import { Icon } from "../ui/Icon";

export function PersonaOnboardingCard({
  pending,
  error,
  onBegin,
}: {
  pending: boolean;
  error: string | null;
  onBegin(): void;
}) {
  return (
    <div className="welcome-card persona-rag-empty">
      <span className="welcome-mark">
        <Icon name="spark" />
      </span>
      <h1>先建立用户画像</h1>
      <p>
        Agent 会结合你提供的内容和可选参考资料，自主判断还缺少什么，并且只追问必要信息。
        画像草稿需要你确认后才会保存到本地。
      </p>
      <button type="button" className="persona-rag-build" disabled={pending} onClick={onBegin}>
        <Icon name="spark" />
        <span>
          <strong>与 Agent 对话建立画像</strong>
          <small>进入后由你决定是否添加参考资料</small>
        </span>
      </button>
      {error ? (
        <p className="persona-rag-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
