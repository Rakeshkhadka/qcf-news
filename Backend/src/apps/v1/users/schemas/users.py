"""
Pydantic schemas for the Users domain.
"""
from typing import Optional

from pydantic import BaseModel, EmailStr, Field


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8)


class UserOutput(BaseModel):
    id: int
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: str
    is_email_verified: bool = False
    is_superuser: bool = False
    # Carried on the DTO because deactivation has to be enforceable at login
    # and on every token exchange, not only in the admin listing.
    is_active: bool = True

    model_config = {"from_attributes": True}


class UserWithPassword(UserOutput):
    password: Optional[str] = None

    model_config = {"from_attributes": True}


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserUpdate(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None


class ChangePassword(BaseModel):
    old_password: str
    new_password: str = Field(..., min_length=8)


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    user_id: int
