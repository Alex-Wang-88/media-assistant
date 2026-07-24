import json
from pathlib import Path

from fastapi import APIRouter
from pydantic import TypeAdapter

router = APIRouter(prefix="/v1/catalog", tags=["catalog"])
CATALOG_DIRECTORY = Path(__file__).resolve().parents[1] / "catalog"
CATALOG_ADAPTER = TypeAdapter(dict[str, object])


def load_catalog(filename: str) -> dict[str, object]:
    source = (CATALOG_DIRECTORY / filename).read_text(encoding="utf-8")
    return CATALOG_ADAPTER.validate_python(json.loads(source))


@router.get("/models")
async def models() -> dict[str, object]:
    return load_catalog("yunrong-models.json")


@router.get("/plugins")
async def plugins() -> dict[str, object]:
    return load_catalog("yunrong-plugins.json")
