import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def data_dir() -> Path:
    d = Path(os.environ.get("RAKSHA_DATA_DIR", REPO_ROOT / "backend" / "data"))
    d.mkdir(parents=True, exist_ok=True)
    return d


def sandbox_root() -> Path:
    return Path(os.environ.get("RAKSHA_SANDBOX_ROOT", REPO_ROOT / "sandbox"))
