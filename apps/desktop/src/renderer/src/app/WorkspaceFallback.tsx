export function WorkspaceFallback({
  error,
  onChooseWorkspace,
}: {
  error: string | null;
  onChooseWorkspace(): void;
}) {
  return (
    <main className="onboarding">
      <div className="brand-mark">沄</div>
      <h1>获客智能助手</h1>
      <p>
        {error
          ? `工作区连接失败：${error}`
          : "默认工作区初始化失败。你可以选择一个本地目录继续使用。"}
      </p>
      <button type="button" className="primary" onClick={onChooseWorkspace}>
        选择工作区
      </button>
    </main>
  );
}
