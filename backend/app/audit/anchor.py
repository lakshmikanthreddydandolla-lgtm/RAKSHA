"""LOCAL DEMO ANCHOR: records only the Merkle root locally.

No blockchain transaction is made. legacy_demo/AuditAnchor.sol is the
reference contract for a real anchor; it is not required by RAKSHA.
"""
import json
import time
from typing import Any

from backend.app.audit import chain
from backend.app.paths import data_dir

LABEL = "LOCAL DEMO ANCHOR (no blockchain transaction)"


def _path():
    return data_dir() / "anchors.jsonl"


def list_anchors() -> list[dict[str, Any]]:
    p = _path()
    if not p.exists():
        return []
    return [json.loads(x) for x in p.read_text(encoding="utf-8").splitlines() if x.strip()]


def anchor_now() -> dict[str, Any]:
    v = chain.verify()
    record = {
        "label": LABEL,
        "merkle_root": v["merkle_root"],
        "event_count": v["event_count"],
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    with _path().open("a", encoding="utf-8") as f:
        f.write(json.dumps(record) + "\n")
    return record
