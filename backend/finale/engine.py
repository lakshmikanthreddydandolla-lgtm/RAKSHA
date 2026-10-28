"""Runtime enforcement pipeline for the RAKSHA finale build."""
from __future__ import annotations

from typing import Any

from backend.app import policy
from backend.app.audit import chain
from backend.app.sandbox.executor import execute_tool
from backend.finale.risk import assess
from backend.finale.state import add_grant, contain, create_review, get_security, record_security_event, resolve_review, update_review


def _summary(action: dict[str, Any]) -> dict[str, Any]:
    return {key: action.get(key) for key in ("tool", "operation", "resource", "destination")}


def _apply_security_floors(decision: dict[str, Any]) -> dict[str, Any]:
    """Risk arithmetic explains the decision; these floors enforce governance invariants."""
    components = decision.get("components", {})
    signals = decision.get("signals", [])
    scoped = "SCOPED_HUMAN_GRANT" in signals
    if decision.get("hard_block"):
        decision["verdict"] = "BLOCK"
        decision["risk_score"] = max(90, int(decision.get("risk_score", 0)))
        return decision
    if "RETRY_AFTER_INTERVENTION" in signals:
        decision["risk_score"] = max(75, int(decision.get("risk_score", 0)))
        decision["verdict"] = "BLOCK"
        decision["predicted_consequence"] = "Repeated risky execution is stopped and the affected session is contained."
        return decision
    if components.get("sequence_risk", 0) >= 70:
        decision["risk_score"] = max(70, int(decision.get("risk_score", 0)))
        decision["verdict"] = "BLOCK"
        return decision
    review_floor = (
        components.get("destination_risk", 0) >= 50
        or components.get("permission_risk", 0) >= 50
        or (components.get("resource_risk", 0) >= 50 and not scoped)
    )
    if review_floor:
        decision["risk_score"] = max(45, int(decision.get("risk_score", 0)))
        decision["verdict"] = "REVIEW"
        decision["predicted_consequence"] = "Execution is paused until a human chooses Allow Once, Scoped Allow, or Deny."
    return decision


def process_action(action: dict[str, Any], execute: bool = True) -> dict[str, Any]:
    session_id = str(action.get("session_id", "demo-session"))
    decision = _apply_security_floors(assess(session_id, action))
    record_security_event(session_id, action, decision)
    summary = _summary(action)
    chain.append_event(
        "ACTION_EVALUATED", session_id, action=summary,
        verdict=decision["verdict"], risk_score=decision["risk_score"],
        reasons=decision["reasons"], signals=decision["signals"], components=decision["components"],
    )
    result = {
        "agent_id": action.get("agent_id", ""), "session_id": session_id, "action": summary,
        **decision, "review_id": None, "tool_result": None, "execution_status": "INTERCEPTED",
        "contained": get_security(session_id).contained, "containment": get_security(session_id).containment,
    }
    if decision["verdict"] == "BLOCK":
        containment = contain(session_id, action, decision)
        result.update(contained=True, containment=containment, execution_status="BLOCKED_AND_CONTAINED")
        chain.append_event("ACTION_BLOCKED", session_id, action=summary, signals=decision["signals"])
        chain.append_event("SESSION_CONTAINED", session_id, trigger_tool=summary.get("tool"), trigger_resource=summary.get("resource"))
        return result
    if decision["verdict"] == "REVIEW":
        review = create_review(session_id, action, decision)
        result.update(review_id=review["review_id"], execution_status="PENDING_REVIEW")
        chain.append_event("REVIEW_CREATED", session_id, review_id=review["review_id"], risk_score=decision["risk_score"], action=summary)
        return result
    if not execute:
        result["execution_status"] = "ALLOWED_NOT_EXECUTED"
        return result
    tool_result = execute_tool(action)
    result["tool_result"] = tool_result
    result["execution_status"] = "EXECUTED" if tool_result.get("ok") else "EXECUTION_FAILED"
    chain.append_event("SANDBOX_EXECUTION", session_id, tool=summary.get("tool"), resource=summary.get("resource"), ok=tool_result.get("ok", False), via="allow")
    return result


def resolve_human_review(review_id: str, outcome: str, scope: dict[str, Any] | None = None) -> tuple[str, dict[str, Any] | None]:
    state, review, action = resolve_review(review_id, outcome)
    if state != "ok" or review is None or action is None:
        return state, review
    session_id = review["session_id"]
    if outcome == "DENY":
        chain.append_event("REVIEW_DENIED", session_id, review_id=review_id)
        return state, review
    if get_security(session_id).contained:
        return state, update_review(review_id, execution_status="DENIED_SESSION_CONTAINED")
    grant = None
    if outcome == "SCOPED_ALLOW":
        requested = scope or {"tool": action.get("tool", "*"), "resource": action.get("resource", "*"), "destination": action.get("destination", "*")}
        grant = add_grant(session_id, requested)
        chain.append_event("SCOPED_GRANT_CREATED", session_id, review_id=review_id, grant=grant)
    tool_result = execute_tool(action)
    final_status = "EXECUTED_AFTER_REVIEW" if tool_result.get("ok") else "EXECUTION_FAILED"
    review = update_review(review_id, tool_result=tool_result, execution_status=final_status, scope_grant=grant)
    chain.append_event("REVIEW_APPROVED", session_id, review_id=review_id, outcome=outcome, scope_grant=grant)
    chain.append_event("SANDBOX_EXECUTION", session_id, tool=action.get("tool"), resource=action.get("resource"), ok=tool_result.get("ok", False), via=outcome.lower())
    return state, review


def permissions_for_agent() -> list[str]:
    return list(policy.get_policy()["default_agent_permissions"])
