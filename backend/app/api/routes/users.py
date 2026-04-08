from fastapi import APIRouter, HTTPException

from app.db.client import ensure_db
from app.models.user import UserDocument, UserPublic


router = APIRouter(prefix="/users", tags=["users"])


@router.get("/{uuid}", response_model=UserPublic)
async def get_user(uuid: str) -> UserPublic:
    await ensure_db()
    user = await UserDocument.find_one({"uuid": uuid})
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé.")
    return user.to_public()
