from beanie import Document
from pydantic import Field

class PingDocument(Document):
    message: str = Field(default="pong", description="Basic ping document")

    class Settings:
        name = "pings"
