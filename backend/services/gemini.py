"""
services/gemini.py
-------------------
Thin wrapper around the `google-genai` SDK that manages per-session,
in-memory chat history and exposes a single async helper the FastAPI
routes call into.

We use the SDK's native `client.chats` interface, which keeps multi-turn
context on the client object itself (a `Chat` instance). We just need to
map our own `session_id` -> `Chat` instance so multiple browser tabs /
users each get their own independent conversation.

NOTE: History lives in process memory only. It resets on server restart
and does not scale across multiple worker processes/instances. That's
fine for a mentorship / demo project; swap in Redis or a DB-backed store
if this ever needs to run with >1 worker.
"""

from __future__ import annotations

import logging
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict

# Ensure backend folder is in sys.path so config imports cleanly
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from google import genai
from google.genai import errors as genai_errors
from google.genai import types as genai_types

from config import get_settings

logger = logging.getLogger("gemini_service")

settings = get_settings()

# A single shared client instance. The SDK reads GEMINI_API_KEY from the
# environment automatically, but we pass it explicitly so config.py stays
# the single source of truth for where the key comes from.
client = genai.Client(api_key=settings.GEMINI_API_KEY)

# System instruction that shapes the assistant's persona/behavior.
SYSTEM_INSTRUCTION = (
    "You are a helpful, friendly AI assistant embedded in a chat product. "
    "Answer clearly and concisely. Use Markdown (headings, lists, code "
    "blocks) when it improves readability."
)


@dataclass
class ChatSession:
    """Wraps a genai Chat object plus light bookkeeping."""
    chat: genai_types.Chat
    turn_count: int = field(default=0)


# session_id -> ChatSession
_sessions: Dict[str, ChatSession] = {}


class GeminiServiceError(Exception):
    """Raised for any recoverable Gemini API failure. Carries an HTTP-ish status."""

    def __init__(self, message: str, status_code: int = 500):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _get_or_create_chat(session_id: str) -> ChatSession:
    if session_id not in _sessions:
        # Sanitize model string (e.g. 'Gemini 3.1 Flash-Lite' -> 'gemini-3.1-flash-lite')
        model_name = settings.GEMINI_MODEL.strip().lower().replace(" ", "-")
        chat = client.chats.create(
            model=model_name,
            config=genai_types.GenerateContentConfig(
                system_instruction=SYSTEM_INSTRUCTION,
                temperature=0.8,
            ),
        )
        _sessions[session_id] = ChatSession(chat=chat)
        logger.info("Created new chat session: %s with model: %s", session_id, model_name)
    return _sessions[session_id]


async def send_message(session_id: str, message: str) -> str:
    """
    Sends `message` to the given session's chat (creating the session if
    it doesn't exist yet) and returns the model's text reply.

    Raises GeminiServiceError with an appropriate status_code on failure,
    so the FastAPI route can translate it into a clean JSON error response.
    """
    if not message or not message.strip():
        raise GeminiServiceError("Message cannot be empty.", status_code=400)

    session = _get_or_create_chat(session_id)

    # Basic safety valve: if a session runs very long, start a fresh chat
    # rather than letting it grow unbounded in memory.
    if session.turn_count >= settings.MAX_HISTORY_MESSAGES:
        logger.info("Session %s hit max history, resetting.", session_id)
        del _sessions[session_id]
        session = _get_or_create_chat(session_id)

    try:
        response = session.chat.send_message(message)
    except genai_errors.ClientError as exc:
        status = getattr(exc, "status_code", None) or getattr(exc, "code", None) or 400
        logger.warning("Gemini client error for session %s: %s", session_id, exc)
        if status == 429:
            raise GeminiServiceError(
                "Rate limit reached. Please wait a moment and try again.", status_code=429
            ) from exc
        if status in (401, 403):
            raise GeminiServiceError(
                "Gemini API key is missing or invalid.", status_code=500
            ) from exc
        raise GeminiServiceError(f"Gemini rejected the request: {exc}", status_code=400) from exc
    except genai_errors.ServerError as exc:
        logger.error("Gemini server error for session %s: %s", session_id, exc)
        raise GeminiServiceError(
            "Gemini's servers are having issues right now. Please try again shortly.",
            status_code=502,
        ) from exc
    except Exception as exc:  # noqa: BLE001 - last-resort safety net
        logger.exception("Unexpected error calling Gemini for session %s", session_id)
        raise GeminiServiceError("Unexpected server error.", status_code=500) from exc

    session.turn_count += 1

    text = getattr(response, "text", None)
    if not text:
        raise GeminiServiceError("Gemini returned an empty response.", status_code=502)

    return text


def clear_session(session_id: str) -> None:
    """Drops the in-memory chat history for a given session, if present."""
    _sessions.pop(session_id, None)
    logger.info("Cleared session: %s", session_id)
