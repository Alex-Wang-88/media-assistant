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
    persona_stage_1_share_url: str | None
    persona_stage_2_share_url: str | None
    persona_stage_3_share_url: str | None
    persona_stage_4_share_url: str | None
    persona_stage_5_share_url: str | None

    @classmethod
    def from_environment(cls) -> "Settings":
        return cls(
            yunrong_base_url=environ.get("YUNRONG_BASE_URL"),
            yunrong_session_cookie=environ.get("YUNRONG_SESSION_COOKIE"),
            yunbloom_share_url=environ.get("YUNBLOOM_SHARE_URL"),
            yunbloom_api_key=environ.get("YUNBLOOM_API_KEY"),
            persona_agent_share_url=environ.get("PERSONA_AGENT_SHARE_URL"),
            persona_agent_api_key=environ.get("PERSONA_AGENT_API_KEY"),
            persona_stage_1_share_url=environ.get("PERSONA_STAGE_1_SHARE_URL"),
            persona_stage_2_share_url=environ.get("PERSONA_STAGE_2_SHARE_URL"),
            persona_stage_3_share_url=environ.get("PERSONA_STAGE_3_SHARE_URL"),
            persona_stage_4_share_url=environ.get("PERSONA_STAGE_4_SHARE_URL"),
            persona_stage_5_share_url=environ.get("PERSONA_STAGE_5_SHARE_URL"),
        )

    def persona_stage_share_urls(self) -> tuple[str | None, ...]:
        return (
            self.persona_stage_1_share_url,
            self.persona_stage_2_share_url,
            self.persona_stage_3_share_url,
            self.persona_stage_4_share_url,
            self.persona_stage_5_share_url,
        )
