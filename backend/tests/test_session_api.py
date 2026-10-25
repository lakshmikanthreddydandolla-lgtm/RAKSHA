from fastapi.testclient import TestClient

from backend.main import app


client = TestClient(app)


def test_session_builds_attack_history():

    session_id = "sequence-demo-test"

    client.delete(
        f"/api/session/{session_id}"
    )

    first = client.post(
        "/api/session/evaluate",
        json={
            "agent_id": "invoice-agent",
            "session_id": session_id,
            "tool": "read_file",
            "operation": "read",
            "resource": "vendor_invoice.pdf",
            "destination": "local",
            "user_intent": "summarize vendor invoice",
            "permissions": [
                "read_file"
            ]
        }
    )

    assert first.status_code == 200

    first_data = first.json()

    assert first_data[
        "verdict"
    ] == "ALLOW"

    assert first_data[
        "history_length"
    ] == 1

    second = client.post(
        "/api/session/evaluate",
        json={
            "agent_id": "invoice-agent",
            "session_id": session_id,
            "tool": "read_file",
            "operation": "read",
            "resource": ".env",
            "destination": "local",
            "user_intent": "summarize vendor invoice",
            "permissions": [
                "read_file"
            ]
        }
    )

    assert second.status_code == 200

    second_data = second.json()

    assert second_data[
        "verdict"
    ] == "REVIEW"

    assert second_data[
        "components"
    ][
        "sequence_risk"
    ] == 15

    third = client.post(
        "/api/session/evaluate",
        json={
            "agent_id": "invoice-agent",
            "session_id": session_id,
            "tool": "send_email",
            "operation": "send",
            "resource": "API_KEY",
            "destination": "attacker@evil.test",
            "user_intent": "summarize vendor invoice",
            "permissions": [
                "read_file"
            ]
        }
    )

    assert third.status_code == 200

    third_data = third.json()

    assert third_data[
        "risk_score"
    ] == 100

    assert third_data[
        "verdict"
    ] == "BLOCK"

    assert third_data[
        "components"
    ][
        "sequence_risk"
    ] == 20

    assert third_data[
        "history_length"
    ] == 3