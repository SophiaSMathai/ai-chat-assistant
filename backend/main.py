"""
main.py
-------
FastAPI application entrypoint.
"""

from __future__ import annotations

import logging
import uuid

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from config import get_settings
from services.gemini import GeminiServiceError, clear_session, send_message

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("main")

settings = get_settings()

app = FastAPI(title="AI Chat Assistant API", version="1.0.0")

# --- Fixed CORS Block ---
# Hardcoding your local frontend origins explicitly so the browser allows the requests
origins = [
    "http://localhost:5500",
    "http://127.0.0.1:5500",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------- Schemas ----------

class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=8000)
    session_id: str | None = None


class ChatResponse(BaseModel):
    reply: str
    session_id: str


class ClearRequest(BaseModel):
    session_id: str


class ErrorResponse(BaseModel):
    error: str


# ---------- Routes ----------

@app.get("/api/health")
async def health():
    return {"status": "ok", "model": settings.GEMINI_MODEL}


@app.post("/api/chat", response_model=ChatResponse)
async def chat(payload: ChatRequest):
    session_id = payload.session_id or str(uuid.uuid4())
    try:
        reply = await send_message(session_id, payload.message)
    except GeminiServiceError as exc:
        return JSONResponse(
            status_code=exc.status_code,
            content=ErrorResponse(error=exc.message).model_dump(),
        )
    return ChatResponse(reply=reply, session_id=session_id)


@app.post("/api/clear")
async def clear(payload: ClearRequest):
    clear_session(payload.session_id)
    return {"status": "cleared", "session_id": payload.session_id}


# ---------- Fallback error handler ----------
@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled exception on %s", request.url.path)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content=ErrorResponse(error="Internal server error.").model_dump(),
    )