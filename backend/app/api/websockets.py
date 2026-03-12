import asyncio
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

sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")


def _now_ms() -> int:
    return int(datetime.now(timezone.utc).timestamp() * 1000)


class GameManager:
    def __init__(self):
        self.room_timers: Dict[str, asyncio.Task] = {}
        self.room_transition_tasks: Dict[str, asyncio.Task] = {}
        self.playing_since: Dict[str, Dict[str, int]] = {}
        self.chat_timestamps: Dict[str, list[float]] = {}
        self.sid_map: Dict[str, tuple[str, str]] = {}  # sid -> (room_code, player_uuid)
        self.uuid_to_sid: Dict[str, Dict[str, str]] = {}  # room_code -> {player_uuid -> sid}
        self.question_cache: Dict[int, object] = {}  # question_id -> QuestionDocument
        self.last_ping_persist: Dict[str, float] = {}  # sid -> last persist timestamp

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
    }


async def _fetch_question(question_id: int):
    cached = manager.question_cache.get(question_id)
    if cached:
        return cached
    from app.models.question import QuestionDocument
    q = await QuestionDocument.find_one(QuestionDocument.question_id == question_id)
    if q:
        manager.question_cache[question_id] = q
    return q


async def _fetch_question_batch(exclude_ids: list[int], size: int = QUESTION_BATCH_SIZE) -> list[int]:
    from app.models.question import QuestionDocument

    pipeline: list[dict] = []
    if exclude_ids:
        pipeline.append({"$match": {"question_id": {"$nin": exclude_ids}}})
    pipeline.append({"$sample": {"size": size}})
    pipeline.append({"$project": {"question_id": 1, "_id": 0}})

    cursor = QuestionDocument.get_pymongo_collection().aggregate(pipeline)
    ids = [doc["question_id"] async for doc in cursor]

    if not ids and exclude_ids:
        pipeline_all = [
            {"$sample": {"size": size}},
            {"$project": {"question_id": 1, "_id": 0}},
        ]
        cursor_all = QuestionDocument.get_pymongo_collection().aggregate(pipeline_all)
        ids = [doc["question_id"] async for doc in cursor_all]

    return ids


async def _send_next_question(room_code: str):
    from app.models.room import GameState, RoomDocument

    room = await RoomDocument.find_one(RoomDocument.room_code == room_code)
    if not room or room.game_state != GameState.PLAYING:
        return

    if room.game_data.current_question_index >= len(room.game_data.question_ids):
        new_ids = await _fetch_question_batch(
            exclude_ids=room.game_data.used_question_ids, size=QUESTION_BATCH_SIZE
        )
        if not new_ids:
            room.game_data.used_question_ids = []
            new_ids = await _fetch_question_batch(exclude_ids=[], size=QUESTION_BATCH_SIZE)
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

    room.game_data.first_correct_at = None
    room.game_data.answered_players = []
    if q_id not in room.game_data.used_question_ids:
        room.game_data.used_question_ids.append(q_id)
    await room.save()

    await sio.emit("new_question", {
        "question_index": room.game_data.current_question_index,
        "total_questions": len(room.game_data.question_ids),
        "question": question.question,
        "question_type": question.question_type.value,
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
        if room and room.game_data.question_ids:
            idx = room.game_data.current_question_index
            if idx < len(room.game_data.question_ids):
                q = await _fetch_question(room.game_data.question_ids[idx])
                if q and q.answers:
                    correct_answer = q.answers[0]

        await sio.emit("time_up", {
            "correct_answer": correct_answer,
        }, room=room_code)
        await asyncio.sleep(DELAY_AFTER_TIME_UP)
        await _advance_question(room_code)
    except asyncio.CancelledError:
        pass
    except Exception as e:
        print(f"[timer] erreur room {room_code}: {e}")


async def _advance_question(room_code: str):
    from app.models.room import GameState, RoomDocument

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

        if connected_uuids and connected_uuids.issubset(correct_uuids):
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

        manager.cancel_timer(room_code)

        wins = room.game_data.round_wins.get(player_uuid, 0) + 1
        room.game_data.round_wins[player_uuid] = wins
        await room.save()

        await sio.emit("round_won", {
            "player_uuid": player_uuid,
            "pseudo": player.pseudo,
            "round": room.game_data.actual_round,
            "round_wins": room.game_data.round_wins,
        }, room=room_code)

        if wins >= room.configurations.rounds_to_win:
            await _end_game(room_code, winner_uuid=player_uuid)
            return

        room = await RoomDocument.find_one(RoomDocument.room_code == room_code)
        if not room:
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

        await asyncio.sleep(DELAY_AFTER_ROUND_WON)
        await _send_next_question(room_code)
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


# --- Socket.IO event handlers ---

@sio.event
async def connect(sid, environ, auth):
    try:
        return await _handle_connect(sid, environ)
    except ConnectionRefusedError:
        raise
    except Exception as e:
        print(f"[connect] ERREUR: {type(e).__name__}: {e}", flush=True)
        raise ConnectionRefusedError(f"Erreur interne: {e}")


async def _handle_connect(sid, environ):
    from app.models.room import GameState, PlayerInfo, RoomDocument

    raw_qs = environ.get("query_string", b"")
    if isinstance(raw_qs, bytes):
        raw_qs = raw_qs.decode()
    qs = parse_qs(raw_qs)
    room_code = (qs.get("room_code", [""])[0]).upper()
    player_uuid = qs.get("player_uuid", [""])[0]
    pseudo = qs.get("pseudo", [None])[0]

    if not room_code or not player_uuid:
        raise ConnectionRefusedError("room_code et player_uuid requis")

    room = await RoomDocument.find_one(RoomDocument.room_code == room_code)
    if not room:
        raise ConnectionRefusedError("Room introuvable")

    # Multi-tab: disconnect old sid for same player in same room
    old_sid = manager.get_sid(room_code, player_uuid)
    if old_sid and old_sid != sid:
        await sio.disconnect(old_sid)

    now_ms = _now_ms()
    existing = room.find_player(player_uuid)
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
    sio.enter_room(sid, room_code)

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


@sio.event
async def disconnect(sid):
    from app.models.room import GameState, RoomDocument

    info = manager.unregister(sid)
    if not info:
        return

    room_code, player_uuid = info
    sio.leave_room(sid, room_code)

    room = await RoomDocument.find_one(RoomDocument.room_code == room_code)
    if room:
        if room.game_state == GameState.PLAYING:
            await manager.flush_playtime(room_code, player_uuid)

        await room.mark_player_disconnected(player_uuid=player_uuid, now_ms=_now_ms())

        await sio.emit("player_leave", {
            "player_uuid": player_uuid,
        }, room=room_code)

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

    q_ids = await _fetch_question_batch(exclude_ids=[], size=QUESTION_BATCH_SIZE)
    if not q_ids:
        await sio.emit("error", {
            "message": "Aucune question disponible en base de données.",
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

    is_correct = any(
        answer_text.lower() == valid.strip().lower()
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

    should_record = is_correct or room.configurations.show_answers
    if should_record:
        room.game_data.answered_players.append(AnsweredPlayer(
            player_uuid=player_uuid,
            answered_at=now,
            is_correct=is_correct,
            answer=answer_text,
            points_awarded=points,
        ))

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

    if "score_objective" in data:
        room.configurations.score_objective = max(1, int(data["score_objective"]))
    if "question_duration" in data:
        room.configurations.question_duration = max(1, int(data["question_duration"]))
    if "rounds_to_win" in data:
        room.configurations.rounds_to_win = max(1, int(data["rounds_to_win"]))
    if "show_answers" in data:
        room.configurations.show_answers = bool(data["show_answers"])
    await room.save()

    await sio.emit("config_update", {
        "configurations": _config_dict(room.configurations),
    }, room=room_code)
