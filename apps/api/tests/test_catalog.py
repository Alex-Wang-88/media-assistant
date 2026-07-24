from pydantic import TypeAdapter

from app.routers.catalog import load_catalog

LIST_ADAPTER = TypeAdapter(list[object])


def test_imported_catalog_counts_match_source_documents() -> None:
    models = load_catalog("yunrong-models.json")
    plugins = load_catalog("yunrong-plugins.json")
    assert len(LIST_ADAPTER.validate_python(models["models"])) == 131
    assert len(LIST_ADAPTER.validate_python(plugins["plugins"])) == 68
