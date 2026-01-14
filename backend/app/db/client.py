from typing import Optional
import logging
from motor.motor_asyncio import AsyncIOMotorClient
from beanie import init_beanie
from app.core.config import MONGODB_URI, MONGODB_DB
from app.models.question import QuestionDocument
from app.models.room import RoomDocument
from app.models.user import UserDocument

logger = logging.getLogger(__name__)
client: Optional[AsyncIOMotorClient] = None
DOCUMENT_MODELS = [QuestionDocument, UserDocument, RoomDocument]

async def init_db() -> None:
    global client
    if client:
        return
    try:
        client = AsyncIOMotorClient(MONGODB_URI)
        await init_beanie(database=client[MONGODB_DB], document_models=DOCUMENT_MODELS)
    except Exception as exc:
        logger.error("Failed to initialize MongoDB/Beanie", exc_info=exc)
        if client:
            client.close()
            client = None
        raise

async def close_db() -> None:
    global client
    if not client:
        return
    try:
        client.close()
    except Exception as exc:
        logger.error("Failed to close MongoDB client", exc_info=exc)
    finally:
        client = None


async def ensure_db() -> None:
    if client is None:
        await init_db()
