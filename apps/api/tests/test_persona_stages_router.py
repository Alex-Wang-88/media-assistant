from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.models.schemas import (
    PersonaAgentApiTurnResult,
    PersonaAgentTurnRequest,
    PersonaAgentTurnResponse,
)
from app.providers.persona_stages import PersonaStageAgentRegistry
from app.routers.persona_stages import router


class StageTwoAgent:
    async def turn(self, request: PersonaAgentTurnRequest) -> PersonaAgentApiTurnResult:
        return PersonaAgentApiTurnResult(
            response=PersonaAgentTurnResponse(
                requestId=request.request_id,
                flowId=request.flow_id,
                stateVersion=request.state_version,
                stage=2,
                action="ask_question",
                question="第2/5阶段：最终决定购买的人是谁？",
                conclusion=None,
                resultPatch={},
                finalSummary=None,
            ),
            userMessage="用户本次回答：\n采购部门使用，老板决定",
            assistantMessage='{"action":"ask_question"}',
        )


@asynccontextmanager
async def configured_lifespan(app: FastAPI) -> AsyncGenerator[None]:
    app.state.persona_stage_agents = PersonaStageAgentRegistry({2: StageTwoAgent()})
    yield


def payload(stage: int) -> dict[str, object]:
    return {
        "requestId": str(uuid4()),
        "flowId": str(uuid4()),
        "stateVersion": 1,
        "stage": stage,
        "event": "user_message",
        "userMessage": "采购部门使用，老板决定",
        "referenceContext": None,
        "stageState": {
            "stage": stage,
            "status": "collecting",
            "revisionCount": 0,
            "conversationId": "stage-session",
            "lastAssistantMessage": None,
            "agentMessages": [],
            "stageData": {},
            "result": {},
        },
        "confirmedData": {},
    }


def test_routes_a_turn_to_the_configured_stage_only() -> None:
    app = FastAPI(lifespan=configured_lifespan)
    app.include_router(router)
    with TestClient(app) as client:
        response = client.post("/v1/persona/stages/turn", json=payload(2))

    assert response.status_code == 200
    assert response.json()["response"]["stage"] == 2
    assert response.json()["response"]["question"].startswith("第2/5阶段")


def test_reports_the_specific_missing_stage_configuration() -> None:
    app = FastAPI(lifespan=configured_lifespan)
    app.include_router(router)
    with TestClient(app) as client:
        response = client.post("/v1/persona/stages/turn", json=payload(4))

    assert response.status_code == 503
    assert "PERSONA_STAGE_4_SHARE_URL" in response.json()["detail"]
