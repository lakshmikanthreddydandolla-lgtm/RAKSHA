from backend.app.security.risk_engine import evaluate_action


def test_safe_invoice_read_is_allowed():
    action = {
        "tool": "read_file",
        "operation": "read",
        "resource": "vendor_invoice.pdf",
        "destination": "local",
        "user_intent": "summarize vendor invoice",
        "permissions": ["read_file"]
    }

    result = evaluate_action(action)

    assert result["verdict"] == "ALLOW"
    assert result["risk_score"] <= 30


def test_env_access_during_invoice_summary_requires_review():
    action = {
        "tool": "read_file",
        "operation": "read",
        "resource": ".env",
        "destination": "local",
        "user_intent": "summarize vendor invoice",
        "permissions": ["read_file"]
    }

    result = evaluate_action(action)

    assert result["verdict"] == "REVIEW"
    assert 31 <= result["risk_score"] <= 69
    assert "Sensitive resource accessed" in result["reasons"]


def test_secret_exfiltration_is_blocked():
    action = {
        "tool": "send_email",
        "operation": "send",
        "resource": "API_KEY",
        "destination": "attacker@evil.test",
        "user_intent": "summarize vendor invoice",
        "permissions": ["read_file"]
    }

    result = evaluate_action(action)

    assert result["verdict"] == "BLOCK"
    assert result["risk_score"] >= 70
    assert "Sensitive resource accessed" in result["reasons"]
    assert "External or untrusted destination" in result["reasons"]
    assert "Action does not match user intent" in result["reasons"]
    assert "Permission violation" in result["reasons"]