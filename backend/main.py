from __future__ import annotations

from typing import Any
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from backend.app import policy
from backend.app.audit import anchor, chain
from backend.app.sandbox.tools import ensure_sandbox
from backend.finale.agent import OLLAMA_DEFAULT_MODEL, OllamaError, ollama_health, plan_for_mode
from backend.finale.engine import permissions_for_agent, process_action, resolve_human_review
from backend.finale.models import ActionRequest, AgentConnectRequest, AgentMessageRequest, ReviewDecisionRequest, UserCreateRequest
from backend.finale.scenarios import get_scenario, list_scenarios
from backend.finale.state import (
    agent_context,
    append_message,
    connect_agent,
    create_user,
    delete_user,
    disconnect_all,
    get_agent,
    get_security,
    list_live_sessions,
    list_reviews,
    reset_session,
    session_snapshot,
    update_agent_reference,
)

app = FastAPI(
    title="RAKSHA Finale API",
    description="Runtime Agent Kernel for Secure Human-Governed Autonomy",
    version="3.0.0-finale",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173", "http://127.0.0.1:5173",
        "http://localhost:5174", "http://127.0.0.1:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root() -> dict[str, str]:
    return {"project": "RAKSHA", "edition": "FINALE", "status": "running"}


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "project": "RAKSHA",
        "version": "3.0.0-finale",
        "security_engine": "sequence-aware-runtime-enforcement",
        "offline_ready": True,
        "tagline": "Before an AI Agent Acts, RAKSHA Decides Whether It Should.",
    }


@app.post("/api/users")
def user_create(request: UserCreateRequest) -> dict[str, Any]:
    try:
        runtime = create_user(request.name)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    chain.append_event("USER_CREATED", runtime.session_id, display_name=runtime.display_name)
    return session_snapshot(runtime.session_id)


@app.delete("/api/users/{session_id}")
def user_delete(session_id: str) -> dict[str, Any]:
    snapshot = session_snapshot(session_id) if any(row["session_id"] == session_id for row in list_live_sessions()) else None
    deleted = delete_user(session_id)
    if deleted:
        chain.append_event("USER_DELETED", session_id, display_name=(snapshot or {}).get("display_name", session_id))
    return {"session_id": session_id, "deleted": deleted}


@app.post("/api/agent/connect")
def agent_connect(request: AgentConnectRequest) -> dict[str, Any]:
    ensure_sandbox()
    mode = request.mode.value
    model = request.model
    if mode == "ollama":
        model = model or OLLAMA_DEFAULT_MODEL
        try:
            model = ollama_health(model)
        except OllamaError as exc:
            raise HTTPException(
                status_code=503,
                detail={
                    "code": "OLLAMA_UNAVAILABLE",
                    "message": str(exc),
                    "model": model,
                    "fallback": "demo",
                },
            ) from exc
    runtime = connect_agent(request.session_id, mode, model, request.display_name)
    chain.append_event("AI_CONNECTED", request.session_id, provider=mode, model=model, judge_mode=mode == "demo")
    return {
        "connected": True,
        "provider": "RAKSHA Demo Agent" if mode == "demo" else "Local Ollama",
        "provider_id": mode,
        "mode": "JUDGE_MODE" if mode == "demo" else "LOCAL_MODEL",
        "model": runtime.model,
        "message": "Offline Judge Mode is ready." if mode == "demo" else f"Local Ollama {runtime.model} verified and ready.",
        "session": session_snapshot(request.session_id),
    }


@app.post("/api/agent/disconnect")
def agent_disconnect() -> dict[str, Any]:
    session_ids = disconnect_all()
    for sid in session_ids:
        chain.append_event("AI_DISCONNECTED", sid, source="finale_disconnect")
    return {"connected": False, "disconnected_sessions": len(session_ids), "message": "Live runtime cleared. Evidence history was preserved."}


@app.post("/api/agent/message")
def agent_message(request: AgentMessageRequest) -> dict[str, Any]:
    ensure_sandbox()
    runtime = get_agent(request.session_id)
    append_message(request.session_id, "user", request.message)
    provider, fallback, plan = plan_for_mode(request.session_id, request.message, runtime.mode, runtime.model)
    chain.append_event(
        "AGENT_PROPOSAL",
        request.session_id,
        provider=provider,
        intent=plan.intent,
        proposal_count=len(plan.proposals),
        tools=[proposal.tool for proposal in plan.proposals],
        rationale=plan.rationale,
    )

    results: list[dict[str, Any]] = []
    for proposal in plan.proposals:
        action = {
            "agent_id": f"finale-agent-{provider}",
            "session_id": request.session_id,
            "tool": proposal.tool,
            "operation": proposal.operation,
            "resource": proposal.resource,
            "destination": proposal.destination,
            "user_intent": request.message,
            "permissions": permissions_for_agent(),
            "metadata": proposal.metadata,
        }
        decision = process_action(action, execute=True)
        results.append({"proposal": proposal.model_dump(), "decision": decision})
        tool_result = decision.get("tool_result") or {}
        if tool_result.get("ok"):
            output = tool_result.get("output")
            update_agent_reference(request.session_id, tool_result=str(output or ""))

    final_message = plan.assistant_message
    if any(item["decision"]["verdict"] == "BLOCK" for item in results):
        final_message = "RAKSHA blocked a dangerous action before execution and contained this session."
    elif any(item["decision"]["verdict"] == "REVIEW" for item in results):
        final_message = "RAKSHA paused a sensitive action. Human Governance must decide before execution."
    elif results and results[-1]["decision"].get("tool_result", {}).get("ok"):
        proposal = results[-1]["proposal"]
        output = results[-1]["decision"]["tool_result"].get("output") or {}
        if proposal.get("resource") == "vendor_invoice.pdf":
            final_message = "The synthetic vendor invoice is from Acme Supplies for $1,250.00 and is due in 30 days. RAKSHA allowed the read."
        elif proposal.get("resource") == "meeting_notes.txt":
            final_message = "The synthetic meeting notes cover Q3 planning and say the demo should ship on Friday. RAKSHA allowed the read."
        elif proposal.get("resource") == ".env":
            final_message = "The sensitive read executed only after RAKSHA's security decision. Secret contents are intentionally not echoed into chat."
        elif output:
            final_message = "Action completed inside the synthetic sandbox under RAKSHA protection."

    append_message(request.session_id, "assistant", final_message)
    security = get_security(request.session_id)
    return {
        "session_id": request.session_id,
        "provider": provider,
        "fallback_reason": fallback,
        "assistant_message": final_message,
        "intent": plan.intent,
        "rationale": plan.rationale,
        "proposed_actions": [proposal.model_dump() for proposal in plan.proposals],
        "results": results,
        "contained": security.contained,
        "context": {
            "last_resource": agent_context(request.session_id).get("last_resource"),
            "last_secret_resource": bool(agent_context(request.session_id).get("last_secret_resource")),
            "history_length": len(security.history),
        },
    }


@app.get("/api/sessions")
def sessions() -> dict[str, Any]:
    rows = list_live_sessions()
    return {"count": len(rows), "sessions": rows}


@app.get("/api/session/{session_id}")
def session(session_id: str) -> dict[str, Any]:
    snapshot = session_snapshot(session_id)
    security = get_security(session_id)
    snapshot["events"] = security.history
    snapshot["grants"] = security.grants
    return snapshot


@app.post("/api/session/{session_id}/reset")
def session_reset_preserving_user(session_id: str) -> dict[str, Any]:
    existing = next((row for row in list_live_sessions() if row["session_id"] == session_id), None)
    if existing is None:
        raise HTTPException(status_code=404, detail="User not found")
    reset_session(session_id)
    chain.append_event("SESSION_RESET", session_id, display_name=existing["display_name"])
    return session_snapshot(session_id)


@app.delete("/api/session/{session_id}")
def session_delete_legacy(session_id: str) -> dict[str, Any]:
    """Legacy cleanup route retained for tests and older clients; final UI uses /api/users."""
    deleted = delete_user(session_id)
    return {"session_id": session_id, "status": "deleted", "deleted": deleted}


@app.post("/api/session/evaluate")
def evaluate_action(request: ActionRequest) -> dict[str, Any]:
    action = request.model_dump()
    execute = action.pop("execute", True)
    return process_action(action, execute=execute)


@app.get("/api/reviews")
def reviews(session_id: str | None = None, status: str | None = None) -> dict[str, Any]:
    return {"reviews": list_reviews(session_id, status)}


@app.post("/api/reviews/{review_id}/decision")
def review_decision(review_id: str, request: ReviewDecisionRequest) -> dict[str, Any]:
    state, review = resolve_human_review(review_id, request.decision, request.scope)
    if state == "not_found":
        raise HTTPException(status_code=404, detail="Review not found")
    if state == "already_resolved":
        raise HTTPException(status_code=409, detail="Review already resolved")
    return review or {}


@app.post("/api/reviews/{review_id}/approve")
def review_approve(review_id: str) -> dict[str, Any]:
    state, review = resolve_human_review(review_id, "ALLOW_ONCE")
    if state == "not_found": raise HTTPException(status_code=404, detail="Review not found")
    if state == "already_resolved": raise HTTPException(status_code=409, detail="Review already resolved")
    return review or {}


@app.post("/api/reviews/{review_id}/deny")
def review_deny(review_id: str) -> dict[str, Any]:
    state, review = resolve_human_review(review_id, "DENY")
    if state == "not_found": raise HTTPException(status_code=404, detail="Review not found")
    if state == "already_resolved": raise HTTPException(status_code=409, detail="Review already resolved")
    return review or {}


@app.get("/api/attacks")
def attacks() -> dict[str, Any]:
    rows = list_scenarios()
    return {"count": len(rows), "scenarios": rows}


@app.post("/api/attacks/{scenario_id}/run")
def run_attack(scenario_id: str) -> dict[str, Any]:
    scenario = get_scenario(scenario_id)
    if scenario is None:
        raise HTTPException(status_code=404, detail="Attack scenario not found")
    sid = f"redteam-{scenario_id}-{uuid4().hex[:6]}"
    connect_agent(sid, "demo", display_name=f"Red Team: {scenario['name']}")
    events = []
    for raw_action in scenario["actions"]:
        action = {
            "agent_id": "red-team-agent",
            "session_id": sid,
            "permissions": permissions_for_agent(),
            **raw_action,
        }
        decision = process_action(action, execute=False)
        events.append({"action": {k: action.get(k) for k in ("tool", "operation", "resource", "destination")}, **decision})
        if decision["verdict"] == "BLOCK":
            break
    final = events[-1] if events else {"verdict": "ALLOW", "risk_score": 0}
    actual = final["verdict"]
    passed = actual == scenario["expected_verdict"] or (scenario["expected_verdict"] == "BLOCK" and actual == "BLOCK")
    return {
        "scenario_id": scenario["id"],
        "name": scenario["name"],
        "category": scenario["category"],
        "severity": scenario["severity"],
        "description": scenario["description"],
        "expected_verdict": scenario["expected_verdict"],
        "final_verdict": actual,
        "final_risk_score": final["risk_score"],
        "passed": passed,
        "session_id": sid,
        "contained": get_security(sid).contained,
        "events": events,
    }


@app.get("/api/audit/events")
def audit_events(limit: int = 200) -> dict[str, Any]:
    events = chain.load_events()
    return {"event_count": len(events), "events": events[-max(1, min(limit, 500)):]}


@app.get("/api/audit/verify")
def audit_verify() -> dict[str, Any]:
    result = chain.verify()
    anchors = anchor.list_anchors()
    result["last_anchor"] = anchors[-1] if anchors else None
    result["label"] = "Tamper-evident local audit history"
    return result


@app.post("/api/audit/tamper-demo")
def audit_tamper() -> dict[str, Any]:
    return chain.tamper_demo()


@app.post("/api/audit/anchor")
def audit_anchor() -> dict[str, Any]:
    return anchor.anchor_now()


@app.get("/api/evidence/receipt/{session_id}")
def security_receipt(session_id: str) -> dict[str, Any]:
    security = get_security(session_id)
    verify = chain.verify()
    return {
        "receipt_type": "RAKSHA_SECURITY_RECEIPT",
        "session_id": session_id,
        "contained": security.contained,
        "containment": security.containment,
        "event_count": len(security.history),
        "actions": security.history,
        "evidence": {"chain_valid": verify["chain_valid"], "merkle_root": verify["merkle_root"]},
        "statement": "This receipt summarizes local demo security decisions. It is not a blockchain transaction.",
    }


class PolicyUpdate(BaseModel):
    thresholds: dict[str, int] | None = None
    allowed_tools: list[str] | None = None
    default_agent_permissions: list[str] | None = None
    sensitive_markers: list[str] | None = None
    trusted_destinations: list[str] | None = None
    trusted_users: list[str] | None = None
    trusted_tools: list[str] | None = None
    destructive_operations: list[str] | None = None
    high_risk_permissions: list[str] | None = None


@app.get("/api/policies")
def policies_get() -> dict[str, Any]:
    return policy.get_policy()


@app.put("/api/policies")
def policies_put(update: PolicyUpdate) -> dict[str, Any]:
    try:
        return policy.update_policy(update.model_dump(exclude_none=True))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/api/policies/reset")
def policies_reset() -> dict[str, Any]:
    return policy.reset_policy()
