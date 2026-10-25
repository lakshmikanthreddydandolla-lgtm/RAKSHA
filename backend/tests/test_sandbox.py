import inspect

from backend.app.sandbox import executor, tools
from backend.app.sandbox.executor import execute_tool
from backend.app.paths import sandbox_root


def test_read_synthetic_file():
    r = execute_tool({"tool": "read_file", "resource": "vendor_invoice.pdf"})
    assert r["ok"] and "synthetic" in r["output"]["content"].lower()


def test_path_traversal_blocked():
    for bad in ("../../etc/passwd", "documents/../../x", "..\\..\\secret"):
        r = execute_tool({"tool": "read_file", "resource": bad})
        assert r["ok"] is False


def test_absolute_paths_blocked():
    for bad in ("/etc/passwd", "C:\\Windows\\win.ini"):
        assert execute_tool({"tool": "read_file", "resource": bad})["ok"] is False


def test_shell_is_simulated_only():
    r = execute_tool({"tool": "shell", "resource": "echo hi"})
    assert r["ok"] and r["output"]["simulated"] is True
    assert "subprocess" not in inspect.getsource(tools)
    assert "subprocess" not in inspect.getsource(executor)
    assert "os.system" not in inspect.getsource(tools)


def test_email_is_local_only():
    r = execute_tool({"tool": "send_email", "destination": "a@b.example", "metadata": {"body": "hi"}})
    assert r["ok"] and r["output"]["simulated"] is True
    assert (sandbox_root() / "mailbox" / "outbox.jsonl").exists()


def test_http_request_makes_no_network_call():
    r = execute_tool({"tool": "http_request", "resource": "http://evil.example"})
    assert r["output"]["simulated"] is True


def test_database_read_and_destructive_write_refused():
    assert execute_tool({"tool": "database_read", "resource": "invoices"})["ok"]
    assert execute_tool({"tool": "database_write", "operation": "drop_table", "resource": "invoices"})["ok"] is False


def test_unknown_tool_refused():
    assert execute_tool({"tool": "format_disk"})["ok"] is False
