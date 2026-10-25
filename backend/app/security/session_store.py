from typing import Any


_sessions: dict[
    str,
    list[dict[str, Any]],
] = {}

_contained_sessions: dict[
    str,
    dict[str, Any],
] = {}


def get_history(
    session_id: str,
) -> list[dict[str, Any]]:
    return list(
        _sessions.get(
            session_id,
            [],
        )
    )


def record_action(
    session_id: str,
    action: dict[str, Any],
    decision: dict[str, Any],
) -> None:
    event = {
        **action,
        "risk_score": decision[
            "risk_score"
        ],
        "verdict": decision[
            "verdict"
        ],
    }

    _sessions.setdefault(
        session_id,
        [],
    ).append(event)


def contain_session(
    session_id: str,
    action: dict[str, Any],
    decision: dict[str, Any],
) -> dict[str, Any]:

    existing = (
        _contained_sessions.get(
            session_id
        )
    )

    if existing:
        return existing

    containment = {
        "contained": True,
        "reason": (
            "Critical action blocked by RAKSHA"
        ),
        "trigger_tool": action.get(
            "tool",
            "",
        ),
        "trigger_operation": action.get(
            "operation",
            "",
        ),
        "trigger_resource": action.get(
            "resource",
            "",
        ),
        "trigger_destination": action.get(
            "destination",
            "",
        ),
        "trigger_risk_score": decision.get(
            "risk_score",
            100,
        ),
    }

    _contained_sessions[
        session_id
    ] = containment

    return containment


def is_contained(
    session_id: str,
) -> bool:
    return (
        session_id
        in _contained_sessions
    )


def get_containment(
    session_id: str,
) -> dict[str, Any] | None:
    containment = (
        _contained_sessions.get(
            session_id
        )
    )

    if containment is None:
        return None

    return dict(
        containment
    )


def reset_session(
    session_id: str,
) -> None:
    _sessions.pop(
        session_id,
        None,
    )

    _contained_sessions.pop(
        session_id,
        None,
    )


def get_session_count() -> int:
    return len(
        _sessions
    )