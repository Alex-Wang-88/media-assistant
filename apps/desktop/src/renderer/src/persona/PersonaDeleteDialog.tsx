export function PersonaDeleteDialog({
  error,
  deleting,
  onCancel,
  onConfirm,
}: {
  error: string | null;
  deleting: boolean;
  onCancel(): void;
  onConfirm(): void;
}) {
  return (
    <div className="persona-delete-overlay">
      <button
        type="button"
        className="persona-delete-backdrop"
        aria-label="取消永久删除"
        disabled={deleting}
        onClick={onCancel}
      />
      <section
        className="persona-delete-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="persona-delete-title"
      >
        <header>
          <div>
            <h2 id="persona-delete-title">永久删除用户画像？</h2>
            <p>此操作会永久删除画像主文件和所有参考资料，删除后无法恢复。</p>
          </div>
        </header>
        {error ? (
          <p className="persona-rag-error" role="alert">
            {error}
          </p>
        ) : null}
        <footer>
          <button type="button" disabled={deleting} onClick={onCancel}>
            取消
          </button>
          <button type="button" className="danger" disabled={deleting} onClick={onConfirm}>
            {deleting ? "正在永久删除…" : "永久删除"}
          </button>
        </footer>
      </section>
    </div>
  );
}
