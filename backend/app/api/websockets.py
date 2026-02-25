import asyncio
import json
import random
from datetime import datetime, timezone
from math import floor
from typing import Dict, Optional

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from app.core.config import (
    DELAY_AFTER_ALL_ANSWERED,
    DELAY_AFTER_GAME_FINISHED,
    DELAY_AFTER_ROUND_WON,
    DELAY_AFTER_TIME_UP,
    MAX_POINTS_FIRST,
    QUESTION_BATCH_SIZE,
    WS_RECEIVE_TIMEOUT,
)

ws_router = APIRouter()


def _now_ms() -> int:
    return int(datetime.now(timezone.utc).timestamp() * 1000)


class ConnectionManager:
    def __init__(self):
        self.rooms: Dict[str, Dict[str, WebSocket]] = {}
        self.room_timers: Dict[str, asyncio.Task] = {}
        self.room_transition_tasks: Dict[str, asyncio.Task] = {}
        self.playing_since: Dict[str, Dict[str, int]] = {}

    def connect(self, room_code: str, player_uuid: str, ws: WebSocket):
        if room_code not in self.rooms:
            self.rooms[room_code] = {}
        self.rooms[room_code][player_uuid] = ws

    def disconnect(self, room_code: str, player_uuid: str):
        room = self.rooms.get(room_code)
        if room:
            room.pop(player_uuid, None)
            if not room:
                del self.rooms[room_code]

    async def broadcast(self, room_code: str, message: dict, *, exclude: str | None = None):
        room = self.rooms.get(room_code)
        if not room:
            return
        payload = json.dumps(message)
        dead: list[str] = []
        for uid, ws in room.items():
            if uid == exclude:
                continue
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(uid)
        for uid in dead:
            room.pop(uid, None)

    async def send_personal(self, ws: WebSocket, message: dict):
        try:
            await ws.send_text(json.dumps(message))
        except Exception:
            pass

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


manager = ConnectionManager()


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
    from app.models.question import QuestionDocument
    return await QuestionDocument.find_one(QuestionDocument.question_id == question_id)


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

    await manager.broadcast(room_code, {
        "type": "new_question",
        "question_index": room.game_data.current_question_index,
        "total_questions": len(room.game_data.question_ids),
        "question": question.question,
        "question_type": question.question_type.value,
        "image_url": str(question.image_url) if question.image_url else None,
        "time_limit": room.configurations.question_duration,
        "round": room.game_data.actual_round,
    })

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

        await manager.broadcast(room_code, {
            "type": "time_up",
            "correct_answer": correct_answer,
        })
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

            await manager.broadcast(room_code, {
                "type": "all_answered",
                "correct_answer": correct_answer,
            })
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

        await manager.broadcast(room_code, {
            "type": "round_won",
            "player_uuid": player_uuid,
            "pseudo": player.pseudo,
            "round": room.game_data.actual_round,
            "round_wins": room.game_data.round_wins,
        })

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

    await manager.broadcast(room_code, {
        "type": "game_finished",
        "winner": winner_data,
        "leaderboard": leaderboard,
        "reason": reason,
    })

    await asyncio.sleep(DELAY_AFTER_GAME_FINISHED)

    room = await RoomDocument.find_one(RoomDocument.room_code == room_code)
    if not room:
        return
    room.game_state = GameState.WAITING
    room.game_data = GameData()
    for p in room.players_info:
        p.points = 0
    await room.save()

    await manager.broadcast(room_code, {
        "type": "game_reset",
        "game_state": "WAITING",
    })


@ws_router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            message = await websocket.receive_text()
            await websocket.send_text(f"echo: {message}")
    except WebSocketDisconnect:
        pass


@ws_router.websocket("/ws/rooms/{room_code}")
async def room_websocket_endpoint(
    websocket: WebSocket,
    room_code: str,
    player_uuid: str = Query(..., min_length=1),
    pseudo: str | None = Query(default=None, min_length=1, max_length=64),
):
    from app.db.client import ensure_db
    from app.models.question import QuestionDocument
    from app.models.room import AnsweredPlayer, GameState, PlayerInfo, RoomDocument

    await ensure_db()
    await websocket.accept()

    room = await RoomDocument.find_one(RoomDocument.room_code == room_code)
    if not room:
        await websocket.close(code=4404)
        return

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
    manager.connect(room_code, player_uuid, websocket)

    if room.game_state == GameState.PLAYING:
        manager.start_playing_one(room_code, player_uuid)

    player_info = room.find_player(player_uuid)

    room_state_msg = {
        "type": "room_state",
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
                elapsed_ms = _now_ms() - (room.game_data.started_at or _now_ms())
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

    try:
        await manager.send_personal(websocket, room_state_msg)

        if player_info:
            await manager.broadcast(room_code, {
                "type": "player_join",
                "player": _player_dict(player_info),
            }, exclude=player_uuid)

        while True:
            raw = await asyncio.wait_for(websocket.receive_text(), timeout=WS_RECEIVE_TIMEOUT)

            try:
                msg = json.loads(raw)
            except (json.JSONDecodeError, ValueError):
                msg = {"type": "ping"} if raw.strip().lower() == "ping" else {"type": "unknown"}

            msg_type = msg.get("type", "")

            if msg_type == "ping":
                room = await RoomDocument.find_one(RoomDocument.room_code == room_code)
                if room:
                    player = room.find_player(player_uuid)
                    if player:
                        player.last_seen_at = _now_ms()
                        await room.save()

            elif msg_type == "start_game":
                room = await RoomDocument.find_one(RoomDocument.room_code == room_code)
                if not room:
                    break
                player = room.find_player(player_uuid)
                if player and player.is_owner and room.game_state == GameState.WAITING:
                    q_ids = await _fetch_question_batch(exclude_ids=[], size=QUESTION_BATCH_SIZE)
                    if not q_ids:
                        await manager.send_personal(websocket, {
                            "type": "error",
                            "message": "Aucune question disponible en base de données.",
                        })
                        continue

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

                    await manager.broadcast(room_code, {
                        "type": "game_started",
                        "game_state": "PLAYING",
                        "started_at": room.game_data.started_at,
                    })

                    await _send_next_question(room_code)

            elif msg_type == "submit_answer":
                room = await RoomDocument.find_one(RoomDocument.room_code == room_code)
                if not room or room.game_state != GameState.PLAYING:
                    continue

                answer_text = str(msg.get("answer", "")).strip()
                if not answer_text:
                    continue

                already_correct = any(
                    ap.player_uuid == player_uuid and ap.is_correct
                    for ap in room.game_data.answered_players
                )
                if already_correct:
                    continue

                idx = room.game_data.current_question_index
                if idx >= len(room.game_data.question_ids):
                    continue
                q_id = room.game_data.question_ids[idx]
                question = await _fetch_question(q_id)
                if not question:
                    continue

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

                await manager.broadcast(room_code, {
                    "type": "player_answered",
                    "player_uuid": player_uuid,
                    "pseudo": player.pseudo if player else None,
                    "is_correct": is_correct,
                    "answer": broadcast_answer,
                    "points_awarded": points,
                    "total_points": player.points if player else 0,
                })

                if is_correct:
                    asyncio.create_task(_check_round_end(room_code, player_uuid))

            elif msg_type == "end_game":
                room = await RoomDocument.find_one(RoomDocument.room_code == room_code)
                if not room:
                    break
                player = room.find_player(player_uuid)
                if player and player.is_owner and room.game_state == GameState.PLAYING:
                    await _end_game(room_code, reason="owner_ended")

            elif msg_type == "chat_message":
                text = str(msg.get("text", "")).strip()
                if text and len(text) <= 300:
                    room = await RoomDocument.find_one(RoomDocument.room_code == room_code)
                    player = room.find_player(player_uuid) if room else None
                    await manager.broadcast(room_code, {
                        "type": "chat_message",
                        "player_uuid": player_uuid,
                        "pseudo": player.pseudo if player else None,
                        "text": text,
                        "timestamp": _now_ms(),
                    })

            elif msg_type == "update_config":
                room = await RoomDocument.find_one(RoomDocument.room_code == room_code)
                if not room:
                    break
                player = room.find_player(player_uuid)
                if player and player.is_owner:
                    data = msg.get("data", {})
                    if "score_objective" in data:
                        room.configurations.score_objective = max(1, int(data["score_objective"]))
                    if "question_duration" in data:
                        room.configurations.question_duration = max(1, int(data["question_duration"]))
                    if "rounds_to_win" in data:
                        room.configurations.rounds_to_win = max(1, int(data["rounds_to_win"]))
                    if "show_answers" in data:
                        room.configurations.show_answers = bool(data["show_answers"])
                    await room.save()

                    await manager.broadcast(room_code, {
                        "type": "config_update",
                        "configurations": _config_dict(room.configurations),
                    })

    except (WebSocketDisconnect, asyncio.TimeoutError):
        pass
    finally:
        manager.disconnect(room_code, player_uuid)
        room = await RoomDocument.find_one(RoomDocument.room_code == room_code)
        if room:
            if room.game_state == GameState.PLAYING:
                await manager.flush_playtime(room_code, player_uuid)

            await room.mark_player_disconnected(player_uuid=player_uuid, now_ms=_now_ms())

            await manager.broadcast(room_code, {
                "type": "player_leave",
                "player_uuid": player_uuid,
            })

            await room.close_if_empty()
