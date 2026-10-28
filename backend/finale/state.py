"""In-memory live state for the finale runtime.

Agent conversation memory and RAKSHA security state are deliberately separate.
This prevents chat context, approvals and containment from accidentally resetting
one another when users switch sessions.
"""
from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from backend.finale.models import AgentMode


_lock = threading.RLock()


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


@dataclass
class AgentRuntime:
    session_id: str
    mode: str = AgentMode.DEMO.value
    model: str | None = None
    connected: bool = True
    connected_at: str = field(default_factory=now_iso)
    messages: list[dict[str, str]] = field(default_factory=list)
    last_resource: str = ""
    last_secret_resource: str = ""
    last_destination: str = ""
    last_intent: str = "NORMAL_CHAT"
    last_tool_result: str = ""


@dataclass
class SecurityRuntime:
    session_id: str
    history: list[dict[str, Any]] = field(default_factory=list)
    contained: bool = False
    containment: dict[str, Any] | None = None
    grants: list[dict[str, Any]] = field(default_factory=list)
    created_at: str = field(default_factory=now_iso)


_agents: dict[str, AgentRuntime] = {}
_security: dict[str, SecurityRuntime] = {}
_reviews: dict[str, dict[str, Any]] = {}


def connect_agent(session_id: str, mode: str, model: str | None = None) -> AgentRuntime:
    with _lock:
        existing = _agents.get(session_id)
        if existing:
            existing.mode = mode
            existing.model = model
            existing.connected = True
            return existing
        runtime = AgentRuntime(session_id=session_id, mode=mode, model=model)
        _agents[session_id] = runtime
        _security.setdefault(session_id, SecurityRuntime(session_id=session_id))
        return runtime


def get_agent(session_id: str) -> AgentRuntime:
    with _lock:
        runtime = _agents.get(session_id)
        if runtime is None:
            runtime = connect_agent(session_id, AgentMode.DEMO.value)
        return runtime


def get_security(session_id: str) -> SecurityRuntime:
    with _lock:
        runtime = _security.get(session_id)
        if runtime is None:
            runtime = SecurityRuntime(session_id=session_id)
            _security[session_id] = runtime
        return runtime


def append_message(session_id: str, role: str, content: str) -> None:
    with _lock:
        runtime = get_agent(session_id)
        runtime.messages.append({"role": role, "content": content})
        # Enough continuity for the demo without unbounded memory growth.
        runtime.messages[:] = runtime.messages[-24:]


def update_agent_reference(
    session_id: str,
    *,
    resource: str | None = None,
    secret_resource: str | None = None,
    destination: str | None = None,
    intent: str | None = None,
    tool_result: str | None = None,
) -> None:
    with _lock:
        runtime = get_agent(session_id)
        if resource:
            runtime.last_resource = resource
        if secret_resource:
            runtime.last_secret_resource = secret_resource
        if destination:
            runtime.last_destination = destination
        if intent:
            runtime.last_intent = intent
        if tool_result is not None:
            runtime.last_tool_result = tool_result[:600]


def agent_context(session_id: str) -> dict[str, Any]:
    with _lock:
        a = get_agent(session_id)
        return {
            "session_id": a.session_id,
            "mode": a.mode,
            "model": a.model,
            "messages": list(a.messages),
            "last_resource": a.last_resource,
            "last_secret_resource": a.last_secret_resource,
            "last_destination": a.last_destination,
            "last_intent": a.last_intent,
            "last_tool_result": a.last_tool_result,
        }


def record_security_event(session_id: str, action: dict[str, Any], decision: dict[str, Any]) -> None:
    with _lock:
        runtime = get_security(session_id)
        runtime.history.append({
            "timestamp": now_iso(),
            "action": dict(action),
            "decision": {
                "risk_score": decision.get("risk_score", 0),
                "verdict": decision.get("verdict", "ALLOW"),
                "reasons": list(decision.get("reasons", [])),
                "components": dict(decision.get("components", {})),
                "signals": list(decision.get("signals", [])),
            },
        })
        runtime.history[:] = runtime.history[-80:]


def contain(session_id: str, action: dict[str, Any], decision: dict[str, Any]) -> dict[str, Any]:
    with _lock:
        runtime = get_security(session_id)
        if runtime.containment:
            return dict(runtime.containment)
        runtime.contained = True
        runtime.containment = {
            "contained": True,
            "reason": "Critical action blocked by RAKSHA",
            "trigger_tool": action.get("tool", ""),
            "trigger_resource": action.get("resource", ""),
            "trigger_destination": action.get("destination", ""),
            "trigger_risk_score": decision.get("risk_score", 100),
            "contained_at": now_iso(),
        }
        return dict(runtime.containment)


def add_grant(session_id: str, grant: dict[str, Any]) -> dict[str, Any]:
    clean = {
        "grant_id": uuid.uuid4().hex[:10],
        "session_id": session_id,
        "tool": str(grant.get("tool", "*")),
        "resource": str(grant.get("resource", "*")),
        "destination": str(grant.get("destination", "*")),
        "expires": "session_end",
        "created_at": now_iso(),
    }
    with _lock:
        get_security(session_id).grants.append(clean)
    return dict(clean)


def _scope_match(expected: str, actual: str) -> bool:
    return expected in {"", "*"} or expected.lower() == actual.lower()


def matching_grant(session_id: str, action: dict[str, Any]) -> dict[str, Any] | None:
    with _lock:
        grants = list(get_security(session_id).grants)
    for grant in grants:
        if (
            _scope_match(grant["tool"], str(action.get("tool", "")))
            and _scope_match(grant["resource"], str(action.get("resource", "")))
            and _scope_match(grant["destination"], str(action.get("destination", "")))
        ):
            return dict(grant)
    return None


def create_review(session_id: str, action: dict[str, Any], decision: dict[str, Any]) -> dict[str, Any]:
    review_id = uuid.uuid4().hex[:12]
    review = {
        "review_id": review_id,
        "session_id": session_id,
        "status": "PENDING",
        "final_outcome": None,
        "created_at": now_iso(),
        "resolved_at": None,
        "action": {
            key: action.get(key)
            for key in ("tool", "operation", "resource", "destination", "user_intent")
        },
        "risk_score": decision.get("risk_score", 0),
        "reasons": list(decision.get("reasons", [])),
        "components": dict(decision.get("components", {})),
        "signals": list(decision.get("signals", [])),
        "predicted_consequence": decision.get("predicted_consequence", "Action may affect a protected resource."),
        "execution_status": "PENDING_REVIEW",
        "tool_result": None,
        "scope_grant": None,
        "_full_action": dict(action),
    }
    with _lock:
        _reviews[review_id] = review
    return public_review(review)


def public_review(review: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in review.items() if not k.startswith("_")}


def list_reviews(session_id: str | None = None, status: str | None = None) -> list[dict[str, Any]]:
    with _lock:
        rows = [
            public_review(r)
            for r in _reviews.values()
            if (session_id is None or r["session_id"] == session_id)
            and (status is None or r["status"] == status)
        ]
    return sorted(rows, key=lambda row: row["created_at"], reverse=True)


def resolve_review(review_id: str, outcome: str) -> tuple[str, dict[str, Any] | None, dict[str, Any] | None]:
    with _lock:
        review = _reviews.get(review_id)
        if review is None:
            return "not_found", None, None
        if review["status"] != "PENDING":
            return "already_resolved", public_review(review), None
        review["status"] = "DENIED" if outcome == "DENY" else "APPROVED"
        review["final_outcome"] = outcome
        review["execution_status"] = "DENIED_BY_HUMAN" if outcome == "DENY" else "APPROVED"
        review["resolved_at"] = now_iso()
        return "ok", public_review(review), dict(review["_full_action"])


def update_review(review_id: str, **changes: Any) -> dict[str, Any] | None:
    with _lock:
        review = _reviews.get(review_id)
        if review is None:
            return None
        review.update(changes)
        return public_review(review)


def reset_session(session_id: str) -> None:
    with _lock:
        _agents.pop(session_id, None)
        _security.pop(session_id, None)
        for review_id in [rid for rid, r in _reviews.items() if r["session_id"] == session_id]:
            _reviews.pop(review_id, None)


def disconnect_all() -> list[str]:
    with _lock:
        session_ids = list(_agents)
        _agents.clear()
        _security.clear()
        _reviews.clear()
        return session_ids


def session_snapshot(session_id: str) -> dict[str, Any]:
    with _lock:
        agent = _agents.get(session_id)
        security = get_security(session_id)
        latest = security.history[-1]["decision"] if security.history else None
        return {
            "session_id": session_id,
            "connected": bool(agent and agent.connected),
            "provider": agent.mode if agent else "demo",
            "model": agent.model if agent else None,
            "status": "CONTAINED" if security.contained else (latest or {}).get("verdict", "ACTIVE"),
            "latest_verdict": (latest or {}).get("verdict"),
            "latest_risk": (latest or {}).get("risk_score"),
            "contained": security.contained,
            "containment": dict(security.containment) if security.containment else None,
            "history_length": len(security.history),
            "grant_count": len(security.grants),
        }


def list_live_sessions() -> list[dict[str, Any]]:
    with _lock:
        ids = list(_agents)
    return [session_snapshot(sid) for sid in ids]
