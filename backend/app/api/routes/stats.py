from typing import List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.core.security import get_current_user
from app.db.client import ensure_db
from app.models.user import UserDocument

router = APIRouter(prefix="/stats", tags=["stats"])


class PersonalStats(BaseModel):
    games_played: int
    wins: int
    win_rate: float
    correct_answers: int
    total_answers: int
    accuracy: float
    best_score: int
    avg_response_time_ms: Optional[float]
    playtime: int


class LeaderboardEntry(BaseModel):
    username: str
    value: float


class LeaderboardResponse(BaseModel):
    top_wins: List[LeaderboardEntry]
    top_playtime: List[LeaderboardEntry]
    fastest_players: List[LeaderboardEntry]


@router.get("/me", response_model=PersonalStats)
async def my_stats(current_user: UserDocument = Depends(get_current_user)) -> PersonalStats:
    win_rate = (current_user.wins / current_user.games_played * 100) if current_user.games_played > 0 else 0.0
    accuracy = (current_user.correct_answers / current_user.total_answers * 100) if current_user.total_answers > 0 else 0.0
    avg_rt = (current_user.total_response_time_ms / current_user.total_responses) if current_user.total_responses > 0 else None

    return PersonalStats(
        games_played=current_user.games_played,
        wins=current_user.wins,
        win_rate=round(win_rate, 1),
        correct_answers=current_user.correct_answers,
        total_answers=current_user.total_answers,
        accuracy=round(accuracy, 1),
        best_score=current_user.best_score,
        avg_response_time_ms=round(avg_rt) if avg_rt is not None else None,
        playtime=current_user.playtime,
    )


@router.get("/leaderboard", response_model=LeaderboardResponse)
async def leaderboard() -> LeaderboardResponse:
    await ensure_db()

    top_wins_users = await UserDocument.find(
        UserDocument.wins > 0
    ).sort("-wins").limit(10).to_list()

    top_playtime_users = await UserDocument.find(
        UserDocument.playtime > 0
    ).sort("-playtime").limit(10).to_list()

    all_with_responses = await UserDocument.find(
        UserDocument.total_responses > 0
    ).to_list()

    fastest = sorted(
        all_with_responses,
        key=lambda u: u.total_response_time_ms / u.total_responses,
    )[:10]

    return LeaderboardResponse(
        top_wins=[
            LeaderboardEntry(username=u.username, value=u.wins)
            for u in top_wins_users
        ],
        top_playtime=[
            LeaderboardEntry(username=u.username, value=u.playtime)
            for u in top_playtime_users
        ],
        fastest_players=[
            LeaderboardEntry(
                username=u.username,
                value=round(u.total_response_time_ms / u.total_responses),
            )
            for u in fastest
        ],
    )
