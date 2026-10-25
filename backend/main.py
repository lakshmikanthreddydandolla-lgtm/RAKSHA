from typing import Any, List
from uuid import uuid4

from fastapi import (
    FastAPI,
    HTTPException,
)
from fastapi.middleware.cors import (
    CORSMiddleware,
)
from pydantic import (
    BaseModel,
    Field,
)

from backend.app.scenarios.catalog import (
    get_attack_scenario,
    get_attack_scenarios,
)
from backend.app.security.risk_engine import (
    evaluate_action,
)
from backend.app import policy as policy_cfg
from backend.app import live_presence
from backend.app.audit import anchor, chain
from backend.app.pipeline import (
    process_action,
    resolve_review,
)
from backend.app.providers import plan_with_fallback
from backend.app.sandbox.tools import ensure_sandbox
from backend.app.security import review_store
from backend.app.security.review_store import (
    remove_session_reviews,
)
from backend.app.security.session_store import (
    contain_session,
    get_containment,
    get_history,
    is_contained,
    record_action,
    reset_session,
)


app = FastAPI(
    title="RAKSHA API",
    description=(
        "Runtime Agent Kernel for "
        "Secure Human-Governed Autonomy"
    ),
    version="0.7.0",
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ActionRequest(BaseModel):
    agent_id: str = "demo-agent"

    session_id: str = "demo-session"

    tool: str

    operation: str

    resource: str

    destination: str = "local"

    user_intent: str

    permissions: List[str] = Field(
        default_factory=list
    )

    metadata: dict[str, Any] = Field(
        default_factory=dict
    )

    execute: bool = True


def containment_decision():
    return {
        "risk_score": 100,
        "verdict": "BLOCK",
        "reasons": [
            (
                "Session is contained because "
                "a previous critical action "
                "was blocked"
            )
        ],
        "components": {
            "resource_risk": 0,
            "destination_risk": 0,
            "intent_risk": 0,
            "permission_risk": 0,
            "sequence_risk": 0,
            "policy_risk": 0,
        },
        "sequence_signals": [
            "SESSION_CONTAINED"
        ],
    }


@app.get("/")
async def root():
    return {
        "project": "RAKSHA",
        "status": "running",
    }


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "project": "RAKSHA",
        "version": "0.8.0",
        "security_engine": (
            "full-runtime-active"
        ),
    }


@app.post("/api/evaluate")
async def evaluate(
    request: ActionRequest,
):
    action = (
        request.model_dump()
    )
    action.pop("execute", None)

    decision = (
        evaluate_action(action)
    )

    return {
        "agent_id": request.agent_id,
        "session_id": request.session_id,
        "action": {
            "tool": request.tool,
            "operation": request.operation,
            "resource": request.resource,
            "destination": (
                request.destination
            ),
        },
        **decision,
    }


@app.post(
    "/api/session/evaluate"
)
async def evaluate_session_action(
    request: ActionRequest,
):
    action = request.model_dump()
    execute = action.pop("execute", True)

    return process_action(
        action,
        execute=execute,
    )


@app.get(
    "/api/session/{session_id}"
)
async def session_history(
    session_id: str,
):
    history = get_history(
        session_id
    )

    return {
        "session_id": session_id,
        "history_length": (
            len(history)
        ),
        "contained": (
            is_contained(
                session_id
            )
        ),
        "containment": (
            get_containment(
                session_id
            )
        ),
        "events": history,
    }


@app.delete(
    "/api/session/{session_id}"
)
async def clear_session(
    session_id: str,
):
    reset_session(
        session_id
    )
    removed = remove_session_reviews(
        session_id
    )
    chain.append_event(
        "SESSION_RESET",
        session_id,
        reviews_removed=removed,
    )
    live_presence.touch_session(session_id, status="CONNECTED", verdict=None, risk_score=0)

    return {
        "session_id": session_id,
        "status": "reset",
        "contained": False,
    }


@app.post(
    "/api/session/{session_id}/contain"
)
async def manually_contain_session(
    session_id: str,
):
    fake_action = {
        "tool": "manual_containment",
        "operation": "contain",
        "resource": session_id,
        "destination": "local",
    }

    fake_decision = {
        "risk_score": 100,
        "verdict": "BLOCK",
    }

    containment = (
        contain_session(
            session_id,
            fake_action,
            fake_decision,
        )
    )

    return {
        "session_id": session_id,
        "contained": True,
        "containment": containment,
    }


@app.get("/api/attacks")
async def attack_catalog():
    scenarios = (
        get_attack_scenarios()
    )

    return {
        "count": len(
            scenarios
        ),
        "scenarios": scenarios,
    }


@app.post(
    "/api/attacks/{scenario_id}/run"
)
async def run_attack_scenario(
    scenario_id: str,
):
    scenario = (
        get_attack_scenario(
            scenario_id
        )
    )

    if scenario is None:
        raise HTTPException(
            status_code=404,
            detail=(
                "Attack scenario "
                "not found"
            ),
        )

    session_id = (
        f"attack-{scenario_id}-"
        f"{uuid4().hex[:8]}"
    )

    reset_session(
        session_id
    )

    events = []

    for scenario_action in scenario[
        "actions"
    ]:
        action = {
            "agent_id": (
                "attack-lab-agent"
            ),
            "session_id": session_id,
            **scenario_action,
        }

        history = get_history(
            session_id
        )

        if is_contained(
            session_id
        ):
            decision = (
                containment_decision()
            )
        else:
            decision = (
                evaluate_action(
                    action,
                    history=history,
                )
            )

        record_action(
            session_id,
            action,
            decision,
        )

        chain.append_event(
            "ACTION_EVALUATED",
            session_id,
            verdict=decision["verdict"],
            risk_score=decision[
                "risk_score"
            ],
            source="attack_lab",
            scenario_id=scenario_id,
        )

        if (
            decision["verdict"]
            == "BLOCK"
            and not is_contained(
                session_id
            )
        ):
            contain_session(
                session_id,
                action,
                decision,
            )

        events.append(
            {
                "action": {
                    "tool": action[
                        "tool"
                    ],
                    "operation": action[
                        "operation"
                    ],
                    "resource": action[
                        "resource"
                    ],
                    "destination": action[
                        "destination"
                    ],
                },
                **decision,
            }
        )

    final_event = events[-1]

    return {
        "scenario_id": scenario[
            "id"
        ],
        "name": scenario[
            "name"
        ],
        "category": scenario[
            "category"
        ],
        "severity": scenario[
            "severity"
        ],
        "description": scenario[
            "description"
        ],
        "expected_verdict": scenario[
            "expected_verdict"
        ],
        "session_id": session_id,
        "contained": (
            is_contained(
                session_id
            )
        ),
        "containment": (
            get_containment(
                session_id
            )
        ),
        "final_risk_score": (
            final_event[
                "risk_score"
            ]
        ),
        "final_verdict": (
            final_event[
                "verdict"
            ]
        ),
        "events": events,
    }


# ---------------- Human review ----------------


@app.get("/api/reviews")
async def list_reviews(
    session_id: str | None = None,
    status: str | None = None,
):
    return {
        "reviews": review_store.list_reviews(
            session_id,
            status,
        )
    }


def _resolve(review_id: str, approve: bool):
    state, review = resolve_review(
        review_id,
        approve,
    )

    if state == "not_found":
        raise HTTPException(
            status_code=404,
            detail="Review not found",
        )

    if state == "already_resolved":
        raise HTTPException(
            status_code=409,
            detail="Review already resolved",
        )

    live_presence.touch_session(
        review["session_id"],
        status="APPROVED" if approve else "DENIED",
    )
    return review


@app.post("/api/reviews/{review_id}/approve")
async def approve_review(review_id: str):
    return _resolve(review_id, True)


@app.post("/api/reviews/{review_id}/deny")
async def deny_review(review_id: str):
    return _resolve(review_id, False)


# ---------------- Policies ----------------


class PolicyUpdate(BaseModel):
    thresholds: dict[str, int] | None = None
    allowed_tools: List[str] | None = None
    default_agent_permissions: List[str] | None = None
    sensitive_markers: List[str] | None = None
    trusted_destinations: List[str] | None = None
    destructive_operations: List[str] | None = None
    high_risk_permissions: List[str] | None = None


@app.get("/api/policies")
async def get_policies():
    return policy_cfg.get_policy()


@app.put("/api/policies")
async def put_policies(update: PolicyUpdate):
    try:
        return policy_cfg.update_policy(
            update.model_dump(
                exclude_none=True
            )
        )
    except ValueError as e:
        raise HTTPException(
            status_code=422,
            detail=str(e),
        )


@app.post("/api/policies/reset")
async def reset_policies():
    return policy_cfg.reset_policy()


# ---------------- Live agent ----------------


class AIConnectRequest(BaseModel):
    session_id: str = "agent-session"
    api_key: str = Field(min_length=1, max_length=500)


@app.post("/api/agent/connect")
async def agent_connect(request: AIConnectRequest):
    # Demo connection only. The supplied value is intentionally never stored,
    # logged, or used as a real cloud credential.
    if not request.api_key.strip():
        raise HTTPException(
            status_code=422,
            detail="Enter any non-empty demo API key",
        )

    event = chain.append_event(
        "AI_CONNECTED",
        request.session_id,
        provider="mock",
        mode="FREE_DEMO",
    )
    session = live_presence.connect_session(
        request.session_id,
        provider="RAKSHA Demo Model",
        start_seq=event["seq"],
    )

    return {
        "connected": True,
        "provider": "RAKSHA Demo Model",
        "provider_id": "mock",
        "mode": "FREE_DEMO",
        "message": "Connected to the free offline demo model.",
        "session": session,
    }


@app.post("/api/agent/disconnect")
async def agent_disconnect():
    """Disconnect the current demo model and clear all live user sessions.

    Historical audit proof is intentionally preserved.
    """
    sessions = live_presence.disconnect_all()
    for item in sessions:
        sid = item["session_id"]
        reset_session(sid)
        removed = remove_session_reviews(sid)
        chain.append_event("SESSION_RESET", sid, reviews_removed=removed, source="disconnect")
        chain.append_event("AI_DISCONNECTED", sid, provider=item.get("provider", "demo"))

    return {
        "connected": False,
        "disconnected_sessions": len(sessions),
        "message": "AI model disconnected. Live sessions were cleared; protected history was preserved.",
    }


def _activity_item(event: dict[str, Any]) -> dict[str, Any] | None:
    event_type = event.get("type", "")
    session_id = event.get("session_id", "")
    data = event.get("data", {}) if isinstance(event.get("data"), dict) else {}

    if not session_id:
        return None

    item = {
        "event_id": event.get("event_id", ""),
        "session_id": session_id,
        "timestamp": event.get("timestamp", ""),
        "kind": event_type,
        "message": "Session activity updated",
        "verdict": data.get("verdict"),
        "risk_score": data.get("risk_score"),
        "tool": None,
        "resource": None,
        "status": None,
    }

    if event_type == "AI_CONNECTED":
        item["message"] = "AI model connected"
        item["status"] = "CONNECTED"
    elif event_type == "AI_DISCONNECTED":
        item["message"] = "AI model disconnected"
        item["status"] = "DISCONNECTED"
    elif event_type == "AGENT_PROPOSAL":
        count = data.get("proposal_count", 0)
        item["message"] = f"AI proposed {count} action(s)"
        item["status"] = "PROPOSED"
    elif event_type == "ACTION_EVALUATED":
        action = data.get("action", {}) if isinstance(data.get("action"), dict) else {}
        item["tool"] = action.get("tool")
        item["resource"] = action.get("resource")
        item["message"] = f"{action.get('tool', 'Action')} · {action.get('resource', '')}".strip(" ·")
        item["status"] = data.get("verdict")
    elif event_type == "REVIEW_CREATED":
        item["message"] = "Waiting for human approval"
        item["status"] = "REVIEW"
        item["risk_score"] = data.get("risk_score")
        item["verdict"] = "REVIEW"
    elif event_type == "REVIEW_APPROVED":
        item["message"] = "Human allowed one action"
        item["status"] = "APPROVED"
    elif event_type == "REVIEW_DENIED":
        item["message"] = "Human denied the action"
        item["status"] = "DENIED"
    elif event_type == "ACTION_BLOCKED":
        action = data.get("action", {}) if isinstance(data.get("action"), dict) else {}
        item["tool"] = action.get("tool")
        item["resource"] = action.get("resource")
        item["message"] = "Dangerous action blocked"
        item["status"] = "BLOCK"
        item["verdict"] = "BLOCK"
    elif event_type == "SESSION_CONTAINED":
        item["message"] = "Session contained after a blocked action"
        item["status"] = "CONTAINED"
        item["verdict"] = "BLOCK"
    elif event_type == "SANDBOX_EXECUTION":
        item["tool"] = data.get("tool")
        item["message"] = f"{data.get('tool', 'Tool')} executed in the safe sandbox"
        item["status"] = "EXECUTED" if data.get("ok") else "FAILED"
    elif event_type == "SESSION_RESET":
        item["message"] = "Session reset"
        item["status"] = "RESET"
    else:
        return None

    return item


@app.get("/api/activity")
async def live_activity(limit: int = 40):
    limit = max(1, min(limit, 200))
    sessions = live_presence.list_sessions()
    if not sessions:
        return {
            "active_sessions": 0,
            "event_count": 0,
            "sessions": [],
            "events": [],
        }

    starts = {item["session_id"]: int(item["start_seq"]) for item in sessions}
    items = []
    for event in chain.load_events():
        sid = event.get("session_id", "")
        start_seq = starts.get(sid)
        if start_seq is None or int(event.get("seq", 0)) < start_seq:
            continue
        item = _activity_item(event)
        if item is not None:
            items.append(item)

    recent = items[-limit:]
    return {
        "active_sessions": len(sessions),
        "event_count": len(recent),
        "sessions": sessions,
        "events": recent,
    }


class AgentMessage(BaseModel):
    session_id: str = "agent-session"
    message: str = Field(min_length=1, max_length=2000)


def _friendly_demo_reply(message: str, plan_summary: str, results: list[dict[str, Any]]) -> str:
    blocked = [r for r in results if r["decision"]["verdict"] == "BLOCK"]
    review = [r for r in results if r["decision"]["verdict"] == "REVIEW"]
    if blocked:
        return (
            "I couldn't complete that request because RAKSHA blocked a dangerous action "
            "before it could run. The affected user session has been contained."
        )
    if review:
        return (
            "I paused part of that request because RAKSHA needs human approval before the "
            "sensitive action can run."
        )

    for result in results:
        proposal = result.get("proposal", {})
        decision = result.get("decision", {})
        tool_result = decision.get("tool_result")
        if proposal.get("tool") == "read_file" and tool_result and tool_result.get("ok"):
            resource = str(proposal.get("resource", ""))
            output = tool_result.get("output") or {}
            if resource == "vendor_invoice.pdf":
                return (
                    "The demo invoice is from Acme Supplies for $1,250.00, with payment due "
                    "in 30 days. RAKSHA allowed the read because it matched the user's request."
                )
            if resource == "meeting_notes.txt":
                return (
                    "The meeting notes cover Q3 planning and say the demo should ship on Friday. "
                    "RAKSHA allowed the read safely."
                )
            if isinstance(output, dict) and output.get("content") and "secret" not in resource.lower():
                return f"I read {resource} safely. {plan_summary or 'The requested information is ready.'}"

    lower = message.lower().strip()
    if not results:
        if any(word in lower for word in ("hello", "hi", "hey")):
            return (
                "Hello. I'm the RAKSHA Demo Model. I can chat normally and use the protected "
                "demo tools when needed; RAKSHA checks every proposed action before it runs."
            )
        if "what can you do" in lower or "help" in lower:
            return (
                "I can answer normal demo questions, summarize the sandbox invoice or meeting "
                "notes, and demonstrate how RAKSHA reviews or blocks risky AI actions."
            )
        return (
            "I understood your message. This free demo model keeps ordinary conversation local, "
            "and RAKSHA will step in automatically if a tool action becomes risky."
        )

    return plan_summary or "Request completed safely under RAKSHA protection."


@app.post("/api/agent/message")
async def agent_message(request: AgentMessage):
    ensure_sandbox()

    provider, fallback, plan = (
        plan_with_fallback(request.message)
    )

    sid = request.session_id

    chain.append_event(
        "AGENT_PROPOSAL",
        sid,
        provider=provider,
        proposal_count=len(plan.proposals),
        tools=[p.tool for p in plan.proposals],
    )

    # Permissions are granted server-side, never by the model.
    permissions = policy_cfg.get_policy()[
        "default_agent_permissions"
    ]

    results = []

    for proposal in plan.proposals:
        action = {
            "agent_id": f"live-agent-{provider}",
            "session_id": sid,
            "tool": proposal.tool,
            "operation": proposal.operation,
            "resource": proposal.resource,
            "destination": proposal.destination,
            "user_intent": request.message,
            "permissions": list(permissions),
            "metadata": proposal.metadata,
        }

        results.append(
            {
                "proposal": proposal.model_dump(),
                "decision": process_action(
                    action,
                    execute=True,
                ),
            }
        )

    if results:
        final_decision = results[-1]["decision"]
        live_presence.touch_session(
            sid,
            status=("CONTAINED" if final_decision.get("contained") else final_decision.get("verdict", "ACTIVE")),
            verdict=final_decision.get("verdict"),
            risk_score=final_decision.get("risk_score"),
        )
    else:
        live_presence.touch_session(sid, status="ACTIVE")

    assistant_message = _friendly_demo_reply(request.message, plan.summary, results)

    return {
        "session_id": sid,
        "provider": provider,
        "fallback_reason": fallback,
        "assistant_message": assistant_message,
        "proposed_actions": [
            p.model_dump()
            for p in plan.proposals
        ],
        "results": results,
        "contained": is_contained(sid),
    }


# ---------------- Audit / forensics ----------------


@app.get("/api/audit/events")
async def audit_events(limit: int = 200):
    events = chain.load_events()

    return {
        "event_count": len(events),
        "events": events[-limit:],
    }


@app.get("/api/audit/verify")
async def audit_verify():
    result = chain.verify()
    anchors = anchor.list_anchors()
    result["last_anchor"] = (
        anchors[-1] if anchors else None
    )
    return result


@app.post("/api/audit/tamper-demo")
async def audit_tamper_demo():
    return chain.tamper_demo()


@app.post("/api/audit/reset")
async def audit_reset():
    chain.reset()
    return chain.verify()


@app.post("/api/audit/anchor")
async def audit_anchor():
    return anchor.anchor_now()
