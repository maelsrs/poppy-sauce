from datetime import datetime
from enum import Enum
from typing import Optional
from uuid import uuid4

from beanie import Document
from beanie.odm.fields import Indexed
from pydantic import BaseModel, EmailStr, Field


class UserRank(str, Enum):
    ADMIN = "Admin"
    USER = "User"


class UserDocument(Document):
    uuid: Indexed(str, unique=True) = Field(default_factory=lambda: str(uuid4()))
    username: Indexed(str, unique=True) = Field(..., min_length=3, max_length=64)
    password_hash: str = Field(..., min_length=8)
    rank: UserRank = Field(default=UserRank.USER)
    email: Indexed(EmailStr, unique=True) = Field(...)
    last_login: Optional[datetime] = Field(default=None)
    level: int = Field(default=1, ge=0)
    first_login: Optional[datetime] = Field(default=None)
    playtime: int = Field(default=0, ge=0)

    games_played: int = Field(default=0, ge=0)
    wins: int = Field(default=0, ge=0)
    correct_answers: int = Field(default=0, ge=0)
    total_answers: int = Field(default=0, ge=0)
    best_score: int = Field(default=0, ge=0)
    total_response_time_ms: int = Field(default=0, ge=0)
    total_responses: int = Field(default=0, ge=0)

    class Settings:
        name = "users"

    def to_public(self) -> "UserPublic":
        return UserPublic.from_orm(self)


class UserCreate(BaseModel):
    username: str = Field(..., min_length=3, max_length=64)
    password: str = Field(..., min_length=8)
    email: EmailStr


class UserPublic(BaseModel):
    uuid: str
    username: str
    rank: UserRank
    last_login: Optional[datetime] = None
    first_login: Optional[datetime] = None
    level: int = 1
    playtime: int = 0
    games_played: int = 0
    wins: int = 0
    correct_answers: int = 0
    total_answers: int = 0
    best_score: int = 0
    total_response_time_ms: int = 0
    total_responses: int = 0

    class Config:
        orm_mode = True
