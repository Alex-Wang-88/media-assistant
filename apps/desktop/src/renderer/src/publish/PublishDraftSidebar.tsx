import { DRAFT_GROUPS, type MemoryPublishDraft } from "./publish-draft-model";

export function PublishDraftSidebar({
  drafts,
  selectedDraftId,
  busy,
  draftMenuId,
  renameDraftId,
  renameDraftValue,
  deleteDraftId,
  onAdd,
  onSelect,
  onToggleMenu,
  onRenameValueChange,
  onBeginRename,
  onCancelRename,
  onConfirmRename,
  onTogglePinned,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  drafts: MemoryPublishDraft[];
  selectedDraftId: string;
  busy: boolean;
  draftMenuId: string | null;
  renameDraftId: string | null;
  renameDraftValue: string;
  deleteDraftId: string | null;
  onAdd(): void;
  onSelect(draftId: string): void;
  onToggleMenu(draftId: string): void;
  onRenameValueChange(value: string): void;
  onBeginRename(draft: MemoryPublishDraft): void;
  onCancelRename(): void;
  onConfirmRename(): void;
  onTogglePinned(draftId: string): void;
  onRequestDelete(draftId: string): void;
  onCancelDelete(): void;
  onConfirmDelete(draft: MemoryPublishDraft): void;
}) {
  return (
    <aside className="publish-draft-sidebar">
      <button type="button" className="primary publish-new-draft" disabled={busy} onClick={onAdd}>
        ＋ 新建自由草稿
      </button>
      <nav className="publish-draft-list" aria-label="发布草稿列表">
        {DRAFT_GROUPS.map((group) => {
          const groupDrafts = drafts.filter((draft) => draft.source === group.source);
          return (
            <section className="publish-draft-group" key={group.source}>
              <h2>{group.label}</h2>
              <div className="publish-draft-group-list">
                {groupDrafts.length === 0 ? <p>{group.emptyLabel}</p> : null}
                {groupDrafts.map((draft) => (
                  <div
                    key={draft.id}
                    className={`publish-draft-row ${draft.id === selectedDraftId ? "active" : ""}`}
                  >
                    {renameDraftId === draft.id ? (
                      <form
                        className="publish-draft-rename"
                        onSubmit={(event) => {
                          event.preventDefault();
                          onConfirmRename();
                        }}
                      >
                        <input
                          value={renameDraftValue}
                          maxLength={80}
                          aria-label="新的草稿名称"
                          onChange={(event) => onRenameValueChange(event.target.value)}
                        />
                        <button type="submit" disabled={!renameDraftValue.trim()}>
                          保存
                        </button>
                        <button type="button" onClick={onCancelRename}>
                          取消
                        </button>
                      </form>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="publish-draft-select"
                          title={draft.pinned ? `${draft.title}（已置顶）` : draft.title}
                          onClick={() => onSelect(draft.id)}
                        >
                          <strong>{draft.title}</strong>
                        </button>
                        <button
                          type="button"
                          className="publish-draft-menu-trigger"
                          aria-label={`打开草稿“${draft.title}”的操作菜单`}
                          aria-expanded={draftMenuId === draft.id}
                          onClick={() => onToggleMenu(draft.id)}
                        >
                          ···
                        </button>
                        {draftMenuId === draft.id ? (
                          <div className="publish-draft-menu">
                            {deleteDraftId === draft.id ? (
                              <>
                                <strong>确定删除这份草稿？</strong>
                                <button type="button" onClick={onCancelDelete}>
                                  取消
                                </button>
                                <button
                                  type="button"
                                  className="danger"
                                  onClick={() => onConfirmDelete(draft)}
                                >
                                  确认删除
                                </button>
                              </>
                            ) : (
                              <>
                                {draft.platform !== "x" ? (
                                  <button type="button" onClick={() => onBeginRename(draft)}>
                                    重命名
                                  </button>
                                ) : null}
                                <button type="button" onClick={() => onTogglePinned(draft.id)}>
                                  {draft.pinned ? "取消置顶" : "置顶"}
                                </button>
                                <button
                                  type="button"
                                  className="danger"
                                  onClick={() => onRequestDelete(draft.id)}
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
  );
}
