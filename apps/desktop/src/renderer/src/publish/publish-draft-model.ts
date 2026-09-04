import type {
  LocalPublishImage,
  Platform,
  PublishAutomationResult,
  PublishDraft,
  ZhihuContentBlock,
} from "@yoom/desktop-contracts";

export const NEW_BILIBILI_ACCOUNT_VALUE = "__new_bilibili_account__";
export const NEW_ZHIHU_ACCOUNT_VALUE = "__new_zhihu_account__";
export const NEW_X_ACCOUNT_VALUE = "__new_x_account__";

export const DRAFT_GROUPS = [
  { source: "generated", label: "Agent 生成", emptyLabel: "暂无 Agent 生成内容" },
  { source: "manual", label: "自由草稿", emptyLabel: "暂无自由草稿" },
] as const;

export type PublishCenterSeed = {
  key: string;
  title: string;
  content: string;
  platform?: Platform;
};

export type MemoryPublishDraft = PublishDraft & {
  automationResult: PublishAutomationResult | null;
};

export function createDraft(
  patch: Partial<Omit<MemoryPublishDraft, "id">> = {},
): MemoryPublishDraft {
  return {
    id: crypto.randomUUID(),
    title: "未命名发布草稿",
    platform: null,
    bilibiliAccountId: null,
    zhihuAccountId: null,
    xAccountId: null,
    content: "",
    images: [],
    source: "manual",
    pinned: false,
    automationResult: null,
    ...patch,
  };
}

export function contentToZhihuBlocks(content: string): ZhihuContentBlock[] {
  const paragraphs = content
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  return (paragraphs.length > 0 ? paragraphs : [""]).map((paragraph) => ({
    id: crypto.randomUUID(),
    type: "text" as const,
    content: paragraph,
  }));
}

export function legacyZhihuBlocks(
  content: string,
  images: readonly LocalPublishImage[],
): ZhihuContentBlock[] {
  return [
    ...contentToZhihuBlocks(content),
    ...images.map((image) => ({
      id: crypto.randomUUID(),
      type: "image" as const,
      imageId: image.id,
      caption: "",
    })),
  ];
}

export function migrateLegacyZhihuDraft(draft: MemoryPublishDraft): MemoryPublishDraft {
  let platformVariants = draft.platformVariants?.map((variant) =>
    variant.platform === "zhihu" && !variant.zhihuBlocks
      ? { ...variant, zhihuBlocks: legacyZhihuBlocks(variant.content, variant.images) }
      : variant,
  );

  if (draft.platform !== "zhihu" || draft.zhihuBlocks) {
    return { ...draft, platformVariants };
  }

  const zhihuBlocks = legacyZhihuBlocks(draft.content, draft.images);
  platformVariants = platformVariants?.map((variant) =>
    variant.platform === "zhihu"
      ? {
          ...variant,
          title: draft.title,
          content: draft.content,
          images: draft.images,
          zhihuBlocks,
        }
      : variant,
  );
  return { ...draft, zhihuBlocks, platformVariants };
}

export function zhihuBlocksToContent(blocks: readonly ZhihuContentBlock[]): string {
  return blocks
    .filter((block): block is Extract<ZhihuContentBlock, { type: "text" }> => block.type === "text")
    .map((block) => block.content.trim())
    .filter(Boolean)
    .join("\n\n");
}

export function uniqueDraftImageIds(draft: MemoryPublishDraft): string[] {
  return [
    ...new Set([
      ...draft.images.map((image) => image.id),
      ...(draft.platformVariants ?? []).flatMap((variant) =>
        variant.images.map((image) => image.id),
      ),
    ]),
  ];
}
