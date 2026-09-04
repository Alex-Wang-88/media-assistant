import type { LocalPublishImage, Platform, ZhihuContentBlock } from "@yoom/desktop-contracts";
import { useState } from "react";
import { PlainContentEditor } from "./publish/PlainContentEditor";
import { PlatformAccountSelector } from "./publish/PlatformAccountSelector";
import { PublishDraftSidebar } from "./publish/PublishDraftSidebar";
import { PLATFORM_LABELS, PUBLISH_PLATFORMS } from "./publish/platforms";
import {
  createDraft,
  legacyZhihuBlocks,
  type MemoryPublishDraft,
  NEW_BILIBILI_ACCOUNT_VALUE,
  NEW_X_ACCOUNT_VALUE,
  NEW_ZHIHU_ACCOUNT_VALUE,
  type PublishCenterSeed,
  uniqueDraftImageIds,
  xDraftTitle,
  zhihuBlocksToContent,
} from "./publish/publish-draft-model";
import { usePlatformAccounts } from "./publish/usePlatformAccounts";
import { usePublishAutomation } from "./publish/usePublishAutomation";
import { usePublishDrafts } from "./publish/usePublishDrafts";
import { ZhihuBlockEditor } from "./publish/ZhihuBlockEditor";

export type { PublishCenterSeed } from "./publish/publish-draft-model";

type PublishCenterProps = {
  open: boolean;
  workspacePath: string | null;
  seed: PublishCenterSeed[] | null;
  onSeedConsumed(): void;
  onClose(): void;
};

export function PublishCenter({
  open,
  workspacePath,
  seed,
  onSeedConsumed,
  onClose,
}: PublishCenterProps) {
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clearConfirm, setClearConfirm] = useState(false);
  const {
    drafts,
    setDrafts,
    selectedDraftId,
    setSelectedDraftId,
    autoPublishByPlatform,
    setAutoPublishByPlatform,
    draftsLoaded,
  } = usePublishDrafts({
    workspacePath,
    seed,
    onSeedConsumed,
    onNotice: setNotice,
    onError: setError,
    onClearConfirm: setClearConfirm,
  });
  const [draftMenuId, setDraftMenuId] = useState<string | null>(null);
  const [renameDraftId, setRenameDraftId] = useState<string | null>(null);
  const [renameDraftValue, setRenameDraftValue] = useState("");
  const [deleteDraftId, setDeleteDraftId] = useState<string | null>(null);
  const selectedDraft = drafts.find((draft) => draft.id === selectedDraftId) ?? drafts[0] ?? null;
  const orderedDrafts = [
    ...drafts.filter((draft) => draft.pinned),
    ...drafts.filter((draft) => !draft.pinned),
  ];
  const selectedPlatformDefinition = selectedDraft?.platform
    ? PUBLISH_PLATFORMS[selectedDraft.platform]
    : null;
  const selectedPlatformAccountReady =
    (selectedDraft?.platform === "bilibili" && Boolean(selectedDraft.bilibiliAccountId)) ||
    (selectedDraft?.platform === "zhihu" && Boolean(selectedDraft.zhihuAccountId)) ||
    (selectedDraft?.platform === "x" && Boolean(selectedDraft.xAccountId));
  const updateSelectedDraft = (patch: Partial<MemoryPublishDraft>) => {
    if (!selectedDraft) return;
    setDrafts((current) =>
      current.map((draft) => {
        if (draft.id !== selectedDraft.id) return draft;
        const mergedDraft = { ...draft, ...patch };
        const nextDraft =
          mergedDraft.platform === "x"
            ? { ...mergedDraft, title: xDraftTitle(mergedDraft.content) }
            : mergedDraft;
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
                  title: nextDraft.title,
                  content: nextDraft.content,
                  images: nextDraft.images,
                  zhihuBlocks: nextDraft.zhihuBlocks,
                }
              : variant,
          ),
        };
      }),
    );
  };

  const {
    bilibiliAccounts,
    zhihuAccounts,
    xAccounts,
    accountsLoading,
    refreshPlatformAccounts,
    createBilibiliAccount,
    deleteBilibiliAccount,
    createZhihuAccount,
    deleteZhihuAccount,
    createXAccount,
    deleteXAccount,
  } = usePlatformAccounts({
    open,
    setDrafts,
    updateSelectedDraft,
    setNotice,
    setError,
  });
  const selectedXUsesApi =
    selectedDraft?.platform === "x" &&
    xAccounts.find((account) => account.id === selectedDraft.xAccountId)?.mode === "api";

  const { selectImages, selectZhihuImage, openPlatform } = usePublishAutomation({
    selectedDraft,
    autoPublishByPlatform,
    updateSelectedDraft,
    refreshPlatformAccounts,
    setNotice,
    setError,
  });

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
    const nextTitle = platform === "x" ? xDraftTitle(nextVariant.content) : nextVariant.title;
    const nextVariants = variants.map((variant) =>
      variant.platform === platform ? { ...variant, title: nextTitle } : variant,
    );
    setDrafts((current) =>
      current.map((draft) =>
        draft.id === selectedDraft.id
          ? {
              ...draft,
              platform,
              title: nextTitle,
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
              xAccountId:
                platform === "x"
                  ? (draft.xAccountId ?? xAccounts[0]?.id ?? null)
                  : draft.xAccountId,
              platformVariants: nextVariants,
              automationResult: null,
            }
          : draft,
      ),
    );
    setNotice(null);
    setError(null);
  };

  const busy =
    !draftsLoaded ||
    selectImages.isPending ||
    selectZhihuImage.isPending ||
    openPlatform.isPending ||
    createBilibiliAccount.isPending ||
    deleteBilibiliAccount.isPending ||
    createZhihuAccount.isPending ||
    deleteZhihuAccount.isPending ||
    createXAccount.isPending ||
    deleteXAccount.isPending ||
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
      xAccountId: generated ? selectedDraft.xAccountId : null,
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
    <section className="publish-center" aria-label="草稿区" hidden={!open}>
      <header className="publish-center-header">
        <div>
          <strong>草稿区</strong>
          <small>草稿自动保存到当前工作区，重新启动应用后仍会保留</small>
        </div>
        <button type="button" onClick={onClose}>
          返回创作工作区
        </button>
      </header>
      <div className="publish-center-body">
        <PublishDraftSidebar
          drafts={orderedDrafts}
          selectedDraftId={selectedDraft?.id ?? ""}
          busy={busy}
          draftMenuId={draftMenuId}
          renameDraftId={renameDraftId}
          renameDraftValue={renameDraftValue}
          deleteDraftId={deleteDraftId}
          onAdd={addDraft}
          onSelect={(draftId) => {
            setSelectedDraftId(draftId);
            setDraftMenuId(null);
            setNotice(null);
            setError(null);
            setClearConfirm(false);
          }}
          onToggleMenu={(draftId) => {
            setDraftMenuId((current) => (current === draftId ? null : draftId));
            setDeleteDraftId(null);
          }}
          onRenameValueChange={setRenameDraftValue}
          onBeginRename={beginRenameDraft}
          onCancelRename={() => {
            setRenameDraftId(null);
            setRenameDraftValue("");
            setDraftMenuId(null);
          }}
          onConfirmRename={confirmRenameDraft}
          onTogglePinned={togglePinnedDraft}
          onRequestDelete={setDeleteDraftId}
          onCancelDelete={() => setDeleteDraftId(null)}
          onConfirmDelete={(draft) => void confirmDeleteDraft(draft)}
        />
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
              {selectedDraft.platform !== "x" ? (
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
              ) : null}
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
                        xAccountId:
                          platform === "x"
                            ? (selectedDraft.xAccountId ?? xAccounts[0]?.id ?? null)
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
                <PlatformAccountSelector
                  platformLabel="B 站"
                  accounts={bilibiliAccounts}
                  selectedAccountId={selectedDraft.bilibiliAccountId}
                  newAccountValue={NEW_BILIBILI_ACCOUNT_VALUE}
                  busy={accountsLoading}
                  creating={createBilibiliAccount.isPending}
                  deleting={deleteBilibiliAccount.isPending}
                  keepAtLeastOne
                  onCreate={() => {
                    createBilibiliAccount.mutate();
                    setNotice("已打开全新的 B 站登录环境，登录成功后会自动加入账号列表");
                    setError(null);
                  }}
                  onSelect={(accountId) => {
                    updateSelectedDraft({ bilibiliAccountId: accountId, automationResult: null });
                    setNotice(null);
                    setError(null);
                  }}
                  onDelete={(account) => deleteBilibiliAccount.mutate(account)}
                />
              ) : null}
              {selectedDraft.platform === "zhihu" ? (
                <PlatformAccountSelector
                  platformLabel="知乎"
                  accounts={zhihuAccounts}
                  selectedAccountId={selectedDraft.zhihuAccountId ?? null}
                  newAccountValue={NEW_ZHIHU_ACCOUNT_VALUE}
                  busy={accountsLoading}
                  creating={createZhihuAccount.isPending}
                  deleting={deleteZhihuAccount.isPending}
                  keepAtLeastOne={false}
                  onCreate={() => {
                    createZhihuAccount.mutate();
                    setNotice("已打开全新的知乎登录环境，登录成功后会自动加入账号列表");
                    setError(null);
                  }}
                  onSelect={(accountId) => {
                    updateSelectedDraft({ zhihuAccountId: accountId, automationResult: null });
                    setNotice(null);
                    setError(null);
                  }}
                  onDelete={(account) => deleteZhihuAccount.mutate(account)}
                />
              ) : null}
              {selectedDraft.platform === "x" ? (
                <PlatformAccountSelector
                  platformLabel="X"
                  accounts={xAccounts}
                  selectedAccountId={selectedDraft.xAccountId ?? null}
                  newAccountValue={NEW_X_ACCOUNT_VALUE}
                  busy={accountsLoading}
                  creating={createXAccount.isPending}
                  deleting={deleteXAccount.isPending}
                  keepAtLeastOne={false}
                  onCreate={() => {
                    createXAccount.mutate();
                    setNotice(
                      "已发起 X 授权；配置 OAuth 后会在系统浏览器中打开并可使用 Google 登录",
                    );
                    setError(null);
                  }}
                  onSelect={(accountId) => {
                    updateSelectedDraft({ xAccountId: accountId, automationResult: null });
                    setNotice(null);
                    setError(null);
                  }}
                  onDelete={(account) => deleteXAccount.mutate(account)}
                />
              ) : null}
              <div className="publish-auto-setting">
                <span>
                  <strong>自动发布</strong>
                  <small>
                    {!selectedDraft.platform
                      ? "请先选择平台；默认关闭"
                      : !PUBLISH_PLATFORMS[selectedDraft.platform].supportsAutoPublish
                        ? `${PLATFORM_LABELS[selectedDraft.platform]}填充完成后固定停在发布操作之前`
                        : selectedXUsesApi
                          ? autoPublishByPlatform.x
                            ? "点击发布按钮后将直接通过 X API 发布"
                            : "通过 X API 发布；点击发布按钮后会再次要求确认"
                          : autoPublishByPlatform[selectedDraft.platform]
                            ? `填充完成后将自动点击${PLATFORM_LABELS[selectedDraft.platform]}的发布按钮`
                            : "默认关闭；填充后停在发布按钮前，由你检查并手动发布"}
                  </small>
                </span>
                <label className="publish-auto-switch">
                  <input
                    type="checkbox"
                    disabled={
                      !selectedDraft.platform ||
                      !PUBLISH_PLATFORMS[selectedDraft.platform].supportsAutoPublish
                    }
                    checked={
                      selectedDraft.platform ? autoPublishByPlatform[selectedDraft.platform] : false
                    }
                    onChange={(event) => {
                      const platform = selectedDraft.platform;
                      if (!platform || !PUBLISH_PLATFORMS[platform].supportsAutoPublish) return;
                      const enabled = event.target.checked;
                      if (
                        enabled &&
                        !window.confirm(
                          selectedXUsesApi
                            ? "开启后，点击发布按钮会直接通过 X API 发布，不再进行二次确认。确定开启吗？"
                            : `开启后，填充完成将直接点击${PLATFORM_LABELS[platform]}的发布按钮，不再等待手动确认。确定开启吗？`,
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
                    PUBLISH_PLATFORMS[selectedDraft.platform].supportsAutoPublish &&
                    autoPublishByPlatform[selectedDraft.platform]
                      ? "已开启"
                      : "已关闭"}
                  </em>
                </label>
              </div>
              {selectedDraft.platform === "zhihu" ? (
                <ZhihuBlockEditor
                  draft={selectedDraft}
                  busy={busy}
                  onInsertImage={(index) => selectZhihuImage.mutate(index)}
                  onMoveBlock={moveZhihuBlock}
                  onRemoveBlock={removeZhihuBlock}
                  onUpdateBlocks={updateZhihuBlocks}
                  onAddTextBlock={() => {
                    const blocks = [
                      ...(selectedDraft.zhihuBlocks ??
                        legacyZhihuBlocks(selectedDraft.content, selectedDraft.images)),
                      { id: crypto.randomUUID(), type: "text" as const, content: "" },
                    ];
                    updateZhihuBlocks(blocks);
                  }}
                />
              ) : (
                <PlainContentEditor
                  content={selectedDraft.content}
                  images={selectedDraft.images}
                  busy={busy}
                  maxImages={selectedDraft.platform === "x" ? 4 : 20}
                  onContentChange={(content) => {
                    updateSelectedDraft({ content, automationResult: null });
                    setNotice(null);
                  }}
                  onSelectImages={() => selectImages.mutate()}
                  onRemoveImage={removeImage}
                />
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
                    !selectedPlatformDefinition?.supportsFill ||
                    !selectedPlatformAccountReady ||
                    !selectedDraft.content.trim()
                  }
                  title={
                    selectedDraft.platform === "bilibili"
                      ? autoPublishByPlatform.bilibili
                        ? "打开持久登录的平台窗口，完成填充后自动点击发布"
                        : "打开持久登录的平台窗口并填充，最终发布由你确认"
                      : selectedDraft.platform === "zhihu"
                        ? "打开知乎写文章页面，填入标题、正文和本地配图"
                        : selectedDraft.platform === "x"
                          ? autoPublishByPlatform.x
                            ? "通过 X API 直接发布正文和最多 4 张配图"
                            : selectedXUsesApi
                              ? "确认后通过 X API 发布正文和最多 4 张配图"
                              : "打开 X 发帖页面并填入正文和最多 4 张配图"
                          : "当前平台尚未接入填充"
                  }
                  onClick={() => {
                    if (
                      selectedXUsesApi &&
                      !autoPublishByPlatform.x &&
                      !window.confirm("将通过 X API 直接发布当前正文和配图，确定继续吗？")
                    ) {
                      return;
                    }
                    openPlatform.mutate();
                  }}
                >
                  {openPlatform.isPending
                    ? selectedXUsesApi
                      ? "正在通过 X API 发布…"
                      : "正在打开并填充…"
                    : selectedXUsesApi
                      ? "发布到 X"
                      : "一键填充到平台"}
                </button>
                <small>
                  {selectedXUsesApi
                    ? autoPublishByPlatform.x
                      ? "自动发布已开启：点击按钮后会直接通过 X API 发布。"
                      : "X API 发布会在点击按钮后再次确认；开启自动发布可跳过该确认。"
                    : selectedDraft.platform === "zhihu"
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
