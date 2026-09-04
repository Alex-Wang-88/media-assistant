export function PersonaDocumentEditor({
  path,
  content,
  error,
  saving,
  saved,
  onClose,
  onChange,
  onSave,
}: {
  path: string;
  content: string;
  error: string | null;
  saving: boolean;
  saved: boolean;
  onClose(): void;
  onChange(value: string): void;
  onSave(): void;
}) {
  return (
    <section className="persona-document-editor">
      <header>
        <div>
          <strong>用户画像主文件</strong>
          <small title={path}>{path}</small>
        </div>
        <button type="button" onClick={onClose}>
          关闭
        </button>
      </header>
      <textarea
        aria-label="用户画像主文件内容"
        value={content}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
      <footer>
        <span>{saved ? "修改已保存到本地" : "Markdown 文件，可直接修改标题和内容"}</span>
        <button
          type="button"
          className="primary"
          disabled={!content.trim() || saving}
          onClick={onSave}
        >
          {saving ? "正在保存…" : "保存修改"}
        </button>
      </footer>
      {error ? (
        <p className="persona-rag-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
