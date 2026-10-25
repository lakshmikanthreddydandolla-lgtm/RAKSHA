from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


def test_default_policy_thresholds():
    data = client.get("/api/policies").json()
    assert data["thresholds"] == {"allow_max": 30, "review_max": 69}
    assert ".env" in data["sensitive_markers"]
    assert "shell" in data["allowed_tools"]


def test_policy_update_changes_verdict():
    r = client.put("/api/policies", json={"thresholds": {"allow_max": 10, "review_max": 40}})
    assert r.status_code == 200
    d = client.post("/api/evaluate", json={
        "tool": "read_file", "operation": "read", "resource": ".env",
        "user_intent": "show the secret env file", "permissions": ["read_file"]}).json()
    assert d["risk_score"] == 25
    assert d["verdict"] == "REVIEW"


def test_invalid_policy_rejected():
    r = client.put("/api/policies", json={"thresholds": {"allow_max": 80, "review_max": 40}})
    assert r.status_code == 422


def test_trusted_destination_lowers_risk():
    body = {"tool": "send_email", "operation": "send", "resource": "report",
            "destination": "ceo@corp.example", "user_intent": "send report",
            "permissions": ["send_email"]}
    before = client.post("/api/evaluate", json=body).json()["risk_score"]
    client.put("/api/policies", json={"trusted_destinations": ["@corp.example"]})
    after = client.post("/api/evaluate", json=body).json()["risk_score"]
    assert after < before


def test_policy_reset():
    client.put("/api/policies", json={"thresholds": {"allow_max": 5, "review_max": 50}})
    d = client.post("/api/policies/reset").json()
    assert d["thresholds"]["allow_max"] == 30
