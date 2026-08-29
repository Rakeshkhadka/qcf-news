"""
Pydantic schemas for the Newsletter domain.
"""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, Field, field_validator

#: Column width in `newsletter_subscribers.email`.  `EmailStr` validates the
#: shape but not the length, and an address longer than the column would fail
#: at the database instead of at the edge.
MAX_EMAIL_LENGTH = 320

#: Free-text label naming the form the signup came from.  Constrained to a
#: short slug so it can be trusted in a GROUP BY and in the admin list.
SOURCE_PATTERN = r"^[a-z0-9][a-z0-9-]{0,49}$"


class SubscribeRequest(BaseModel):
    """A signup as submitted by the public form."""

    email: EmailStr
    source: Optional[str] = Field(None, pattern=SOURCE_PATTERN, max_length=50)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        """
        Fold to the canonical form actually stored.

        Only case and surrounding whitespace are touched.  Nothing else is
        "helpfully" rewritten — stripping Gmail-style `+tags` or dots would
        silently subscribe an address the reader did not type, and for some
        providers those are genuinely different mailboxes.
        """
        normalized = value.strip().lower()
        if len(normalized) > MAX_EMAIL_LENGTH:
            raise ValueError(f"Email must be at most {MAX_EMAIL_LENGTH} characters")
        return normalized


class SubscriberOutput(BaseModel):
    """
    One subscriber, as the admin list returns it.

    The token digests are absent by construction: nothing outside the service
    layer has any use for them.
    """

    id: int
    email: str
    status: str
    source: Optional[str] = None
    confirmed_at: Optional[datetime] = None
    unsubscribed_at: Optional[datetime] = None
    created_at: datetime

    model_config = {"from_attributes": True}
