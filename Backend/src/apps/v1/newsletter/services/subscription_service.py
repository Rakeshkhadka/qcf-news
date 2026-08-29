"""
Newsletter subscription service.

Implements a double opt-in list:

    subscribe → pending row + emailed link → confirm → confirmed
                                                    ↘ unsubscribe → unsubscribed

Nothing is ever mailed to an address that has not clicked the link in a
message sent to that address, which is the whole point of the exercise: it is
what makes the consent record worth anything, and it is what keeps a typo or a
malicious signup from turning into somebody else's unwanted mail.

Three rules shape most of what follows:

1. **The endpoint never reveals whether an address is on the list.**  Every
   outcome of `subscribe` — new, resent, throttled, already confirmed —
   returns the same message and the same status code.  Otherwise the form is a
   free membership oracle for anyone with a list of addresses to check.
2. **A recorded subscription implies a sent email.**  The confirmation mail
   goes out inside the unit of work, so a relay failure rolls the row back
   rather than leaving a pending signup nobody was told about.
3. **Opt-out is never undone by accident.**  Unsubscribing keeps the row as
   the record of the opt-out; coming back requires a fresh trip through the
   confirmation link.
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import status

from src.apps.v1.newsletter import emails
from src.apps.v1.newsletter.models.subscriber import (
    NewsletterSubscriber,
    SubscriptionStatus,
)
from src.apps.v1.newsletter.schemas.newsletter import (
    SubscribeRequest,
    SubscriberOutput,
)
from src.apps.v1.newsletter.tokens import (
    generate_token,
    hash_token,
    parse_unsubscribe_token,
    unsubscribe_token,
)
from src.apps.v1.newsletter.unit_of_work.interfaces import INewsletterUnitOfWork
from src.config.settings import settings
from src.utils.exceptions import (
    InvalidDataException,
    NotFoundException,
    ServiceUnavailableException,
)
from src.utils.mailer import MailDeliveryError, Mailer
from src.utils.response import ResponseSuccess

logger = logging.getLogger(__name__)

#: One message for every outcome of a signup attempt.  See rule 1 above.
SIGNUP_ACCEPTED = (
    "Check your inbox — if that address isn't subscribed yet, "
    "a confirmation link is on its way."
)

#: Deliberately identical for an unknown token, a used one and an expired one:
#: distinguishing them would confirm which tokens exist.
INVALID_LINK = "That link is invalid or has expired. Try subscribing again."


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _as_aware(value: Optional[datetime]) -> Optional[datetime]:
    """
    Treat a naive timestamp as UTC.

    The columns are `TIMESTAMPTZ` and asyncpg returns aware datetimes, but a
    row written by a migration or by psycopg2 tooling can come back naive, and
    comparing the two raises `TypeError` mid-request.
    """
    if value is None or value.tzinfo is not None:
        return value
    return value.replace(tzinfo=timezone.utc)


class SubscriptionService:
    def __init__(self, uow: INewsletterUnitOfWork, mailer: Mailer):
        self.uow = uow
        self.mailer = mailer

    # ── Public flow ───────────────────────────────────────────────────────

    async def subscribe(
        self,
        payload: SubscribeRequest,
        *,
        client_ip: Optional[str] = None,
        user_agent: Optional[str] = None,
    ):
        """
        Record a signup and mail the confirmation link.

        The mail is sent *inside* the unit of work, so the transaction and the
        message succeed or fail together.  That holds a database transaction
        open for the length of an SMTP conversation, which would be the wrong
        trade at bulk volume — here the endpoint is rate limited to a handful
        of requests per IP per five minutes, and the alternative (commit, then
        send, then hope) produces exactly the silent failure this feature was
        written to eliminate.
        """
        self._require_enabled()

        async with self.uow as uow:
            repo = uow.subscriber_repository
            subscriber = await repo.get_by_email(payload.email)

            # Already on the list: say nothing new and send nothing.  Re-mailing
            # a confirmed subscriber on demand would make the form a way to
            # pester them.
            if subscriber and subscriber.status == SubscriptionStatus.CONFIRMED:
                return self._accepted()

            # Recently mailed and still pending: the link in their inbox is
            # live, and a second one would only be a second unsolicited email.
            if subscriber and self._recently_mailed(subscriber):
                return self._accepted()

            token = generate_token()
            now = _utcnow()
            expires = now + timedelta(
                hours=settings.NEWSLETTER_CONFIRM_TOKEN_TTL_HOURS
            )

            if subscriber is None:
                subscriber = NewsletterSubscriber(email=payload.email)
                # Flushes, so the row has the id the unsubscribe token is
                # derived from before any link is written into an email.
                await repo.add(subscriber)

            # Covers the fresh row, a stale pending one, and a returning
            # unsubscriber: all three are consenting again, right now, so the
            # consent evidence is overwritten rather than appended to.
            subscriber.status = SubscriptionStatus.PENDING.value
            subscriber.confirm_token_hash = hash_token(token)
            subscriber.confirm_token_expires_at = expires
            subscriber.confirmed_at = None
            subscriber.unsubscribed_at = None
            subscriber.source = payload.source
            subscriber.consent_ip = client_ip
            subscriber.consent_user_agent = (user_agent or None) and user_agent[:500]

            opt_out = unsubscribe_token(subscriber.id)
            message = emails.confirmation_email(
                confirm_link=emails.confirm_url(token),
                unsubscribe_link=emails.unsubscribe_url(opt_out),
            )
            try:
                await self.mailer.send(
                    to=subscriber.email,
                    headers=emails.list_unsubscribe_headers(opt_out),
                    **message,
                )
            except MailDeliveryError as exc:
                # Leaving the `async with` by exception rolls the row back, so
                # the address is not left pending against a link that was never
                # delivered.  The reader is told to retry, not that they are
                # subscribed.
                raise ServiceUnavailableException(
                    detail="We couldn't send the confirmation email just now. "
                    "Please try again in a few minutes."
                ) from exc

            # Stamped only after a successful send, so a failed attempt does not
            # start the resend throttle running.
            subscriber.confirm_sent_at = now

        return self._accepted()

    async def confirm(self, token: str):
        """
        Complete a double opt-in.

        Idempotent: mail clients prefetch links and readers double-click them,
        and a second visit has to read as success rather than as a broken
        link.  The token is therefore *not* consumed on use — it is rotated
        whenever a new confirmation email is sent, which is what actually
        invalidates an old one.
        """
        self._require_enabled()
        token_hash = hash_token(token)

        async with self.uow as uow:
            subscriber = await uow.subscriber_repository.get_by_confirm_token_hash(
                token_hash
            )
            if subscriber is None:
                raise InvalidDataException(detail=INVALID_LINK)

            if subscriber.status == SubscriptionStatus.CONFIRMED:
                return ResponseSuccess(
                    message="You're already subscribed.",
                    data={"email": subscriber.email},
                ).to_response()

            # An unsubscribe supersedes any confirmation link still in flight;
            # honouring one afterwards would re-subscribe someone who left.
            if subscriber.status == SubscriptionStatus.UNSUBSCRIBED:
                raise InvalidDataException(detail=INVALID_LINK)

            expires_at = _as_aware(subscriber.confirm_token_expires_at)
            if expires_at is None or expires_at < _utcnow():
                raise InvalidDataException(detail=INVALID_LINK)

            subscriber.status = SubscriptionStatus.CONFIRMED.value
            subscriber.confirmed_at = _utcnow()
            email = subscriber.email
            opt_out = unsubscribe_token(subscriber.id)

        # Outside the unit of work on purpose: the consent is recorded and
        # committed, and a welcome note that fails to send must not undo it.
        await self._send_welcome(email, opt_out)

        return ResponseSuccess(
            message="Subscription confirmed.", data={"email": email}
        ).to_response()

    async def unsubscribe(self, token: str):
        """
        Opt out.

        Works whether or not the newsletter is currently enabled — switching
        the feature off must never be a reason a person cannot leave the list.
        Idempotent for the same reason `confirm` is, and the token keeps
        working afterwards — it is derived from the row rather than stored, so
        a link in a two-year-old email still leads somewhere sensible.
        """
        subscriber_id = parse_unsubscribe_token(token)
        if subscriber_id is None:
            raise InvalidDataException(detail=INVALID_LINK)

        async with self.uow as uow:
            subscriber = await uow.subscriber_repository.get_by_id(subscriber_id)
            if subscriber is None:
                raise InvalidDataException(detail=INVALID_LINK)

            if subscriber.status != SubscriptionStatus.UNSUBSCRIBED:
                subscriber.status = SubscriptionStatus.UNSUBSCRIBED.value
                subscriber.unsubscribed_at = _utcnow()
                # A pending confirmation link must not survive an opt-out.
                subscriber.confirm_token_hash = None
                subscriber.confirm_token_expires_at = None

            email = subscriber.email

        return ResponseSuccess(
            message="You've been unsubscribed.", data={"email": email}
        ).to_response()

    # ── Admin ─────────────────────────────────────────────────────────────

    async def list_subscribers(
        self,
        *,
        status_filter: Optional[str] = None,
        search: Optional[str] = None,
        limit: int = 20,
        offset: int = 0,
    ):
        if status_filter and status_filter not in {
            s.value for s in SubscriptionStatus
        }:
            raise InvalidDataException(
                detail=f"Unknown status '{status_filter}'"
            )

        async with self.uow as uow:
            subscribers, total = await uow.subscriber_repository.get_all(
                status=status_filter, search=search, limit=limit, offset=offset
            )
            data = [
                SubscriberOutput.model_validate(s).model_dump(mode="json")
                for s in subscribers
            ]
        return ResponseSuccess(
            message="Newsletter subscribers", data=data, total_count=total
        ).to_response()

    async def delete_subscriber(self, subscriber_id: int):
        """
        Erase one subscriber outright.

        This is the erasure path, not the opt-out path: it destroys the consent
        record along with the address, so a person deleted here can sign up
        again from scratch with no trace of the previous subscription. Use
        `unsubscribe` to take somebody off the mailing while keeping the proof
        that they asked to leave.
        """
        async with self.uow as uow:
            subscriber = await uow.subscriber_repository.get_by_id(subscriber_id)
            if subscriber is None:
                raise NotFoundException(detail="Subscriber not found")
            await uow.subscriber_repository.delete(subscriber)

        return ResponseSuccess(
            message="Subscriber deleted", data={"id": subscriber_id}
        ).to_response()

    # ── Internals ─────────────────────────────────────────────────────────

    @staticmethod
    def _require_enabled() -> None:
        if not settings.NEWSLETTER_ENABLED:
            raise ServiceUnavailableException(
                detail="The newsletter is not accepting signups right now."
            )

    @staticmethod
    def _accepted():
        return ResponseSuccess(
            message=SIGNUP_ACCEPTED,
            data=None,
            status_code=status.HTTP_202_ACCEPTED,
        ).to_response()

    @staticmethod
    def _recently_mailed(subscriber: NewsletterSubscriber) -> bool:
        """
        Has this address been sent a confirmation link too recently to send
        another?

        Keyed on the recipient rather than on the caller, because the abuse
        this prevents — using the form to bury somebody in mail — is trivially
        spread across IP addresses and would slip straight through the per-IP
        limiter.
        """
        sent_at = _as_aware(subscriber.confirm_sent_at)
        if sent_at is None:
            return False
        gap = timedelta(seconds=settings.NEWSLETTER_RESEND_INTERVAL_SECONDS)
        return _utcnow() - sent_at < gap

    async def _send_welcome(self, email: str, opt_out_token: str) -> None:
        message = emails.welcome_email(
            unsubscribe_link=emails.unsubscribe_url(opt_out_token)
        )
        try:
            await self.mailer.send(
                to=email,
                headers=emails.list_unsubscribe_headers(opt_out_token),
                **message,
            )
        except MailDeliveryError:
            # Best-effort by design. The subscription is already confirmed and
            # committed; the reader is told so by the page they are looking at,
            # and a missing welcome note is not worth failing that page for.
            logger.warning(
                "Welcome email could not be delivered", exc_info=True
            )
