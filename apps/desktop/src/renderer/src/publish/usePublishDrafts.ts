import type { Platform, PublishDraftState } from "@yoom/desktop-contracts";
import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import { DEFAULT_AUTO_PUBLISH_BY_PLATFORM } from "./platforms";
import {
  contentToZhihuBlocks,
  createDraft,
  type MemoryPublishDraft,
  migrateLegacyZhihuDraft,
  type PublishCenterSeed,
} from "./publish-draft-model";

export type PublishDraftController = {
  drafts: MemoryPublishDraft[];
  setDrafts: Dispatch<SetStateAction<MemoryPublishDraft[]>>;
  selectedDraftId: string;
  setSelectedDraftId: Dispatch<SetStateAction<string>>;
  autoPublishByPlatform: Record<Platform, boolean>;
  setAutoPublishByPlatform: Dispatch<SetStateAction<Record<Platform, boolean>>>;
  draftsLoaded: boolean;
};

export function usePublishDrafts({
  workspacePath,
  seed,
  onSeedConsumed,
  onNotice,
  onError,
  onClearConfirm,
}: {
  workspacePath: string | null;
  seed: PublishCenterSeed[] | null;
  onSeedConsumed(): void;
  onNotice(message: string | null): void;
  onError(message: string | null): void;
  onClearConfirm(value: boolean): void;
}): PublishDraftController {
  const [drafts, setDrafts] = useState<MemoryPublishDraft[]>(() => [createDraft()]);
  const [selectedDraftId, setSelectedDraftId] = useState(() => drafts[0]?.id ?? "");
  const [autoPublishByPlatform, setAutoPublishByPlatform] = useState<Record<Platform, boolean>>(
    DEFAULT_AUTO_PUBLISH_BY_PLATFORM,
  );
  const [draftsLoaded, setDraftsLoaded] = useState(false);

  useEffect(() => {
    if (!seed || seed.length === 0 || !draftsLoaded) return;
    const primary = seed[0];
    if (!primary) return;
    const platformVariants = seed.flatMap((entry) =>
      entry.platform
        ? [
            {
              platform: entry.platform,
              title: entry.title || "Agent 生成内容",
              content: entry.content,
              images: [],
              zhihuBlocks:
                entry.platform === "zhihu" ? contentToZhihuBlocks(entry.content) : undefined,
            },
          ]
        : [],
    );
    const generatedDraft = createDraft({
      title: primary.title || "Agent 生成内容",
      content: primary.content,
      platform: primary.platform ?? null,
      source: "generated",
      platformVariants,
      zhihuBlocks: primary.platform === "zhihu" ? contentToZhihuBlocks(primary.content) : undefined,
    });
    setDrafts((current) => [generatedDraft, ...current]);
    setSelectedDraftId(generatedDraft.id);
    onNotice(
      platformVariants.length > 1
        ? `${platformVariants.length} 个平台版本已合并到同一份草稿`
        : "生成内容已转入当前内存草稿",
    );
    onError(null);
    onClearConfirm(false);
    onSeedConsumed();
  }, [draftsLoaded, onClearConfirm, onError, onNotice, onSeedConsumed, seed]);

  useEffect(() => {
    let cancelled = false;
    setDraftsLoaded(false);
    if (!workspacePath) return;
    window.desktop.publish
      .loadDrafts()
      .then((state) => {
        if (cancelled) return;
        const restoredDrafts = state?.drafts.map((draft) =>
          migrateLegacyZhihuDraft({ ...draft, automationResult: null }),
        );
        const nextDrafts =
          restoredDrafts && restoredDrafts.length > 0 ? restoredDrafts : [createDraft()];
        const nextSelectedDraftId =
          state && nextDrafts.some((draft) => draft.id === state.selectedDraftId)
            ? state.selectedDraftId
            : (nextDrafts[0]?.id ?? "");
        setDrafts(nextDrafts);
        setSelectedDraftId(nextSelectedDraftId);
        setAutoPublishByPlatform(state?.autoPublishByPlatform ?? DEFAULT_AUTO_PUBLISH_BY_PLATFORM);
        setDraftsLoaded(true);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        const draft = createDraft();
        setDrafts([draft]);
        setSelectedDraftId(draft.id);
        setAutoPublishByPlatform(DEFAULT_AUTO_PUBLISH_BY_PLATFORM);
        onError(readableError(reason));
        setDraftsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [onError, workspacePath]);

  useEffect(() => {
    if (!draftsLoaded || !workspacePath || drafts.length === 0 || !selectedDraftId) return;
    const state: PublishDraftState = {
      version: 1,
      selectedDraftId,
      drafts: drafts.map(({ automationResult: _automationResult, ...draft }) => draft),
      autoPublishByPlatform,
    };
    void window.desktop.publish.saveDrafts(state).catch((reason: unknown) => {
      onError(`草稿自动保存失败：${readableError(reason)}`);
    });
  }, [autoPublishByPlatform, drafts, draftsLoaded, onError, selectedDraftId, workspacePath]);

  return {
    drafts,
    setDrafts,
    selectedDraftId,
    setSelectedDraftId,
    autoPublishByPlatform,
    setAutoPublishByPlatform,
    draftsLoaded,
  };
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
