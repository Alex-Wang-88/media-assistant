import { useMutation } from "@tanstack/react-query";
import type {
  BilibiliAccount,
  LocalPublishImage,
  Platform,
  PublishAutomationResult,
  PublishDraft,
  PublishDraftState,
  ZhihuAccount,
  ZhihuContentBlock,
} from "@yoom/desktop-contracts";
import { useCallback, useEffect, useState } from "react";

const NEW_BILIBILI_ACCOUNT_VALUE = "__new_bilibili_account__";
const NEW_ZHIHU_ACCOUNT_VALUE = "__new_zhihu_account__";

const PLATFORM_LABELS: Record<Platform, string> = {
  wechat: "微信公众号",
  toutiao: "今日头条",
  zhihu: "知乎",
  weibo: "微博",
  bilibili: "哔哩哔哩",
  xiaohongshu: "小红书",
};

const DRAFT_GROUPS = [
  { source: "generated", label: "Agent 生成", emptyLabel: "暂无 Agent 生成内容" },
  { source: "manual", label: "自由草稿", emptyLabel: "暂无自由草稿" },
] as const;

export type PublishCenterSeed = {
  key: string;
  title: string;
  content: string;
  platform?: Platform;
};

type MemoryPublishDraft = PublishDraft & {
  automationResult: PublishAutomationResult | null;
};

type PublishCenterProps = {
  open: boolean;
  workspacePath: string | null;
  seed: PublishCenterSeed[] | null;
  onSeedConsumed(): void;
  onClose(): void;
};

const DEFAULT_AUTO_PUBLISH_BY_PLATFORM: Record<Platform, boolean> = {
  wechat: false,
  toutiao: false,
  zhihu: false,
  weibo: false,
  bilibili: false,
  xiaohongshu: false,
};

function createDraft(patch: Partial<Omit<MemoryPublishDraft, "id">> = {}): MemoryPublishDraft {
  return {
    id: crypto.randomUUID(),
    title: "未命名发布草稿",
    platform: null,
    bilibiliAccountId: null,
    zhihuAccountId: null,
    content: "",
    images: [],
    source: "manual",
    pinned: false,
    automationResult: null,
    ...patch,
  };
}

function contentToZhihuBlocks(content: string): ZhihuContentBlock[] {
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

function legacyZhihuBlocks(
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

function migrateLegacyZhihuDraft(draft: MemoryPublishDraft): MemoryPublishDraft {
  let platformVariants = draft.platformVariants?.map((variant) =>
    variant.platform === "zhihu" && !variant.zhihuBlocks
      ? {
          ...variant,
          zhihuBlocks: legacyZhihuBlocks(variant.content, variant.images),
        }
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

function zhihuBlocksToContent(blocks: readonly ZhihuContentBlock[]): string {
  return blocks
    .filter((block): block is Extract<ZhihuContentBlock, { type: "text" }> => block.type === "text")
    .map((block) => block.content.trim())
    .filter(Boolean)
    .join("\n\n");
}

function uniqueDraftImageIds(draft: MemoryPublishDraft): string[] {
  return [
    ...new Set([
      ...draft.images.map((image) => image.id),
      ...(draft.platformVariants ?? []).flatMap((variant) =>
        variant.images.map((image) => image.id),
      ),
    ]),
  ];
}

export function PublishCenter({
  open,
  workspacePath,
  seed,
  onSeedConsumed,
  onClose,
}: PublishCenterProps) {
  const [drafts, setDrafts] = useState<MemoryPublishDraft[]>(() => [createDraft()]);
  const [selectedDraftId, setSelectedDraftId] = useState(() => drafts[0]?.id ?? "");
  const [autoPublishByPlatform, setAutoPublishByPlatform] = useState<Record<Platform, boolean>>(
    DEFAULT_AUTO_PUBLISH_BY_PLATFORM,
  );
  const [draftsLoaded, setDraftsLoaded] = useState(false);
  const [bilibiliAccounts, setBilibiliAccounts] = useState<BilibiliAccount[]>([]);
  const [zhihuAccounts, setZhihuAccounts] = useState<ZhihuAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [draftMenuId, setDraftMenuId] = useState<string | null>(null);
  const [renameDraftId, setRenameDraftId] = useState<string | null>(null);
  const [renameDraftValue, setRenameDraftValue] = useState("");
  const [deleteDraftId, setDeleteDraftId] = useState<string | null>(null);
  const selectedDraft = drafts.find((draft) => draft.id === selectedDraftId) ?? drafts[0] ?? null;
  const orderedDrafts = [
    ...drafts.filter((draft) => draft.pinned),
    ...drafts.filter((draft) => !draft.pinned),
  ];

  const refreshPlatformAccounts = useCallback(async (showLoading = false) => {
    if (showLoading) setAccountsLoading(true);
    try {
      const [accounts, loadedZhihuAccounts] = await Promise.all([
        window.desktop.publish.listBilibiliAccounts(),
        window.desktop.publish.listZhihuAccounts?.() ?? Promise.resolve([]),
      ]);
      setBilibiliAccounts(accounts);
      setZhihuAccounts(loadedZhihuAccounts);
      const defaultBilibiliAccountId = accounts[0]?.id ?? null;
      const defaultZhihuAccountId = loadedZhihuAccounts[0]?.id ?? null;
      setDrafts((current) =>
        current.map((draft) => {
          if (draft.platform === "bilibili" && !draft.bilibiliAccountId) {
            return { ...draft, bilibiliAccountId: defaultBilibiliAccountId };
          }
          if (draft.platform === "zhihu" && !draft.zhihuAccountId) {
            return { ...draft, zhihuAccountId: defaultZhihuAccountId };
          }
          return draft;
        }),
      );
    } catch (reason: unknown) {
      if (showLoading) setError(readableError(reason));
    } finally {
      if (showLoading) setAccountsLoading(false);
    }
  }, []);

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
    setNotice(
      platformVariants.length > 1
        ? `${platformVariants.length} 个平台版本已合并到同一份草稿`
        : "生成内容已转入当前内存草稿",
    );
    setError(null);
    setClearConfirm(false);
    onSeedConsumed();
  }, [draftsLoaded, onSeedConsumed, seed]);

  useEffect(() => {
    let cancelled = false;
    setDraftsLoaded(false);
    if (!workspacePath) return;
    window.desktop.publish
      .loadDrafts()
      .then((state) => {
        if (cancelled) return;
        const restoredDrafts = state?.drafts.map((draft) =>
          migrateLegacyZhihuDraft({
            ...draft,
            automationResult: null,
          }),
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
        setError(readableError(reason));
        setDraftsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [workspacePath]);

  useEffect(() => {
    if (!draftsLoaded || !workspacePath || drafts.length === 0 || !selectedDraftId) return;
    const state: PublishDraftState = {
      version: 1,
      selectedDraftId,
      drafts: drafts.map(({ automationResult: _automationResult, ...draft }) => draft),
      autoPublishByPlatform,
    };
    void window.desktop.publish.saveDrafts(state).catch((reason: unknown) => {
      setError(`草稿自动保存失败：${readableError(reason)}`);
    });
  }, [autoPublishByPlatform, drafts, draftsLoaded, selectedDraftId, workspacePath]);

  useEffect(() => {
    if (!open) return;
    void refreshPlatformAccounts(true);
    const handleWindowFocus = () => {
      void refreshPlatformAccounts();
    };
    window.addEventListener("focus", handleWindowFocus);
    return () => {
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, [open, refreshPlatformAccounts]);

  const updateSelectedDraft = (patch: Partial<MemoryPublishDraft>) => {
    if (!selectedDraft) return;
    setDrafts((current) =>
      current.map((draft) => {
        if (draft.id !== selectedDraft.id) return draft;
        const nextDraft = { ...draft, ...patch };
        if (
          draft.source !== "generated" ||
          !draft.platform ||
          !draft.platformVariants?.length ||
          (!("title" in patch) &&
            !("content" in patch) &&
            !("images" in patch) &&
            !("zhihuBlocks" in patch))
        ) {
          return nextDraft;
        }
        return {
          ...nextDraft,
          platformVariants: draft.platformVariants.map((variant) =>
            variant.platform === draft.platform
              ? {
                  ...variant,
                  title: patch.title ?? draft.title,
                  content: patch.content ?? draft.content,
                  images: patch.images ?? draft.images,
                  zhihuBlocks: patch.zhihuBlocks ?? draft.zhihuBlocks,
                }
              : variant,
          ),
        };
      }),
    );
  };

  const switchGeneratedPlatform = (platform: Platform) => {
    if (!selectedDraft?.platformVariants?.length) return;
    const variants = selectedDraft.platformVariants.map((variant) =>
      variant.platform === selectedDraft.platform
        ? {
            ...variant,
            title: selectedDraft.title,
            content: selectedDraft.content,
            images: selectedDraft.images,
            zhihuBlocks: selectedDraft.zhihuBlocks,
          }
        : variant,
    );
    const nextVariant = variants.find((variant) => variant.platform === platform);
    if (!nextVariant) return;
    setDrafts((current) =>
      current.map((draft) =>
        draft.id === selectedDraft.id
          ? {
              ...draft,
              platform,
              title: nextVariant.title,
              content: nextVariant.content,
              images: nextVariant.images,
              zhihuBlocks: platform === "zhihu" ? nextVariant.zhihuBlocks : undefined,
              bilibiliAccountId:
                platform === "bilibili"
                  ? (draft.bilibiliAccountId ?? bilibiliAccounts[0]?.id ?? null)
                  : draft.bilibiliAccountId,
              zhihuAccountId:
                platform === "zhihu"
                  ? (draft.zhihuAccountId ?? zhihuAccounts[0]?.id ?? null)
                  : draft.zhihuAccountId,
              platformVariants: variants,
              automationResult: null,
            }
          : draft,
      ),
    );
    setNotice(null);
    setError(null);
  };

  const selectImages = useMutation({
    mutationFn: () =>
      window.desktop.publish.selectImages(Math.max(1, 20 - (selectedDraft?.images.length ?? 0))),
    onSuccess: (images) => {
      if (images.length === 0) return;
      updateSelectedDraft({
        images: [...(selectedDraft?.images ?? []), ...images].slice(0, 20),
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

  const createBilibiliAccount = useMutation({
    mutationFn: () => window.desktop.publish.createBilibiliAccount(),
    onSuccess: (account) => {
      setBilibiliAccounts((current) =>
        current.some((candidate) => candidate.id === account.id)
          ? current.map((candidate) => (candidate.id === account.id ? account : candidate))
          : [...current, account],
      );
      updateSelectedDraft({
        bilibiliAccountId: account.id,
        automationResult: null,
      });
      setNotice(`已识别并保存 B 站账号“${account.name}”`);
      setError(null);
    },
    onError: (reason) => setError(readableError(reason)),
  });

  const deleteBilibiliAccount = useMutation({
    mutationFn: (account: BilibiliAccount) =>
      window.desktop.publish.deleteBilibiliAccount(account.id),
    onSuccess: (accounts, deletedAccount) => {
      const replacementAccountId = accounts[0]?.id ?? null;
      setBilibiliAccounts(accounts);
      setDrafts((current) =>
        current.map((draft) =>
          draft.bilibiliAccountId === deletedAccount.id
            ? {
                ...draft,
                bilibiliAccountId: replacementAccountId,
                automationResult: null,
              }
            : draft,
        ),
      );
      setNotice(`已永久删除 B 站账号“${deletedAccount.name}”的本地登录数据`);
      setError(null);
    },
    onError: (reason) => setError(readableError(reason)),
  });

  const createZhihuAccount = useMutation({
    mutationFn: () => {
      const createAccount = window.desktop.publish.createZhihuAccount;
      if (!createAccount) throw new Error("当前应用版本未加载知乎账号功能");
      return createAccount();
    },
    onSuccess: (account) => {
      setZhihuAccounts((current) =>
        current.some((candidate) => candidate.id === account.id)
          ? current.map((candidate) => (candidate.id === account.id ? account : candidate))
          : [...current, account],
      );
      updateSelectedDraft({
        zhihuAccountId: account.id,
        automationResult: null,
      });
      setNotice(`已识别并保存知乎账号“${account.name}”`);
      setError(null);
    },
    onError: (reason) => setError(readableError(reason)),
  });

  const deleteZhihuAccount = useMutation({
    mutationFn: (account: ZhihuAccount) => {
      const deleteAccount = window.desktop.publish.deleteZhihuAccount;
      if (!deleteAccount) throw new Error("当前应用版本未加载知乎账号功能");
      return deleteAccount(account.id);
    },
    onSuccess: (accounts, deletedAccount) => {
      const replacementAccountId = accounts[0]?.id ?? null;
      setZhihuAccounts(accounts);
      setDrafts((current) =>
        current.map((draft) =>
          draft.zhihuAccountId === deletedAccount.id
            ? {
                ...draft,
                zhihuAccountId: replacementAccountId,
                automationResult: null,
              }
            : draft,
        ),
      );
      setNotice(`已永久删除知乎账号“${deletedAccount.name}”的本地登录数据`);
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

  const busy =
    !draftsLoaded ||
    selectImages.isPending ||
    selectZhihuImage.isPending ||
    openPlatform.isPending ||
    createBilibiliAccount.isPending ||
    deleteBilibiliAccount.isPending ||
    createZhihuAccount.isPending ||
    deleteZhihuAccount.isPending ||
    accountsLoading;

  const addDraft = () => {
    const draft = createDraft();
    setDrafts((current) => [draft, ...current]);
    setSelectedDraftId(draft.id);
    setNotice(null);
    setError(null);
    setClearConfirm(false);
  };

  const beginRenameDraft = (draft: MemoryPublishDraft) => {
    setRenameDraftId(draft.id);
    setRenameDraftValue(draft.title);
    setDeleteDraftId(null);
  };

  const confirmRenameDraft = () => {
    const name = renameDraftValue.trim();
    if (!renameDraftId || !name) return;
    setDrafts((current) =>
      current.map((draft) => {
        if (draft.id !== renameDraftId) return draft;
        return {
          ...draft,
          title: name,
          platformVariants:
            draft.source === "generated" && draft.platform && draft.platformVariants
              ? draft.platformVariants.map((variant) =>
                  variant.platform === draft.platform ? { ...variant, title: name } : variant,
                )
              : draft.platformVariants,
        };
      }),
    );
    setRenameDraftId(null);
    setRenameDraftValue("");
    setDraftMenuId(null);
  };

  const togglePinnedDraft = (draftId: string) => {
    setDrafts((current) =>
      current.map((draft) => (draft.id === draftId ? { ...draft, pinned: !draft.pinned } : draft)),
    );
    setDraftMenuId(null);
  };

  const confirmDeleteDraft = async (draft: MemoryPublishDraft) => {
    await window.desktop.publish.releaseImages(uniqueDraftImageIds(draft));
    const remaining = drafts.filter((entry) => entry.id !== draft.id);
    const nextDrafts = remaining.length > 0 ? remaining : [createDraft()];
    setDrafts(nextDrafts);
    if (selectedDraftId === draft.id) setSelectedDraftId(nextDrafts[0]?.id ?? "");
    setDraftMenuId(null);
    setDeleteDraftId(null);
    setRenameDraftId(null);
    setNotice("草稿已删除，本地原始图片未删除");
    setError(null);
  };

  const removeImage = (image: LocalPublishImage) => {
    updateSelectedDraft({
      images: selectedDraft?.images.filter((entry) => entry.id !== image.id) ?? [],
      automationResult: null,
    });
    void window.desktop.publish.releaseImages([image.id]);
    setNotice("已从当前草稿移除图片；原始文件未删除");
  };

  const updateZhihuBlocks = (blocks: ZhihuContentBlock[]) => {
    updateSelectedDraft({
      zhihuBlocks: blocks,
      content: zhihuBlocksToContent(blocks),
      automationResult: null,
    });
    setNotice(null);
  };

  const removeZhihuBlock = (block: ZhihuContentBlock) => {
    if (!selectedDraft) return;
    const remainingBlocks = (selectedDraft.zhihuBlocks ?? []).filter(
      (entry) => entry.id !== block.id,
    );
    updateZhihuBlocks(
      remainingBlocks.length > 0
        ? remainingBlocks
        : [{ id: crypto.randomUUID(), type: "text", content: "" }],
    );
    if (block.type === "image") {
      updateSelectedDraft({
        images: selectedDraft.images.filter((image) => image.id !== block.imageId),
        automationResult: null,
      });
      void window.desktop.publish.releaseImages([block.imageId]);
      setNotice("已移除知乎插图；原始文件未删除");
    }
  };

  const moveZhihuBlock = (blockIndex: number, offset: -1 | 1) => {
    if (!selectedDraft) return;
    const blocks = [...(selectedDraft.zhihuBlocks ?? [])];
    const targetIndex = blockIndex + offset;
    if (targetIndex < 0 || targetIndex >= blocks.length) return;
    const [block] = blocks.splice(blockIndex, 1);
    if (!block) return;
    blocks.splice(targetIndex, 0, block);
    updateZhihuBlocks(blocks);
  };

  const clearCurrentDraft = async () => {
    if (!selectedDraft) return;
    await window.desktop.publish.releaseImages(selectedDraft.images.map((image) => image.id));
    const generated = selectedDraft.source === "generated";
    updateSelectedDraft({
      title: generated ? selectedDraft.title : "未命名发布草稿",
      platform: generated ? selectedDraft.platform : null,
      bilibiliAccountId: generated ? selectedDraft.bilibiliAccountId : null,
      zhihuAccountId: generated ? selectedDraft.zhihuAccountId : null,
      content: "",
      images: [],
      zhihuBlocks:
        selectedDraft.platform === "zhihu"
          ? [{ id: crypto.randomUUID(), type: "text", content: "" }]
          : undefined,
      source: selectedDraft.source,
      automationResult: null,
    });
    setNotice("当前草稿已清空，原始图片未删除");
    setError(null);
    setClearConfirm(false);
  };

  return (
    <section className="publish-center" aria-label="发布中心" hidden={!open}>
      <header className="publish-center-header">
        <div>
          <strong>发布中心</strong>
          <small>草稿自动保存到当前工作区，重新启动应用后仍会保留</small>
        </div>
        <button type="button" onClick={onClose}>
          返回创作工作区
        </button>
      </header>
      <div className="publish-center-body">
        <aside className="publish-draft-sidebar">
          <button
            type="button"
            className="primary publish-new-draft"
            disabled={busy}
            onClick={addDraft}
          >
            ＋ 新建自由草稿
          </button>
          <nav className="publish-draft-list" aria-label="发布草稿列表">
            {DRAFT_GROUPS.map((group) => {
              const groupDrafts = orderedDrafts.filter((draft) => draft.source === group.source);
              return (
                <section className="publish-draft-group" key={group.source}>
                  <h2>{group.label}</h2>
                  <div className="publish-draft-group-list">
                    {groupDrafts.length === 0 ? <p>{group.emptyLabel}</p> : null}
                    {groupDrafts.map((draft) => (
                      <div
                        key={draft.id}
                        className={`publish-draft-row ${draft.id === selectedDraft?.id ? "active" : ""}`}
                      >
                        {renameDraftId === draft.id ? (
                          <form
                            className="publish-draft-rename"
                            onSubmit={(event) => {
                              event.preventDefault();
                              confirmRenameDraft();
                            }}
                          >
                            <input
                              value={renameDraftValue}
                              maxLength={80}
                              aria-label="新的草稿名称"
                              onChange={(event) => setRenameDraftValue(event.target.value)}
                            />
                            <button type="submit" disabled={!renameDraftValue.trim()}>
                              保存
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setRenameDraftId(null);
                                setRenameDraftValue("");
                                setDraftMenuId(null);
                              }}
                            >
                              取消
                            </button>
                          </form>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="publish-draft-select"
                              title={draft.pinned ? `${draft.title}（已置顶）` : draft.title}
                              onClick={() => {
                                setSelectedDraftId(draft.id);
                                setDraftMenuId(null);
                                setNotice(null);
                                setError(null);
                                setClearConfirm(false);
                              }}
                            >
                              <strong>{draft.title}</strong>
                            </button>
                            <button
                              type="button"
                              className="publish-draft-menu-trigger"
                              aria-label={`打开草稿“${draft.title}”的操作菜单`}
                              aria-expanded={draftMenuId === draft.id}
                              onClick={() => {
                                setDraftMenuId((current) =>
                                  current === draft.id ? null : draft.id,
                                );
                                setDeleteDraftId(null);
                              }}
                            >
                              ···
                            </button>
                            {draftMenuId === draft.id ? (
                              <div className="publish-draft-menu">
                                {deleteDraftId === draft.id ? (
                                  <>
                                    <strong>确定删除这份草稿？</strong>
                                    <button type="button" onClick={() => setDeleteDraftId(null)}>
                                      取消
                                    </button>
                                    <button
                                      type="button"
                                      className="danger"
                                      onClick={() => void confirmDeleteDraft(draft)}
                                    >
                                      确认删除
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <button type="button" onClick={() => beginRenameDraft(draft)}>
                                      重命名
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => togglePinnedDraft(draft.id)}
                                    >
                                      {draft.pinned ? "取消置顶" : "置顶"}
                                    </button>
                                    <button
                                      type="button"
                                      className="danger"
                                      onClick={() => setDeleteDraftId(draft.id)}
                                    >
                                      删除
                                    </button>
                                  </>
                                )}
                              </div>
                            ) : null}
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
          </nav>
        </aside>
        <main className="publish-editor">
          {selectedDraft ? (
            <>
              <div className="publish-editor-heading">
                <div>
                  <strong>编辑发布内容</strong>
                  <small>编辑内容和图片选择会自动保存到当前工作区</small>
                </div>
                <span
                  className={`publish-draft-status ${
                    selectedDraft.platform && selectedDraft.content.trim() ? "ready" : "draft"
                  }`}
                >
                  {selectedDraft.platform && selectedDraft.content.trim() ? "可进入填充" : "编辑中"}
                </span>
              </div>
              <label>
                草稿名称
                <input
                  value={selectedDraft.title}
                  maxLength={80}
                  onChange={(event) => {
                    updateSelectedDraft({ title: event.target.value });
                    setNotice(null);
                  }}
                />
              </label>
              {selectedDraft.source === "generated" ? (
                selectedDraft.platformVariants && selectedDraft.platformVariants.length > 1 ? (
                  <label>
                    目标平台
                    <select
                      value={selectedDraft.platform ?? ""}
                      onChange={(event) => switchGeneratedPlatform(event.target.value as Platform)}
                    >
                      {selectedDraft.platformVariants.map((variant) => (
                        <option key={variant.platform} value={variant.platform}>
                          {PLATFORM_LABELS[variant.platform]}
                        </option>
                      ))}
                    </select>
                    <small>切换平台会显示对应版本，已做的修改会分别保留</small>
                  </label>
                ) : (
                  <div className="publish-platform-field">
                    <span>目标平台</span>
                    <div className="publish-platform-fixed">
                      <strong>
                        {selectedDraft.platform
                          ? PLATFORM_LABELS[selectedDraft.platform]
                          : "未记录目标平台"}
                      </strong>
                      <small>由 Agent 内容流程确定</small>
                    </div>
                  </div>
                )
              ) : (
                <label>
                  目标平台
                  <select
                    value={selectedDraft.platform ?? ""}
                    onChange={(event) => {
                      const platform = (event.target.value || null) as Platform | null;
                      updateSelectedDraft({
                        platform,
                        bilibiliAccountId:
                          platform === "bilibili"
                            ? (selectedDraft.bilibiliAccountId ?? bilibiliAccounts[0]?.id ?? null)
                            : null,
                        zhihuAccountId:
                          platform === "zhihu"
                            ? (selectedDraft.zhihuAccountId ?? zhihuAccounts[0]?.id ?? null)
                            : null,
                        zhihuBlocks:
                          platform === "zhihu"
                            ? (selectedDraft.zhihuBlocks ??
                              legacyZhihuBlocks(selectedDraft.content, selectedDraft.images))
                            : selectedDraft.zhihuBlocks,
                        automationResult: null,
                      });
                      setNotice(null);
                    }}
                  >
                    <option value="">请选择平台</option>
                    {Object.entries(PLATFORM_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {selectedDraft.platform === "bilibili" ? (
                <div className="publish-account-setting">
                  <label>
                    发布账号
                    <span className="publish-account-control">
                      <select
                        value={selectedDraft.bilibiliAccountId ?? ""}
                        disabled={
                          accountsLoading ||
                          createBilibiliAccount.isPending ||
                          deleteBilibiliAccount.isPending
                        }
                        onChange={(event) => {
                          const value = event.target.value;
                          if (value === NEW_BILIBILI_ACCOUNT_VALUE) {
                            createBilibiliAccount.mutate();
                            setNotice("已打开全新的 B 站登录环境，登录成功后会自动加入账号列表");
                            setError(null);
                            return;
                          }
                          updateSelectedDraft({
                            bilibiliAccountId: value || null,
                            automationResult: null,
                          });
                          setNotice(null);
                          setError(null);
                        }}
                      >
                        {bilibiliAccounts.length === 0 ? (
                          <option value="">暂无已记录账号</option>
                        ) : null}
                        {bilibiliAccounts.map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.name}
                          </option>
                        ))}
                        <option value={NEW_BILIBILI_ACCOUNT_VALUE}>＋ 使用新账号</option>
                      </select>
                      <button
                        type="button"
                        disabled={
                          bilibiliAccounts.length <= 1 ||
                          !selectedDraft.bilibiliAccountId ||
                          deleteBilibiliAccount.isPending
                        }
                        onClick={() => {
                          const account = bilibiliAccounts.find(
                            (candidate) => candidate.id === selectedDraft.bilibiliAccountId,
                          );
                          if (
                            !account ||
                            !window.confirm(
                              `确定永久删除 B 站账号“${account.name}”吗？该账号的本地 Cookie 和 Session 将无法恢复。`,
                            )
                          ) {
                            return;
                          }
                          deleteBilibiliAccount.mutate(account);
                        }}
                      >
                        {deleteBilibiliAccount.isPending ? "正在删除…" : "删除当前账号"}
                      </button>
                    </span>
                    <small>已有账号复用各自登录状态；使用新账号会打开完全空白的登录环境</small>
                  </label>
                  {createBilibiliAccount.isPending ? (
                    <small className="publish-account-login-status">
                      正在等待新账号登录；只有识别到用户名后才会保存
                    </small>
                  ) : null}
                </div>
              ) : null}
              {selectedDraft.platform === "zhihu" ? (
                <div className="publish-account-setting">
                  <label>
                    发布账号
                    <span className="publish-account-control">
                      <select
                        value={selectedDraft.zhihuAccountId ?? ""}
                        disabled={
                          accountsLoading ||
                          createZhihuAccount.isPending ||
                          deleteZhihuAccount.isPending
                        }
                        onChange={(event) => {
                          const value = event.target.value;
                          if (value === NEW_ZHIHU_ACCOUNT_VALUE) {
                            createZhihuAccount.mutate();
                            setNotice("已打开全新的知乎登录环境，登录成功后会自动加入账号列表");
                            setError(null);
                            return;
                          }
                          updateSelectedDraft({
                            zhihuAccountId: value || null,
                            automationResult: null,
                          });
                          setNotice(null);
                          setError(null);
                        }}
                      >
                        {zhihuAccounts.length === 0 ? (
                          <option value="">暂无已记录账号</option>
                        ) : null}
                        {zhihuAccounts.map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.name}
                          </option>
                        ))}
                        <option value={NEW_ZHIHU_ACCOUNT_VALUE}>＋ 使用新账号</option>
                      </select>
                      <button
                        type="button"
                        disabled={!selectedDraft.zhihuAccountId || deleteZhihuAccount.isPending}
                        onClick={() => {
                          const account = zhihuAccounts.find(
                            (candidate) => candidate.id === selectedDraft.zhihuAccountId,
                          );
                          if (
                            !account ||
                            !window.confirm(
                              `确定永久删除知乎账号“${account.name}”吗？该账号的本地 Cookie 和 Session 将无法恢复。`,
                            )
                          ) {
                            return;
                          }
                          deleteZhihuAccount.mutate(account);
                        }}
                      >
                        {deleteZhihuAccount.isPending ? "正在删除…" : "删除当前账号"}
                      </button>
                    </span>
                    <small>已有账号复用各自登录状态；使用新账号会打开完全空白的登录环境</small>
                  </label>
                  {createZhihuAccount.isPending ? (
                    <small className="publish-account-login-status">
                      正在等待新账号登录；只有识别到用户名后才会保存
                    </small>
                  ) : null}
                </div>
              ) : null}
              <div className="publish-auto-setting">
                <span>
                  <strong>自动发布</strong>
                  <small>
                    {!selectedDraft.platform
                      ? "请先选择平台；默认关闭"
                      : selectedDraft.platform === "zhihu"
                        ? "知乎填充完成后固定停在发布操作之前"
                        : autoPublishByPlatform[selectedDraft.platform]
                          ? `填充完成后将自动点击${PLATFORM_LABELS[selectedDraft.platform]}的发布按钮`
                          : "默认关闭；填充后停在发布按钮前，由你检查并手动发布"}
                  </small>
                </span>
                <label className="publish-auto-switch">
                  <input
                    type="checkbox"
                    disabled={!selectedDraft.platform || selectedDraft.platform === "zhihu"}
                    checked={
                      selectedDraft.platform ? autoPublishByPlatform[selectedDraft.platform] : false
                    }
                    onChange={(event) => {
                      const platform = selectedDraft.platform;
                      if (!platform || platform === "zhihu") return;
                      const enabled = event.target.checked;
                      if (
                        enabled &&
                        !window.confirm(
                          `开启后，填充完成将直接点击${PLATFORM_LABELS[platform]}的发布按钮，不再等待手动确认。确定开启吗？`,
                        )
                      ) {
                        return;
                      }
                      setAutoPublishByPlatform((current) => ({
                        ...current,
                        [platform]: enabled,
                      }));
                    }}
                  />
                  <span aria-hidden="true" />
                  <em>
                    {selectedDraft.platform &&
                    selectedDraft.platform !== "zhihu" &&
                    autoPublishByPlatform[selectedDraft.platform]
                      ? "已开启"
                      : "已关闭"}
                  </em>
                </label>
              </div>
              {selectedDraft.platform === "zhihu" ? (
                <section className="publish-zhihu-editor" aria-labelledby="publish-zhihu-title">
                  <header>
                    <div>
                      <strong id="publish-zhihu-title">知乎文章结构</strong>
                      <small>段落与图片会按这里的顺序填入；图片注释为可选项</small>
                    </div>
                    <span>{selectedDraft.images.length}/20 张图片</span>
                  </header>
                  <div className="publish-zhihu-blocks">
                    {(selectedDraft.zhihuBlocks ?? []).map((block, blockIndex, blocks) => {
                      const image =
                        block.type === "image"
                          ? selectedDraft.images.find((entry) => entry.id === block.imageId)
                          : null;
                      return (
                        <div className="publish-zhihu-block-row" key={block.id}>
                          <button
                            type="button"
                            className="publish-zhihu-insert"
                            disabled={busy || selectedDraft.images.length >= 20}
                            onClick={() => selectZhihuImage.mutate(blockIndex)}
                          >
                            ＋ 在此处插入图片
                          </button>
                          <article className={`publish-zhihu-block ${block.type}`}>
                            <header>
                              <strong>
                                {block.type === "text" ? "文字段落" : (image?.name ?? "本地图片")}
                              </strong>
                              <span>
                                <button
                                  type="button"
                                  disabled={busy || blockIndex === 0}
                                  onClick={() => moveZhihuBlock(blockIndex, -1)}
                                >
                                  上移
                                </button>
                                <button
                                  type="button"
                                  disabled={busy || blockIndex === blocks.length - 1}
                                  onClick={() => moveZhihuBlock(blockIndex, 1)}
                                >
                                  下移
                                </button>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => removeZhihuBlock(block)}
                                >
                                  移除
                                </button>
                              </span>
                            </header>
                            {block.type === "text" ? (
                              <textarea
                                value={block.content}
                                maxLength={100_000}
                                placeholder="输入这一段正文…"
                                onChange={(event) =>
                                  updateZhihuBlocks(
                                    blocks.map((entry) =>
                                      entry.id === block.id && entry.type === "text"
                                        ? { ...entry, content: event.target.value }
                                        : entry,
                                    ),
                                  )
                                }
                              />
                            ) : (
                              <div className="publish-zhihu-image-block">
                                {image ? <img src={image.previewUrl} alt="" /> : null}
                                <label>
                                  图片注释（可选）
                                  <textarea
                                    value={block.caption}
                                    maxLength={140}
                                    placeholder="添加图片注释，不超过 140 字…"
                                    onChange={(event) =>
                                      updateZhihuBlocks(
                                        blocks.map((entry) =>
                                          entry.id === block.id && entry.type === "image"
                                            ? { ...entry, caption: event.target.value }
                                            : entry,
                                        ),
                                      )
                                    }
                                  />
                                  <small>{block.caption.length}/140</small>
                                </label>
                              </div>
                            )}
                          </article>
                        </div>
                      );
                    })}
                    <button
                      type="button"
                      className="publish-zhihu-insert"
                      disabled={busy || selectedDraft.images.length >= 20}
                      onClick={() =>
                        selectZhihuImage.mutate((selectedDraft.zhihuBlocks ?? []).length)
                      }
                    >
                      ＋ 在末尾插入图片
                    </button>
                    <button
                      type="button"
                      className="publish-zhihu-add-text"
                      disabled={busy}
                      onClick={() => {
                        const blocks = [
                          ...(selectedDraft.zhihuBlocks ??
                            legacyZhihuBlocks(selectedDraft.content, selectedDraft.images)),
                          { id: crypto.randomUUID(), type: "text" as const, content: "" },
                        ];
                        updateZhihuBlocks(blocks);
                      }}
                    >
                      ＋ 新增文字段落
                    </button>
                  </div>
                </section>
              ) : (
                <>
                  <label className="publish-content-field">
                    推文内容
                    <textarea
                      value={selectedDraft.content}
                      maxLength={100_000}
                      placeholder="可以直接输入任何想发布的内容…"
                      onChange={(event) => {
                        updateSelectedDraft({
                          content: event.target.value,
                          automationResult: null,
                        });
                        setNotice(null);
                      }}
                    />
                    <small>{selectedDraft.content.length.toLocaleString()} 字</small>
                  </label>
                  <section className="publish-assets" aria-labelledby="publish-assets-title">
                    <header>
                      <div>
                        <strong id="publish-assets-title">本地配图</strong>
                        <small>图片会在正文之后统一上传，只记录原始路径和名称</small>
                      </div>
                      <button
                        type="button"
                        disabled={busy || selectedDraft.images.length >= 20}
                        onClick={() => selectImages.mutate()}
                      >
                        选择本地图片
                      </button>
                    </header>
                    <div className="publish-asset-list">
                      {selectedDraft.images.map((image, index) => (
                        <div key={image.id} className="publish-image-item">
                          <img src={image.previewUrl} alt="" />
                          <span>
                            <strong>
                              {index + 1}. {image.name}
                            </strong>
                            <small title={image.path}>{image.path}</small>
                          </span>
                          <button
                            type="button"
                            aria-label={`移除配图“${image.name}”`}
                            disabled={busy}
                            onClick={() => removeImage(image)}
                          >
                            移除
                          </button>
                        </div>
                      ))}
                      {selectedDraft.images.length === 0 ? <p>尚未选择配图</p> : null}
                    </div>
                  </section>
                </>
              )}
              {error ? (
                <p className="publish-editor-error" role="alert">
                  {error}
                </p>
              ) : null}
              {notice ? <p className="publish-editor-notice">{notice}</p> : null}
              <div
                className={`publish-automation-result ${selectedDraft.automationResult?.state ?? "empty"}`}
                aria-live="polite"
              >
                {selectedDraft.automationResult ? (
                  <>
                    <strong>
                      {selectedDraft.automationResult.state === "published"
                        ? "已自动发布"
                        : "已完成自动填充"}
                    </strong>
                    <p>{selectedDraft.automationResult.message}</p>
                  </>
                ) : null}
              </div>
              <footer className="publish-editor-actions">
                {clearConfirm ? (
                  <span className="publish-clear-confirm">
                    <span>确定清空当前草稿？原始图片不会删除。</span>
                    <button type="button" onClick={() => setClearConfirm(false)}>
                      取消
                    </button>
                    <button type="button" onClick={() => void clearCurrentDraft()}>
                      确认清空
                    </button>
                  </span>
                ) : (
                  <button type="button" disabled={busy} onClick={() => setClearConfirm(true)}>
                    清除当前草稿
                  </button>
                )}
                <button
                  type="button"
                  className="primary"
                  disabled={
                    busy ||
                    !(
                      (selectedDraft.platform === "bilibili" &&
                        Boolean(selectedDraft.bilibiliAccountId)) ||
                      (selectedDraft.platform === "zhihu" && Boolean(selectedDraft.zhihuAccountId))
                    ) ||
                    !selectedDraft.content.trim()
                  }
                  title={
                    selectedDraft.platform === "bilibili"
                      ? autoPublishByPlatform.bilibili
                        ? "打开持久登录的平台窗口，完成填充后自动点击发布"
                        : "打开持久登录的平台窗口并填充，最终发布由你确认"
                      : selectedDraft.platform === "zhihu"
                        ? "打开知乎写文章页面，填入标题、正文和本地配图"
                        : "当前平台尚未接入填充"
                  }
                  onClick={() => openPlatform.mutate()}
                >
                  {openPlatform.isPending ? "正在打开并填充…" : "一键填充到平台"}
                </button>
                <small>
                  {selectedDraft.platform === "zhihu"
                    ? "知乎内容填充完成后会停在发布操作之前，由你检查并手动确认。"
                    : selectedDraft.platform && autoPublishByPlatform[selectedDraft.platform]
                      ? "自动发布已开启：填充完成后程序会直接点击平台发布按钮。"
                      : "自动发布已关闭：程序会停在最终发布按钮前，由你检查并手动确认。"}
                </small>
              </footer>
            </>
          ) : null}
        </main>
      </div>
    </section>
  );
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
