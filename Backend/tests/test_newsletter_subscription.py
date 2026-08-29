"""
Policy behaviour of the double opt-in newsletter.

The rules pinned here are the ones a reader or a regulator would notice if they
broke, and none of them is visible from the endpoint's happy path:

  • nobody is subscribed until they click a link sent to their own address;
  • a recorded subscription always implies an email that actually went out;
  • the signup response never reveals whether an address is on the list;
  • confirming and unsubscribing are idempotent, because mail clients prefetch
    links and readers double-click them;
  • an unsubscribe link keeps working forever, and keeps working even while
    signups are switched off.

No database and no mail server: the unit of work and the mailer are stood in
for, which is enough to exercise every branch above.
"""
import unittest
from datetime import timedelta

from src.apps.v1.newsletter import tokens
from src.apps.v1.newsletter.models.subscriber import (
    NewsletterSubscriber,
    SubscriptionStatus,
)
from src.apps.v1.newsletter.schemas.newsletter import SubscribeRequest
from src.apps.v1.newsletter.services.subscription_service import (
    SubscriptionService,
    _utcnow,
)
from src.config.settings import settings
from src.utils.exceptions import DomainException
from src.utils.mailer import MailDeliveryError


class _Repository:
    """In-memory stand-in, keyed by id like the real table."""

    def __init__(self, rows: dict[int, NewsletterSubscriber]):
        self.rows = rows
        self.added: list[NewsletterSubscriber] = []

    async def get_by_email(self, email):
        return next((s for s in self.rows.values() if s.email == email), None)

    async def get_by_confirm_token_hash(self, token_hash):
        return next(
            (s for s in self.rows.values() if s.confirm_token_hash == token_hash),
            None,
        )

    async def get_by_id(self, subscriber_id):
        return self.rows.get(subscriber_id)

    async def add(self, subscriber):
        # Mirrors the real repository, which flushes so the row has its id
        # before anything derives an unsubscribe token from it.
        subscriber.id = max(self.rows, default=0) + 1
        self.added.append(subscriber)
        return subscriber.id

    async def get_all(self, **_kwargs):
        return list(self.rows.values()), len(self.rows)

    async def delete(self, subscriber):
        self.rows.pop(subscriber.id, None)


class _UnitOfWork:
    """Commits added rows on a clean exit; discards every change on an error."""

    def __init__(self, rows: dict[int, NewsletterSubscriber]):
        self.rows = rows

    async def __aenter__(self):
        self._snapshot = {i: dict(s.__dict__) for i, s in self.rows.items()}
        self.subscriber_repository = _Repository(self.rows)
        return self

    async def __aexit__(self, exc_type, exc_value, traceback):
        if exc_type:
            for subscriber_id, state in self._snapshot.items():
                self.rows[subscriber_id].__dict__.update(state)
        else:
            for subscriber in self.subscriber_repository.added:
                self.rows[subscriber.id] = subscriber
        return False


class _Mailer:
    def __init__(self):
        self.sent: list[dict] = []
        self.broken = False

    async def send(self, *, to, subject, text_body, html_body=None, headers=None):
        if self.broken:
            raise MailDeliveryError("relay refused the message")
        self.sent.append(
            {"to": to, "subject": subject, "body": text_body, "headers": headers or {}}
        )


def _link(message: dict, path: str) -> str:
    """Pull the first URL containing `path` out of a plain-text message body."""
    for word in message["body"].split():
        if path in word:
            return word.rstrip(".")
    raise AssertionError(f"no {path} link in the message body")


def _token_of(link: str) -> str:
    return link.partition("token=")[2]


class NewsletterSubscriptionTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.rows: dict[int, NewsletterSubscriber] = {}
        self.mailer = _Mailer()
        self.service = SubscriptionService(_UnitOfWork(self.rows), self.mailer)

        # The service reads configuration directly; put it in the state these
        # tests describe and put it back afterwards.
        self._saved = {
            name: getattr(settings, name)
            for name in ("NEWSLETTER_ENABLED", "SITE_BASE_URL", "POSTAL_ADDRESS")
        }
        settings.NEWSLETTER_ENABLED = True
        settings.SITE_BASE_URL = "https://example.com"
        settings.POSTAL_ADDRESS = "1 Example Street"

    def tearDown(self):
        for name, value in self._saved.items():
            setattr(settings, name, value)

    async def _subscribe(self, email="reader@example.com", **kwargs):
        return await self.service.subscribe(SubscribeRequest(email=email), **kwargs)

    # ── Signing up ────────────────────────────────────────────────────────

    async def test_signup_records_a_pending_row_and_mails_a_link(self):
        response = await self._subscribe(
            client_ip="203.0.113.9", user_agent="Firefox/141"
        )

        self.assertEqual(202, response.status_code)
        subscriber = self.rows[1]
        self.assertEqual(SubscriptionStatus.PENDING.value, subscriber.status)
        self.assertIsNone(subscriber.confirmed_at)
        self.assertEqual(1, len(self.mailer.sent))
        self.assertIn("/newsletter/confirm", self.mailer.sent[0]["body"])

    async def test_signup_stores_the_consent_evidence(self):
        await self._subscribe(client_ip="203.0.113.9", user_agent="Firefox/141")

        subscriber = self.rows[1]
        self.assertEqual("203.0.113.9", subscriber.consent_ip)
        self.assertEqual("Firefox/141", subscriber.consent_user_agent)
        self.assertIsNotNone(subscriber.confirm_sent_at)

    async def test_the_address_is_normalised_before_it_is_stored(self):
        await self.service.subscribe(SubscribeRequest(email="  Reader@Example.COM  "))
        self.assertEqual("reader@example.com", self.rows[1].email)

    async def test_the_confirmation_token_is_stored_only_as_a_digest(self):
        await self._subscribe()

        token = _token_of(_link(self.mailer.sent[0], "/newsletter/confirm"))
        subscriber = self.rows[1]
        self.assertNotEqual(token, subscriber.confirm_token_hash)
        self.assertEqual(tokens.hash_token(token), subscriber.confirm_token_hash)

    async def test_every_message_carries_one_click_unsubscribe_headers(self):
        await self._subscribe()

        headers = self.mailer.sent[0]["headers"]
        self.assertIn("List-Unsubscribe", headers)
        self.assertEqual(
            "List-Unsubscribe=One-Click", headers["List-Unsubscribe-Post"]
        )

    async def test_the_postal_address_appears_in_the_message(self):
        await self._subscribe()
        self.assertIn("1 Example Street", self.mailer.sent[0]["body"])

    # ── Not leaking who is on the list ────────────────────────────────────

    async def test_every_signup_outcome_answers_identically(self):
        first = await self._subscribe()

        # Throttled resend.
        throttled = await self._subscribe()
        self.assertEqual(first.body, throttled.body)
        self.assertEqual(first.status_code, throttled.status_code)

        # Already confirmed.
        self.rows[1].status = SubscriptionStatus.CONFIRMED.value
        confirmed = await self._subscribe()
        self.assertEqual(first.body, confirmed.body)
        self.assertEqual(first.status_code, confirmed.status_code)

    async def test_a_confirmed_subscriber_is_not_mailed_again_by_the_form(self):
        await self._subscribe()
        self.rows[1].status = SubscriptionStatus.CONFIRMED.value

        await self._subscribe()
        self.assertEqual(1, len(self.mailer.sent))

    async def test_a_recent_signup_is_not_mailed_a_second_link(self):
        await self._subscribe()
        await self._subscribe()
        self.assertEqual(1, len(self.mailer.sent))

    async def test_the_throttle_lapses(self):
        await self._subscribe()
        self.rows[1].confirm_sent_at = _utcnow() - timedelta(
            seconds=settings.NEWSLETTER_RESEND_INTERVAL_SECONDS + 1
        )

        await self._subscribe()
        self.assertEqual(2, len(self.mailer.sent))

    # ── A subscription always implies a sent email ────────────────────────

    async def test_a_relay_failure_leaves_no_subscriber_behind(self):
        self.mailer.broken = True

        with self.assertRaises(DomainException) as caught:
            await self._subscribe()

        self.assertEqual(503, caught.exception.error_code.status_code)
        self.assertEqual({}, self.rows)

    async def test_a_relay_failure_does_not_start_the_resend_throttle(self):
        """
        A failed send must not cost the reader their next attempt.

        `confirm_sent_at` is stamped only after the mailer returns, so a relay
        that refuses the message leaves the old timestamp in place — and the
        retry a moment later is mailed rather than silently throttled.
        """
        await self._subscribe()
        self.rows[1].confirm_sent_at = _utcnow() - timedelta(days=1)
        self.mailer.broken = True

        with self.assertRaises(DomainException):
            await self._subscribe()

        self.mailer.broken = False
        await self._subscribe()

        self.assertEqual(2, len(self.mailer.sent))

    # ── Confirming ────────────────────────────────────────────────────────

    async def _confirm_first_signup(self):
        await self._subscribe()
        token = _token_of(_link(self.mailer.sent[0], "/newsletter/confirm"))
        return token, await self.service.confirm(token)

    async def test_confirming_completes_the_subscription(self):
        _, response = await self._confirm_first_signup()

        self.assertEqual(200, response.status_code)
        self.assertEqual(SubscriptionStatus.CONFIRMED.value, self.rows[1].status)
        self.assertIsNotNone(self.rows[1].confirmed_at)

    async def test_confirming_sends_exactly_one_welcome(self):
        await self._confirm_first_signup()
        self.assertEqual(2, len(self.mailer.sent))
        self.assertIn("/newsletter/unsubscribe", self.mailer.sent[1]["body"])

    async def test_confirming_twice_is_not_an_error(self):
        token, _ = await self._confirm_first_signup()

        response = await self.service.confirm(token)

        self.assertEqual(200, response.status_code)
        self.assertEqual(2, len(self.mailer.sent))

    async def test_an_expired_link_is_refused(self):
        await self._subscribe()
        token = _token_of(_link(self.mailer.sent[0], "/newsletter/confirm"))
        self.rows[1].confirm_token_expires_at = _utcnow() - timedelta(seconds=1)

        with self.assertRaises(DomainException) as caught:
            await self.service.confirm(token)

        self.assertEqual(400, caught.exception.error_code.status_code)

    async def test_an_unknown_link_is_refused(self):
        with self.assertRaises(DomainException):
            await self.service.confirm(tokens.generate_token())

    async def test_a_confirmation_cannot_resurrect_an_unsubscriber(self):
        await self._subscribe()
        token = _token_of(_link(self.mailer.sent[0], "/newsletter/confirm"))
        self.rows[1].status = SubscriptionStatus.UNSUBSCRIBED.value

        with self.assertRaises(DomainException):
            await self.service.confirm(token)

    # ── Unsubscribing ─────────────────────────────────────────────────────

    async def test_unsubscribing_takes_the_address_off_the_list(self):
        await self._confirm_first_signup()
        token = _token_of(_link(self.mailer.sent[1], "/newsletter/unsubscribe"))

        response = await self.service.unsubscribe(token)

        self.assertEqual(200, response.status_code)
        self.assertEqual(SubscriptionStatus.UNSUBSCRIBED.value, self.rows[1].status)
        self.assertIsNotNone(self.rows[1].unsubscribed_at)

    async def test_unsubscribing_twice_is_not_an_error(self):
        await self._confirm_first_signup()
        token = _token_of(_link(self.mailer.sent[1], "/newsletter/unsubscribe"))

        await self.service.unsubscribe(token)
        response = await self.service.unsubscribe(token)

        self.assertEqual(200, response.status_code)

    async def test_unsubscribing_kills_any_confirmation_link_still_in_flight(self):
        await self._subscribe()
        token = _token_of(_link(self.mailer.sent[0], "/newsletter/unsubscribe"))

        await self.service.unsubscribe(token)

        self.assertIsNone(self.rows[1].confirm_token_hash)

    async def test_a_tampered_unsubscribe_token_is_refused(self):
        await self._subscribe()

        with self.assertRaises(DomainException):
            await self.service.unsubscribe("1." + "0" * 64)

    async def test_the_unsubscribe_link_survives_a_re_subscribe(self):
        """
        The link in a two-year-old email has to keep working.

        This is the reason the token is derived from the row rather than stored
        in it: anything stored is something a later signup would rotate.
        """
        await self._subscribe()
        original = _token_of(_link(self.mailer.sent[0], "/newsletter/unsubscribe"))
        self.rows[1].confirm_sent_at = None

        await self._subscribe()
        reissued = _token_of(_link(self.mailer.sent[1], "/newsletter/unsubscribe"))

        self.assertEqual(original, reissued)

    async def test_unsubscribing_works_while_signups_are_disabled(self):
        """Switching the feature off must never trap somebody on the list."""
        await self._subscribe()
        token = _token_of(_link(self.mailer.sent[0], "/newsletter/unsubscribe"))
        settings.NEWSLETTER_ENABLED = False

        response = await self.service.unsubscribe(token)

        self.assertEqual(200, response.status_code)

    # ── Coming back ───────────────────────────────────────────────────────

    async def test_re_subscribing_after_leaving_needs_fresh_confirmation(self):
        await self._subscribe()
        token = _token_of(_link(self.mailer.sent[0], "/newsletter/unsubscribe"))
        await self.service.unsubscribe(token)
        self.rows[1].confirm_sent_at = None

        await self._subscribe()

        self.assertEqual(SubscriptionStatus.PENDING.value, self.rows[1].status)
        self.assertEqual(2, len(self.mailer.sent))

    # ── The feature switch ────────────────────────────────────────────────

    async def test_signups_are_refused_when_the_newsletter_is_off(self):
        settings.NEWSLETTER_ENABLED = False

        with self.assertRaises(DomainException) as caught:
            await self._subscribe()

        self.assertEqual(503, caught.exception.error_code.status_code)
        self.assertEqual([], self.mailer.sent)


class UnsubscribeTokenTests(unittest.TestCase):
    """The derived opt-out token, on its own."""

    def test_a_token_round_trips_to_its_subscriber(self):
        self.assertEqual(42, tokens.parse_unsubscribe_token(tokens.unsubscribe_token(42)))

    def test_the_same_row_always_derives_the_same_token(self):
        self.assertEqual(tokens.unsubscribe_token(42), tokens.unsubscribe_token(42))

    def test_two_rows_do_not_share_a_token(self):
        self.assertNotEqual(tokens.unsubscribe_token(42), tokens.unsubscribe_token(43))

    def test_a_swapped_id_does_not_verify(self):
        digest = tokens.unsubscribe_token(42).partition(".")[2]
        self.assertIsNone(tokens.parse_unsubscribe_token(f"43.{digest}"))

    def test_malformed_tokens_are_rejected_rather_than_raising(self):
        for candidate in ("", ".", "abc", "abc.def", "-1.deadbeef", "0.deadbeef"):
            with self.subTest(candidate=candidate):
                self.assertIsNone(tokens.parse_unsubscribe_token(candidate))


if __name__ == "__main__":
    unittest.main()
