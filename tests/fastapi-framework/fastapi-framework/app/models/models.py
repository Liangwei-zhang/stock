"""
Minimal User model — replace or extend with your own domain models.

This is the only model the framework ships with. The auth router
(app/api/auth.py) depends on it for login/register.

To add your own models:
    1. Create new SQLModel classes in this file (or split into separate files).
    2. Import them in app/main.py so SQLModel.metadata picks them up at init_db().
"""
from sqlmodel import SQLModel, Field
from sqlalchemy import Index
from datetime import datetime
from typing import Optional


class User(SQLModel, table=True):
    """Generic user / account table. Rename or extend as needed."""
    __tablename__ = "users"

    id:            Optional[int] = Field(default=None, primary_key=True)
    name:          str           = Field(max_length=100)
    email:         str           = Field(unique=True, max_length=200)
    password_hash: str

    role:          str           = Field(default="user", max_length=50)  # e.g. "user", "admin"

    created_at:    Optional[datetime] = Field(default_factory=datetime.utcnow)
    updated_at:    Optional[datetime] = Field(default_factory=datetime.utcnow)

    __table_args__ = (
        Index("idx_user_email", "email"),
        Index("idx_user_role",  "role"),
    )
