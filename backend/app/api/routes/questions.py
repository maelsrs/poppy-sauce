from typing import List

from fastapi import APIRouter

from app.db.client import ensure_db
from app.models.question import QuestionDocument


router = APIRouter(prefix="/questions", tags=["questions"])


@router.get("/categories", response_model=List[str])
async def list_categories() -> List[str]:
    await ensure_db()
    pipeline = [
        {"$group": {"_id": "$category"}},
        {"$sort": {"_id": 1}},
    ]
    cursor = QuestionDocument.get_pymongo_collection().aggregate(pipeline)
    return [row["_id"] async for row in cursor if row.get("_id")]
