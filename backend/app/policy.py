"""RAKSHA policy configuration (in-memory, secure defaults)."""
import copy
import threading
from typing import Any

DEFAULT_POLICY: dict[str, Any] = {
    "thresholds": {"allow_max": 30, "review_max": 69},
    "allowed_tools": [
        "read_file", "send_email", "database_read",
        "database_write", "http_request", "shell",
    ],
    "default_agent_permissions": ["read_file", "database_read"],
    "sensitive_markers": [
        ".env", "api_key", "apikey", "secret", "password", "token",
        "private_key", "credential", "pii", "payroll",
    ],
    "trusted_destinations": [],
    "trusted_users": [],
    "trusted_tools": [],
    "destructive_operations": [
        "delete", "remove", "destroy", "wipe", "format", "drop_table", "drop",
    ],
    "high_risk_permissions": ["admin", "root", "shell", "database_write"],
}

_LIST_KEYS = [k for k, v in DEFAULT_POLICY.items() if isinstance(v, list)]
_lock = threading.Lock()
_policy: dict[str, Any] = copy.deepcopy(DEFAULT_POLICY)


def get_policy() -> dict[str, Any]:
    with _lock:
        return copy.deepcopy(_policy)


def reset_policy() -> dict[str, Any]:
    global _policy
    with _lock:
        _policy = copy.deepcopy(DEFAULT_POLICY)
    return get_policy()


def update_policy(update: dict[str, Any]) -> dict[str, Any]:
    """Validate and apply a partial update. Raises ValueError when invalid."""
    new = get_policy()
    th = update.get("thresholds")
    if th is not None:
        allow_max = th.get("allow_max", new["thresholds"]["allow_max"])
        review_max = th.get("review_max", new["thresholds"]["review_max"])
        if not (
            isinstance(allow_max, int) and isinstance(review_max, int)
            and 0 <= allow_max < review_max <= 99
        ):
            raise ValueError("thresholds need 0 <= allow_max < review_max <= 99")
        new["thresholds"] = {"allow_max": allow_max, "review_max": review_max}
    for key in _LIST_KEYS:
        value = update.get(key)
        if value is None:
            continue
        if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
            raise ValueError(f"{key} must be a list of strings")
        cleaned = [v.strip().lower() for v in value if v.strip()]
        if key == "sensitive_markers" and not cleaned:
            raise ValueError("sensitive_markers cannot be empty")
        new[key] = list(dict.fromkeys(cleaned))
    global _policy
    with _lock:
        _policy = new
    return get_policy()


def verdict_for(score: int) -> str:
    th = get_policy()["thresholds"]
    if score <= th["allow_max"]:
        return "ALLOW"
    if score <= th["review_max"]:
        return "REVIEW"
    return "BLOCK"


def is_trusted_destination(destination: str) -> bool:
    d = destination.lower().strip()
    for t in get_policy()["trusted_destinations"]:
        if d == t or (t.startswith("@") and d.endswith(t)):
            return True
    return False


def is_trusted_user(display_name: str) -> bool:
    return display_name.lower().strip() in get_policy()["trusted_users"]


def is_trusted_tool(tool: str) -> bool:
    return tool.lower().strip() in get_policy()["trusted_tools"]
