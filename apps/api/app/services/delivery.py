from datetime import UTC, datetime
from hashlib import sha256
from uuid import UUID, uuid4

from app.models.schemas import ArticleRequest, ArticleResult, PendingArtifact


class DeliveryNotFoundError(LookupError):
    pass


class DeliveryHashMismatchError(ValueError):
    pass


class DeliveryService:
    """A small explicit delivery boundary; replace its store with PostgreSQL in deployment."""

    def __init__(self) -> None:
        self._pending: dict[UUID, PendingArtifact] = {}
        self._expected_hashes: dict[UUID, str] = {}
        self._committed: set[UUID] = set()

    def create_article(self, request: ArticleRequest, result: ArticleResult) -> PendingArtifact:
        artifact_id = uuid4()
        content = _article_markdown(artifact_id, request, result)
        artifact = PendingArtifact(
            id=artifact_id,
            project_id=request.project_id,
            relative_path=f"文章/{_safe_title(result.title)}__{str(artifact_id)[:8]}.md",
            media_type="text/markdown",
            content=content,
            created_at=datetime.now(UTC),
        )
        self._pending[artifact_id] = artifact
        self._expected_hashes[artifact_id] = sha256(content.encode()).hexdigest()
        return artifact

    def get_pending(self, artifact_id: UUID) -> PendingArtifact:
        artifact = self._pending.get(artifact_id)
        if artifact is None or artifact_id in self._committed:
            raise DeliveryNotFoundError("待交付生成物不存在")
        return artifact

    def commit(self, artifact_id: UUID, digest: str) -> None:
        self.get_pending(artifact_id)
        if self._expected_hashes[artifact_id] != digest:
            raise DeliveryHashMismatchError("生成物 SHA256 不匹配")
        self._committed.add(artifact_id)


def _safe_title(title: str) -> str:
    forbidden = '<>:"/\\|?*'
    cleaned = "".join(" " if char in forbidden else char for char in title)
    return " ".join(cleaned.split())[:60] or "未命名文章"


def _article_markdown(
    artifact_id: UUID, request: ArticleRequest, result: ArticleResult
) -> str:
    generated_at = datetime.now(UTC).isoformat()
    return f"""---
schema: yoom.article/v1
id: {artifact_id}
project_id: {request.project_id}
platform: {request.platform.value}
generated_at: {generated_at}
published_at:
tags_version: 1
tags:
  topics: []
  style: []
  tone: []
  audience: []
  format: []
  industry: []
  free: []
---

# {result.title}

{result.content.rstrip()}
"""
