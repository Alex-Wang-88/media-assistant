import { useMutation } from "@tanstack/react-query";
import type { Platform } from "@yoom/desktop-contracts";
import {
  contentToZhihuBlocks,
  type MemoryPublishDraft,
  zhihuBlocksToContent,
} from "./publish-draft-model";

export function usePublishAutomation({
  selectedDraft,
  autoPublishByPlatform,
  updateSelectedDraft,
  refreshPlatformAccounts,
  setNotice,
  setError,
}: {
  selectedDraft: MemoryPublishDraft | null;
  autoPublishByPlatform: Record<Platform, boolean>;
  updateSelectedDraft(patch: Partial<MemoryPublishDraft>): void;
  refreshPlatformAccounts(showLoading?: boolean): Promise<void>;
  setNotice(message: string | null): void;
  setError(message: string | null): void;
}) {
  const selectImages = useMutation({
    mutationFn: () => {
      const limit = selectedDraft?.platform === "x" ? 4 : 20;
      return window.desktop.publish.selectImages(
        Math.max(1, limit - (selectedDraft?.images.length ?? 0)),
      );
    },
    onSuccess: (images) => {
      if (images.length === 0) return;
      const limit = selectedDraft?.platform === "x" ? 4 : 20;
      updateSelectedDraft({
        images: [...(selectedDraft?.images ?? []), ...images].slice(0, limit),
        automationResult: null,
      });
      setNotice("已记录本地图片路径；不会复制或修改原图");
      setError(null);
    },
    onError: (reason) => setError(readableError(reason)),
  });

  const selectZhihuImage = useMutation({
    mutationFn: (insertionIndex: number) => {
      if (!selectedDraft || selectedDraft.images.length >= 20) {
        throw new Error("每份草稿最多选择 20 张图片");
      }
      return window.desktop.publish.selectImages(1).then((images) => ({ images, insertionIndex }));
    },
    onSuccess: ({ images, insertionIndex }) => {
      const image = images[0];
      if (!selectedDraft || !image) return;
      const blocks = [...(selectedDraft.zhihuBlocks ?? [])];
      blocks.splice(insertionIndex, 0, {
        id: crypto.randomUUID(),
        type: "image",
        imageId: image.id,
        caption: "",
      });
      updateSelectedDraft({
        images: [...selectedDraft.images, image].slice(0, 20),
        zhihuBlocks: blocks,
        content: zhihuBlocksToContent(blocks),
        automationResult: null,
      });
      setNotice("图片已插入当前位置；可选填不超过 140 字的图片注释");
      setError(null);
    },
    onError: (reason) => setError(readableError(reason)),
  });

  const openPlatform = useMutation({
    mutationFn: () => {
      if (!selectedDraft) throw new Error("请先新建或选择一个草稿");
      if (selectedDraft.platform === "bilibili") {
        if (!selectedDraft.bilibiliAccountId) throw new Error("请先选择 B 站发布账号");
        return window.desktop.publish.openBilibili({
          accountId: selectedDraft.bilibiliAccountId,
          title: selectedDraft.title,
          content: selectedDraft.content,
          imageIds: selectedDraft.images.map((image) => image.id),
          autoPublish: autoPublishByPlatform.bilibili,
        });
      }
      if (selectedDraft.platform === "zhihu") {
        if (!selectedDraft.zhihuAccountId) throw new Error("请先选择知乎发布账号");
        const openZhihu = window.desktop.publish.openZhihu;
        if (!openZhihu) throw new Error("当前应用版本未加载知乎填充功能");
        return openZhihu({
          accountId: selectedDraft.zhihuAccountId,
          title: selectedDraft.title,
          blocks: selectedDraft.zhihuBlocks ?? contentToZhihuBlocks(selectedDraft.content),
        });
      }
      if (selectedDraft.platform === "x") {
        if (!selectedDraft.xAccountId) throw new Error("请先选择 X 发布账号");
        if (selectedDraft.images.length > 4) throw new Error("X 每条帖子最多添加 4 张配图");
        return window.desktop.publish.openX({
          accountId: selectedDraft.xAccountId,
          content: selectedDraft.content,
          imageIds: selectedDraft.images.map((image) => image.id),
          autoPublish: autoPublishByPlatform.x,
        });
      }
      throw new Error("当前平台尚未接入自由草稿填充");
    },
    onSuccess: (result) => {
      const completed = result.state === "filled" || result.state === "published";
      updateSelectedDraft({ automationResult: completed ? result : null });
      void refreshPlatformAccounts();
      setNotice(null);
      setError(completed ? null : result.message);
    },
    onError: (reason) => setError(readableError(reason)),
  });

  return { selectImages, selectZhihuImage, openPlatform };
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
