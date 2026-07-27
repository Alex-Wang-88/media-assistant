import * as Switch from "@radix-ui/react-switch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Artifact, ChatMessage, PersonaProfileInput, Project } from "@yoom/desktop-contracts";
import { memo, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  applyAppearance,
  resolveAppearance,
  systemPrefersDark,
  watchSystemTheme,
} from "./appearance";
import { useChatScroll } from "./chat-scroll";
import { applyChatEvent, type ConversationMessage, type ConversationToolCall } from "./chat-state";
import { SettingsPanel } from "./SettingsPanel";
import { useUiStore } from "./store";

function required<T>(value: T | null, message: string): T {
  if (value === null) throw new Error(message);
  return value;
}

function personaSetupMessage(
  role: ConversationMessage["role"],
  content: string,
): ConversationMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    status: "complete",
    tools: [],
  };
}

function formatPersonaDraft(profile: PersonaProfileInput): string {
  return [
    "我已根据当前对话和资料整理出用户画像草稿：",
    `账号主体与业务：${profile.brandOverview}`,
    `目标人群：${profile.audience}`,
    `品牌定位与长期认知：${profile.positioning}`,
    `固定事实、产品与服务：${profile.fixedFacts}`,
    `内容边界：${profile.contentBoundaries}`,
    "请在界面中确认保存，或继续告诉我需要修改的地方。",
  ].join("\n\n");
}

function parsePersonaDraft(argumentsText: string): PersonaProfileInput | null {
  try {
    const value = JSON.parse(argumentsText) as Record<string, unknown>;
    const keys: (keyof PersonaProfileInput)[] = [
      "brandOverview",
      "audience",
      "positioning",
      "fixedFacts",
      "contentBoundaries",
    ];
    if (
      typeof value !== "object" ||
      value === null ||
      keys.some((key) => typeof value[key] !== "string" || !value[key].trim())
    ) {
      return null;
    }
    return Object.fromEntries(
      keys.map((key) => [key, (value[key] as string).trim()]),
    ) as PersonaProfileInput;
  } catch {
    return null;
  }
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
  const [pendingDeleteProjectId, setPendingDeleteProjectId] = useState<string | null>(null);
  const [taskDeleteError, setTaskDeleteError] = useState<string | null>(null);
  const [personaSetupOpen, setPersonaSetupOpen] = useState(false);
  const [personaSetupMessages, setPersonaSetupMessages] = useState<ConversationMessage[]>([]);
  const [personaDraft, setPersonaDraft] = useState<PersonaProfileInput | null>(null);
  const skipNextProjectReset = useRef(false);
  const {
    viewportRef: messagesViewport,
    scrollbarThumbRef,
    requestScroll: requestLatestMessage,
    cancelScroll: cancelLatestMessage,
    handleScroll: handleMessagesScroll,
    handleUserScrollIntent,
    handleThumbPointerDown,
    handleThumbPointerMove,
    handleThumbPointerUp,
  } = useChatScroll(conversationMessages);
  const workspace = useQuery({
    queryKey: ["workspace"],
    queryFn: () => window.desktop.workspace.current(),
  });
  const workspaces = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => window.desktop.workspace.list(),
  });
  const personaRag = useQuery({
    queryKey: ["persona-rag", workspace.data],
    queryFn: () => window.desktop.personaRag.status(),
    enabled: Boolean(workspace.data),
    retry: false,
    refetchInterval: 1_000,
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
  const deleteTask = useMutation({
    mutationFn: (projectId: string) => {
      const deleteProject = window.desktop.tasks.delete;
      if (typeof deleteProject !== "function") {
        throw new Error("应用组件已更新，请完全退出并重新启动应用后再试");
      }
      return deleteProject(projectId);
    },
    onSuccess: async (_result, projectId) => {
      setPendingDeleteProjectId(null);
      setTaskDeleteError(null);
      queryClient.setQueryData<Project[]>(["projects", workspace.data], (current) =>
        current?.filter((project) => project.id !== projectId),
      );
      if (ui.selectedProjectId === projectId) ui.resetProject();
      await queryClient.invalidateQueries({ queryKey: ["projects", workspace.data] });
    },
    onError: (error) => {
      setTaskDeleteError(`删除失败：${readableError(error)}`);
    },
  });
  const importPersonaRagFiles = useMutation({
    mutationFn: () => window.desktop.personaRag.importFiles(),
    onSuccess: (result) => {
      if (result.names.length === 0) return;
      setPersonaDraft(null);
      setPersonaSetupMessages((current) => [
        ...current,
        personaSetupMessage(
          "assistant",
          `已上传 ${result.names.length} 个本地资料：${result.names.join("、")}。Agent 会结合资料和当前对话继续判断还缺少什么。`,
        ),
      ]);
      void personaRag.refetch();
    },
    onError: (error) => {
      setPersonaSetupMessages((current) => [
        ...current,
        personaSetupMessage("assistant", `资料上传失败：${readableError(error)}`),
      ]);
    },
  });
  const confirmPersonaRag = useMutation({
    mutationFn: (profile: PersonaProfileInput) => window.desktop.personaRag.confirm(profile),
    onSuccess: async () => {
      await personaRag.refetch();
      setPersonaSetupOpen(false);
      setPersonaSetupMessages([]);
      setPersonaDraft(null);
      setMessage("");
    },
  });
  const visibleProjects = useMemo(
    () =>
      (projects.data ?? []).filter((project) =>
        project.name.toLocaleLowerCase("zh-CN").includes(search.toLocaleLowerCase("zh-CN")),
      ),
    [projects.data, search],
  );

  const sendPersonaAgentMessage = async (
    prompt: string,
    showUserMessage = true,
    previousMessages = personaSetupMessages,
  ) => {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt || isStreaming) return;
    const requestId = crypto.randomUUID();
    const assistantId = crypto.randomUUID();
    const history: ChatMessage[] = previousMessages
      .filter((entry) => entry.content.trim())
      .map((entry) => ({ role: entry.role, content: entry.content }));
    const userEntry = personaSetupMessage("user", normalizedPrompt);
    const assistantEntry: ConversationMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      status: "streaming",
      tools: [],
    };
    setPersonaSetupMessages((current) => [
      ...current,
      ...(showUserMessage ? [userEntry] : []),
      assistantEntry,
    ]);
    if (showUserMessage) setPersonaDraft(null);
    setMessage("");
    setIsStreaming(true);
    let proposedDraft: PersonaProfileInput | null = null;
    try {
      await window.desktop.chat.send(
        {
          requestId,
          messages: [...history, { role: "user", content: normalizedPrompt }],
          knowledgeEnabled: true,
          strategyEnabled: false,
          autoExecute: false,
          mode: "persona_setup",
        },
        (event) => {
          if (
            event.type === "tool-call" &&
            event.name === "propose_persona" &&
            event.status === "completed"
          ) {
            proposedDraft = parsePersonaDraft(event.arguments);
          }
          setPersonaSetupMessages((current) => applyChatEvent(current, assistantId, event));
        },
      );
      if (proposedDraft) {
        setPersonaDraft(proposedDraft);
        setPersonaSetupMessages((current) =>
          current.map((entry) =>
            entry.id === assistantId
              ? { ...entry, content: formatPersonaDraft(proposedDraft as PersonaProfileInput) }
              : entry,
          ),
        );
      }
    } catch (error) {
      const errorMessage = readableError(error);
      setPersonaSetupMessages((current) =>
        current.map((entry) =>
          entry.id === assistantId ? { ...entry, status: "error", error: errorMessage } : entry,
        ),
      );
    } finally {
      setIsStreaming(false);
    }
  };

  const beginPersonaSetup = () => {
    setPersonaSetupOpen(true);
    setPersonaSetupMessages([]);
    setPersonaDraft(null);
    setMessage("");
    void sendPersonaAgentMessage(
      "请开始通过自然对话帮助我建立长期用户画像。先根据现有本地资料判断最需要了解什么，再提出第一个问题。",
      false,
      [],
    );
  };

  useLayoutEffect(() => {
    const apply = (prefersDark = systemPrefersDark()) => {
      applyAppearance(document.documentElement, resolveAppearance(ui.appearance, prefersDark));
    };
    apply();
    if (ui.appearance.mode !== "system") return;
    return watchSystemTheme(apply);
  }, [ui.appearance]);

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
    cancelLatestMessage();
  }, [ui.selectedProjectId]);

  const sendMessage = async () => {
    if (personaSetupOpen) {
      await sendPersonaAgentMessage(message);
      return;
    }
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
    requestLatestMessage();
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
            <div className="project-row" key={project.id}>
              <button
                type="button"
                className={ui.selectedProjectId === project.id ? "project active" : "project"}
                onClick={() => {
                  setPendingDeleteProjectId(null);
                  ui.selectProject(project.id);
                }}
              >
                <span className={`status ${project.status}`} />
                <span>
                  <strong>{project.name}</strong>
                  <small>{new Date(project.updatedAt).toLocaleDateString()}</small>
                </span>
              </button>
              {pendingDeleteProjectId === project.id ? (
                <span className="project-delete-confirm">
                  <button
                    type="button"
                    disabled={deleteTask.isPending || isStreaming}
                    onClick={() => deleteTask.mutate(project.id)}
                  >
                    确认删除
                  </button>
                  <button type="button" onClick={() => setPendingDeleteProjectId(null)}>
                    取消
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="project-delete"
                  aria-label={`删除最近任务“${project.name}”`}
                  disabled={isStreaming}
                  onClick={() => {
                    setTaskDeleteError(null);
                    setPendingDeleteProjectId(project.id);
                  }}
                >
                  <Icon name="trash" />
                </button>
              )}
            </div>
          ))}
          {taskDeleteError ? (
            <p className="project-delete-error" role="alert">
              {taskDeleteError}
            </p>
          ) : null}
        </nav>
        <section className="persona-sidebar-section" aria-labelledby="persona-sidebar-title">
          <header>
            <span className="persona-sidebar-icon">
              <Icon name="user" />
            </span>
            <span>
              <strong id="persona-sidebar-title">用户画像</strong>
              <small>
                {personaRag.isError
                  ? "状态读取失败"
                  : personaRag.data?.ready
                    ? "画像已就绪"
                    : "尚未构建"}
              </small>
            </span>
          </header>
          <div className="persona-sidebar-meta">
            <span className={personaRag.data?.ready ? "ready" : ""} />
            {personaRag.data?.ready
              ? `${personaRag.data.fileCount} 个本地文件`
              : "Agent 动态提问，参考资料可选"}
          </div>
          <button
            type="button"
            disabled={personaRag.isPending || isStreaming || personaSetupOpen}
            onClick={beginPersonaSetup}
          >
            {personaSetupOpen
              ? "正在构建"
              : personaRag.data?.ready
                ? "查看或更新画像"
                : "开始构建画像"}
          </button>
        </section>
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
          <button type="button" onClick={ui.openSettings}>
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
        <div className="messages-shell">
          <div
            className="messages"
            ref={messagesViewport}
            onScroll={handleMessagesScroll}
            onWheel={handleUserScrollIntent}
          >
            {conversationMessages.length === 0 && personaSetupOpen ? (
              <div className="persona-setup-conversation">
                <header>
                  <div>
                    <strong>建立用户画像</strong>
                    <small>Agent 会根据已有回答和本地资料动态追问</small>
                  </div>
                  <div className="persona-setup-actions">
                    <button
                      type="button"
                      disabled={importPersonaRagFiles.isPending}
                      onClick={() => importPersonaRagFiles.mutate()}
                    >
                      {importPersonaRagFiles.isPending ? "正在上传…" : "上传参考资料"}
                    </button>
                    <button
                      type="button"
                      disabled={isStreaming}
                      onClick={() => {
                        setPersonaSetupOpen(false);
                        setPersonaSetupMessages([]);
                        setPersonaDraft(null);
                        setMessage("");
                      }}
                    >
                      暂时退出
                    </button>
                  </div>
                </header>
                <div className="message-list" aria-live="polite">
                  {personaSetupMessages.map((entry) => (
                    <ChatBubble key={entry.id} message={entry} />
                  ))}
                </div>
                {personaDraft ? (
                  <article className="persona-draft-card">
                    <header>
                      <div>
                        <strong>用户画像草稿待确认</strong>
                        <small>确认前不会写入本地主文件</small>
                      </div>
                    </header>
                    <dl>
                      <div>
                        <dt>账号主体与业务</dt>
                        <dd>{personaDraft.brandOverview}</dd>
                      </div>
                      <div>
                        <dt>目标人群</dt>
                        <dd>{personaDraft.audience}</dd>
                      </div>
                      <div>
                        <dt>定位与长期认知</dt>
                        <dd>{personaDraft.positioning}</dd>
                      </div>
                      <div>
                        <dt>固定事实与服务</dt>
                        <dd>{personaDraft.fixedFacts}</dd>
                      </div>
                      <div>
                        <dt>内容边界</dt>
                        <dd>{personaDraft.contentBoundaries}</dd>
                      </div>
                    </dl>
                    {confirmPersonaRag.isError ? (
                      <p className="persona-rag-error" role="alert">
                        保存失败：{readableError(confirmPersonaRag.error)}
                      </p>
                    ) : null}
                    <footer>
                      <button type="button" onClick={() => setPersonaDraft(null)}>
                        继续修改
                      </button>
                      <button
                        type="button"
                        className="primary"
                        disabled={confirmPersonaRag.isPending}
                        onClick={() => confirmPersonaRag.mutate(personaDraft)}
                      >
                        {confirmPersonaRag.isPending ? "正在保存…" : "确认并保存"}
                      </button>
                    </footer>
                  </article>
                ) : null}
              </div>
            ) : conversationMessages.length === 0 && personaRag.data?.ready ? (
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
            ) : conversationMessages.length === 0 ? (
              <div className="welcome-card persona-rag-empty">
                <span className="welcome-mark">
                  <Icon name="spark" />
                </span>
                <h1>先建立用户画像</h1>
                <p>
                  Agent 会结合你提供的内容和可选参考资料，自主判断还缺少什么，并且只追问必要信息。
                  画像草稿需要你确认后才会保存到本地。
                </p>
                <button
                  type="button"
                  className="persona-rag-build"
                  disabled={personaRag.isPending}
                  onClick={beginPersonaSetup}
                >
                  <Icon name="spark" />
                  <span>
                    <strong>与 Agent 对话建立画像</strong>
                    <small>可以直接开始，也可以随时上传参考资料</small>
                  </span>
                </button>
                {personaRag.isError ? (
                  <p className="persona-rag-error" role="alert">
                    {readableError(personaRag.error)}
                  </p>
                ) : (
                  <p className="persona-rag-status" role="status">
                    用户画像确认保存后会显示四个快捷入口；画像文件被删除后会回到这里。
                  </p>
                )}
              </div>
            ) : (
              <div className="message-list" aria-live="polite">
                {conversationMessages.map((entry) => (
                  <ChatBubble key={entry.id} message={entry} />
                ))}
              </div>
            )}
          </div>
          <div className="chat-scrollbar" aria-hidden="true">
            <div
              className="chat-scrollbar-thumb"
              ref={scrollbarThumbRef}
              hidden
              onPointerDown={handleThumbPointerDown}
              onPointerMove={handleThumbPointerMove}
              onPointerUp={handleThumbPointerUp}
              onPointerCancel={handleThumbPointerUp}
            />
          </div>
        </div>
        <div className="composer-wrap">
          {personaSetupOpen ? (
            <div className="persona-setup-composer-label">
              正在建立用户画像 · 可随时上传补充资料
            </div>
          ) : (
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
          )}
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
              placeholder={personaSetupOpen ? "回答上方问题…" : "告诉 Agent 你想做什么…"}
              disabled={personaSetupOpen && isStreaming}
            />
            <div className="composer-actions">
              <button
                type="button"
                title={personaSetupOpen ? "上传画像参考资料" : "添加附件"}
                aria-label={personaSetupOpen ? "上传画像参考资料" : "添加附件"}
                className="attach"
                disabled={personaSetupOpen && importPersonaRagFiles.isPending}
                onClick={() => {
                  if (personaSetupOpen) importPersonaRagFiles.mutate();
                }}
              >
                <Icon name="paperclip" />
              </button>
              <span className="composer-note">
                {personaSetupOpen
                  ? "支持一次选择多个本地资料"
                  : ui.selectedProjectId
                    ? "支持图片、CSV、XLSX、PDF"
                    : "首次发送将自动创建任务"}
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
      <SettingsPanel />
    </main>
  );
}

function readableError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/^Error invoking remote method '[^']+': Error:\s*/, "")
    .replace(/^Error:\s*/, "");
}

const ChatBubble = memo(function ChatBubble({ message }: { message: ConversationMessage }) {
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
  | "file"
  | "trash"
  | "user";

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
    trash: <path d="M5 7h14M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5" />,
    user: <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0" />,
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
