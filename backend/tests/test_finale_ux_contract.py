from fastapi.testclient import TestClient

from backend.main import app


client = TestClient(app)


def test_ollama_connect_requires_real_health_check_and_defaults_to_llama32(monkeypatch):
    calls = {}

    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return {"models": [{"name": "llama3.2:latest"}]}

    class Client:
        def __init__(self, timeout):
            calls["timeout"] = timeout

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def get(self, url):
            calls["url"] = url
            return Response()

    monkeypatch.setattr("backend.finale.agent.httpx.Client", Client)
    response = client.post(
        "/api/agent/connect",
        json={"session_id": "ollama-health", "mode": "ollama"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["connected"] is True
    assert body["model"] == "llama3.2"
    assert calls["timeout"] == 30.0
    assert calls["url"].endswith("/api/tags")


def test_named_user_creation_reset_and_delete_are_distinct():
    created = client.post("/api/users", json={"name": "Judge"})
    assert created.status_code == 200
    body = created.json()
    sid = body["session_id"]
    assert body["display_name"] == "Judge"

    connected = client.post(
        "/api/agent/connect",
        json={"session_id": sid, "mode": "demo", "display_name": "Judge"},
    )
    assert connected.status_code == 200

    reset = client.post(f"/api/session/{sid}/reset")
    assert reset.status_code == 200
    assert reset.json()["display_name"] == "Judge"

    sessions = client.get("/api/sessions").json()["sessions"]
    assert any(row["session_id"] == sid and row["display_name"] == "Judge" for row in sessions)

    deleted = client.delete(f"/api/users/{sid}")
    assert deleted.status_code == 200
    assert deleted.json()["deleted"] is True

    sessions_after = client.get("/api/sessions").json()["sessions"]
    assert all(row["session_id"] != sid for row in sessions_after)


def test_policy_supports_scoped_trusted_users_and_tools():
    response = client.put(
        "/api/policies",
        json={
            "trusted_users": ["Judge"],
            "trusted_tools": ["read_file"],
        },
    )
    assert response.status_code == 200
    policy = response.json()
    assert policy["trusted_users"] == ["judge"]
    assert policy["trusted_tools"] == ["read_file"]

    client.post("/api/policies/reset")
