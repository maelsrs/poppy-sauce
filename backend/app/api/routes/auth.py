from datetime import datetime, timezone

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field

from app.core.security import create_access_token, get_current_user
from app.db.client import ensure_db
from app.models.user import UserCreate, UserDocument, UserPublic, UserRank


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserPublic

    class Config:
        orm_mode = True


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8)


class RegisterRequest(UserCreate):
    username: str = Field(..., min_length=3, max_length=64)
    email: EmailStr
    password: str = Field(..., min_length=8)


router = APIRouter(prefix="/auth", tags=["auth"])


def hash_password(raw_password: str) -> str:
    return bcrypt.hashpw(raw_password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def build_response(user: UserDocument) -> AuthResponse:
    token = create_access_token(user.uuid)
    return AuthResponse(access_token=token, user=user.to_public())


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def register(payload: RegisterRequest) -> AuthResponse:
    await ensure_db()

    email = payload.email.lower()

    if await UserDocument.find_one({"email": email}):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Cette adresse email est déjà utilisée.")

    if await UserDocument.find_one({"username": payload.username}):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Ce pseudo est déjà pris.")

    now = datetime.now(timezone.utc)
    user = UserDocument(
        username=payload.username,
        email=email,
        password_hash=hash_password(payload.password),
        rank=UserRank.USER,
        level=1,
        playtime=0,
        first_login=now,
        last_login=now,
    )
    await user.insert()
    return build_response(user)


@router.post("/login", response_model=AuthResponse)
async def login(payload: LoginRequest) -> AuthResponse:
    await ensure_db()
    email = payload.email.lower()
    user = await UserDocument.find_one({"email": email})
    if not user or not bcrypt.checkpw(payload.password.encode("utf-8"), user.password_hash.encode("utf-8")):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Email ou mot de passe incorrect.")

    user.last_login = datetime.now(timezone.utc)
    await user.save()
    return build_response(user)


@router.get("/me", response_model=UserPublic)
async def me(current_user: UserDocument = Depends(get_current_user)) -> UserPublic:
    return current_user.to_public()
