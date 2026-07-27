from dataclasses import dataclass
from os import environ


@dataclass(frozen=True, slots=True)
class Settings:
    yunrong_base_url: str | None
    yunrong_session_cookie: str | None
    yunbloom_share_url: str | None
    yunbloom_api_key: str | None
    persona_agent_share_url: str | None
    persona_agent_api_key: str | None

    @classmethod
    def from_environment(cls) -> "Settings":
        return cls(
            yunrong_base_url=environ.get("YUNRONG_BASE_URL"),
            yunrong_session_cookie=environ.get("YUNRONG_SESSION_COOKIE"),
            yunbloom_share_url=environ.get("YUNBLOOM_SHARE_URL"),
            yunbloom_api_key=environ.get("YUNBLOOM_API_KEY"),
            persona_agent_share_url=environ.get("PERSONA_AGENT_SHARE_URL"),
            persona_agent_api_key=environ.get("PERSONA_AGENT_API_KEY"),
        )
