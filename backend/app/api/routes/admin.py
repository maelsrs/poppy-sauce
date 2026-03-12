from math import ceil
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from app.core.security import get_current_user
from app.models.question import QuestionDocument
from app.models.user import UserDocument, UserPublic, UserRank

router = APIRouter(prefix="/admin", tags=["admin"])


async def require_admin(current_user: UserDocument = Depends(get_current_user)) -> UserDocument:
    if current_user.rank != UserRank.ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accès réservé aux administrateurs.")
    return current_user


class PaginatedUsers(BaseModel):
    items: List[UserPublic]
    total: int
    page: int
    per_page: int
    pages: int


class QuestionOut(BaseModel):
    question_id: int
    question_type: str
    category: str
    question: str
    answers: List[str]
    image_url: Optional[str] = None


class PaginatedQuestions(BaseModel):
    items: List[QuestionOut]
    total: int
    page: int
    per_page: int
    pages: int


@router.get("/users", response_model=PaginatedUsers)
async def admin_list_users(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    _admin: UserDocument = Depends(require_admin),
):
    total = await UserDocument.count()
    pages = max(1, ceil(total / per_page))
    skip = (page - 1) * per_page
    users = await UserDocument.find_all().skip(skip).limit(per_page).to_list()
    return PaginatedUsers(
        items=[u.to_public() for u in users],
        total=total,
        page=page,
        per_page=per_page,
        pages=pages,
    )


@router.get("/questions/categories", response_model=List[str])
async def admin_list_categories(
    _admin: UserDocument = Depends(require_admin),
):
    categories = await QuestionDocument.distinct("category")
    return sorted(categories)


@router.get("/questions", response_model=PaginatedQuestions)
async def admin_list_questions(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    category: Optional[str] = Query(None),
    _admin: UserDocument = Depends(require_admin),
):
    query = QuestionDocument.find({"category": category}) if category else QuestionDocument.find_all()
    total = await query.count()
    pages = max(1, ceil(total / per_page))
    skip = (page - 1) * per_page
    questions = await QuestionDocument.find({"category": category}).skip(skip).limit(per_page).to_list() if category else await QuestionDocument.find_all().skip(skip).limit(per_page).to_list()
    return PaginatedQuestions(
        items=[
            QuestionOut(
                question_id=q.question_id,
                question_type=q.question_type.value,
                category=q.category,
                question=q.question,
                answers=q.answers,
                image_url=str(q.image_url) if q.image_url else None,
            )
            for q in questions
        ],
        total=total,
        page=page,
        per_page=per_page,
        pages=pages,
    )
