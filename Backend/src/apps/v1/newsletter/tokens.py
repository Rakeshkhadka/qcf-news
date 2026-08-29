"""
The opaque tokens behind the confirm and unsubscribe links.

The two links have opposite requirements, so they are built two different
ways — and getting that backwards is how newsletters end up with unsubscribe
buttons that 404 a month after the email was sent.

**Confirmation tokens are random and stored as a digest.**  They are
short-lived, single-purpose and must be revocable: sending a new confirmation
email has to invalidate the previous one.  A random token whose SHA-256 lives
in the row does all three, and a leaked database gives up nothing usable.

**Unsubscribe tokens are derived, not stored.**  An unsubscribe link has to
keep working for as long as the email it sits in exists — CAN-SPAM puts the
floor at 30 days and readers keep mail for years — so it cannot be rotated,
and rotation is exactly what a stored random token invites.  Instead the token
is `<id>.<HMAC(secret, id)>`: recomputable at any time from the row, verifiable
in constant time, stable forever, and worthless without the server secret.
"""
import hashlib
import hmac
import secrets

from src.config.settings import settings

#: 256 bits of CSPRNG output, URL-safe base64 → 43 characters.
TOKEN_BYTES = 32

#: Upper bound on a token arriving from a request, so a megabyte of query
#: string is rejected before it reaches a hash function or the database.
MAX_TOKEN_LENGTH = 128

#: Nothing shorter than this can be one of ours.
MIN_TOKEN_LENGTH = 8

#: Domain separation: the same secret must not produce the same digest for two
#: different purposes, or a token minted for one becomes valid for the other.
_UNSUBSCRIBE_PURPOSE = b"newsletter-unsubscribe-v1"


def generate_token() -> str:
    """A fresh, unguessable confirmation token."""
    return secrets.token_urlsafe(TOKEN_BYTES)


def hash_token(token: str) -> str:
    """
    SHA-256 — deliberately not a password hash.

    The input is 256 bits of uniform random data, so there is no dictionary to
    attack and no work factor worth paying.  The digest exists so that a stolen
    row cannot be replayed as a working link, and a fast hash is the right tool
    for that.  Returns 64 hex characters, matching the column width.
    """
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _unsubscribe_secret() -> bytes:
    """
    Key for the unsubscribe HMAC.

    `NEWSLETTER_TOKEN_SECRET` when set, otherwise the JWT signing key — which
    keeps a working default, at the cost that rotating the JWT key also
    invalidates every unsubscribe link already sitting in somebody's inbox.
    Set the dedicated secret to decouple the two.
    """
    secret = settings.NEWSLETTER_TOKEN_SECRET or settings.JWT_SECRET_KEY
    return secret.encode("utf-8")


def unsubscribe_token(subscriber_id: int) -> str:
    """
    The permanent opt-out token for one subscriber.

    Derived, so it survives re-subscribes, secret rotation of the *confirm*
    tokens, and anything else that rewrites the row.
    """
    digest = hmac.new(
        _unsubscribe_secret(),
        _UNSUBSCRIBE_PURPOSE + str(subscriber_id).encode("ascii"),
        hashlib.sha256,
    ).hexdigest()
    return f"{subscriber_id}.{digest}"


def parse_unsubscribe_token(token: str) -> int | None:
    """
    Recover the subscriber id from an unsubscribe token, or ``None``.

    The comparison is constant-time.  A timing oracle here would leak the valid
    digest one byte at a time, which is enough to unsubscribe the whole list.
    """
    raw_id, separator, _ = token.partition(".")
    if not separator or not raw_id.isdigit():
        return None
    try:
        subscriber_id = int(raw_id)
    except ValueError:  # pragma: no cover — isdigit already excludes this
        return None
    if subscriber_id <= 0:
        return None
    if not hmac.compare_digest(token, unsubscribe_token(subscriber_id)):
        return None
    return subscriber_id
