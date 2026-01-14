from enum import Enum
from typing import List, Optional

from beanie import Document, Insert, before_event
from pydantic import Field, HttpUrl
from pymongo import ReturnDocument


class QuestionType(str, Enum):
    TEXT = "text"
    IMAGE = "image"
    MIXED = "mixed"


class QuestionDocument(Document):
    question_id: int = Field(default=None, index=True, unique=True)
    question_type: QuestionType = Field(default=QuestionType.TEXT)
    question: str = Field(...,)
    answers: List[str] = Field(default_factory=list,)
    image_url: Optional[HttpUrl] = Field(default=None)

    class Settings:
        name = "questions"

    @before_event(Insert)
    async def set_auto_increment_id(self):
        if self.question_id is not None:
            return

        counters = self.get_motor_collection().database["counters"]
        result = await counters.find_one_and_update(
            {"_id": "question_id"},
            {"$inc": {"seq": 1}},
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
        self.question_id = result["seq"]
