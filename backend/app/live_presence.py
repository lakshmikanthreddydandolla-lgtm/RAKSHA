"""In-memory live-session presence for the Command Center.

This is intentionally separate from the permanent audit log. The audit log is
historical proof; this module represents who is connected *right now*.
"""
from __future__ import annotations

import threading
import time
from typing import Any

_lock = threading.RLock()
_active: dict[str, dict[str, Any]] = {}
_counter = 0


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def connect_session(
    session_id: str,
    *,
    provider: str,
    start_seq: int,
) -> dict[str, Any]:
    global _counter
    with _lock:
        existing = _active.get(session_id)
        if existing is None:
            _counter += 1
            display_name = f"User {_counter:02d}"
        else:
            display_name = existing["display_name"]

        record = {
            "session_id": session_id,
            "display_name": display_name,
            "provider": provider,
            "status": "CONNECTED",
            "connected_at": _now_iso(),
            "last_seen": _now_iso(),
            "start_seq": int(start_seq),
            "latest_verdict": None,
            "latest_risk": None,
        }
        _active[session_id] = record
        return dict(record)


def touch_session(
    session_id: str,
    *,
    status: str | None = None,
    verdict: str | None = None,
    risk_score: int | None = None,
) -> None:
    with _lock:
        record = _active.get(session_id)
        if record is None:
            return
        record["last_seen"] = _now_iso()
        if status is not None:
            record["status"] = status
        if verdict is not None:
            record["latest_verdict"] = verdict
        if risk_score is not None:
            record["latest_risk"] = risk_score


def disconnect_session(session_id: str) -> dict[str, Any] | None:
    with _lock:
        record = _active.pop(session_id, None)
        return dict(record) if record is not None else None


def disconnect_all() -> list[dict[str, Any]]:
    with _lock:
        records = [dict(item) for item in _active.values()]
        _active.clear()
        return records


def list_sessions() -> list[dict[str, Any]]:
    with _lock:
        return [dict(item) for item in _active.values()]


def active_session_ids() -> set[str]:
    with _lock:
        return set(_active)


def start_seq_for(session_id: str) -> int | None:
    with _lock:
        record = _active.get(session_id)
        return int(record["start_seq"]) if record is not None else None


def reset_presence() -> None:
    global _counter
    with _lock:
        _active.clear()
        _counter = 0
