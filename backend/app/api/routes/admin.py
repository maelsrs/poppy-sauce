from math import ceil
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, EmailStr, Field

from app.core.security import get_current_user
from app.models.question import QuestionDocument, QuestionType
from app.models.user import UserDocument, UserPublic, UserRank

router = APIRouter(prefix="/admin", tags=["admin"])


async def require_admin(
    current_user: UserDocument = Depends(get_current_user),
) -> UserDocument:
    if current_user.rank != UserRank.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Accès réservé aux administrateurs.",
        )
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
    description: Optional[str] = None
    image_url: Optional[str] = None


class PaginatedQuestions(BaseModel):
    items: List[QuestionOut]
    total: int
    page: int
    per_page: int
    pages: int


class CategoryStat(BaseModel):
    name: str
    count: int


class QuestionStats(BaseModel):
    total: int
    categories: List[CategoryStat]


class RankStat(BaseModel):
    name: str
    count: int


class UserStats(BaseModel):
    total: int
    ranks: List[RankStat]


class UpdateUserRequest(BaseModel):
    username: Optional[str] = Field(default=None, min_length=3, max_length=64)
    email: Optional[EmailStr] = None
    rank: Optional[UserRank] = None


class CreateQuestionRequest(BaseModel):
    question: str = Field(..., min_length=1)
    answers: List[str] = Field(..., min_items=1)
    category: str = Field(default="Grand public", min_length=1)
    question_type: QuestionType = Field(default=QuestionType.TEXT)
    description: Optional[str] = None
    image_url: Optional[str] = None


class UpdateQuestionRequest(BaseModel):
    question: Optional[str] = Field(default=None, min_length=1)
    answers: Optional[List[str]] = None
    category: Optional[str] = Field(default=None, min_length=1)
    question_type: Optional[QuestionType] = None
    description: Optional[str] = None
    image_url: Optional[str] = None


def _question_to_out(q: QuestionDocument) -> QuestionOut:
    return QuestionOut(
        question_id=q.question_id,
        question_type=q.question_type.value,
        category=q.category,
        question=q.question,
        answers=q.answers,
        description=q.description,
        image_url=str(q.image_url) if q.image_url else None,
    )


@router.get("/users/stats", response_model=UserStats)
async def admin_user_stats(
    _admin: UserDocument = Depends(require_admin),
):
    pipeline = [
        {"$group": {"_id": "$rank", "count": {"$sum": 1}}},
        {"$sort": {"_id": 1}},
    ]
    cursor = UserDocument.get_pymongo_collection().aggregate(pipeline)
    rows = await cursor.to_list(length=None)
    ranks = [RankStat(name=row["_id"], count=row["count"]) for row in rows]
    total = sum(r.count for r in ranks)
    return UserStats(total=total, ranks=ranks)


@router.get("/users", response_model=PaginatedUsers)
async def admin_list_users(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    rank: Optional[str] = Query(None),
    _admin: UserDocument = Depends(require_admin),
):
    if rank:
        query_filter = {"rank": rank}
        total = await UserDocument.find(query_filter).count()
    else:
        query_filter = {}
        total = await UserDocument.get_pymongo_collection().estimated_document_count()
    pages = max(1, ceil(total / per_page))
    skip = (page - 1) * per_page
    users = await UserDocument.find(query_filter).skip(skip).limit(per_page).to_list()
    return PaginatedUsers(
        items=[u.to_public() for u in users],
        total=total,
        page=page,
        per_page=per_page,
        pages=pages,
    )


@router.get("/questions/stats", response_model=QuestionStats)
async def admin_question_stats(
    _admin: UserDocument = Depends(require_admin),
):
    pipeline = [
        {"$group": {"_id": "$category", "count": {"$sum": 1}}},
        {"$sort": {"_id": 1}},
    ]
    cursor = QuestionDocument.get_pymongo_collection().aggregate(pipeline)
    rows = await cursor.to_list(length=None)
    categories = [CategoryStat(name=row["_id"], count=row["count"]) for row in rows]
    total = sum(c.count for c in categories)
    return QuestionStats(total=total, categories=categories)


@router.get("/questions", response_model=PaginatedQuestions)
async def admin_list_questions(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    category: Optional[str] = Query(None),
    _admin: UserDocument = Depends(require_admin),
):
    if category:
        query_filter = {"category": category}
        total = await QuestionDocument.find(query_filter).count()
    else:
        query_filter = {}
        total = (
            await QuestionDocument.get_pymongo_collection().estimated_document_count()
        )
    pages = max(1, ceil(total / per_page))
    skip = (page - 1) * per_page
    questions = (
        await QuestionDocument.find(query_filter).skip(skip).limit(per_page).to_list()
    )
    return PaginatedQuestions(
        items=[_question_to_out(q) for q in questions],
        total=total,
        page=page,
        per_page=per_page,
        pages=pages,
    )


@router.put("/users/{uuid}", response_model=UserPublic)
async def admin_update_user(
    uuid: str,
    payload: UpdateUserRequest,
    _admin: UserDocument = Depends(require_admin),
):
    user = await UserDocument.find_one(UserDocument.uuid == uuid)
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable.")

    if payload.username is not None:
        existing = await UserDocument.find_one(
            UserDocument.username == payload.username
        )
        if existing and existing.uuid != uuid:
            raise HTTPException(status_code=409, detail="Ce pseudo est déjà pris.")
        user.username = payload.username

    if payload.email is not None:
        existing = await UserDocument.find_one({"email": payload.email.lower()})
        if existing and existing.uuid != uuid:
            raise HTTPException(status_code=409, detail="Cet email est déjà utilisé.")
        user.email = payload.email.lower()

    if payload.rank is not None:
        user.rank = payload.rank

    await user.save()
    return user.to_public()


@router.delete("/users/{uuid}", status_code=status.HTTP_204_NO_CONTENT)
async def admin_delete_user(
    uuid: str,
    admin: UserDocument = Depends(require_admin),
):
    if admin.uuid == uuid:
        raise HTTPException(
            status_code=400, detail="Impossible de supprimer votre propre compte."
        )
    user = await UserDocument.find_one(UserDocument.uuid == uuid)
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable.")
    await user.delete()


@router.post(
    "/questions", response_model=QuestionOut, status_code=status.HTTP_201_CREATED
)
async def admin_create_question(
    payload: CreateQuestionRequest,
    _admin: UserDocument = Depends(require_admin),
):
    q = QuestionDocument(
        question=payload.question,
        answers=payload.answers,
        category=payload.category,
        question_type=payload.question_type,
        description=payload.description,
        image_url=payload.image_url,
    )
    await q.insert()
    return _question_to_out(q)


@router.put("/questions/{question_id}", response_model=QuestionOut)
async def admin_update_question(
    question_id: int,
    payload: UpdateQuestionRequest,
    _admin: UserDocument = Depends(require_admin),
):
    q = await QuestionDocument.find_one(QuestionDocument.question_id == question_id)
    if not q:
        raise HTTPException(status_code=404, detail="Question introuvable.")

    if payload.question is not None:
        q.question = payload.question
    if payload.answers is not None:
        q.answers = payload.answers
    if payload.category is not None:
        q.category = payload.category
    if payload.question_type is not None:
        q.question_type = payload.question_type
    if payload.description is not None:
        q.description = payload.description
    if payload.image_url is not None:
        q.image_url = payload.image_url

    await q.save()
    return _question_to_out(q)


@router.delete("/questions/{question_id}", status_code=status.HTTP_204_NO_CONTENT)
async def admin_delete_question(
    question_id: int,
    _admin: UserDocument = Depends(require_admin),
):
    q = await QuestionDocument.find_one(QuestionDocument.question_id == question_id)
    if not q:
        raise HTTPException(status_code=404, detail="Question introuvable.")
    await q.delete()
