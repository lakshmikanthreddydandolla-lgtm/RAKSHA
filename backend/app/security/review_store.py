import threading
import time
import uuid
from typing import Any

_lock = threading.RLock()
_reviews: dict[str, dict[str, Any]] = {}


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def create_review(session_id: str, action: dict[str, Any], decision: dict[str, Any]) -> dict[str, Any]:
    review = {
        "review_id": uuid.uuid4().hex[:12],
        "session_id": session_id,
        "agent_id": action.get("agent_id", ""),
        "action": {k: action.get(k) for k in
                   ("tool", "operation", "resource", "destination", "user_intent")},
        "risk_score": decision["risk_score"],
        "verdict": "REVIEW",
        "reasons": list(decision.get("reasons", [])),
        "components": decision.get("components", {}),
        "sequence_signals": list(decision.get("sequence_signals", [])),
        "status": "PENDING",
        "final_outcome": None,
        "execution_status": "PENDING_REVIEW",
        "tool_result": None,
        "created_at": _now(),
        "resolved_at": None,
        # full action kept server-side for one-time execution
        "_full_action": dict(action),
    }
    with _lock:
        _reviews[review["review_id"]] = review
    return public(review)


def public(review: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in review.items() if not k.startswith("_")}


def list_reviews(session_id: str | None = None, status: str | None = None) -> list[dict[str, Any]]:
    with _lock:
        items = [public(r) for r in _reviews.values()
                 if (session_id is None or r["session_id"] == session_id)
                 and (status is None or r["status"] == status)]
    return sorted(items, key=lambda r: r["created_at"])


def get_review(review_id: str) -> dict[str, Any] | None:
    with _lock:
        r = _reviews.get(review_id)
        return public(r) if r else None


def resolve_review(review_id: str, approve: bool) -> tuple[str, dict[str, Any] | None, dict[str, Any] | None]:
    """Atomically resolve. Returns (state, public_review, full_action).
    state: 'not_found' | 'already_resolved' | 'ok'."""
    with _lock:
        r = _reviews.get(review_id)
        if r is None:
            return "not_found", None, None
        if r["status"] != "PENDING":
            return "already_resolved", public(r), None
        r["status"] = "APPROVED" if approve else "DENIED"
        r["final_outcome"] = "ALLOW_ONCE" if approve else "DENY"
        r["execution_status"] = "APPROVED_ONCE" if approve else "DENIED_BY_HUMAN"
        r["resolved_at"] = _now()
        return "ok", public(r), dict(r["_full_action"])


def set_tool_result(review_id: str, tool_result: dict[str, Any] | None, execution_status: str | None = None) -> dict[str, Any] | None:
    with _lock:
        r = _reviews.get(review_id)
        if r is None:
            return None
        r["tool_result"] = tool_result
        if execution_status:
            r["execution_status"] = execution_status
        return public(r)


def remove_session_reviews(session_id: str) -> int:
    with _lock:
        ids = [i for i, r in _reviews.items() if r["session_id"] == session_id]
        for i in ids:
            del _reviews[i]
        return len(ids)
