import os

from dotenv import load_dotenv

load_dotenv()

MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
MONGODB_DB = os.getenv("MONGODB_DB", "poppy_sauce")

JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "cGV0aXQgZWFzdGVyIGVnZw==!")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "300"))

APP_HOST = os.getenv("APP_HOST", "0.0.0.0")
APP_PORT = int(os.getenv("APP_PORT", "8081"))
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "*").split(",")

ROOM_TTL_HOURS = int(os.getenv("ROOM_TTL_HOURS", "12"))
ROOM_EMPTY_CLOSE_SECONDS = int(os.getenv("ROOM_EMPTY_CLOSE_SECONDS", "60"))

QUESTION_BATCH_SIZE = int(os.getenv("QUESTION_BATCH_SIZE", "200"))
MAX_POINTS_FIRST = int(os.getenv("MAX_POINTS_FIRST", "10"))
DELAY_AFTER_TIME_UP = int(os.getenv("DELAY_AFTER_TIME_UP", "5"))
DELAY_AFTER_ALL_ANSWERED = int(os.getenv("DELAY_AFTER_ALL_ANSWERED", "3"))
DELAY_AFTER_ROUND_WON = int(os.getenv("DELAY_AFTER_ROUND_WON", "3"))
DELAY_AFTER_GAME_FINISHED = int(os.getenv("DELAY_AFTER_GAME_FINISHED", "5"))

WS_RECEIVE_TIMEOUT = int(os.getenv("WS_RECEIVE_TIMEOUT", "45"))
