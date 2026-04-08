import secrets
import string
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.core.security import get_current_user
from app.db.client import ensure_db
from app.models.room import GameState, PlayerInfo, RoomConfigurations, RoomDocument, RoomPrivacy
from app.models.user import UserDocument


router = APIRouter(prefix="/rooms", tags=["rooms"])


def _now_ms() -> int:
    return int(datetime.utcnow().timestamp() * 1000)


def _gen_room_code() -> str:
    alphabet = string.ascii_uppercase
    return "".join(secrets.choice(alphabet) for _ in range(4))


class PublicRoom(BaseModel):
    room_uuid: str
    room_code: str
    room_name: str
    privacy: RoomPrivacy
    game_state: GameState
    host: Optional[str] = None
    players_connected: int
    players_total: int
    score_objective: int
    question_duration: int
    rounds_to_win: int


class CreateRoomRequest(BaseModel):
    room_name: str = Field(default="Salon", min_length=1, max_length=64)
    privacy: RoomPrivacy = RoomPrivacy.OPEN
    player_uuid: str = Field(..., min_length=1)
    pseudo: Optional[str] = Field(default=None, min_length=1, max_length=64)
    configurations: RoomConfigurations = Field(default_factory=RoomConfigurations)


class CreateRoomResponse(BaseModel):
    room_uuid: str
    room_code: str


@router.get("/public", response_model=List[PublicRoom])
async def list_public_rooms() -> List[PublicRoom]:
    await ensure_db()
    rooms = await RoomDocument.find(RoomDocument.privacy == RoomPrivacy.OPEN).to_list()
    now = datetime.utcnow()

    result: List[PublicRoom] = []
    for room in rooms:
        connected = room.connected_players_count()
        if connected == 0:
            expires_at = room.expires_at.replace(tzinfo=None) if room.expires_at.tzinfo is not None else room.expires_at
            if expires_at <= now:
                await room.delete()
            continue

        owner = next((p for p in room.players_info if p.is_owner), None)
        result.append(
            PublicRoom(
                room_uuid=room.room_uuid,
                room_code=room.room_code,
                room_name=room.room_name,
                privacy=room.privacy,
                game_state=room.game_state,
                host=owner.pseudo if owner else None,
                players_connected=connected,
                players_total=len(room.players_info),
                score_objective=room.configurations.score_objective,
                question_duration=room.configurations.question_duration,
                rounds_to_win=room.configurations.rounds_to_win,
            )
        )

    result.sort(key=lambda r: r.players_connected, reverse=True)
    return result


@router.post("", response_model=CreateRoomResponse, status_code=status.HTTP_201_CREATED)
async def create_room(payload: CreateRoomRequest, current_user: UserDocument = Depends(get_current_user)) -> CreateRoomResponse:
    await ensure_db()

    for _ in range(50):
        code = _gen_room_code()
        existing = await RoomDocument.find_one(RoomDocument.room_code == code)
        if not existing:
            break
    else:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Impossible de générer un code de room.")

    now_ms = _now_ms()
    room = RoomDocument(
        room_code=code,
        room_name=payload.room_name,
        privacy=payload.privacy,
        game_state=GameState.WAITING,
        configurations=payload.configurations,
        players_info=[
            PlayerInfo(
                player_uuid=payload.player_uuid,
                pseudo=payload.pseudo,
                points=0,
                is_owner=True,
                joined_at=now_ms,
                last_seen_at=now_ms,
                disconnected_at=None,
                is_connected=True,
            )
        ],
    )
    await room.insert()
    return CreateRoomResponse(room_uuid=room.room_uuid, room_code=room.room_code)
