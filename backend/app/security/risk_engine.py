from typing import Any

from backend.app import policy as policy_cfg
from backend.app.security.sequence_analyzer import (
    analyze_sequence,
)


SENSITIVE_TERMS = (
    ".env",
    "api_key",
    "apikey",
    "secret",
    "password",
    "token",
    "private_key",
    "credential",
    "pii",
    "payroll",
)

EXTERNAL_TERMS = (
    "@",
    "http://",
    "https://",
    "external",
    "evil",
    "unknown",
)

INJECTION_TERMS = (
    "ignore previous",
    "ignore all previous",
    "override system",
    "override policy",
    "system prompt",
    "reveal secret",
    "send the secret",
    "exfiltrate",
)

DESTRUCTIVE_OPERATIONS = (
    "delete",
    "remove",
    "destroy",
    "wipe",
    "format",
    "drop_table",
    "drop",
)

DANGEROUS_SHELL_TERMS = (
    "rm -rf",
    "del /f",
    "format ",
    "shutdown",
    "powershell -enc",
    "curl ",
    "wget ",
)

COMMUNICATION_TOOLS = (
    "send_email",
    "http_post",
    "upload",
    "webhook",
)


def _contains_any(
    value: str,
    terms: tuple[str, ...],
) -> bool:
    normalized = value.lower()

    return any(
        term in normalized
        for term in terms
    )


def _is_sensitive_resource(
    resource: str,
) -> bool:
    return _contains_any(
        resource,
        tuple(
            policy_cfg.get_policy()[
                "sensitive_markers"
            ]
        ),
    )


def _is_external_destination(
    destination: str,
) -> bool:
    normalized = (
        destination
        .lower()
        .strip()
    )

    if normalized in {
        "",
        "local",
        "localhost",
        "internal",
    }:
        return False

    if policy_cfg.is_trusted_destination(
        normalized
    ):
        return False

    return _contains_any(
        normalized,
        EXTERNAL_TERMS,
    )


def _intent_mismatch(
    action: dict[str, Any],
) -> bool:
    intent = str(
        action.get(
            "user_intent",
            "",
        )
    ).lower()

    tool = str(
        action.get(
            "tool",
            "",
        )
    ).lower()

    operation = str(
        action.get(
            "operation",
            "",
        )
    ).lower()

    resource = str(
        action.get(
            "resource",
            "",
        )
    ).lower()

    if not intent:
        return True

    if _is_sensitive_resource(
        resource
    ):
        expected_secret_words = (
            "secret",
            "credential",
            "api key",
            "token",
            "password",
            ".env",
            "pii",
            "payroll",
        )

        if not any(
            word in intent
            for word
            in expected_secret_words
        ):
            return True

    communication_actions = (
        "send",
        "email",
        "share",
        "upload",
        "post",
        "transmit",
    )

    is_communication = (
        tool
        in COMMUNICATION_TOOLS
        or any(
            word in tool
            for word
            in communication_actions
        )
        or operation
        in communication_actions
    )

    if is_communication:
        expected_communication_words = (
            "send",
            "email",
            "share",
            "upload",
            "transmit",
            "backup",
        )

        if not any(
            word in intent
            for word
            in expected_communication_words
        ):
            return True

    return False


def _permission_violation(
    action: dict[str, Any],
) -> bool:
    tool = str(
        action.get(
            "tool",
            "",
        )
    ).lower()

    permissions = [
        str(
            permission
        ).lower()
        for permission
        in action.get(
            "permissions",
            [],
        )
    ]

    return (
        tool
        not in permissions
    )


def _metadata_text(
    action: dict[str, Any],
) -> str:
    metadata = action.get(
        "metadata",
        {},
    )

    if not isinstance(
        metadata,
        dict,
    ):
        return str(metadata)

    return " ".join(
        str(value)
        for value
        in metadata.values()
    )


def _policy_analysis(
    action: dict[str, Any],
) -> dict[str, Any]:

    tool = str(
        action.get(
            "tool",
            "",
        )
    ).lower()

    operation = str(
        action.get(
            "operation",
            "",
        )
    ).lower()

    resource = str(
        action.get(
            "resource",
            "",
        )
    ).lower()

    metadata = action.get(
        "metadata",
        {},
    )

    if not isinstance(
        metadata,
        dict,
    ):
        metadata = {}

    combined_text = " ".join(
        [
            tool,
            operation,
            resource,
            _metadata_text(
                action
            ),
        ]
    ).lower()

    score = 0

    reasons: list[str] = []
    signals: list[str] = []

    def add_rule(
        points: int,
        reason: str,
        signal: str,
    ) -> None:
        nonlocal score

        score += points

        if reason not in reasons:
            reasons.append(
                reason
            )

        if signal not in signals:
            signals.append(
                signal
            )

    if _contains_any(
        combined_text,
        INJECTION_TERMS,
    ):
        add_rule(
            60,
            "Prompt injection pattern detected",
            "PROMPT_INJECTION",
        )

    if metadata.get(
        "credential_disclosure_request"
    ):
        add_rule(
            60,
            "Credential disclosure request detected",
            "CREDENTIAL_DISCLOSURE",
        )

    if metadata.get(
        "credential_access"
    ):
        add_rule(
            40,
            "Credential harvesting behavior detected",
            "CREDENTIAL_ACCESS",
        )

    if (
        tool == "delete_file"
        or operation
        in policy_cfg.get_policy()[
            "destructive_operations"
        ]
    ):
        add_rule(
            60,
            "Destructive operation requested",
            "DESTRUCTIVE_OPERATION",
        )

    if (
        tool == "shell"
        and _contains_any(
            combined_text,
            DANGEROUS_SHELL_TERMS,
        )
    ):
        add_rule(
            60,
            "Dangerous shell command detected",
            "DANGEROUS_SHELL",
        )

    if (
        tool
        == "database_write"
        and operation
        in {
            "drop",
            "drop_table",
            "delete",
            "truncate",
            "update_all",
        }
    ):
        add_rule(
            60,
            "Unauthorized database modification detected",
            "DATABASE_DESTRUCTIVE_WRITE",
        )

    if metadata.get(
        "external_policy_violation"
    ):
        add_rule(
            40,
            "External destination violates policy",
            "UNTRUSTED_EXTERNAL_DESTINATION",
        )

    if metadata.get(
        "tool_poisoned"
    ):
        add_rule(
            60,
            "Tool capability mismatch detected",
            "TOOL_POISONING",
        )

    if (
        tool == "memory_write"
        and (
            metadata.get(
                "memory_source_trust"
            )
            == "untrusted"
            or metadata.get(
                "memory_poisoning"
            )
        )
    ):
        add_rule(
            60,
            "Untrusted data attempted to modify trusted memory",
            "MEMORY_POISONING",
        )

    requested_privilege = str(
        metadata.get(
            "requested_privilege",
            "",
        )
    ).lower()

    if (
        tool
        == "permission_manager"
        or operation
        in {
            "grant_admin",
            "elevate",
            "escalate",
        }
        or requested_privilege
        in {
            "admin",
            "administrator",
            "root",
        }
    ):
        add_rule(
            60,
            "Privilege escalation attempt detected",
            "PRIVILEGE_ESCALATION",
        )

    if metadata.get(
        "fragmented_transfer"
    ):
        add_rule(
            15,
            "Fragmented transfer pattern detected",
            "POLICY_EVASION",
        )

    return {
        "policy_risk": min(
            score,
            60,
        ),
        "reasons": reasons,
        "signals": signals,
    }


def _verdict(
    score: int,
) -> str:
    return policy_cfg.verdict_for(
        score
    )


def evaluate_action(
    action: dict[str, Any],
    history: list[
        dict[str, Any]
    ] | None = None,
) -> dict[str, Any]:

    if history is None:
        history = []

    resource = str(
        action.get(
            "resource",
            "",
        )
    )

    destination = str(
        action.get(
            "destination",
            "",
        )
    )

    score = 0

    reasons: list[str] = []

    components = {
        "resource_risk": 0,
        "destination_risk": 0,
        "intent_risk": 0,
        "permission_risk": 0,
        "sequence_risk": 0,
        "policy_risk": 0,
    }

    security_signals: list[str] = []

    if _is_sensitive_resource(
        resource
    ):
        components[
            "resource_risk"
        ] = 25

        score += 25

        reasons.append(
            "Sensitive resource accessed"
        )

    if _is_external_destination(
        destination
    ):
        components[
            "destination_risk"
        ] = 20

        score += 20

        reasons.append(
            "External or untrusted destination"
        )

    if _intent_mismatch(
        action
    ):
        components[
            "intent_risk"
        ] = 20

        score += 20

        reasons.append(
            "Action does not match user intent"
        )

    if _permission_violation(
        action
    ):
        components[
            "permission_risk"
        ] = 15

        score += 15

        reasons.append(
            "Permission violation"
        )

    sequence_result = (
        analyze_sequence(
            history,
            action,
        )
    )

    components[
        "sequence_risk"
    ] = sequence_result[
        "sequence_risk"
    ]

    score += sequence_result[
        "sequence_risk"
    ]

    reasons.extend(
        sequence_result[
            "reasons"
        ]
    )

    security_signals.extend(
        sequence_result[
            "signals"
        ]
    )

    policy_result = (
        _policy_analysis(
            action
        )
    )

    components[
        "policy_risk"
    ] = policy_result[
        "policy_risk"
    ]

    score += policy_result[
        "policy_risk"
    ]

    reasons.extend(
        policy_result[
            "reasons"
        ]
    )

    security_signals.extend(
        policy_result[
            "signals"
        ]
    )

    score = min(
        score,
        100,
    )

    if not reasons:
        reasons.append(
            "No significant policy violations detected"
        )

    return {
        "risk_score": score,
        "verdict": _verdict(
            score
        ),
        "reasons": list(
            dict.fromkeys(
                reasons
            )
        ),
        "components": components,
        "sequence_signals": list(
            dict.fromkeys(
                security_signals
            )
        ),
    }