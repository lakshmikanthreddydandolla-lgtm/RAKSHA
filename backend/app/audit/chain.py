"""SHA-256 hash-chained audit log (JSONL) + Merkle root.

Adapted from legacy_demo/server.py. Never log secrets or tool output here.
"""
import copy
import hashlib
import json
import threading
import time
import uuid
from typing import Any

from backend.app.paths import data_dir

GENESIS = "0" * 64
_lock = threading.RLock()


def _log_path():
    return data_dir() / "audit.jsonl"


def canonical(obj: Any) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(",", ":")).encode()


def _hash(event: dict[str, Any]) -> str:
    payload = dict(event)
    payload.pop("event_hash", None)
    return hashlib.sha256(canonical(payload)).hexdigest()


def load_events() -> list[dict[str, Any]]:
    path = _log_path()
    if not path.exists():
        return []
    with _lock:
        lines = path.read_text(encoding="utf-8").splitlines()
    out = []
    for line in lines:
        if line.strip():
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                out.append({"corrupt_line": line})
    return out


def append_event(event_type: str, session_id: str = "", **data: Any) -> dict[str, Any]:
    with _lock:
        events = load_events()
        prev = events[-1].get("event_hash", GENESIS) if events else GENESIS
        event = {
            "event_id": uuid.uuid4().hex[:12],
            "seq": len(events) + 1,
            "type": event_type,
            "session_id": session_id,
            "data": data,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "prev_hash": prev,
        }
        event["event_hash"] = _hash(event)
        with _log_path().open("a", encoding="utf-8") as f:
            f.write(json.dumps(event) + "\n")
        return event


def verify_events(events: list[dict[str, Any]]) -> dict[str, Any]:
    prev = GENESIS
    for i, e in enumerate(events):
        if e.get("prev_hash") != prev or _hash(e) != e.get("event_hash"):
            return {"valid": False, "invalid_index": i,
                    "invalid_event_id": e.get("event_id")}
        prev = e["event_hash"]
    return {"valid": True, "invalid_index": None, "invalid_event_id": None}


def merkle_root(hashes: list[str]) -> str:
    if not hashes:
        return GENESIS
    layer = list(hashes)
    while len(layer) > 1:
        if len(layer) % 2:
            layer.append(layer[-1])
        layer = [
            hashlib.sha256((layer[i] + layer[i + 1]).encode()).hexdigest()
            for i in range(0, len(layer), 2)
        ]
    return layer[0]


def verify() -> dict[str, Any]:
    events = load_events()
    result = verify_events(events)
    return {
        "event_count": len(events),
        "chain_valid": result["valid"],
        "invalid_index": result["invalid_index"],
        "invalid_event_id": result["invalid_event_id"],
        "merkle_root": merkle_root([e.get("event_hash", "") for e in events]),
    }


def tamper_demo() -> dict[str, Any]:
    """Tamper with an in-memory COPY only; the real log is never modified."""
    events = copy.deepcopy(load_events())
    if len(events) < 3:
        # build a throwaway in-memory chain so the demo always works
        events, prev = [], GENESIS
        for n in range(3):
            e = {"seq": n + 1, "type": "DEMO_EVENT", "data": {"n": n},
                 "prev_hash": prev}
            e["event_hash"] = _hash(e)
            prev = e["event_hash"]
            events.append(e)
    before = verify_events(events)
    target = len(events) // 2
    events[target].setdefault("data", {})["tampered"] = True
    after = verify_events(events)
    return {
        "event_count": len(events),
        "tampered_index": target,
        "chain_valid_before": before["valid"],
        "chain_valid": after["valid"],
        "invalid_index": after["invalid_index"],
        "invalid_event_id": after["invalid_event_id"],
        "real_log_modified": False,
    }


def reset() -> None:
    with _lock:
        p = _log_path()
        if p.exists():
            p.unlink()
