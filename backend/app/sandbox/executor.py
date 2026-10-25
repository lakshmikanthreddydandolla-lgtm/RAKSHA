"""Central tool executor. Only call this AFTER RAKSHA allowed the action."""
import json
import time
from typing import Any

from backend.app import policy
from backend.app.sandbox.tools import TOOLS, SandboxError, ensure_sandbox


def execute_tool(action: dict[str, Any]) -> dict[str, Any]:
    tool = str(action.get("tool", ""))
    result: dict[str, Any] = {"tool": tool, "ok": False, "output": None, "error": None}
    try:
        if tool not in policy.get_policy()["allowed_tools"] or tool not in TOOLS:
            raise SandboxError(f"Tool '{tool}' is not available in the sandbox")
        result["output"] = TOOLS[tool](action)
        result["ok"] = True
    except SandboxError as e:
        result["error"] = str(e)
    except Exception as e:  # never let a tool crash the API
        result["error"] = f"Tool error: {type(e).__name__}"
    try:
        root = ensure_sandbox()
        with (root / "logs" / "executions.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps({"tool": tool, "resource": str(action.get("resource", ""))[:200],
                                "ok": result["ok"],
                                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}) + "\n")
    except OSError:
        pass
    return result
