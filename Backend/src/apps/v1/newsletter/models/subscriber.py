"""
Newsletter subscriber model.

One row per address that has ever asked for the newsletter, carrying the
consent evidence a double opt-in list has to be able to produce on demand:
when the address was submitted, from which form, from which IP and user
agent, when the confirmation link was clicked, and when — if ever — it was
unsubscribed.

Two deliberate departures from the other domain models:

- **No soft delete.**  Everything under `news/` inherits `SoftDeleteMixin`, but
  a soft-deleted row here would keep occupying the unique `email` index while
  the global ORM filter hides it from every query — so the same person could
  never sign up again, and the insert would fail on a constraint the code
  cannot see.  Unsubscribing is a `status` change (the row is the proof of
  opt-out and must survive), and an erasure request is a real DELETE.
- **The confirmation token is stored as a SHA-256 digest, and the unsubscribe
  token is not stored at all.**  Both links are bearer credentials for somebody
  else's mailbox, so a leaked dump must not hand the holder the ability to
  confirm addresses they do not own.  See `tokens.py` for why the two are built
  differently.
"""
from enum import Enum

from sqlalchemy import Column, DateTime, Integer, String

from src.db.base import Base, TimestampMixin


class SubscriptionStatus(str, Enum):
    """
    Lifecycle of one address.

    Stored as a plain string rather than a PostgreSQL ENUM: adding a state to
    a native enum needs its own migration and locks the type, and nothing here
    benefits from the database enforcing the set.
    """

    PENDING = "pending"
    CONFIRMED = "confirmed"
    UNSUBSCRIBED = "unsubscribed"


class NewsletterSubscriber(Base, TimestampMixin):
    __tablename__ = "newsletter_subscribers"

    id = Column(Integer, primary_key=True, index=True)

    # 320 = 64-octet local part + "@" + 255-octet domain, the RFC 3696 ceiling.
    # Stored lower-cased and stripped so "A@x.com" and "a@x.com" collide on the
    # unique index instead of becoming two subscriptions to the same inbox.
    email = Column(String(320), unique=True, nullable=False, index=True)
    status = Column(
        String(20),
        nullable=False,
        default=SubscriptionStatus.PENDING.value,
        index=True,
    )

    # ── Double opt-in ────────────────────────────────────────────────────
    # The hash is unique so a token lookup is a single indexed equality test
    # and can never match two rows.
    confirm_token_hash = Column(String(64), unique=True, nullable=True, index=True)
    confirm_token_expires_at = Column(DateTime(timezone=True), nullable=True)
    # Set only after the confirmation mail actually left the building, so a
    # failed send does not lock the address out of the resend throttle.
    confirm_sent_at = Column(DateTime(timezone=True), nullable=True)
    confirmed_at = Column(DateTime(timezone=True), nullable=True)

    # ── Opt-out ──────────────────────────────────────────────────────────
    # There is no unsubscribe token column: the token is an HMAC over this
    # row's id, recomputed on demand.  See `tokens.py` — an unsubscribe link
    # has to keep working for as long as the email holding it exists, and a
    # stored token is a token something will eventually rotate.
    unsubscribed_at = Column(DateTime(timezone=True), nullable=True)

    # ── Consent evidence ─────────────────────────────────────────────────
    # Which form the address came from ("footer", "article-aside"), and what
    # the request looked like.  Best-effort: the IP is whatever the proxy
    # chain reported, which is evidence of consent, not authentication.
    source = Column(String(50), nullable=True)
    consent_ip = Column(String(45), nullable=True)  # 45 = max INET6 text form
    consent_user_agent = Column(String(500), nullable=True)

    def __repr__(self) -> str:  # pragma: no cover — debugging aid
        return f"<NewsletterSubscriber {self.email} {self.status}>"
