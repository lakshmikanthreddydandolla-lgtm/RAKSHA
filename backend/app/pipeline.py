"""Agent proposal -> RAKSHA evaluation -> decision -> optional sandbox execution."""
from typing import Any

from backend.app.audit import chain
from backend.app.sandbox.executor import execute_tool
from backend.app.security import review_store
from backend.app.security.risk_engine import evaluate_action
from backend.app.security.session_store import (
    contain_session, get_containment, get_history, is_contained, record_action,
)

ACTION_KEYS = ("tool", "operation", "resource", "destination")


def containment_decision() -> dict[str, Any]:
    return {
        "risk_score": 100,
        "verdict": "BLOCK",
        "reasons": ["Session is contained because a previous critical action was blocked"],
        "components": {k: 0 for k in (
            "resource_risk", "destination_risk", "intent_risk",
            "permission_risk", "sequence_risk", "policy_risk")},
        "sequence_signals": ["SESSION_CONTAINED"],
    }


def _audit_execution(session_id: str, result: dict[str, Any], via: str) -> None:
    # log metadata only: never tool output (may contain synthetic secrets)
    chain.append_event("SANDBOX_EXECUTION", session_id, tool=result["tool"],
                       ok=result["ok"], error=result["error"], via=via)


def process_action(action: dict[str, Any], execute: bool = True) -> dict[str, Any]:
    sid = action["session_id"]
    history = get_history(sid)
    summary = {k: action.get(k) for k in ACTION_KEYS}
    base = {"agent_id": action.get("agent_id", ""), "session_id": sid,
            "history_length": len(history) + 1, "action": summary}

    if is_contained(sid):
        decision = containment_decision()
        record_action(sid, action, decision)
        chain.append_event("ACTION_EVALUATED", sid, verdict="BLOCK", risk_score=100,
                           action=summary, signals=["SESSION_CONTAINED"])
        return {**base, **decision, "contained": True,
                "containment": get_containment(sid),
                "execution_status": "DENIED_SESSION_CONTAINED",
                "review_id": None, "tool_result": None}

    decision = evaluate_action(action, history=history)
    record_action(sid, action, decision)
    verdict = decision["verdict"]
    chain.append_event("ACTION_EVALUATED", sid, verdict=verdict,
                       risk_score=decision["risk_score"], action=summary,
                       reasons=decision["reasons"])

    out = {**base, **decision, "contained": False, "containment": None,
           "execution_status": "INTERCEPTED", "review_id": None, "tool_result": None}

    if verdict == "BLOCK":
        out["containment"] = contain_session(sid, action, decision)
        out["contained"] = True
        out["execution_status"] = "BLOCKED_AND_CONTAINED"
        chain.append_event("ACTION_BLOCKED", sid, action=summary)
        chain.append_event("SESSION_CONTAINED", sid, trigger_tool=summary["tool"])
    elif verdict == "REVIEW":
        review = review_store.create_review(sid, action, decision)
        out["review_id"] = review["review_id"]
        out["execution_status"] = "PENDING_REVIEW"
        chain.append_event("REVIEW_CREATED", sid, review_id=review["review_id"],
                           risk_score=decision["risk_score"])
    elif execute:
        result = execute_tool(action)
        out["tool_result"] = result
        out["execution_status"] = "EXECUTED" if result["ok"] else "EXECUTION_FAILED"
        _audit_execution(sid, result, "allow")
    return out


def resolve_review(review_id: str, approve: bool):
    """Returns (state, review). Executes ONLY the one pending action on approve."""
    state, review, action = review_store.resolve_review(review_id, approve)
    if state != "ok":
        return state, review
    sid = review["session_id"]
    if not approve:
        chain.append_event("REVIEW_DENIED", sid, review_id=review_id)
        return state, review
    chain.append_event("REVIEW_APPROVED", sid, review_id=review_id, outcome="ALLOW_ONCE")
    if is_contained(sid):
        review = review_store.set_tool_result(review_id, None, "DENIED_SESSION_CONTAINED")
        return state, review
    result = execute_tool(action)
    _audit_execution(sid, result, "allow_once")
    return state, review_store.set_tool_result(review_id, result)
