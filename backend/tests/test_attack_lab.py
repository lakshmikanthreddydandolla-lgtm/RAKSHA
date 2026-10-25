import pytest
from fastapi.testclient import TestClient

from backend.main import app


client = TestClient(app)


EXPECTED_SCENARIOS = {
    "direct-prompt-injection": "BLOCK",
    "indirect-prompt-injection": "BLOCK",
    "credential-theft": "BLOCK",
    "secret-exfiltration": "BLOCK",
    "destructive-file-operation": "BLOCK",
    "dangerous-shell-command": "BLOCK",
    "unauthorized-database-modification": "BLOCK",
    "untrusted-external-destination": "BLOCK",
    "tool-poisoning": "BLOCK",
    "memory-poisoning": "BLOCK",
    "privilege-escalation": "BLOCK",
    "multi-step-policy-evasion": "BLOCK",
}


def test_attack_catalog_contains_exactly_twelve_scenarios():
    response = client.get("/api/attacks")

    assert response.status_code == 200

    data = response.json()

    assert data["count"] == 12
    assert len(data["scenarios"]) == 12

    ids = {
        scenario["id"]
        for scenario in data["scenarios"]
    }

    assert ids == set(EXPECTED_SCENARIOS)


@pytest.mark.parametrize(
    "scenario_id,expected_verdict",
    EXPECTED_SCENARIOS.items(),
)
def test_each_attack_reaches_expected_verdict(
    scenario_id,
    expected_verdict,
):
    response = client.post(
        f"/api/attacks/{scenario_id}/run"
    )

    assert response.status_code == 200

    data = response.json()

    assert data["scenario_id"] == scenario_id
    assert data["expected_verdict"] == expected_verdict
    assert data["final_verdict"] == expected_verdict
    assert data["final_risk_score"] >= 70
    assert len(data["events"]) >= 1


def test_secret_exfiltration_reaches_critical_risk():
    response = client.post(
        "/api/attacks/secret-exfiltration/run"
    )

    assert response.status_code == 200

    data = response.json()

    assert data["final_verdict"] == "BLOCK"
    assert data["final_risk_score"] == 100
    assert len(data["events"]) == 3


def test_multi_step_evasion_escalates_over_time():
    response = client.post(
        "/api/attacks/multi-step-policy-evasion/run"
    )

    assert response.status_code == 200

    data = response.json()

    risks = [
        event["risk_score"]
        for event in data["events"]
    ]

    assert risks[0] <= 30
    assert risks[-1] >= 70
    assert data["final_verdict"] == "BLOCK"


def test_invalid_attack_returns_404():
    response = client.post(
        "/api/attacks/not-real/run"
    )

    assert response.status_code == 404