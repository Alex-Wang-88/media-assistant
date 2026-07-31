from fastapi import APIRouter, HTTPException, Request, status

from app.models.schemas import PersonaAgentApiTurnResult, PersonaAgentTurnRequest
from app.providers.article import ProviderResponseError
from app.providers.persona_stages import PersonaStageAgentRegistry

router = APIRouter(prefix="/v1/persona/stages", tags=["persona-stages"])


@router.post("/turn", response_model=PersonaAgentApiTurnResult)
async def persona_stage_turn(
    body: PersonaAgentTurnRequest,
    request: Request,
) -> PersonaAgentApiTurnResult:
    registry: PersonaStageAgentRegistry = request.app.state.persona_stage_agents
    provider = registry.get(body.stage)
    if provider is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            f"第 {body.stage} 阶段 Agent 未配置，请设置 "
            f"PERSONA_STAGE_{body.stage}_SHARE_URL 和 PERSONA_AGENT_API_KEY",
        )
    try:
        return await provider.turn(body)
    except ProviderResponseError as error:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(error)) from error
