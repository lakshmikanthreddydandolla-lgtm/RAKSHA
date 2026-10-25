import json
import os
import urllib.request

from backend.app.providers.base import SYSTEM_PROMPT, AgentPlan, Provider, ProviderError, parse_plan


class GeminiProvider(Provider):
    name = "gemini"

    def __init__(self) -> None:
        self.key = os.environ.get("GEMINI_API_KEY", "")
        self.model = os.environ.get("GEMINI_MODEL", "")

    @staticmethod
    def available() -> bool:
        return bool(os.environ.get("GEMINI_API_KEY") and os.environ.get("GEMINI_MODEL"))

    def plan(self, message: str) -> AgentPlan:
        body = json.dumps({
            "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
            "contents": [{"role": "user", "parts": [{"text": message}]}],
        }).encode()
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent"
        req = urllib.request.Request(
            url, data=body,
            headers={"Content-Type": "application/json", "x-goog-api-key": self.key})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                data = json.loads(r.read())
            return parse_plan(data["candidates"][0]["content"]["parts"][0]["text"])
        except ProviderError:
            raise
        except Exception as e:
            raise ProviderError(f"Gemini call failed: {type(e).__name__}") from e
