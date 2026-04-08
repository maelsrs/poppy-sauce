import asyncio
import re
import unicodedata
from datetime import datetime, timezone
from math import floor
from typing import Dict, Optional
from urllib.parse import parse_qs

import socketio

from app.core.config import (
    DELAY_AFTER_ALL_ANSWERED,
    DELAY_AFTER_GAME_FINISHED,
    DELAY_AFTER_ROUND_WON,
    DELAY_AFTER_TIME_UP,
    MAX_POINTS_FIRST,
    QUESTION_BATCH_SIZE,
)

from app.core.config import CORS_ORIGINS

sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins=CORS_ORIGINS)


def _now_ms() -> int:
    return int(datetime.now(timezone.utc).timestamp() * 1000)


class GameManager:
    def __init__(self):
        self.room_timers: Dict[str, asyncio.Task] = {}
        self.room_transition_tasks: Dict[str, asyncio.Task] = {}
        self.playing_since: Dict[str, Dict[str, int]] = {}
        self.chat_timestamps: Dict[str, list[float]] = {}
        self.sid_map: Dict[str, tuple[str, str]] = {}
        self.uuid_to_sid: Dict[str, Dict[str, str]] = {}
        self.question_cache: Dict[int, object] = {}
        self.last_ping_persist: Dict[str, float] = {}
        self.pending_leave: Dict[str, asyncio.Task] = {}
        self.skipped_players: Dict[str, set] = {}
        self.pending_round_win: Dict[str, dict] = {}

    def register(self, sid: str, room_code: str, player_uuid: str):
        self.sid_map[sid] = (room_code, player_uuid)
        self.uuid_to_sid.setdefault(room_code, {})[player_uuid] = sid

    def unregister(self, sid: str) -> tuple[str, str] | None:
        info = self.sid_map.pop(sid, None)
        self.last_ping_persist.pop(sid, None)
        if info:
            room_code, player_uuid = info
            room_sids = self.uuid_to_sid.get(room_code, {})
            if room_sids.get(player_uuid) == sid:
                del room_sids[player_uuid]
                if not room_sids:
                    self.uuid_to_sid.pop(room_code, None)
        return info

    def get_sid(self, room_code: str, player_uuid: str) -> str | None:
        return self.uuid_to_sid.get(room_code, {}).get(player_uuid)

    def cancel_timer(self, room_code: str):
        task = self.room_timers.pop(room_code, None)
        if task and not task.done():
            task.cancel()

    def cancel_transition(self, room_code: str):
        task = self.room_transition_tasks.pop(room_code, None)
        if task and not task.done():
            task.cancel()

    def start_playing(self, room_code: str, player_uuids: list[str]):
        now = _now_ms()
        self.playing_since.setdefault(room_code, {})
        for uid in player_uuids:
            self.playing_since[room_code][uid] = now

    def start_playing_one(self, room_code: str, player_uuid: str):
        self.playing_since.setdefault(room_code, {})
        self.playing_since[room_code][player_uuid] = _now_ms()

    async def flush_playtime(self, room_code: str, player_uuid: str):
        room_dict = self.playing_since.get(room_code)
        if not room_dict:
            return
        since = room_dict.pop(player_uuid, None)
        if since is None:
            return
        elapsed_s = max(0, (_now_ms() - since) // 1000)
        if elapsed_s == 0:
            return
        from app.models.user import UserDocument
        user = await UserDocument.find_one({"uuid": player_uuid})
        if user:
            user.playtime += elapsed_s
            await user.save()

    async def flush_playtime_all(self, room_code: str):
        room_dict = self.playing_since.pop(room_code, None)
        if not room_dict:
            return
        now = _now_ms()
        from app.models.user import UserDocument
        for uid, since in room_dict.items():
            elapsed_s = max(0, (now - since) // 1000)
            if elapsed_s == 0:
                continue
            user = await UserDocument.find_one({"uuid": uid})
            if user:
                user.playtime += elapsed_s
                await user.save()


manager = GameManager()


def _player_dict(player) -> dict:
    return {
        "player_uuid": player.player_uuid,
        "pseudo": player.pseudo,
        "is_owner": player.is_owner,
        "is_connected": player.is_connected,
        "points": player.points,
    }


def _config_dict(configurations) -> dict:
    return {
        "score_objective": configurations.score_objective,
        "question_duration": configurations.question_duration,
        "rounds_to_win": configurations.rounds_to_win,
        "show_answers": configurations.show_answers,
        "categories": [{"name": c.name, "mode": c.mode} for c in configurations.categories],
    }


def _get_first_correct_pseudo(room) -> str | None:
    correct_aps = [ap for ap in room.game_data.answered_players if ap.is_correct]
    if not correct_aps:
        return None
    first = min(correct_aps, key=lambda ap: ap.answered_at)
    player = room.find_player(first.player_uuid)
    return player.pseudo if player else None


def _get_correct_answers_list(room) -> list[dict]:
    result = []
    for ap in room.game_data.answered_players:
        if not ap.is_correct:
            continue
        player = room.find_player(ap.player_uuid)
        result.append({
            "player_uuid": ap.player_uuid,
            "pseudo": player.pseudo if player else "?",
            "answer": ap.answer,
        })
    result.sort(key=lambda x: next(
        (a.answered_at for a in room.game_data.answered_players if a.player_uuid == x["player_uuid"]), 0
    ))
    return result


async def _fetch_question(question_id: int):
    cached = manager.question_cache.get(question_id)
    if cached:
        return cached
    from app.models.question import QuestionDocument
    q = await QuestionDocument.find_one(QuestionDocument.question_id == question_id)
    if q:
        manager.question_cache[question_id] = q
    return q


def _build_category_filter(categories: list) -> dict | None:
    if not categories:
        return None
    include = [c.name for c in categories if c.mode == "uniquement"]
    exclude = [c.name for c in categories if c.mode == "enlever"]
    match: dict = {}
    if include:
        match["category"] = {"$in": include}
    if exclude:
        if "category" in match:
            match["category"]["$nin"] = exclude
        else:
            match["category"] = {"$nin": exclude}
    return match if match else None


async def _fetch_question_batch(exclude_ids: list[int], size: int = QUESTION_BATCH_SIZE, categories: list | None = None) -> list[int]:
    from app.models.question import QuestionDocument

    cat_filter = _build_category_filter(categories) if categories else None

    pipeline: list[dict] = []
    match_stage: dict = {"question_id": {"$exists": True, "$ne": None}}
    if exclude_ids:
        match_stage["question_id"]["$nin"] = exclude_ids
    if cat_filter:
        match_stage.update(cat_filter)
    if match_stage:
        pipeline.append({"$match": match_stage})
    pipeline.append({"$sample": {"size": size}})
    pipeline.append({"$project": {"question_id": 1, "_id": 0}})

    cursor = QuestionDocument.get_pymongo_collection().aggregate(pipeline)
    ids = [doc["question_id"] async for doc in cursor]

    if not ids and exclude_ids:
        pipeline_all: list[dict] = []
        if cat_filter:
            pipeline_all.append({"$match": cat_filter})
        pipeline_all.append({"$sample": {"size": size}})
        pipeline_all.append({"$project": {"question_id": 1, "_id": 0}})
        cursor_all = QuestionDocument.get_pymongo_collection().aggregate(pipeline_all)
        ids = [doc["question_id"] async for doc in cursor_all]

    return ids


async def _send_next_question(room_code: str):
    from app.models.room import GameState, RoomDocument

    room = await RoomDocument.find_one(RoomDocument.room_code == room_code)
    if not room or room.game_state != GameState.PLAYING:
        return

    if room.game_data.current_question_index >= len(room.game_data.question_ids):
        cats = room.configurations.categories or None
        new_ids = await _fetch_question_batch(
            exclude_ids=room.game_data.used_question_ids, size=QUESTION_BATCH_SIZE, categories=cats
        )
        if not new_ids:
            room.game_data.used_question_ids = []
            new_ids = await _fetch_question_batch(exclude_ids=[], size=QUESTION_BATCH_SIZE, categories=cats)
        if not new_ids:
            await _end_game(room_code, reason="no_more_questions")
            return
        room.game_data.question_ids = new_ids
        room.game_data.current_question_index = 0
        await room.save()

    q_id = room.game_data.question_ids[room.game_data.current_question_index]
    question = await _fetch_question(q_id)
    if not question:
        room.game_data.current_question_index += 1
        await room.save()
        await _send_next_question(room_code)
        return

    room.game_data.question_sent_at = _now_ms()
    room.game_data.first_correct_at = None
    room.game_data.answered_players = []
    if q_id not in room.game_data.used_question_ids:
        room.game_data.used_question_ids.append(q_id)
    await room.save()

    manager.skipped_players.pop(room_code, None)

    await sio.emit("new_question", {
        "question_index": room.game_data.current_question_index,
        "total_questions": len(room.game_data.question_ids),
        "question": question.question,
        "question_type": question.question_type.value,
        "description": question.description,
        "image_url": str(question.image_url) if question.image_url else None,
        "time_limit": room.configurations.question_duration,
        "round": room.game_data.actual_round,
    }, room=room_code)

    manager.cancel_timer(room_code)
    manager.room_timers[room_code] = asyncio.create_task(
        _question_timer(room_code, room.configurations.question_duration)
    )


async def _question_timer(room_code: str, duration: int):
    try:
        await asyncio.sleep(duration)

        from app.models.room import RoomDocument
        room = await RoomDocument.find_one(RoomDocument.room_code == room_code)
        correct_answer = None
        first_pseudo = None
        if room and room.game_data.question_ids:
            idx = room.game_data.current_question_index
            if idx < len(room.game_data.question_ids):
                q = await _fetch_question(room.game_data.question_ids[idx])
                if q and q.answers:
                    correct_answer = q.answers[0]
        if room:
            first_pseudo = _get_first_correct_pseudo(room)

        await sio.emit("time_up", {
            "correct_answer": correct_answer,
            "first_pseudo": first_pseudo,
            "correct_players": _get_correct_answers_list(room) if room else [],
        }, room=room_code)
        await asyncio.sleep(DELAY_AFTER_TIME_UP)
        await _advance_question(room_code)
    except asyncio.CancelledError:
        pass
    except Exception as e:
        print(f"[timer] erreur room {room_code}: {e}")


async def _advance_question(room_code: str):
    from app.models.room import GameState, RoomDocument

    pending = manager.pending_round_win.pop(room_code, None)
    if pending:
        room = await RoomDocument.find_one(RoomDocument.room_code == room_code)
        if not room or room.game_state != GameState.PLAYING:
            return

        if pending["wins"] >= room.configurations.rounds_to_win:
            await _end_game(room_code, winner_uuid=pending["player_uuid"])
            return

        await asyncio.sleep(DELAY_AFTER_ROUND_WON)

        room = await RoomDocument.find_one(RoomDocument.room_code == room_code)
        if not room or room.game_state != GameState.PLAYING:
            return
        room.game_data.actual_round += 1
        for p in room.players_info:
            p.points = 0
        room.game_data.first_correct_at = None
        room.game_data.answered_players = []
        room.game_data.used_question_ids = []
        room.game_data.question_ids = []
        room.game_data.current_question_index = 0
        await room.save()

        await _send_next_question(room_code)
        return

    room = await RoomDocument.find_one(RoomDocument.room_code == room_code)
    if not room or room.game_state != GameState.PLAYING:
        return

    room.game_data.current_question_index += 1
    room.game_data.first_correct_at = None
    room.game_data.answered_players = []
    await room.save()

    await _send_next_question(room_code)


async def _check_all_answered(room_code: str):
    try:
        from app.models.room import RoomDocument

        room = await RoomDocument.find_one(RoomDocument.room_code == room_code)
        if not room:
            return

        connected_uuids = {p.player_uuid for p in room.players_info if p.is_connected}
        correct_uuids = {
            ap.player_uuid for ap in room.game_data.answered_players if ap.is_correct
        }
        skipped_uuids = manager.skipped_players.get(room_code, set())
        done_uuids = correct_uuids | skipped_uuids

        if connected_uuids and connected_uuids.issubset(done_uuids):
            manager.cancel_timer(room_code)

            correct_answer = None
            if room.game_data.question_ids:
                idx = room.game_data.current_question_index
                if idx < len(room.game_data.question_ids):
                    q = await _fetch_question(room.game_data.question_ids[idx])
                    if q and q.answers:
                        correct_answer = q.answers[0]

            await sio.emit("all_answered", {
                "correct_answer": correct_answer,
                "first_pseudo": _get_first_correct_pseudo(room),
                "correct_players": _get_correct_answers_list(room),
            }, room=room_code)
            await asyncio.sleep(DELAY_AFTER_ALL_ANSWERED)
            await _advance_question(room_code)
    except asyncio.CancelledError:
        pass
    except Exception as e:
        print(f"[check_all_answered] erreur room {room_code}: {e}")


async def _check_round_end(room_code: str, player_uuid: str):
    try:
        from app.models.room import GameState, RoomDocument

        room = await RoomDocument.find_one(RoomDocument.room_code == room_code)
        if not room or room.game_state != GameState.PLAYING:
            return

        player = room.find_player(player_uuid)
        if not player:
            return

        if player.points < room.configurations.score_objective:
            asyncio.create_task(_check_all_answered(room_code))
            return

        wins = room.game_data.round_wins.get(player_uuid, 0) + 1
        room.game_data.round_wins[player_uuid] = wins
        await room.save()

        await sio.emit("round_won", {
            "player_uuid": player_uuid,
            "pseudo": player.pseudo,
            "round": room.game_data.actual_round,
            "round_wins": room.game_data.round_wins,
        }, room=room_code)

        manager.pending_round_win[room_code] = {
            "player_uuid": player_uuid,
            "wins": wins,
        }

        asyncio.create_task(_check_all_answered(room_code))
    except asyncio.CancelledError:
        pass
    except Exception as e:
        print(f"[check_round_end] erreur room {room_code}: {e}")


async def _end_game(room_code: str, *, winner_uuid: Optional[str] = None, reason: str = "won"):
    from app.models.room import GameData, GameState, RoomDocument

    room = await RoomDocument.find_one(RoomDocument.room_code == room_code)
    if not room:
        return

    manager.cancel_timer(room_code)
    await manager.flush_playtime_all(room_code)
    room.game_state = GameState.FINISHED
    await room.save()

    sorted_players = sorted(room.players_info, key=lambda p: (
        -room.game_data.round_wins.get(p.player_uuid, 0),
        -p.points,
    ))

    leaderboard = []
    for rank, p in enumerate(sorted_players, 1):
        leaderboard.append({
            "player_uuid": p.player_uuid,
            "pseudo": p.pseudo,
            "points": p.points,
            "rounds_won": room.game_data.round_wins.get(p.player_uuid, 0),
            "rank": rank,
        })

    winner_data = None
    if winner_uuid:
        wp = room.find_player(winner_uuid)
        if wp:
            winner_data = {
                "player_uuid": winner_uuid,
                "pseudo": wp.pseudo,
                "rounds_won": room.game_data.round_wins.get(winner_uuid, 0),
            }
    elif leaderboard:
        top = leaderboard[0]
        winner_data = {
            "player_uuid": top["player_uuid"],
            "pseudo": top["pseudo"],
            "rounds_won": top["rounds_won"],
        }

    await sio.emit("game_finished", {
        "winner": winner_data,
        "leaderboard": leaderboard,
        "reason": reason,
    }, room=room_code)

    has_been_played = len(room.game_data.all_answers) > 0

    if has_been_played:
        from app.models.user import UserDocument

        actual_winner_uuid = (
            winner_data["player_uuid"]
            if winner_data and reason != "owner_ended"
            else None
        )

        for p in room.players_info:
            user = await UserDocument.find_one(UserDocument.uuid == p.player_uuid)
            if not user:
                continue

            user.games_played += 1
            if actual_winner_uuid and p.player_uuid == actual_winner_uuid:
                user.wins += 1
            if p.points > user.best_score:
                user.best_score = p.points

            player_answers = [a for a in room.game_data.all_answers if a.player_uuid == p.player_uuid]
            user.total_answers += len(player_answers)
            user.correct_answers += sum(1 for a in player_answers if a.is_correct)

            for a in player_answers:
                if a.question_started_at and a.answered_at > a.question_started_at:
                    user.total_response_time_ms += a.answered_at - a.question_started_at
                    user.total_responses += 1

            await user.save()

    await asyncio.sleep(DELAY_AFTER_GAME_FINISHED)

    room = await RoomDocument.find_one(RoomDocument.room_code == room_code)
    if not room:
        return
    room.game_state = GameState.WAITING
    room.game_data = GameData()
    for p in room.players_info:
        p.points = 0
    await room.save()

    await sio.emit("game_reset", {
        "game_state": "WAITING",
    }, room=room_code)


@sio.event
async def connect(sid, environ, auth):
    try:
        return await _handle_connect(sid, environ)
    except ConnectionRefusedError:
        raise
    except Exception as e:
        print(f"[connect] error: {type(e).__name__}: {e}", flush=True)
        raise ConnectionRefusedError(f"Erreur interne: {e}")


def _parse_cookie_header(environ) -> dict:
    from http.cookies import SimpleCookie
    cookie_header = environ.get("HTTP_COOKIE", "")
    if not cookie_header:
        for header, value in environ.get("asgi.scope", {}).get("headers", []):
            if header == b"cookie":
                cookie_header = value.decode("utf-8", errors="ignore")
                break
    cookies = SimpleCookie()
    cookies.load(cookie_header)
    return {k: v.value for k, v in cookies.items()}


async def _resolve_authenticated_user(environ):
    from jose import JWTError, jwt as jose_jwt
    from app.core.config import JWT_SECRET_KEY, JWT_ALGORITHM
    from app.models.user import UserDocument
    from app.core.security import COOKIE_NAME

    cookies = _parse_cookie_header(environ)
    token = cookies.get(COOKIE_NAME)
    if not token:
        return None

    try:
        payload = jose_jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        subject = payload.get("sub")
        if not subject:
            return None
    except (JWTError, ValueError):
        return None

    return await UserDocument.find_one(UserDocument.uuid == subject)


async def _handle_connect(sid, environ):
    from app.models.room import GameState, PlayerInfo, RoomDocument

    qs = parse_qs(environ.get("QUERY_STRING", ""))
    room_code = (qs.get("room_code", [""])[0]).upper()
    player_uuid = qs.get("player_uuid", [""])[0]
    pseudo = qs.get("pseudo", [None])[0]

    if not room_code:
        raise ConnectionRefusedError("room_code requis")

    auth_user = await _resolve_authenticated_user(environ)
    if auth_user:
        player_uuid = auth_user.uuid
        pseudo = auth_user.username

    if not player_uuid:
        raise ConnectionRefusedError("player_uuid requis")

    room = await RoomDocument.find_one(RoomDocument.room_code == room_code)
    if not room:
        raise ConnectionRefusedError("Room introuvable")

    old_sid = manager.get_sid(room_code, player_uuid)
    if old_sid and old_sid != sid:
        await sio.disconnect(old_sid)

    leave_key = f"{room_code}:{player_uuid}"
    leave_task = manager.pending_leave.pop(leave_key, None)
    if leave_task and not leave_task.done():
        leave_task.cancel()

    now_ms = _now_ms()
    existing = room.find_player(player_uuid)
    is_new = not existing
    if existing:
        await room.mark_player_connected(player_uuid=player_uuid, now_ms=now_ms)
    else:
        room.players_info.append(
            PlayerInfo(
                player_uuid=player_uuid,
                pseudo=pseudo,
                points=0,
                is_owner=False,
                joined_at=now_ms,
                last_seen_at=now_ms,
                disconnected_at=None,
                is_connected=True,
            )
        )
        await room.save()

    room = await RoomDocument.find_one(RoomDocument.room_code == room_code)
    manager.register(sid, room_code, player_uuid)

    async def _join_room_delayed():
        await asyncio.sleep(0.1)
        await sio.enter_room(sid, room_code)

    asyncio.create_task(_join_room_delayed())

    if room.game_state == GameState.PLAYING:
        manager.start_playing_one(room_code, player_uuid)

    player_info = room.find_player(player_uuid)

    room_state_msg = {
        "players": [_player_dict(p) for p in room.players_info if p.is_connected],
        "configurations": _config_dict(room.configurations),
        "game_state": room.game_state.value,
    }

    if room.game_state == GameState.PLAYING and room.game_data.question_ids:
        idx = room.game_data.current_question_index
        if idx < len(room.game_data.question_ids):
            q_id = room.game_data.question_ids[idx]
            question = await _fetch_question(q_id)
            if question:
                room_state_msg["current_question"] = {
                    "question": question.question,
                    "question_type": question.question_type.value,
                    "description": question.description,
                    "image_url": str(question.image_url) if question.image_url else None,
                    "question_index": idx,
                    "total_questions": len(room.game_data.question_ids),
                    "time_limit": room.configurations.question_duration,
                    "round": room.game_data.actual_round,
                }
                room_state_msg["answered_players"] = [
                    {
                        "player_uuid": ap.player_uuid,
                        "is_correct": ap.is_correct,
                        "points_awarded": ap.points_awarded,
                    }
                    for ap in room.game_data.answered_players
                ]
                room_state_msg["round_wins"] = room.game_data.round_wins

    await sio.emit("room_state", room_state_msg, to=sid)

    if player_info:
        await sio.emit("player_join", {
            "player": _player_dict(player_info),
        }, room=room_code, skip_sid=sid)

        if is_new:
            await sio.emit("chat_message", {
                "player_uuid": None,
                "pseudo": None,
                "text": f"{player_info.pseudo or 'Un joueur'} a rejoint la partie",
                "timestamp": _now_ms(),
                "system": True,
            }, room=room_code)


@sio.event
async def disconnect(sid):
    from app.models.room import GameState, RoomDocument

    info = manager.unregister(sid)
    if not info:
        return

    room_code, player_uuid = info
    await sio.leave_room(sid, room_code)

    room = await RoomDocument.find_one(RoomDocument.room_code == room_code)
    if room:
        if room.game_state == GameState.PLAYING:
            await manager.flush_playtime(room_code, player_uuid)

        player = room.find_player(player_uuid)
        pseudo = player.pseudo if player else None

        await room.mark_player_disconnected(player_uuid=player_uuid, now_ms=_now_ms())

        await sio.emit("player_leave", {
            "player_uuid": player_uuid,
        }, room=room_code)

        async def _delayed_leave_msg():
            await asyncio.sleep(5)
            from app.models.room import RoomDocument as RD
            r = await RD.find_one(RD.room_code == room_code)
            if not r:
                return
            p = r.find_player(player_uuid)
            if p and p.is_connected:
                return
            await sio.emit("chat_message", {
                "player_uuid": None,
                "pseudo": None,
                "text": f"{pseudo or 'Un joueur'} a quitté la partie",
                "timestamp": _now_ms(),
                "system": True,
            }, room=room_code)

        leave_key = f"{room_code}:{player_uuid}"
        old_task = manager.pending_leave.pop(leave_key, None)
        if old_task and not old_task.done():
            old_task.cancel()
        manager.pending_leave[leave_key] = asyncio.create_task(_delayed_leave_msg())

        await room.close_if_empty()


@sio.on("ping")
async def handle_ping(sid, data=None):
    info = manager.sid_map.get(sid)
    if not info:
        return

    now = asyncio.get_event_loop().time()
    last = manager.last_ping_persist.get(sid, 0)
    if now - last < 60:
        return
    manager.last_ping_persist[sid] = now

    room_code, player_uuid = info
    from app.models.room import RoomDocument
    room = await RoomDocument.find_one(RoomDocument.room_code == room_code)
    if room:
        player = room.find_player(player_uuid)
        if player:
            player.last_seen_at = _now_ms()
            await room.save()


@sio.on("start_game")
async def handle_start_game(sid, data=None):
    from app.models.room import GameState, RoomDocument

    info = manager.sid_map.get(sid)
    if not info:
        return
    room_code, player_uuid = info

    room = await RoomDocument.find_one(RoomDocument.room_code == room_code)
    if not room:
        return
    player = room.find_player(player_uuid)
    if not player or not player.is_owner or room.game_state != GameState.WAITING:
        return

    cats = room.configurations.categories or None
    q_ids = await _fetch_question_batch(exclude_ids=[], size=QUESTION_BATCH_SIZE, categories=cats)
    if not q_ids:
        await sio.emit("error", {
            "message": "Aucune question disponible pour ces catégories.",
        }, to=sid)
        return

    room.game_state = GameState.PLAYING
    room.game_data.started_at = _now_ms()
    room.game_data.question_ids = q_ids
    room.game_data.current_question_index = 0
    room.game_data.first_correct_at = None
    room.game_data.answered_players = []
    room.game_data.round_wins = {}
    room.game_data.actual_round = 1
    room.game_data.used_question_ids = []
    for p in room.players_info:
        p.points = 0
    await room.save()

    connected_uuids = [p.player_uuid for p in room.players_info if p.is_connected]
    manager.start_playing(room_code, connected_uuids)

    await sio.emit("game_started", {
        "game_state": "PLAYING",
        "started_at": room.game_data.started_at,
    }, room=room_code)

    await _send_next_question(room_code)


@sio.on("submit_answer")
async def handle_submit_answer(sid, data=None):
    from app.models.room import AnsweredPlayer, GameState, RoomDocument

    info = manager.sid_map.get(sid)
    if not info:
        return
    room_code, player_uuid = info

    data = data or {}

    room = await RoomDocument.find_one(RoomDocument.room_code == room_code)
    if not room or room.game_state != GameState.PLAYING:
        return

    answer_text = str(data.get("answer", "")).strip()
    if not answer_text:
        return

    skipped_set = manager.skipped_players.get(room_code, set())
    was_skipped = player_uuid in skipped_set
    if was_skipped:
        skipped_set.discard(player_uuid)
        await sio.emit("player_unskipped", {"player_uuid": player_uuid}, room=room_code)

    already_correct = any(
        ap.player_uuid == player_uuid and ap.is_correct
        for ap in room.game_data.answered_players
    )
    if already_correct:
        return

    idx = room.game_data.current_question_index
    if idx >= len(room.game_data.question_ids):
        return
    q_id = room.game_data.question_ids[idx]
    question = await _fetch_question(q_id)
    if not question:
        return

    def _normalize(s: str) -> str:
        s = unicodedata.normalize("NFD", s.lower()).encode("ascii", "ignore").decode()
        s = re.sub(r"[,;:.!?'\"\-()\\[\\]{}]", " ", s)
        return " ".join(s.split())

    is_correct = any(
        _normalize(answer_text) == _normalize(valid.strip())
        for valid in question.answers
    )

    now = _now_ms()
    points = 0
    if is_correct:
        if room.game_data.first_correct_at is None:
            room.game_data.first_correct_at = now
            points = MAX_POINTS_FIRST
        else:
            diff_seconds = (now - room.game_data.first_correct_at) / 1000.0
            points = max(0, MAX_POINTS_FIRST - floor(diff_seconds))
            if points == MAX_POINTS_FIRST:
                points = MAX_POINTS_FIRST - 1

        player = room.find_player(player_uuid)
        if player:
            player.points += points

    ap = AnsweredPlayer(
        player_uuid=player_uuid,
        answered_at=now,
        is_correct=is_correct,
        answer=answer_text,
        points_awarded=points,
        question_started_at=room.game_data.question_sent_at,
    )

    should_record = is_correct or room.configurations.show_answers
    if should_record:
        room.game_data.answered_players.append(ap)

    room.game_data.all_answers.append(ap)

    await room.save()

    player = room.find_player(player_uuid)
    broadcast_answer = None
    if not is_correct and room.configurations.show_answers:
        broadcast_answer = answer_text

    await sio.emit("player_answered", {
        "player_uuid": player_uuid,
        "pseudo": player.pseudo if player else None,
        "is_correct": is_correct,
        "answer": broadcast_answer,
        "points_awarded": points,
        "total_points": player.points if player else 0,
    }, room=room_code)

    if is_correct:
        asyncio.create_task(_check_round_end(room_code, player_uuid))


@sio.on("end_game")
async def handle_end_game(sid, data=None):
    from app.models.room import GameState, RoomDocument

    info = manager.sid_map.get(sid)
    if not info:
        return
    room_code, player_uuid = info

    room = await RoomDocument.find_one(RoomDocument.room_code == room_code)
    if not room:
        return
    player = room.find_player(player_uuid)
    if player and player.is_owner and room.game_state == GameState.PLAYING:
        await _end_game(room_code, reason="owner_ended")


@sio.on("chat_message")
async def handle_chat_message(sid, data=None):
    from app.models.room import RoomDocument

    info = manager.sid_map.get(sid)
    if not info:
        return
    room_code, player_uuid = info

    data = data or {}
    text = str(data.get("text", "")).strip()
    if not text or len(text) > 300:
        return

    now_t = asyncio.get_event_loop().time()
    ts_list = manager.chat_timestamps.get(player_uuid, [])
    ts_list = [t for t in ts_list if now_t - t < 1.0]
    if len(ts_list) >= 3:
        return
    ts_list.append(now_t)
    manager.chat_timestamps[player_uuid] = ts_list

    room = await RoomDocument.find_one(RoomDocument.room_code == room_code)
    player = room.find_player(player_uuid) if room else None
    await sio.emit("chat_message", {
        "player_uuid": player_uuid,
        "pseudo": player.pseudo if player else None,
        "text": text,
        "timestamp": _now_ms(),
    }, room=room_code)


@sio.on("update_config")
async def handle_update_config(sid, data=None):
    from app.models.room import RoomDocument

    info = manager.sid_map.get(sid)
    if not info:
        return
    room_code, player_uuid = info

    data = data or {}

    room = await RoomDocument.find_one(RoomDocument.room_code == room_code)
    if not room:
        return
    player = room.find_player(player_uuid)
    if not player or not player.is_owner:
        return

    labels = {
        "score_objective": "Score objectif",
        "question_duration": "Durée des questions",
        "rounds_to_win": "Manches pour gagner",
        "show_answers": "Afficher les réponses",
    }
    old = _config_dict(room.configurations)

    if "score_objective" in data:
        room.configurations.score_objective = max(1, int(data["score_objective"]))
    if "question_duration" in data:
        room.configurations.question_duration = max(1, int(data["question_duration"]))
    if "rounds_to_win" in data:
        room.configurations.rounds_to_win = max(1, int(data["rounds_to_win"]))
    if "show_answers" in data:
        room.configurations.show_answers = bool(data["show_answers"])
    if "categories" in data:
        from app.models.room import CategoryConfig
        room.configurations.categories = [
            CategoryConfig(name=c["name"], mode=c.get("mode", "uniquement"))
            for c in data["categories"] if isinstance(c, dict) and c.get("name")
        ]
    await room.save()

    new = _config_dict(room.configurations)
    changes = []
    for key in labels:
        if old[key] != new[key]:
            val = "Oui" if new[key] is True else "Non" if new[key] is False else f"{new[key]}"
            if key == "question_duration":
                val += "s"
            changes.append(f"{labels[key]} → {val}")

    old_cats = {c["name"] for c in old["categories"]}
    new_cats = {c["name"] for c in new["categories"]}
    added = new_cats - old_cats
    removed = old_cats - new_cats
    if added:
        changes.append(f"Catégories ajoutées : {', '.join(sorted(added))}")
    if removed:
        changes.append(f"Catégories retirées : {', '.join(sorted(removed))}")
    for c in new["categories"]:
        old_c = next((o for o in old["categories"] if o["name"] == c["name"]), None)
        if old_c and old_c["mode"] != c["mode"]:
            changes.append(f"{c['name']} → {c['mode'].upper()}")

    await sio.emit("config_update", {
        "configurations": new,
    }, room=room_code)

    if changes:
        await sio.emit("chat_message", {
            "player_uuid": None,
            "pseudo": None,
            "text": "Paramètres modifiés : " + ", ".join(changes),
            "timestamp": _now_ms(),
            "system": True,
        }, room=room_code)


@sio.on("skip_question")
async def handle_skip_question(sid, data=None):
    from app.models.room import GameState, RoomDocument

    info = manager.sid_map.get(sid)
    if not info:
        return
    room_code, player_uuid = info

    room = await RoomDocument.find_one(RoomDocument.room_code == room_code)
    if not room or room.game_state != GameState.PLAYING:
        return

    already_correct = any(
        ap.player_uuid == player_uuid and ap.is_correct
        for ap in room.game_data.answered_players
    )
    if already_correct:
        return

    skipped_set = manager.skipped_players.setdefault(room_code, set())
    if player_uuid in skipped_set:
        return

    skipped_set.add(player_uuid)

    await sio.emit("player_skipped", {"player_uuid": player_uuid}, room=room_code)

    connected_uuids = {p.player_uuid for p in room.players_info if p.is_connected}
    correct_uuids = {
        ap.player_uuid for ap in room.game_data.answered_players if ap.is_correct
    }
    done_uuids = correct_uuids | skipped_set

    if connected_uuids and connected_uuids.issubset(done_uuids):
        manager.cancel_timer(room_code)

        correct_answer = None
        if room.game_data.question_ids:
            idx = room.game_data.current_question_index
            if idx < len(room.game_data.question_ids):
                q = await _fetch_question(room.game_data.question_ids[idx])
                if q and q.answers:
                    correct_answer = q.answers[0]

        await sio.emit("all_answered", {
            "correct_answer": correct_answer,
            "first_pseudo": _get_first_correct_pseudo(room),
            "correct_players": _get_correct_answers_list(room),
        }, room=room_code)
        await asyncio.sleep(DELAY_AFTER_ALL_ANSWERED)
        await _advance_question(room_code)


@sio.on("unskip_question")
async def handle_unskip_question(sid, data=None):
    from app.models.room import GameState, RoomDocument

    info = manager.sid_map.get(sid)
    if not info:
        return
    room_code, player_uuid = info

    room = await RoomDocument.find_one(RoomDocument.room_code == room_code)
    if not room or room.game_state != GameState.PLAYING:
        return

    skipped_set = manager.skipped_players.get(room_code, set())
    if player_uuid not in skipped_set:
        return

    skipped_set.discard(player_uuid)
    await sio.emit("player_unskipped", {"player_uuid": player_uuid}, room=room_code)
