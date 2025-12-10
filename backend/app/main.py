from contextlib import asynccontextmanager
from fastapi import FastAPI
from app.api.routes.health import router as health_router
from app.api.routes.pings import router as pings_router
from app.api.websockets import ws_router
from app.db.client import init_db, close_db

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    try:
        yield
    finally:
        await close_db()

app = FastAPI(title="poppy-sauce", lifespan=lifespan)

app.include_router(health_router)
app.include_router(pings_router)
app.include_router(ws_router)
