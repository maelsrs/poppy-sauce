import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes.auth import router as auth_router
from app.api.routes.health import router as health_router
from app.api.routes.rooms import router as rooms_router
from app.api.routes.users import router as users_router
from app.api.websockets import ws_router
from app.core.config import CORS_ORIGINS
from app.db.client import init_db, close_db

app = FastAPI(title="poppy-sauce")

logger = logging.getLogger("uvicorn.access")

@app.on_event("startup")
async def startup_event():
    await init_db()


@app.on_event("shutdown")
async def shutdown_event():
    await close_db()

@app.exception_handler(RequestValidationError)
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
                msg = f"Champ trop court (min {limit} caractères)." if limit else "Champ trop court."

        if field:
            message = f"{field} : {msg}"
        else:
            message = msg

    return JSONResponse(status_code=422, content={"detail": message})

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(auth_router)
app.include_router(rooms_router)
app.include_router(users_router)
app.include_router(ws_router)
