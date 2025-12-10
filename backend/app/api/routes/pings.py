from fastapi import APIRouter
from app.models import PingDocument

router = APIRouter(prefix="/pings", tags=["pings"])

@router.get("")
async def list_pings():
    return await PingDocument.find_all().to_list()
