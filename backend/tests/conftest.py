import os
import tempfile

# Isolate data + sandbox BEFORE the app is imported.
os.environ["RAKSHA_DATA_DIR"] = tempfile.mkdtemp(prefix="raksha-data-")
os.environ["RAKSHA_SANDBOX_ROOT"] = tempfile.mkdtemp(prefix="raksha-sandbox-")

import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def _no_cloud_keys_and_default_policy(monkeypatch):
    for key in ("GROQ_API_KEY", "GROQ_MODEL", "GEMINI_API_KEY", "GEMINI_MODEL"):
        monkeypatch.delenv(key, raising=False)
    from backend.app import policy
    policy.reset_policy()
    yield
    policy.reset_policy()
