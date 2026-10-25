from typing import Any

from backend.app import policy as policy_cfg


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

DOCUMENT_TERMS = (
    ".pdf",
    ".txt",
    ".doc",
    ".docx",
    "invoice",
    "document",
    "notes",
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


def _is_sensitive(
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


def _looks_like_document(
    resource: str,
) -> bool:
    return _contains_any(
        resource,
        DOCUMENT_TERMS,
    )


def _is_external(
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

    return (
        "@" in normalized
        or normalized.startswith(
            "http://"
        )
        or normalized.startswith(
            "https://"
        )
        or "external" in normalized
        or "evil" in normalized
        or "unknown" in normalized
    )


def analyze_sequence(
    history: list[dict[str, Any]],
    current_action: dict[str, Any],
) -> dict[str, Any]:

    if not history:
        return {
            "sequence_risk": 0,
            "reasons": [],
            "signals": [],
        }

    score = 0

    reasons: list[str] = []
    signals: list[str] = []

    current_resource = str(
        current_action.get(
            "resource",
            "",
        )
    )

    current_destination = str(
        current_action.get(
            "destination",
            "",
        )
    )

    previous_resources = [
        str(
            event.get(
                "resource",
                "",
            )
        )
        for event in history
    ]

    previous_document_access = any(
        _looks_like_document(
            resource
        )
        for resource
        in previous_resources
    )

    previous_sensitive_access = any(
        _is_sensitive(
            resource
        )
        for resource
        in previous_resources
    )

    previous_external_transfer = any(
        _is_external(
            str(
                event.get(
                    "destination",
                    "",
                )
            )
        )
        for event
        in history
    )

    if (
        previous_document_access
        and _is_sensitive(
            current_resource
        )
        and not previous_sensitive_access
    ):
        score = max(
            score,
            15,
        )

        reasons.append(
            "Suspicious resource pivot detected"
        )

        signals.append(
            "DOCUMENT_TO_SECRET_PIVOT"
        )

    if (
        previous_sensitive_access
        and _is_external(
            current_destination
        )
    ):
        score = max(
            score,
            20,
        )

        reasons.append(
            "Sensitive activity followed by external transfer"
        )

        signals.append(
            "SECRET_TO_EXTERNAL_TRANSFER"
        )

    if (
        previous_external_transfer
        and _is_external(
            current_destination
        )
    ):
        score = max(
            score,
            20,
        )

        reasons.append(
            "Repeated external transfer pattern detected"
        )

        signals.append(
            "FRAGMENTED_EXTERNAL_TRANSFER"
        )

    return {
        "sequence_risk": min(
            score,
            20,
        ),
        "reasons": reasons,
        "signals": signals,
    }