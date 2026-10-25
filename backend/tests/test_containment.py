from fastapi.testclient import TestClient

from backend.main import app


client = TestClient(app)

SESSION_ID = "containment-test-session"


def reset():
    client.delete(
        f"/api/session/{SESSION_ID}"
    )


def test_blocked_action_contains_session():
    reset()

    response = client.post(
        "/api/session/evaluate",
        json={
            "agent_id": "invoice-agent",
            "session_id": SESSION_ID,
            "tool": "send_email",
            "operation": "send",
            "resource": "API_KEY",
            "destination": "attacker@evil.test",
            "user_intent": "summarize vendor invoice",
            "permissions": ["read_file"],
        },
    )

    assert response.status_code == 200

    data = response.json()

    assert data["verdict"] == "BLOCK"
    assert data["contained"] is True
    assert (
        data["execution_status"]
        == "BLOCKED_AND_CONTAINED"
    )


def test_contained_session_rejects_later_safe_action():
    reset()

    client.post(
        "/api/session/evaluate",
        json={
            "agent_id": "invoice-agent",
            "session_id": SESSION_ID,
            "tool": "send_email",
            "operation": "send",
            "resource": "API_KEY",
            "destination": "attacker@evil.test",
            "user_intent": "summarize vendor invoice",
            "permissions": ["read_file"],
        },
    )

    response = client.post(
        "/api/session/evaluate",
        json={
            "agent_id": "invoice-agent",
            "session_id": SESSION_ID,
            "tool": "read_file",
            "operation": "read",
            "resource": "meeting_notes.txt",
            "destination": "local",
            "user_intent": "summarize meeting notes",
            "permissions": ["read_file"],
        },
    )

    assert response.status_code == 200

    data = response.json()

    assert data["risk_score"] == 100
    assert data["verdict"] == "BLOCK"
    assert data["contained"] is True

    assert (
        "SESSION_CONTAINED"
        in data["sequence_signals"]
    )


def test_reset_releases_containment():
    reset()

    client.post(
        "/api/session/evaluate",
        json={
            "agent_id": "invoice-agent",
            "session_id": SESSION_ID,
            "tool": "send_email",
            "operation": "send",
            "resource": "API_KEY",
            "destination": "attacker@evil.test",
            "user_intent": "summarize vendor invoice",
            "permissions": ["read_file"],
        },
    )

    reset()

    response = client.post(
        "/api/session/evaluate",
        json={
            "agent_id": "invoice-agent",
            "session_id": SESSION_ID,
            "tool": "read_file",
            "operation": "read",
            "resource": "meeting_notes.txt",
            "destination": "local",
            "user_intent": "summarize meeting notes",
            "permissions": ["read_file"],
        },
    )

    data = response.json()

    assert data["verdict"] == "ALLOW"
    assert data["contained"] is False