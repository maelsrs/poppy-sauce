from datetime import datetime, timezone
from typing import List

import bcrypt
from fastapi import APIRouter, HTTPException, status

from app.db.client import ensure_db
from app.models.user import UserCreate, UserDocument, UserPublic, UserRank


router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=List[UserPublic])
async def list_users() -> List[UserPublic]:
    await ensure_db()
    return await UserDocument.find_all().to_list()


@router.get("/{uuid}", response_model=UserPublic)
async def get_user(uuid: str) -> UserPublic:
    await ensure_db()
    user = await UserDocument.find_one({"uuid": uuid})
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé.")
    return user.to_public()


@router.post("", response_model=UserPublic, status_code=status.HTTP_201_CREATED)
async def create_user(payload: UserCreate) -> UserPublic:
    await ensure_db()
    email = payload.email.lower()

    if await UserDocument.find_one({"email": email}):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Cette adresse email est déjà utilisée.")

    if await UserDocument.find_one({"username": payload.username}):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Ce pseudo est déjà pris.")

    now = datetime.now(timezone.utc)
    password_hash = bcrypt.hashpw(payload.password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    user = UserDocument(
        username=payload.username,
        email=email,
        password_hash=password_hash,
        rank=UserRank.USER,
        level=1,
        playtime=0,
        first_login=now,
        last_login=now,
    )
    await user.insert()
    return user.to_public()
