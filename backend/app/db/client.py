from typing import Optional
import logging
from motor.motor_asyncio import AsyncIOMotorClient
from beanie import init_beanie
from app.core.config import MONGODB_URI, MONGODB_DB
from app.models.ping import PingDocument

logger = logging.getLogger(__name__)
client: Optional[AsyncIOMotorClient] = None
DOCUMENT_MODELS = [PingDocument]

async def init_db() -> None:
    global client
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
