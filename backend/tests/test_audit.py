import json

from fastapi.testclient import TestClient

from backend.app.audit import anchor, chain
from backend.main import app

client = TestClient(app)


def test_chain_valid_and_merkle_stable(tmp_path, monkeypatch):
    monkeypatch.setenv("RAKSHA_DATA_DIR", str(tmp_path))
    for i in range(5):
        chain.append_event("TEST", "s", i=i)
    a, b = chain.verify(), chain.verify()
    assert a["chain_valid"] is True and a["event_count"] == 5
    assert a["merkle_root"] == b["merkle_root"] and len(a["merkle_root"]) == 64
    chain.append_event("TEST", "s", i=99)
    assert chain.verify()["merkle_root"] != a["merkle_root"]


def test_real_tampering_detected(tmp_path, monkeypatch):
    monkeypatch.setenv("RAKSHA_DATA_DIR", str(tmp_path))
    for i in range(4):
        chain.append_event("TEST", "s", i=i)
    p = tmp_path / "audit.jsonl"
    lines = p.read_text().splitlines()
    e = json.loads(lines[1])
    e["data"]["i"] = 1000
    lines[1] = json.dumps(e)
    p.write_text("\n".join(lines) + "\n")
    v = chain.verify()
    assert v["chain_valid"] is False and v["invalid_index"] == 1


def test_tamper_demo_does_not_corrupt_real_log(tmp_path, monkeypatch):
    monkeypatch.setenv("RAKSHA_DATA_DIR", str(tmp_path))
    for i in range(4):
        chain.append_event("TEST", "s", i=i)
    before = (tmp_path / "audit.jsonl").read_text()
    d = chain.tamper_demo()
    assert d["chain_valid"] is False and d["invalid_index"] is not None
    assert (tmp_path / "audit.jsonl").read_text() == before
    assert chain.verify()["chain_valid"] is True


def test_tamper_demo_works_on_empty_log(tmp_path, monkeypatch):
    monkeypatch.setenv("RAKSHA_DATA_DIR", str(tmp_path))
    assert chain.tamper_demo()["chain_valid"] is False


def test_audit_endpoints_and_events(tmp_path, monkeypatch):
    monkeypatch.setenv("RAKSHA_DATA_DIR", str(tmp_path))
    client.post("/api/audit/reset")
    client.delete("/api/session/audit-s")
    client.post("/api/session/evaluate", json={
        "session_id": "audit-s", "tool": "read_file", "operation": "read",
        "resource": "vendor_invoice.pdf", "user_intent": "summarize vendor invoice",
        "permissions": ["read_file"]})
    v = client.get("/api/audit/verify").json()
    assert v["chain_valid"] is True and v["event_count"] >= 2 and v["merkle_root"]
    types = [e["type"] for e in client.get("/api/audit/events").json()["events"]]
    assert "ACTION_EVALUATED" in types and "SANDBOX_EXECUTION" in types
    t = client.post("/api/audit/tamper-demo").json()
    assert t["chain_valid"] is False
    assert client.get("/api/audit/verify").json()["chain_valid"] is True


def test_audit_never_logs_tool_output(tmp_path, monkeypatch):
    monkeypatch.setenv("RAKSHA_DATA_DIR", str(tmp_path))
    client.delete("/api/session/audit-sec")
    d = client.post("/api/session/evaluate", json={
        "session_id": "audit-sec", "tool": "read_file", "operation": "read",
        "resource": ".env", "user_intent": "show env secrets", "permissions": ["read_file"]}).json()
    assert d["tool_result"]["ok"] is True
    assert "synthetic-not-a-real-key" not in (tmp_path / "audit.jsonl").read_text()


def test_local_anchor_records_only_root(tmp_path, monkeypatch):
    monkeypatch.setenv("RAKSHA_DATA_DIR", str(tmp_path))
    chain.append_event("TEST", "s")
    r = anchor.anchor_now()
    assert "LOCAL DEMO ANCHOR" in r["label"]
    assert set(r) == {"label", "merkle_root", "event_count", "timestamp"}
