import { useMutation } from "@tanstack/react-query";
import type {
  BilibiliAccount,
  LocalPublishImage,
  Platform,
  PublishAutomationResult,
  PublishDraft,
  PublishDraftState,
} from "@yoom/desktop-contracts";
import { useEffect, useState } from "react";

const NEW_BILIBILI_ACCOUNT_VALUE = "__new_bilibili_account__";

const PLATFORM_LABELS: Record<Platform, string> = {
  wechat: "微信公众号",
  toutiao: "今日头条",
  zhihu: "知乎",
  weibo: "微博",
  bilibili: "哔哩哔哩",
  xiaohongshu: "小红书",
};

export type PublishCenterSeed = {
  key: string;
  title: string;
  content: string;
};

type MemoryPublishDraft = PublishDraft & {
  automationResult: PublishAutomationResult | null;
};

type PublishCenterProps = {
  open: boolean;
  workspacePath: string | null;
  seed: PublishCenterSeed | null;
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
    content: "",
    images: [],
    source: "manual",
    pinned: false,
    automationResult: null,
    ...patch,
  };
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

  useEffect(() => {
    if (!seed || !draftsLoaded) return;
    const draft = createDraft({
      title: seed.title || "Agent 生成内容",
      content: seed.content,
      source: "generated",
    });
    setDrafts((current) => [draft, ...current]);
    setSelectedDraftId(draft.id);
    setNotice("生成内容已转入当前内存草稿");
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
        const restoredDrafts = state?.drafts.map((draft) => ({
          ...draft,
          automationResult: null,
        }));
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
    let cancelled = false;
    setAccountsLoading(true);
    window.desktop.publish
      .listBilibiliAccounts()
      .then((accounts) => {
        if (cancelled) return;
        setBilibiliAccounts(accounts);
        const defaultAccountId = accounts[0]?.id ?? null;
        setDrafts((current) =>
          current.map((draft) =>
            draft.platform === "bilibili" && !draft.bilibiliAccountId
              ? { ...draft, bilibiliAccountId: defaultAccountId }
              : draft,
          ),
        );
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(readableError(reason));
      })
      .finally(() => {
        if (!cancelled) setAccountsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const updateSelectedDraft = (patch: Partial<MemoryPublishDraft>) => {
    if (!selectedDraft) return;
    setDrafts((current) =>
      current.map((draft) => (draft.id === selectedDraft.id ? { ...draft, ...patch } : draft)),
    );
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

  const openPlatform = useMutation({
    mutationFn: () => {
      if (!selectedDraft) throw new Error("请先新建或选择一个草稿");
      if (selectedDraft.platform !== "bilibili") {
        throw new Error("当前只接入了哔哩哔哩自动填充");
      }
      if (!selectedDraft.bilibiliAccountId) {
        throw new Error("请先选择 B 站发布账号");
      }
      return window.desktop.publish.openBilibili({
        accountId: selectedDraft.bilibiliAccountId,
        title: selectedDraft.title,
        content: selectedDraft.content,
        imageIds: selectedDraft.images.map((image) => image.id),
        autoPublish: autoPublishByPlatform.bilibili,
      });
    },
    onSuccess: (result) => {
      const completed = result.state === "filled" || result.state === "published";
      updateSelectedDraft({ automationResult: completed ? result : null });
      setNotice(null);
      setError(completed ? null : result.message);
    },
    onError: (reason) => setError(readableError(reason)),
  });

  const busy =
    !draftsLoaded ||
    selectImages.isPending ||
    openPlatform.isPending ||
    createBilibiliAccount.isPending ||
    deleteBilibiliAccount.isPending ||
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
      current.map((draft) => (draft.id === renameDraftId ? { ...draft, title: name } : draft)),
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
    await window.desktop.publish.releaseImages(draft.images.map((image) => image.id));
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

  const clearCurrentDraft = async () => {
    if (!selectedDraft) return;
    await window.desktop.publish.releaseImages(selectedDraft.images.map((image) => image.id));
    updateSelectedDraft({
      title: "未命名发布草稿",
      platform: null,
      bilibiliAccountId: null,
      content: "",
      images: [],
      source: "manual",
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
            ＋ 新建空白草稿
          </button>
          <nav className="publish-draft-list" aria-label="发布草稿列表">
            {orderedDrafts.map((draft) => (
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
                      onClick={() => {
                        setSelectedDraftId(draft.id);
                        setDraftMenuId(null);
                        setNotice(null);
                        setError(null);
                        setClearConfirm(false);
                      }}
                    >
                      <strong>
                        {draft.pinned ? <span title="已置顶">置顶 · </span> : null}
                        {draft.title}
                      </strong>
                      <span>
                        {draft.platform ? PLATFORM_LABELS[draft.platform] : "未选择平台"}
                        {" · "}
                        {draft.source === "generated" ? "来自生成内容" : "手写草稿"}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="publish-draft-menu-trigger"
                      aria-label={`打开草稿“${draft.title}”的操作菜单`}
                      aria-expanded={draftMenuId === draft.id}
                      onClick={() => {
                        setDraftMenuId((current) => (current === draft.id ? null : draft.id));
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
                            <button type="button" onClick={() => togglePinnedDraft(draft.id)}>
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
              <div className="publish-auto-setting">
                <span>
                  <strong>自动发布</strong>
                  <small>
                    {!selectedDraft.platform
                      ? "请先选择平台；默认关闭"
                      : autoPublishByPlatform[selectedDraft.platform]
                        ? `填充完成后将自动点击${PLATFORM_LABELS[selectedDraft.platform]}的发布按钮`
                        : "默认关闭；填充后停在发布按钮前，由你检查并手动发布"}
                  </small>
                </span>
                <label className="publish-auto-switch">
                  <input
                    type="checkbox"
                    disabled={!selectedDraft.platform}
                    checked={
                      selectedDraft.platform ? autoPublishByPlatform[selectedDraft.platform] : false
                    }
                    onChange={(event) => {
                      const platform = selectedDraft.platform;
                      if (!platform) return;
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
                    {selectedDraft.platform && autoPublishByPlatform[selectedDraft.platform]
                      ? "已开启"
                      : "已关闭"}
                  </em>
                </label>
              </div>
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
                    <small>只记录原始路径和名称，不制作图片副本</small>
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
              {error ? (
                <p className="publish-editor-error" role="alert">
                  {error}
                </p>
              ) : null}
              {notice ? <p className="publish-editor-notice">{notice}</p> : null}
              {selectedDraft.automationResult ? (
                <div
                  className={`publish-automation-result ${selectedDraft.automationResult.state}`}
                >
                  <strong>
                    {selectedDraft.automationResult.state === "published"
                      ? "已自动发布"
                      : "已完成自动填充"}
                  </strong>
                  <p>{selectedDraft.automationResult.message}</p>
                </div>
              ) : null}
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
                    selectedDraft.platform !== "bilibili" ||
                    !selectedDraft.bilibiliAccountId ||
                    !selectedDraft.content.trim()
                  }
                  title={
                    selectedDraft.platform === "bilibili"
                      ? autoPublishByPlatform.bilibili
                        ? "打开持久登录的平台窗口，完成填充后自动点击发布"
                        : "打开持久登录的平台窗口并填充，最终发布由你确认"
                      : "当前仅接入哔哩哔哩自动填充"
                  }
                  onClick={() => openPlatform.mutate()}
                >
                  {openPlatform.isPending ? "正在打开并填充…" : "一键填充到平台"}
                </button>
                <small>
                  {selectedDraft.platform && autoPublishByPlatform[selectedDraft.platform]
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
