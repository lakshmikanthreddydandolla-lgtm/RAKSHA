from backend.app.providers.base import AgentPlan, Provider, ProviderError
from backend.app.providers.gemini_provider import GeminiProvider
from backend.app.providers.groq_provider import GroqProvider
from backend.app.providers.mock_provider import MockProvider

try:  # optional: load .env if python-dotenv is installed
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass


def select_provider() -> Provider:
    """Groq -> Gemini -> Mock. Mock is always available (offline)."""
    if GroqProvider.available():
        return GroqProvider()
    if GeminiProvider.available():
        return GeminiProvider()
    return MockProvider()


def plan_with_fallback(message: str) -> tuple[str, str | None, AgentPlan]:
    """Returns (provider_name, fallback_reason, plan)."""
    provider = select_provider()
    if provider.name == "mock":
        return "mock", None, provider.plan(message)
    try:
        return provider.name, None, provider.plan(message)
    except ProviderError as e:
        return "mock", f"{provider.name} unavailable: {e}", MockProvider().plan(message)
