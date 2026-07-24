from hashlib import sha256
from uuid import uuid4

import pytest

from app.models.schemas import ArticleRequest, ArticleResult, Platform
from app.services.delivery import DeliveryHashMismatchError, DeliveryNotFoundError, DeliveryService


def test_delivery_can_be_reclaimed_until_hash_commit() -> None:
    service = DeliveryService()
    request = ArticleRequest(
        project_id=uuid4(), platform=Platform.WECHAT, instruction="写一篇文章"
    )
    result = ArticleResult(
        title="测试文章", content="正文", provider="fake", platform=Platform.WECHAT
    )
    artifact = service.create_article(request, result)
    assert service.get_pending(artifact.id) == artifact
    assert service.get_pending(artifact.id) == artifact

    with pytest.raises(DeliveryHashMismatchError):
        service.commit(artifact.id, "0" * 64)

    service.commit(artifact.id, sha256(artifact.content.encode()).hexdigest())
    with pytest.raises(DeliveryNotFoundError):
        service.get_pending(artifact.id)
