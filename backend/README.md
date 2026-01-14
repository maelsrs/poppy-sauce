## Launch uvicorn app

uvicorn app.main:app --port 8081 --reload

## Launch local mongo for debugging

cd dev
docker compose up -d
