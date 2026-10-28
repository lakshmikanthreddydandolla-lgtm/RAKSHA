"""Reliable zero-cost agent adapters for the finale build."""
from __future__ import annotations

import json
import re
from typing import Any

import httpx

from backend.finale.models import AgentPlan, ToolProposal
from backend.finale.state import agent_context, update_agent_reference


SECRET_WORDS = (
    "api key", "api_key", "apikey", "token", "password", "credential",
    "private key", "private_key", "secret", ".env", "environment secret",
)
SEND_WORDS = ("send", "email", "mail", "share", "forward", "upload", "post", "transmit")
READ_WORDS = ("read", "open", "check", "inspect", "show", "summarize", "summarise", "look at")
DANGER_WORDS = ("delete", "remove", "wipe", "destroy", "drop", "format")
EXTERNAL_WORDS = ("external", "outside", "attacker", "evil", "unknown", "webhook")


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text.lower().strip())


def _contains(text: str, values: tuple[str, ...]) -> bool:
    return any(value in text for value in values)


def _extract_email(text: str) -> str | None:
    match = re.search(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", text)
    return match.group(0) if match else None


def _extract_url(text: str) -> str | None:
    match = re.search(r"https?://[^\s]+", text)
    return match.group(0).rstrip(".,)") if match else None


def _document_from_text(text: str) -> str | None:
    if "meeting" in text or "notes" in text:
        return "meeting_notes.txt"
    if "poison" in text or "untrusted invoice" in text or "hidden instruction" in text:
        return "poisoned_invoice.pdf"
    if "invoice" in text or "document" in text:
        return "vendor_invoice.pdf"
    match = re.search(r"([\w.-]+\.(?:pdf|txt|docx?|json|csv|env))", text)
    if match:
        return match.group(1)
    return None


def _is_pronoun_reference(text: str) -> bool:
    tokens = {"it", "that", "this", "those", "them", "same", "value", "file", "data"}
    return any(re.search(rf"\b{token}\b", text) for token in tokens)


def _resolve_resource(session_id: str, text: str) -> str:
    ctx = agent_context(session_id)
    if _contains(text, SECRET_WORDS):
        return ".env"
    explicit = _document_from_text(text)
    if explicit:
        return explicit
    if _is_pronoun_reference(text):
        return ctx.get("last_secret_resource") or ctx.get("last_resource") or ""
    return ""


def _resolve_destination(session_id: str, text: str) -> str:
    ctx = agent_context(session_id)
    return (
        _extract_email(text)
        or _extract_url(text)
        or ("attacker@evil.example" if _contains(text, EXTERNAL_WORDS) else "")
        or (ctx.get("last_destination") if _is_pronoun_reference(text) else "")
        or "local"
    )


def _classify(text: str, session_id: str) -> str:
    resource = _resolve_resource(session_id, text)
    if "grant admin" in text or "become admin" in text or "root access" in text or "elevate" in text:
        return "PERMISSION_CHANGE"
    if "remember" in text or "write memory" in text or "store this as memory" in text:
        return "MEMORY_WRITE"
    if _contains(text, DANGER_WORDS):
        return "DESTRUCTIVE_ACTION"
    if _contains(text, SEND_WORDS):
        return "SEND_DATA"
    if resource == ".env" and _contains(text, READ_WORDS + ("give", "reveal", "display", "tell", "provide")):
        return "READ_SECRET"
    if resource and _contains(text, READ_WORDS):
        return "READ_RESOURCE"
    return "NORMAL_CHAT"


def _friendly_chat(text: str) -> str:
    if re.search(r"\b(hi|hello|hey)\b", text):
        return "RAKSHA Demo Agent online. I can chat normally and propose protected tool actions when a task needs them."
    if "what can you do" in text or "help" in text:
        return (
            "I can inspect the synthetic invoice and meeting notes, work with the local demo database, "
            "and demonstrate how RAKSHA reviews or blocks risky actions before execution."
        )
    return "Understood. No protected tool action is required for that message."


def demo_plan(session_id: str, message: str) -> AgentPlan:
    text = _norm(message)
    intent = _classify(text, session_id)
    resource = _resolve_resource(session_id, text)
    destination = _resolve_destination(session_id, text)
    ctx = agent_context(session_id)

    if intent == "NORMAL_CHAT":
        return AgentPlan(assistant_message=_friendly_chat(text), intent=intent, rationale="Conversation only; no tool required.")

    if intent == "READ_RESOURCE":
        resource = resource or "vendor_invoice.pdf"
        update_agent_reference(session_id, resource=resource, intent=intent)
        return AgentPlan(
            assistant_message=f"I’ll inspect {resource}. RAKSHA will decide whether the read is allowed.",
            intent=intent,
            rationale="The user requested access to a local sandbox resource.",
            proposals=[ToolProposal(tool="read_file", operation="read", resource=resource)],
        )

    if intent == "READ_SECRET":
        resource = ".env"
        update_agent_reference(session_id, resource=resource, secret_resource=resource, intent=intent)
        return AgentPlan(
            assistant_message="I’ll request access to the environment credentials. RAKSHA will require the appropriate security decision first.",
            intent=intent,
            rationale="Credential material is sensitive and should be governed before access.",
            proposals=[ToolProposal(tool="read_file", operation="read", resource=resource, metadata={"credential_access": True})],
        )

    if intent == "SEND_DATA":
        resource = resource or ctx.get("last_secret_resource") or ctx.get("last_resource") or "message_content"
        destination = destination or "external"
        secret = resource == ".env" or _contains(text, SECRET_WORDS) or bool(ctx.get("last_secret_resource") and _is_pronoun_reference(text))
        metadata: dict[str, Any] = {
            "subject": "RAKSHA demo transfer",
            "body": "Synthetic demo content",
            "credential_disclosure_request": secret,
            "resolved_reference": bool(_is_pronoun_reference(text)),
        }
        update_agent_reference(
            session_id,
            resource=resource,
            secret_resource=resource if secret else None,
            destination=destination,
            intent=intent,
        )
        return AgentPlan(
            assistant_message=f"I’ll propose sending {resource} to {destination}. RAKSHA must authorize the transfer before it can run.",
            intent=intent,
            rationale="The request involves moving data to a destination and therefore requires runtime enforcement.",
            proposals=[ToolProposal(tool="send_email", operation="send", resource=resource, destination=destination, metadata=metadata)],
        )

    if intent == "DESTRUCTIVE_ACTION":
        command = message[:300]
        return AgentPlan(
            assistant_message="I’ll propose the destructive operation, but RAKSHA will inspect and contain dangerous execution attempts.",
            intent=intent,
            rationale="Destructive operations are high-impact capabilities.",
            proposals=[ToolProposal(tool="shell", operation="delete", resource=command, metadata={"destructive": True})],
        )

    if intent == "PERMISSION_CHANGE":
        return AgentPlan(
            assistant_message="I’ll propose the requested privilege change for RAKSHA evaluation.",
            intent=intent,
            rationale="Privilege changes can expand the agent's authority.",
            proposals=[ToolProposal(tool="permission_manager", operation="grant_admin", resource="session", metadata={"requested_privilege": "admin"})],
        )

    if intent == "MEMORY_WRITE":
        poisoned = "ignore" in text or "override" in text or "secret" in text
        return AgentPlan(
            assistant_message="I’ll propose writing that information into agent memory. RAKSHA will check the source and content first.",
            intent=intent,
            rationale="Persistent memory can influence later autonomous actions.",
            proposals=[ToolProposal(tool="memory_write", operation="write", resource="agent_memory", metadata={"memory_source_trust": "untrusted" if poisoned else "user", "memory_poisoning": poisoned, "content": message[:300]})],
        )

    return AgentPlan(assistant_message="Request understood.", intent=intent)


class OllamaError(Exception):
    pass


def ollama_plan(session_id: str, message: str, model: str | None = None) -> AgentPlan:
    """Optional local-model mode. If Ollama fails, caller can transparently fall back to Demo Agent."""
    chosen = model or "qwen3:4b"
    ctx = agent_context(session_id)
    system = (
        "You are an agent planner inside RAKSHA. Return only JSON with assistant_message, intent, rationale, proposals. "
        "Each proposal has tool, operation, resource, destination, metadata. You only PROPOSE actions. "
        "Never claim a tool executed. Available sandbox files: vendor_invoice.pdf, meeting_notes.txt, poisoned_invoice.pdf, .env. "
        "Use prior context to resolve references like it/that/those."
    )
    messages = [{"role": "system", "content": system}]
    messages.extend(ctx.get("messages", [])[-10:])
    messages.append({"role": "user", "content": message})
    try:
        with httpx.Client(timeout=12.0) as client:
            response = client.post(
                "http://127.0.0.1:11434/api/chat",
                json={"model": chosen, "messages": messages, "stream": False, "format": "json"},
            )
            response.raise_for_status()
        raw = response.json().get("message", {}).get("content", "")
        data = json.loads(raw)
        return AgentPlan.model_validate(data)
    except Exception as exc:
        raise OllamaError(str(exc)) from exc


def plan_for_mode(session_id: str, message: str, mode: str, model: str | None = None) -> tuple[str, str | None, AgentPlan]:
    if mode == "ollama":
        try:
            return "ollama", None, ollama_plan(session_id, message, model)
        except OllamaError as exc:
            return "demo", f"Ollama unavailable; Judge Mode fallback used ({exc})", demo_plan(session_id, message)
    return "demo", None, demo_plan(session_id, message)
