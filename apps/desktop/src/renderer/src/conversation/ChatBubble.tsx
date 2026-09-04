import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ConversationMessage, ConversationToolCall } from "../chat-state";

export const ChatBubble = memo(function ChatBubble({ message }: { message: ConversationMessage }) {
  if (message.hidden) return null;
  return (
    <article className={`chat-message ${message.role} ${message.status}`}>
      <header>
        <span>{message.role === "user" ? "你" : "Agent"}</span>
        {message.role === "assistant" && message.status === "streaming" && (
          <span className="stream-indicator">
            <span className="spinner" />
            正在生成
          </span>
        )}
      </header>
      {message.content &&
        (message.role === "assistant" ? (
          <div className="message-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
          </div>
        ) : (
          <p>{message.content}</p>
        ))}
      {message.tools.length > 0 && (
        <div className="tool-call-list">
          {message.tools.map((tool) => (
            <ToolCallStatus key={tool.id} tool={tool} />
          ))}
        </div>
      )}
      {message.error && (
        <div className="message-error">
          <strong>请求失败</strong>
          <span>{message.error}</span>
          <small>可重新输入内容后再次发送。</small>
        </div>
      )}
    </article>
  );
});

function ToolCallStatus({ tool }: { tool: ConversationToolCall }) {
  const labels: Record<ConversationToolCall["status"], string> = {
    requested: "已请求",
    running: "执行中",
    completed: "已完成",
    failed: "失败",
  };
  return (
    <details className={`tool-call ${tool.status}`}>
      <summary>
        <span className="tool-icon">
          {tool.status === "running" ? <span className="spinner" /> : "⌘"}
        </span>
        <span>
          <strong>{tool.name}</strong>
          <small>{labels[tool.status]}</small>
        </span>
      </summary>
      {tool.arguments && <pre>{tool.arguments}</pre>}
      {tool.result && <pre className="tool-result">{tool.result}</pre>}
    </details>
  );
}
