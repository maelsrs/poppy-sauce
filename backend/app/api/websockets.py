import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

ws_router = APIRouter()


def _now_ms() -> int:
    return int(datetime.now(timezone.utc).timestamp() * 1000)


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
    from app.models.room import PlayerInfo, RoomDocument

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

    try:
        while True:
            await asyncio.wait_for(websocket.receive_text(), timeout=30)  
            player = room.find_player(player_uuid)
            if player:
                player.last_seen_at = _now_ms()
                await room.save()
    except (WebSocketDisconnect, asyncio.TimeoutError):
        await room.mark_player_disconnected(player_uuid=player_uuid, now_ms=_now_ms())
        await room.close_if_empty()
