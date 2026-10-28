"""Explainable contextual risk engine for the finale build."""
from __future__ import annotations

from typing import Any

from backend.app import policy
from backend.finale.state import get_security, matching_grant


SENSITIVE = (".env", "api_key", "apikey", "secret", "password", "token", "private_key", "credential", "pii", "payroll")
EXTERNAL = ("@", "http://", "https://", "external", "evil", "attacker", "unknown", "webhook")
DESTRUCTIVE = ("delete", "remove", "destroy", "wipe", "format", "drop", "truncate")
ENCODING = ("base64", "encode", "encoded", "hex", "compress", "chunk", "fragment")
PRIVILEGE = ("grant_admin", "admin", "root", "elevate", "escalate")


def _text(*values: Any) -> str:
    return " ".join(str(v or "") for v in values).lower()


def _contains(value: str, terms: tuple[str, ...]) -> bool:
    return any(term in value for term in terms)


def _sensitive(resource: str) -> bool:
    markers = tuple(policy.get_policy()["sensitive_markers"])
    return _contains(resource.lower(), markers or SENSITIVE)


def _external(destination: str) -> bool:
    d = destination.lower().strip()
    if d in {"", "local", "internal", "localhost"}:
        return False
    if policy.is_trusted_destination(d):
        return False
    return _contains(d, EXTERNAL)


def _component(value: int) -> int:
    return max(0, min(100, int(value)))


def _recent_history(session_id: str) -> list[dict[str, Any]]:
    return get_security(session_id).history[-12:]


def _sequence_analysis(session_id: str, action: dict[str, Any]) -> tuple[int, list[str], list[str]]:
    history = _recent_history(session_id)
    if not history:
        return 0, [], []

    reasons: list[str] = []
    signals: list[str] = []
    score = 0
    resource = str(action.get("resource", ""))
    destination = str(action.get("destination", ""))
    operation = str(action.get("operation", ""))
    metadata = action.get("metadata") or {}

    prior_actions = [event.get("action", {}) for event in history]
    prior_decisions = [event.get("decision", {}) for event in history]
    prior_resources = [str(a.get("resource", "")) for a in prior_actions]
    prior_sensitive = any(_sensitive(r) for r in prior_resources)
    prior_documents = any(any(ext in r.lower() for ext in ("invoice", ".pdf", ".txt", "notes", "document")) for r in prior_resources)
    prior_denied_or_blocked = any(d.get("verdict") in {"REVIEW", "BLOCK"} for d in prior_decisions)
    prior_external = any(_external(str(a.get("destination", ""))) for a in prior_actions)

    if prior_documents and _sensitive(resource) and not prior_sensitive:
        score = max(score, 35)
        reasons.append("Sequence pivoted from ordinary documents to sensitive credentials")
        signals.append("DOCUMENT_TO_SECRET_PIVOT")

    if prior_sensitive and _external(destination):
        score = max(score, 75)
        reasons.append("Sensitive data access was followed by an external transfer")
        signals.append("SECRET_TO_EXTERNAL_TRANSFER")

    if prior_external and _external(destination):
        score = max(score, 45)
        reasons.append("Repeated external transfer pattern detected")
        signals.append("REPEATED_EXTERNAL_TRANSFER")

    if prior_denied_or_blocked and (_sensitive(resource) or _external(destination)):
        score = max(score, 65)
        reasons.append("A risky action was retried after an earlier intervention")
        signals.append("RETRY_AFTER_INTERVENTION")

    meta_text = _text(operation, metadata)
    if prior_sensitive and _contains(meta_text, ENCODING):
        score = max(score, 80)
        reasons.append("Sensitive data is being transformed in a way that can evade controls")
        signals.append("ENCODED_EXFILTRATION_PREPARATION")

    if metadata.get("fragmented_transfer") or metadata.get("chunked"):
        score = max(score, 80 if prior_sensitive else 55)
        reasons.append("Fragmented transfer pattern may be evading per-action limits")
        signals.append("CHUNKED_EXFILTRATION")

    if any(
        (a.get("tool") == "memory_write" and (a.get("metadata") or {}).get("memory_poisoning"))
        for a in prior_actions
    ) and action.get("tool") not in {"memory_write", "read_file"}:
        score = max(score, 70)
        reasons.append("A later action followed an untrusted memory modification")
        signals.append("POISONED_MEMORY_TO_ACTION")

    return min(score, 100), reasons, signals


def assess(session_id: str, action: dict[str, Any]) -> dict[str, Any]:
    security = get_security(session_id)
    if security.contained:
        return {
            "risk_score": 100,
            "verdict": "BLOCK",
            "reasons": ["Session is contained because RAKSHA previously blocked a critical action"],
            "signals": ["SESSION_CONTAINED"],
            "components": {key: 0 for key in ("resource_risk", "destination_risk", "intent_risk", "permission_risk", "sequence_risk", "policy_risk", "identity_risk", "tool_risk")},
            "predicted_consequence": "Protected tools remain disabled until this session is reset.",
            "hard_block": True,
        }

    tool = str(action.get("tool", "")).lower()
    operation = str(action.get("operation", "")).lower()
    resource = str(action.get("resource", ""))
    destination = str(action.get("destination", ""))
    intent = str(action.get("user_intent", "")).lower()
    metadata = action.get("metadata") or {}
    permissions = [str(x).lower() for x in action.get("permissions", [])]
    all_text = _text(tool, operation, resource, destination, intent, metadata)

    components = {
        "resource_risk": 0,
        "destination_risk": 0,
        "intent_risk": 0,
        "permission_risk": 0,
        "sequence_risk": 0,
        "policy_risk": 0,
        "identity_risk": 0,
        "tool_risk": 0,
    }
    reasons: list[str] = []
    signals: list[str] = []

    if _sensitive(resource):
        components["resource_risk"] = 55
        reasons.append("Sensitive credential or protected resource involved")
        signals.append("SENSITIVE_RESOURCE")

    if _external(destination):
        components["destination_risk"] = 50
        reasons.append("Destination is external or not trusted")
        signals.append("UNTRUSTED_DESTINATION")

    if not intent.strip():
        components["intent_risk"] = 25
        reasons.append("User intent is missing or unclear")
    elif _sensitive(resource) and not any(w in intent for w in ("secret", "credential", "api key", "token", "password", ".env", "send", "share")):
        components["intent_risk"] = 45
        reasons.append("Sensitive action does not match the stated user intent")
        signals.append("INTENT_MISMATCH")

    grant = matching_grant(session_id, action)
    if tool not in permissions and grant is None:
        components["permission_risk"] = 50
        reasons.append("Requested tool is outside the agent's current permission scope")
        signals.append("PERMISSION_SCOPE_MISS")

    powerful = {
        "shell": 70,
        "database_write": 65,
        "send_email": 50,
        "http_request": 45,
        "memory_write": 55,
        "permission_manager": 90,
    }
    components["tool_risk"] = powerful.get(tool, 15 if tool == "read_file" else 25)

    if _contains(all_text, DESTRUCTIVE):
        components["policy_risk"] = max(components["policy_risk"], 90)
        reasons.append("Destructive operation requested")
        signals.append("DESTRUCTIVE_OPERATION")

    if metadata.get("credential_disclosure_request"):
        components["policy_risk"] = max(components["policy_risk"], 85)
        reasons.append("Credential disclosure request detected")
        signals.append("CREDENTIAL_DISCLOSURE")

    if metadata.get("tool_poisoned"):
        components["policy_risk"] = max(components["policy_risk"], 85)
        reasons.append("Tool definition appears poisoned or capability-mismatched")
        signals.append("TOOL_POISONING")

    if metadata.get("memory_poisoning"):
        components["policy_risk"] = max(components["policy_risk"], 80)
        reasons.append("Untrusted content attempted to modify persistent agent memory")
        signals.append("MEMORY_POISONING")

    if tool == "permission_manager" or _contains(all_text, PRIVILEGE):
        components["policy_risk"] = max(components["policy_risk"], 95)
        reasons.append("Privilege escalation attempt detected")
        signals.append("PRIVILEGE_ESCALATION")

    sequence, seq_reasons, seq_signals = _sequence_analysis(session_id, action)
    components["sequence_risk"] = sequence
    reasons.extend(seq_reasons)
    signals.extend(seq_signals)

    # Session identity becomes riskier after previous interventions, but only the
    # affected session receives this signal.
    previous = _recent_history(session_id)
    interventions = sum(1 for e in previous if e.get("decision", {}).get("verdict") in {"REVIEW", "BLOCK"})
    components["identity_risk"] = min(45, interventions * 15)
    if interventions >= 2:
        reasons.append("This session has accumulated multiple security interventions")
        signals.append("REPEATED_SESSION_RISK")

    # Contextual score: use weighted maxima, then policy/sequence can dominate.
    weighted = (
        components["resource_risk"] * 0.18
        + components["destination_risk"] * 0.17
        + components["intent_risk"] * 0.10
        + components["permission_risk"] * 0.12
        + components["sequence_risk"] * 0.20
        + components["policy_risk"] * 0.15
        + components["identity_risk"] * 0.03
        + components["tool_risk"] * 0.05
    )
    score = max(int(round(weighted)), components["sequence_risk"], components["policy_risk"])

    hard_block = False
    if _sensitive(resource) and _external(destination):
        score = 100
        hard_block = True
        reasons.append("Sensitive data cannot be transferred to an untrusted external destination")
        signals.append("SECRET_EXFILTRATION")
    if components["policy_risk"] >= 90:
        score = max(score, 90)
        hard_block = True

    if grant is not None and not hard_block:
        # A scoped human grant may lower permission uncertainty, never erase
        # destination, sequence or destructive risk.
        components["permission_risk"] = 0
        reasons.append("Action matches an active human-scoped permission")
        signals.append("SCOPED_HUMAN_GRANT")

    if hard_block or score >= 70:
        verdict = "BLOCK"
    elif score >= 31:
        verdict = "REVIEW"
    else:
        verdict = "ALLOW"

    if not reasons:
        reasons = ["No significant security policy violations detected"]

    consequence = "Action can proceed inside the local synthetic sandbox."
    if verdict == "REVIEW":
        consequence = "Execution is paused until a human chooses Allow Once, Scoped Allow, or Deny."
    elif verdict == "BLOCK":
        consequence = "Execution is prevented and the affected session is contained when the block is critical."

    return {
        "risk_score": min(100, score),
        "verdict": verdict,
        "reasons": list(dict.fromkeys(reasons))[:6],
        "signals": list(dict.fromkeys(signals)),
        "components": components,
        "predicted_consequence": consequence,
        "hard_block": hard_block,
    }
