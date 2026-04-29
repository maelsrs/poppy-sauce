import logging

import socketio as socketio_lib
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes.admin import router as admin_router
from app.api.routes.auth import router as auth_router
from app.api.routes.health import router as health_router
from app.api.routes.questions import router as questions_router
from app.api.routes.rooms import router as rooms_router
from app.api.routes.stats import router as stats_router
from app.api.routes.users import router as users_router
from app.api.websockets import sio
from app.core.config import CORS_ORIGINS
from app.db.client import init_db, close_db

fastapi_app = FastAPI(title="poppy-sauce")

logger = logging.getLogger("uvicorn.access")


@fastapi_app.on_event("startup")
async def startup_event():
    await init_db()


@fastapi_app.on_event("shutdown")
async def shutdown_event():
    await close_db()


@fastapi_app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    detail = exc.errors()
    message = "Données invalides."

    if detail:
        first = detail[0]
        loc = first.get("loc")
        msg = first.get("msg", "Entrée invalide")
        error_type = first.get("type", "")
        ctx = first.get("ctx") or {}

        field = None
        if isinstance(loc, (list, tuple)) and len(loc) > 1:
            field = ".".join(str(part) for part in loc[1:])

        if error_type in ("value_error.email", "email"):
            msg = "Email invalide."
        elif error_type == "missing":
            msg = "Champ requis."
        elif error_type.startswith("string_too_short"):
            limit = ctx.get("min_length") or ctx.get("limit_value")
            if field and "password" in field:
                msg = f"Le mot de passe doit contenir au moins {limit or 8} caractères."
            else:
                msg = (
                    f"Champ trop court (min {limit} caractères)."
                    if limit
                    else "Champ trop court."
                )

        if field:
            message = f"{field} : {msg}"
        else:
            message = msg

    return JSONResponse(status_code=422, content={"detail": message})


fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

fastapi_app.include_router(health_router)
fastapi_app.include_router(auth_router)
fastapi_app.include_router(rooms_router)
fastapi_app.include_router(stats_router)
fastapi_app.include_router(users_router)
fastapi_app.include_router(questions_router)
fastapi_app.include_router(admin_router)

app = socketio_lib.ASGIApp(sio, other_asgi_app=fastapi_app)
