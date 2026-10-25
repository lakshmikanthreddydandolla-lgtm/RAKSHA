import json
import os
import urllib.request

from backend.app.providers.base import SYSTEM_PROMPT, AgentPlan, Provider, ProviderError, parse_plan


class GroqProvider(Provider):
    name = "groq"

    def __init__(self) -> None:
        self.key = os.environ.get("GROQ_API_KEY", "")
        self.model = os.environ.get("GROQ_MODEL", "")

    @staticmethod
    def available() -> bool:
        return bool(os.environ.get("GROQ_API_KEY") and os.environ.get("GROQ_MODEL"))

    def plan(self, message: str) -> AgentPlan:
        body = json.dumps({"model": self.model, "temperature": 0,
                           "messages": [{"role": "system", "content": SYSTEM_PROMPT},
                                        {"role": "user", "content": message}]}).encode()
        req = urllib.request.Request(
            "https://api.groq.com/openai/v1/chat/completions", data=body,
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {self.key}"})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                data = json.loads(r.read())
            return parse_plan(data["choices"][0]["message"]["content"])
        except ProviderError:
            raise
        except Exception as e:
            raise ProviderError(f"Groq call failed: {type(e).__name__}") from e
