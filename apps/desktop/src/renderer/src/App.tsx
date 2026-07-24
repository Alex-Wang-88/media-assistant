import * as Switch from "@radix-ui/react-switch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Artifact, ChatMessage } from "@yoom/desktop-contracts";
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { applyChatEvent, type ConversationMessage, type ConversationToolCall } from "./chat-state";
import { useUiStore } from "./store";

function required<T>(value: T | null, message: string): T {
  if (value === null) throw new Error(message);
  return value;
}

export function App() {
  const queryClient = useQueryClient();
  const ui = useUiStore();
  const [taskName, setTaskName] = useState("");
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [conversationMessages, setConversationMessages] = useState<ConversationMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [agentRequestFailed, setAgentRequestFailed] = useState(false);
  const [workspaceActionError, setWorkspaceActionError] = useState<string | null>(null);
  const messagesViewport = useRef<HTMLDivElement>(null);
  const shouldFollowLatestMessage = useRef(true);
  const forceLatestMessage = useRef(false);
  const isProgrammaticScroll = useRef(false);
  const skipNextProjectReset = useRef(false);
  const workspace = useQuery({
    queryKey: ["workspace"],
    queryFn: () => window.desktop.workspace.current(),
  });
  const workspaces = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => window.desktop.workspace.list(),
  });
  const agentStatus = useQuery({
    queryKey: ["agent-status"],
    queryFn: () => window.desktop.chat.status(),
    enabled: Boolean(workspace.data),
    retry: false,
    refetchInterval: 10_000,
  });
  const projects = useQuery({
    queryKey: ["projects", workspace.data],
    queryFn: () => window.desktop.tasks.list(),
    enabled: Boolean(workspace.data),
  });
  const artifacts = useQuery({
    queryKey: ["artifacts", ui.selectedProjectId],
    queryFn: () => window.desktop.files.listOutputs(required(ui.selectedProjectId, "未选择任务")),
    enabled: Boolean(ui.selectedProjectId),
    refetchInterval: 2_000,
  });
  const preview = useQuery({
    queryKey: ["preview", ui.selectedProjectId, ui.selectedArtifactPath],
    queryFn: () =>
      window.desktop.files.preview(
        required(ui.selectedProjectId, "未选择任务"),
        required(ui.selectedArtifactPath, "未选择生成物"),
      ),
    enabled: Boolean(ui.selectedProjectId && ui.selectedArtifactPath),
  });
  const createTask = useMutation({
    mutationFn: () => window.desktop.tasks.create({ name: taskName }),
    onSuccess: async (project) => {
      setTaskName("");
      ui.selectProject(project.id);
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
  const visibleProjects = useMemo(
    () =>
      (projects.data ?? []).filter((project) =>
        project.name.toLocaleLowerCase("zh-CN").includes(search.toLocaleLowerCase("zh-CN")),
      ),
    [projects.data, search],
  );

  useEffect(() => {
    if (!ui.selectedProjectId && projects.data?.[0]) ui.selectProject(projects.data[0].id);
  }, [projects.data, ui]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: switching projects must clear the active transcript
  useEffect(() => {
    if (skipNextProjectReset.current) {
      skipNextProjectReset.current = false;
      return;
    }
    setConversationMessages([]);
    setMessage("");
    setIsStreaming(false);
    shouldFollowLatestMessage.current = true;
    forceLatestMessage.current = false;
  }, [ui.selectedProjectId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: message layout changes determine whether the viewport should follow the latest content
  useLayoutEffect(() => {
    const viewport = messagesViewport.current;
    if (!viewport) return;
    if (!forceLatestMessage.current && !shouldFollowLatestMessage.current) return;

    const bottom = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    if (Math.abs(viewport.scrollTop - bottom) > 0.5) {
      isProgrammaticScroll.current = true;
      viewport.scrollTop = bottom;
    }
    shouldFollowLatestMessage.current = true;
    forceLatestMessage.current = false;
  }, [conversationMessages]);

  const sendMessage = async () => {
    const prompt = message.trim();
    let projectId = ui.selectedProjectId;
    if (!prompt || isStreaming) return;

    const requestId = crypto.randomUUID();
    const assistantId = crypto.randomUUID();
    const history: ChatMessage[] = conversationMessages
      .filter((entry) => entry.content.trim())
      .map((entry) => ({ role: entry.role, content: entry.content }));
    const userMessage: ConversationMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: prompt,
      status: "complete",
      tools: [],
    };
    const assistantMessage: ConversationMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      status: "streaming",
      tools: [],
    };
    forceLatestMessage.current = true;
    setConversationMessages((current) => [...current, userMessage, assistantMessage]);
    setMessage("");
    setIsStreaming(true);
    try {
      if (!projectId) {
        const project = await window.desktop.tasks.create({
          name: prompt.split(/\r?\n/, 1)[0]?.slice(0, 40) || "新对话",
        });
        projectId = project.id;
        skipNextProjectReset.current = true;
        ui.selectProject(project.id);
        await queryClient.invalidateQueries({ queryKey: ["projects"] });
      }
      await window.desktop.chat.send(
        {
          requestId,
          projectId,
          messages: [...history, { role: "user", content: prompt }],
          knowledgeEnabled: ui.knowledgeEnabled,
          strategyEnabled: ui.strategyEnabled,
          autoExecute: ui.autoExecute,
        },
        (event) => {
          if (event.type === "error") setAgentRequestFailed(true);
          if (event.type === "finish") setAgentRequestFailed(false);
          setConversationMessages((current) => applyChatEvent(current, assistantId, event));
        },
      );
    } catch (error) {
      setAgentRequestFailed(true);
      const errorMessage = readableError(error);
      setConversationMessages((current) =>
        current.map((entry) =>
          entry.id === assistantId ? { ...entry, status: "error", error: errorMessage } : entry,
        ),
      );
    } finally {
      setIsStreaming(false);
    }
  };

  const refreshWorkspace = async () => {
    ui.resetProject();
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["workspace"] }),
      queryClient.invalidateQueries({ queryKey: ["workspaces"] }),
      queryClient.invalidateQueries({ queryKey: ["projects"] }),
      queryClient.removeQueries({ queryKey: ["artifacts"] }),
      queryClient.removeQueries({ queryKey: ["preview"] }),
    ]);
  };

  const chooseWorkspace = async () => {
    setWorkspaceActionError(null);
    try {
      const path = await window.desktop.workspace.select();
      if (path) await refreshWorkspace();
    } catch (error) {
      setWorkspaceActionError(readableError(error));
    }
  };

  if (workspace.isPending) return <main className="centered">正在加载工作区…</main>;
  if (!workspace.data) {
    const initializationError = workspace.isError
      ? readableError(workspace.error)
      : workspaceActionError;
    return (
      <main className="onboarding">
        <div className="brand-mark">沄</div>
        <h1>获客智能助手</h1>
        <p>
          {initializationError
            ? `工作区连接失败：${initializationError}`
            : "默认工作区初始化失败。你可以选择一个本地目录继续使用。"}
        </p>
        <button type="button" className="primary" onClick={() => void chooseWorkspace()}>
          选择工作区
        </button>
      </main>
    );
  }

  const detectedAgentState = agentStatus.isPending
    ? "checking"
    : agentStatus.isError
      ? "unavailable"
      : agentStatus.data.state;
  const displayedAgentState = agentRequestFailed ? "unavailable" : detectedAgentState;
  const agentLabels = {
    checking: "Agent 检测中",
    ready: "Agent 就绪",
    unconfigured: "Agent 未配置",
    unavailable: "Agent 未连接",
  } as const;

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="logo-row">
          <span className="logo">
            <Icon name="spark" />
          </span>
          <span className="brand-copy">
            <strong>沄荣助手</strong>
            <small>Media workspace</small>
          </span>
        </div>
        <div className="workspace-switcher">
          <select
            aria-label="当前工作区"
            value={workspace.data}
            onChange={async (event) => {
              await window.desktop.workspace.activate(event.target.value);
              await refreshWorkspace();
            }}
          >
            {(workspaces.data ?? []).map((entry) => (
              <option key={entry.path} value={entry.path}>
                {entry.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            title="添加工作区"
            aria-label="添加工作区"
            onClick={() => void chooseWorkspace()}
          >
            <Icon name="plus" />
          </button>
        </div>
        <form
          className="new-task"
          onSubmit={(event) => {
            event.preventDefault();
            if (taskName.trim()) createTask.mutate();
          }}
        >
          <input
            value={taskName}
            onChange={(e) => setTaskName(e.target.value)}
            placeholder="新任务名称"
          />
          <button type="submit" aria-label="新建任务">
            <Icon name="plus" />
            <span>新建任务</span>
          </button>
        </form>
        <div className="search-field">
          <Icon name="search" />
          <input
            className="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索任务"
          />
        </div>
        <div className="section-title">最近任务</div>
        <nav className="project-list">
          {visibleProjects.map((project) => (
            <button
              type="button"
              className={ui.selectedProjectId === project.id ? "project active" : "project"}
              key={project.id}
              onClick={() => ui.selectProject(project.id)}
            >
              <span className={`status ${project.status}`} />
              <span>
                <strong>{project.name}</strong>
                <small>{new Date(project.updatedAt).toLocaleDateString()}</small>
              </span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button type="button">
            <span className="nav-label">
              <Icon name="monitor" /> 已配对设备
            </span>
            <span>0</span>
          </button>
          <button type="button">
            <span className="nav-label">
              <Icon name="wallet" /> 账户与余额
            </span>
            <span>—</span>
          </button>
          <button type="button">
            <span className="nav-label">
              <Icon name="settings" /> 设置
            </span>
          </button>
        </div>
      </aside>

      <section className="conversation">
        <header className="conversation-header">
          <div>
            <strong>
              {projects.data?.find((p) => p.id === ui.selectedProjectId)?.name ?? "新任务"}
            </strong>
            <small>{workspaces.data?.find((entry) => entry.path === workspace.data)?.name}</small>
          </div>
          <span className={`agent-status ${displayedAgentState}`}>
            <span />
            {agentLabels[displayedAgentState]}
          </span>
        </header>
        <div
          className="messages"
          ref={messagesViewport}
          onScroll={(event) => {
            const viewport = event.currentTarget;
            if (isProgrammaticScroll.current) {
              isProgrammaticScroll.current = false;
              return;
            }
            const distanceFromBottom =
              viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
            shouldFollowLatestMessage.current = distanceFromBottom <= 24;
          }}
        >
          {conversationMessages.length === 0 ? (
            <div className="welcome-card">
              <span className="welcome-mark">
                <Icon name="spark" />
              </span>
              <h1>今天想完成什么？</h1>
              <p>直接描述目标、平台和内容。Agent 会选择合适的工具，并将结果保存到当前工作区。</p>
              <div className="suggestions">
                <button
                  type="button"
                  onClick={() => setMessage("为新品制定一套小红书首发内容策略")}
                >
                  <strong>制定首发策略</strong>
                  <span>为新品规划小红书内容</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMessage("分析我上传的流量数据并给出可验证的实验建议")}
                >
                  <strong>分析流量数据</strong>
                  <span>从数据中发现增长机会</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMessage("写一篇适合微信公众号发布的产品介绍文章")}
                >
                  <strong>创作平台文章</strong>
                  <span>说明平台和主题即可开始</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMessage("根据企业知识库整理一份本周选题清单")}
                >
                  <strong>引用企业知识</strong>
                  <span>基于本地资料生成内容</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="message-list" aria-live="polite">
              {conversationMessages.map((entry) => (
                <ChatBubble key={entry.id} message={entry} />
              ))}
            </div>
          )}
        </div>
        <div className="composer-wrap">
          <div className="toggles">
            <Toggle
              label="企业知识"
              checked={ui.knowledgeEnabled}
              onChange={(v) => ui.setToggle("knowledgeEnabled", v)}
            />
            <Toggle
              label="流量策略"
              checked={ui.strategyEnabled}
              onChange={(v) => ui.setToggle("strategyEnabled", v)}
            />
            <Toggle
              label="自动执行"
              checked={ui.autoExecute}
              onChange={(v) => ui.setToggle("autoExecute", v)}
              warning
            />
          </div>
          <div className="composer">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void sendMessage();
                }
              }}
              placeholder="告诉 Agent 你想做什么…"
            />
            <div className="composer-actions">
              <button type="button" title="添加附件" className="attach">
                <Icon name="paperclip" />
              </button>
              <span className="composer-note">
                {ui.selectedProjectId ? "支持图片、CSV、XLSX、PDF" : "首次发送将自动创建任务"}
              </span>
              <button
                className="send"
                type="button"
                aria-label="发送消息"
                onClick={() => void sendMessage()}
                disabled={!message.trim() || isStreaming}
              >
                {isStreaming ? <span className="button-spinner" /> : <Icon name="arrow-up" />}
              </button>
            </div>
          </div>
        </div>
      </section>

      <aside className="artifacts">
        <header>
          <div>
            <strong>生成物</strong>
            <small>{artifacts.data?.length ?? 0} 个文件</small>
          </div>
          <button type="button" onClick={() => artifacts.refetch()}>
            <Icon name="refresh" />
          </button>
        </header>
        <ArtifactList
          artifacts={artifacts.data ?? []}
          selected={ui.selectedArtifactPath}
          onSelect={ui.selectArtifact}
        />
        <div className="preview">
          {!ui.selectedArtifactPath && (
            <div className="empty-preview">
              <span className="preview-icon">
                <Icon name="file" />
              </span>
              <strong>暂无预览</strong>
              <p>Agent 生成的文章、图片和报告会出现在这里</p>
            </div>
          )}
          {preview.data?.content && preview.data.mediaType === "text/markdown" && (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{preview.data.content}</ReactMarkdown>
          )}
          {preview.data?.content && preview.data.mediaType !== "text/markdown" && (
            <pre>{preview.data.content}</pre>
          )}
          {preview.data && !preview.data.content && (
            <div className="empty-preview">
              <p>请使用系统应用打开此文件。</p>
            </div>
          )}
        </div>
        {preview.data && (
          <footer className="file-actions">
            <button
              type="button"
              onClick={() =>
                window.desktop.files.open(
                  required(ui.selectedProjectId, "未选择任务"),
                  required(ui.selectedArtifactPath, "未选择生成物"),
                )
              }
            >
              打开
            </button>
            <button
              type="button"
              onClick={() =>
                window.desktop.files.reveal(
                  required(ui.selectedProjectId, "未选择任务"),
                  required(ui.selectedArtifactPath, "未选择生成物"),
                )
              }
            >
              显示位置
            </button>
            <button type="button" onClick={() => navigator.clipboard.writeText(preview.data.path)}>
              复制路径
            </button>
          </footer>
        )}
      </aside>
    </main>
  );
}

function readableError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/^Error invoking remote method '[^']+': Error:\s*/, "")
    .replace(/^Error:\s*/, "");
}

function ChatBubble({ message }: { message: ConversationMessage }) {
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
}

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

function Toggle({
  label,
  checked,
  onChange,
  warning = false,
}: {
  label: string;
  checked: boolean;
  onChange(value: boolean): void;
  warning?: boolean;
}) {
  return (
    <span className={warning ? "toggle warning" : "toggle"}>
      <Switch.Root checked={checked} onCheckedChange={onChange} aria-label={label}>
        <Switch.Thumb className="toggle-thumb" />
      </Switch.Root>
      {label}
    </span>
  );
}

function ArtifactList({
  artifacts,
  selected,
  onSelect,
}: {
  artifacts: Artifact[];
  selected: string | null;
  onSelect(path: string): void;
}) {
  const labels: Record<Artifact["kind"], string> = {
    article: "文章",
    image: "图片",
    analytics_report: "分析报告",
    strategy: "创作策略",
    video: "视频",
    publish_receipt: "发布回执",
    input: "输入文件",
  };
  const grouped = Object.groupBy(artifacts, (artifact) => artifact.kind);
  return (
    <div className="artifact-list">
      {Object.entries(grouped).map(([kind, items]) => (
        <section key={kind}>
          <h3>
            {labels[kind as Artifact["kind"]]} <span>{items?.length ?? 0}</span>
          </h3>
          {items?.map((artifact) => (
            <button
              type="button"
              key={artifact.path}
              className={selected === artifact.path ? "active" : ""}
              onClick={() => onSelect(artifact.path)}
            >
              <span className="file-icon">
                {artifact.mediaType.startsWith("image/") ? "▧" : "▤"}
              </span>
              <span>
                <strong>{artifact.name}</strong>
                <small>{new Date(artifact.updatedAt).toLocaleString()}</small>
              </span>
            </button>
          ))}
        </section>
      ))}
    </div>
  );
}

type IconName =
  | "plus"
  | "search"
  | "spark"
  | "monitor"
  | "wallet"
  | "settings"
  | "paperclip"
  | "arrow-up"
  | "refresh"
  | "file";

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    plus: <path d="M12 5v14M5 12h14" />,
    search: <path d="m21 21-4.35-4.35m2.35-5.65a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z" />,
    spark: (
      <path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Zm6 12 .8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8L18 15Z" />
    ),
    monitor: <path d="M4 5h16v11H4V5Zm5 15h6m-3-4v4" />,
    wallet: (
      <path d="M4 6.5h14a2 2 0 0 1 2 2V18H6a2 2 0 0 1-2-2V6.5Zm0 0A2.5 2.5 0 0 1 6.5 4H17v2.5M16 11h4v4h-4a2 2 0 1 1 0-4Z" />
    ),
    settings: (
      <path d="M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Zm0-5 1 2.2 2.4.6 2-1.3 1.6 1.6-1.3 2 .6 2.4 2.2 1v2l-2.2 1-.6 2.4 1.3 2-1.6 1.6-2-1.3-2.4.6-1 2.2h-2l-1-2.2-2.4-.6-2 1.3L5 19.4l1.3-2-.6-2.4-2.2-1v-2l2.2-1 .6-2.4-1.3-2L6.6 5l2 1.3 2.4-.6 1-2.2h2Z" />
    ),
    paperclip: <path d="m8.5 12.5 5.8-5.8a3 3 0 0 1 4.2 4.2l-7.2 7.2a5 5 0 0 1-7.1-7.1l7-7" />,
    "arrow-up": <path d="m6 11 6-6 6 6M12 5v14" />,
    refresh: <path d="M20 6v5h-5M4 18v-5h5m10-2a7 7 0 0 0-12-4L4 11m16 2-3 4a7 7 0 0 1-12-4" />,
    file: <path d="M7 3h7l4 4v14H7V3Zm7 0v5h5M10 13h5m-5 4h5" />,
  };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {paths[name]}
      </g>
    </svg>
  );
}
