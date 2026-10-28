"""Typed contracts for the RAKSHA finale runtime."""
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class Verdict(str, Enum):
    ALLOW = "ALLOW"
    REVIEW = "REVIEW"
    BLOCK = "BLOCK"


class AgentMode(str, Enum):
    DEMO = "demo"
    OLLAMA = "ollama"


class ToolProposal(BaseModel):
    tool: str = Field(min_length=1, max_length=64)
    operation: str = Field(default="read", max_length=64)
    resource: str = Field(default="", max_length=500)
    destination: str = Field(default="local", max_length=240)
    metadata: dict[str, Any] = Field(default_factory=dict)


class AgentPlan(BaseModel):
    assistant_message: str
    intent: str = "NORMAL_CHAT"
    rationale: str = ""
    proposals: list[ToolProposal] = Field(default_factory=list, max_length=8)


class UserCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=48)


class AgentConnectRequest(BaseModel):
    session_id: str = "agent-session"
    mode: AgentMode = AgentMode.DEMO
    model: str | None = None
    display_name: str | None = Field(default=None, max_length=48)
    # Kept only for backwards compatibility with the Round-2 UI. The finale
    # demo never needs, stores, logs or validates a fake API key.
    api_key: str | None = None


class AgentMessageRequest(BaseModel):
    session_id: str = "agent-session"
    message: str = Field(min_length=1, max_length=4000)


class ActionRequest(BaseModel):
    agent_id: str = "demo-agent"
    session_id: str = "demo-session"
    tool: str
    operation: str = "read"
    resource: str = ""
    destination: str = "local"
    user_intent: str = ""
    permissions: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    execute: bool = True


class ReviewDecisionRequest(BaseModel):
    decision: str = Field(pattern="^(ALLOW_ONCE|DENY|SCOPED_ALLOW)$")
    scope: dict[str, Any] | None = None


class ScopeGrant(BaseModel):
    tool: str
    resource: str = "*"
    destination: str = "*"
    session_id: str
    expires: str = "session_end"
