from __future__ import annotations

from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Dict, List, Optional
from uuid import uuid4

from beanie import Document, before_event
from beanie.odm.actions import EventTypes
from beanie.odm.fields import Indexed
from pydantic import BaseModel, Field

from app.core.config import ROOM_EMPTY_CLOSE_SECONDS, ROOM_TTL_HOURS


class RoomPrivacy(str, Enum):
    OPEN = "OPEN"
    PRIVATE = "PRIVATE"


class GameState(str, Enum):
    WAITING = "WAITING"
    STARTING = "STARTING"
    PLAYING = "PLAYING"
    FINISHED = "FINISHED"


class RoomConfigurations(BaseModel):
    score_objective: int = Field(default=100, ge=1)
    question_duration: int = Field(default=15, ge=1)
    rounds_to_win: int = Field(default=5, ge=1)
    show_answers: bool = Field(default=True)


class PlayerInfo(BaseModel):
    player_uuid: str = Field(..., min_length=1)
    pseudo: Optional[str] = Field(default=None, min_length=1, max_length=64)
    points: int = Field(default=0, ge=0)
    is_owner: bool = False
    joined_at: int = Field(..., ge=0)
    is_connected: bool = True
    last_seen_at: int = Field(..., ge=0)
    disconnected_at: Optional[int] = Field(default=None, ge=0)


class AnsweredPlayer(BaseModel):
    player_uuid: str
    answered_at: int
    is_correct: bool
    answer: str
    points_awarded: int


class RoundData(BaseModel):
    round_index: int = Field(..., ge=1)
    questions_id_list: List[str] = Field(default_factory=list)
    room_started_at: int = Field(..., ge=0)


class GameData(BaseModel):
    started_at: Optional[int] = Field(default=None, ge=0)
    actual_round: int = Field(default=1, ge=1)
    actual_question_int: int = Field(default=0, ge=0)
    rounds: List[RoundData] = Field(default_factory=list)
    question_ids: List[int] = Field(default_factory=list)
    current_question_index: int = Field(default=0, ge=0)
    first_correct_at: Optional[int] = Field(default=None)
    answered_players: List[AnsweredPlayer] = Field(default_factory=list)
    round_wins: Dict[str, int] = Field(default_factory=dict)
    used_question_ids: List[int] = Field(default_factory=list)


class RoomDocument(Document):
    room_uuid: Indexed(str, unique=True) = Field(default_factory=lambda: str(uuid4()))
    room_code: Indexed(str, unique=True) = Field(..., min_length=4, max_length=4, regex=r"^[A-Z]{4}$")
    room_name: str = Field(default="Salon", min_length=1, max_length=64)

    privacy: Indexed(RoomPrivacy) = RoomPrivacy.OPEN
    game_state: GameState = GameState.WAITING

    configurations: RoomConfigurations = Field(default_factory=RoomConfigurations)
    players_info: List[PlayerInfo] = Field(default_factory=list)
    game_data: GameData = Field(default_factory=GameData)

    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    expires_at: Indexed(datetime, expireAfterSeconds=0) = Field(
        default_factory=lambda: datetime.utcnow() + timedelta(hours=ROOM_TTL_HOURS)
    )
    empty_close_seconds: int = Field(default=ROOM_EMPTY_CLOSE_SECONDS, ge=0)

    class Settings:
        name = "active_rooms"

    @before_event(EventTypes.INSERT)
    def _set_created_on_insert(self):
        now = datetime.utcnow()
        self.created_at = now
        self.updated_at = now

    @before_event(EventTypes.SAVE)
    def _touch_updated(self):
        self.updated_at = datetime.utcnow()

    def connected_players_count(self) -> int:
        return sum(1 for player in self.players_info if player.is_connected)

    def find_player(self, player_uuid: str) -> Optional[PlayerInfo]:
        for player in self.players_info:
            if player.player_uuid == player_uuid:
                return player
        return None

    async def mark_player_connected(self, player_uuid: str, now_ms: int) -> None:
        player = self.find_player(player_uuid)
        if not player:
            raise ValueError("Player not found in room")
        player.is_connected = True
        player.disconnected_at = None
        player.last_seen_at = now_ms
        self.expires_at = datetime.utcnow() + timedelta(hours=ROOM_TTL_HOURS)
        await self.save()

    async def mark_player_disconnected(self, player_uuid: str, now_ms: int) -> None:
        player = self.find_player(player_uuid)
        if not player:
            return
        player.is_connected = False
        player.last_seen_at = now_ms
        player.disconnected_at = now_ms
        await self.save()

    async def close_if_empty(self) -> bool:
        if self.connected_players_count() > 0:
            return False
        now = datetime.utcnow()
        if self.empty_close_seconds <= 0:
            await self.delete()
            return True

        self.expires_at = now + timedelta(seconds=self.empty_close_seconds)
        await self.save()
        return True
