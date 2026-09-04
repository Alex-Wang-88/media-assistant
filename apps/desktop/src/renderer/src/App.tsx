import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  ChatMessage,
  PersonaFlowState,
  PersonaRagConfirmInput,
  PersonaRagImportResult,
  PersonaStageOption,
  Project,
} from "@yoom/desktop-contracts";
import { personaStageWelcome } from "@yoom/desktop-contracts";
import {
  type DragEvent as ReactDragEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useWorkspaceQueries } from "./app/useWorkspaceQueries";
import { WorkspaceFallback } from "./app/WorkspaceFallback";
import { WorkspaceSidebar } from "./app/WorkspaceSidebar";
import {
  applyAppearance,
  resolveAppearance,
  systemPrefersDark,
  watchSystemTheme,
} from "./appearance";
import { ArtifactPanel } from "./artifacts/ArtifactPanel";
import { useChatScroll } from "./chat-scroll";
import { applyChatEvent, type ConversationMessage } from "./chat-state";
import { ContentTypePicker } from "./content/ContentTypePicker";
import { ProductPlatformPicker } from "./content/ProductPlatformPicker";
import { ProductQuestionCard } from "./content/ProductQuestionCard";
import { useContentFlowController } from "./content/useContentFlowController";
import { ChatBubble } from "./conversation/ChatBubble";
import { ChatComposer } from "./conversation/ChatComposer";
import { PublishCenter, type PublishCenterSeed } from "./PublishCenter";
import { PersonaDeleteDialog } from "./persona/PersonaDeleteDialog";
import { PersonaDocumentEditor } from "./persona/PersonaDocumentEditor";
import { PersonaFlowView } from "./persona/PersonaFlowView";
import { PersonaOnboardingCard } from "./persona/PersonaOnboardingCard";
import { parsePersonaReport, personaSetupMessage } from "./persona/persona-report";
import { loadPersonaTranscript, savePersonaTranscript } from "./persona-transcript";
import { SettingsPanel } from "./SettingsPanel";
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
  const [pendingDeleteProjectId, setPendingDeleteProjectId] = useState<string | null>(null);
  const [taskDeleteError, setTaskDeleteError] = useState<string | null>(null);
  const [personaSetupOpen, setPersonaSetupOpen] = useState(false);
  const [personaResumeChoiceOpen, setPersonaResumeChoiceOpen] = useState(false);
  const [personaSetupMessages, setPersonaSetupMessages] = useState<ConversationMessage[]>([]);
  const [personaFlow, setPersonaFlow] = useState<PersonaFlowState | null>(null);
  const [personaReportDraft, setPersonaReportDraft] = useState<string | null>(null);
  const [personaSelectedOptionIds, setPersonaSelectedOptionIds] = useState<string[]>([]);
  const [personaFinalAnswer, setPersonaFinalAnswer] = useState("");
  const [personaDocumentOpen, setPersonaDocumentOpen] = useState(false);
  const [personaDocumentPath, setPersonaDocumentPath] = useState("");
  const [personaDocumentContent, setPersonaDocumentContent] = useState("");
  const [personaDocumentError, setPersonaDocumentError] = useState<string | null>(null);
  const [personaDropActive, setPersonaDropActive] = useState(false);
  const [personaDeleteConfirm, setPersonaDeleteConfirm] = useState(false);
  const [personaDeleteError, setPersonaDeleteError] = useState<string | null>(null);
  const [publishCenterOpen, setPublishCenterOpen] = useState(false);
  const [publishCenterSeed, setPublishCenterSeed] = useState<PublishCenterSeed[] | null>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const activeScrollItems = useMemo(
    () =>
      personaSetupOpen
        ? [...personaSetupMessages, ...(personaReportDraft ? ["persona-report-draft"] : [])]
        : conversationMessages,
    [conversationMessages, personaReportDraft, personaSetupMessages, personaSetupOpen],
  );
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
  } = useChatScroll(activeScrollItems);
  const {
    contentAgentType,
    productAgentResponse,
    productSelectedOptionIds,
    productCustomInput,
    setProductCustomInput,
    productTargetPlatforms,
    productPlatformSelectionConfirmed,
    selectContentAgent,
    toggleProductPlatform,
    confirmProductPlatforms,
    returnToProductPlatformPicker,
    returnToContentTypePicker,
    resetForProjectChange,
    preserveForNextProjectChange,
    sendProductPromotionAnswer,
    toggleProductOption,
    submitProductAnswer,
    skipProductQuestion,
  } = useContentFlowController({
    selectedProjectId: ui.selectedProjectId,
    selectProject: ui.selectProject,
    conversationMessages,
    setConversationMessages,
    isStreaming,
    setIsStreaming,
    setMessage,
    requestLatestMessage,
    cancelLatestMessage,
    setAgentRequestFailed,
    openPublishCenter: (seed) => {
      setPublishCenterSeed(seed);
      setPublishCenterOpen(true);
    },
    focusComposer: () => requestAnimationFrame(() => messageInputRef.current?.focus()),
  });
  const { workspace, workspaces, personaRag, agentStatus, projects, artifacts, preview } =
    useWorkspaceQueries({
      selectedProjectId: ui.selectedProjectId,
      selectedArtifactPath: ui.selectedArtifactPath,
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
  const handlePersonaFilesImported = (result: PersonaRagImportResult) => {
    if (result.names.length === 0) return;
    setPersonaReportDraft(null);
    void personaRag.refetch();
    continuePersonaSetupAfterImport(result.names);
  };
  const importPersonaRagFiles = useMutation({
    mutationFn: () => window.desktop.personaRag.importFiles(),
    onSuccess: handlePersonaFilesImported,
    onError: (error) => {
      setPersonaSetupMessages((current) => [
        ...current,
        personaSetupMessage("assistant", `资料上传失败：${readableError(error)}`, true),
      ]);
    },
  });
  const importDroppedPersonaRagFiles = useMutation({
    mutationFn: async (files: File[]) => {
      const droppedFiles = await Promise.all(
        files.slice(0, 10).map(async (file) => ({
          name: file.name,
          data: new Uint8Array(await file.arrayBuffer()),
        })),
      );
      return window.desktop.personaRag.importDroppedFiles(droppedFiles);
    },
    onSuccess: handlePersonaFilesImported,
  });
  const confirmPersonaRag = useMutation({
    mutationFn: (profile: PersonaRagConfirmInput) => window.desktop.personaRag.confirm(profile),
    onSuccess: async () => {
      await personaRag.refetch();
      setPersonaSetupOpen(false);
      setPersonaSetupMessages([]);
      setPersonaFlow(null);
      setPersonaReportDraft(null);
      setMessage("");
    },
  });
  const deletePersonaRag = useMutation({
    mutationFn: () => {
      const deleteProfile = window.desktop.personaRag.delete;
      if (typeof deleteProfile !== "function") {
        throw new Error("应用组件已更新，请完全退出并重新启动应用后再试");
      }
      return deleteProfile();
    },
    onSuccess: async () => {
      setPersonaDeleteConfirm(false);
      setPersonaDeleteError(null);
      setPersonaSetupOpen(false);
      setPersonaSetupMessages([]);
      setPersonaFlow(null);
      setPersonaReportDraft(null);
      setPersonaDocumentOpen(false);
      setPersonaDocumentPath("");
      setPersonaDocumentContent("");
      setPersonaDocumentError(null);
      setMessage("");
      await personaRag.refetch();
    },
    onError: (error) => setPersonaDeleteError(`删除失败：${readableError(error)}`),
  });
  const readPersonaDocument = useMutation({
    mutationFn: () => window.desktop.personaRag.readDocument(),
    onSuccess: (document) => {
      setPersonaSetupOpen(false);
      setPersonaDocumentPath(document.path);
      setPersonaDocumentContent(document.content);
      setPersonaDocumentError(null);
      setPersonaDocumentOpen(true);
    },
    onError: (error) => setPersonaDocumentError(`打开失败：${readableError(error)}`),
  });
  const savePersonaDocument = useMutation({
    mutationFn: (content: string) => window.desktop.personaRag.saveDocument(content),
    onSuccess: async () => {
      setPersonaDocumentError(null);
      await personaRag.refetch();
    },
    onError: (error) => setPersonaDocumentError(`保存失败：${readableError(error)}`),
  });
  const visibleProjects = useMemo(
    () =>
      (projects.data ?? []).filter((project) =>
        project.name.toLocaleLowerCase("zh-CN").includes(search.toLocaleLowerCase("zh-CN")),
      ),
    [projects.data, search],
  );
  const personaUploadPending =
    importPersonaRagFiles.isPending || importDroppedPersonaRagFiles.isPending;
  const activePersonaStage = personaFlow?.stages[personaFlow.currentStage - 1] ?? null;
  const personaSelectionRequired = activePersonaStage?.status === "selection_required";
  const personaFinalConfirmationRequired =
    activePersonaStage?.status === "waiting_confirmation" && activePersonaStage.questionCount >= 5;
  const personaConvergenceActive =
    Boolean(personaSelectionRequired) || Boolean(personaFinalConfirmationRequired);
  const personaSelectionMultiple = personaFlow?.currentStage === 5;
  const handlePersonaDragOver = (event: ReactDragEvent<HTMLElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setPersonaDropActive(true);
  };
  const handlePersonaDrop = (event: ReactDragEvent<HTMLElement>) => {
    event.preventDefault();
    setPersonaDropActive(false);
    if (personaUploadPending || isStreaming) return;
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) importDroppedPersonaRagFiles.mutate(files);
  };

  const sendPersonaAgentMessage = async (
    prompt: string,
    showUserMessage = true,
    includeReferences = false,
    selectedOption: PersonaStageOption | null = null,
    skipStage = false,
    confirmStage = false,
  ) => {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt || isStreaming) return;
    const assistantId = crypto.randomUUID();
    const userEntry = {
      ...personaSetupMessage("user", normalizedPrompt),
      hidden: !showUserMessage,
    };
    const assistantEntry: ConversationMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      status: "streaming",
      tools: [],
    };
    setPersonaSetupMessages((current) => [...current, userEntry, assistantEntry]);
    if (showUserMessage) setPersonaReportDraft(null);
    setMessage("");
    setIsStreaming(true);
    try {
      const result = await window.desktop.personaFlow.turn({
        userMessage: normalizedPrompt,
        includePersonaReferences: includeReferences,
        selectedOption,
        skipStage,
        confirmStage,
      });
      setPersonaFlow(result.flow);
      setPersonaSelectedOptionIds([]);
      setPersonaFinalAnswer("");
      let assistantContent = "";
      if (result.response.action === "ask_question") {
        assistantContent = result.response.question ?? "";
      } else if (result.response.action === "show_selection") {
        assistantContent = result.response.question ?? "";
      } else if (result.response.action === "present_conclusion") {
        assistantContent = result.response.conclusion ?? "";
      } else if (result.response.action === "complete_stage") {
        assistantContent = personaStageWelcome(result.flow.currentStage);
      } else if (result.response.action === "generate_final_summary") {
        assistantContent = "五个阶段已完成，用户画像报告已生成。";
      }
      requestLatestMessage(true);
      setPersonaSetupMessages((current) =>
        current.map((entry) =>
          entry.id === assistantId
            ? {
                ...entry,
                content: assistantContent,
                status: "complete",
                modelExcluded: result.response.action !== "ask_question",
              }
            : entry,
        ),
      );
      if (result.response.action === "generate_final_summary" && result.response.finalSummary) {
        const report =
          parsePersonaReport(result.response.finalSummary) ??
          `# 用户画像\n\n${result.response.finalSummary.trim()}`;
        setPersonaReportDraft(report);
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

  const togglePersonaConvergenceOption = (option: PersonaStageOption) => {
    setPersonaFinalAnswer("");
    setPersonaSelectedOptionIds((current) => {
      if (!personaSelectionMultiple) return current.includes(option.id) ? [] : [option.id];
      return current.includes(option.id)
        ? current.filter((id) => id !== option.id)
        : [...current, option.id];
    });
  };

  const submitPersonaConvergence = () => {
    if (!activePersonaStage) return;
    const manual = personaFinalAnswer.trim();
    const selected = activePersonaStage.options.filter((option) =>
      personaSelectedOptionIds.includes(option.id),
    );
    const labels = manual ? [manual] : selected.map((option) => option.label);
    if (labels.length === 0) return;
    const visibleAnswer = labels.join("、");
    const structuredOption: PersonaStageOption = {
      id: manual
        ? "__custom__"
        : selected.length > 1
          ? "__multiple__"
          : (selected[0]?.id ?? "answer"),
      label: visibleAnswer.slice(0, 200),
    };
    setPersonaSelectedOptionIds([]);
    setPersonaFinalAnswer("");
    void sendPersonaAgentMessage(visibleAnswer, true, false, structuredOption);
  };

  const submitPersonaFinalCorrection = () => {
    const manual = personaFinalAnswer.trim();
    if (!manual) return;
    setPersonaFinalAnswer("");
    void sendPersonaAgentMessage(manual, true, false, {
      id: "__custom__",
      label: manual.slice(0, 200),
    });
  };

  const beginPersonaSetup = async () => {
    if (isStreaming) return;
    setPersonaDocumentOpen(false);
    setPersonaSetupOpen(true);
    setPersonaSetupMessages([]);
    setPersonaReportDraft(null);
    setMessage("");
    setIsStreaming(true);
    try {
      const existing = await window.desktop.personaFlow.load();
      const flow = existing ?? (await window.desktop.personaFlow.start());
      setPersonaFlow(flow);
      setPersonaSelectedOptionIds([]);
      setPersonaFinalAnswer("");
      if (flow.flowCompleted && flow.finalSummary) {
        setPersonaReportDraft(
          parsePersonaReport(flow.finalSummary) ?? `# 用户画像\n\n${flow.finalSummary.trim()}`,
        );
      }
      const hasUnfinishedProgress =
        !flow.flowCompleted &&
        (flow.stateVersion > 0 ||
          flow.currentStage > 1 ||
          flow.stages.some((stage) => stage.agentMessages.length > 0));
      setPersonaResumeChoiceOpen(hasUnfinishedProgress);
      if (!hasUnfinishedProgress) {
        const current = flow.stages[flow.currentStage - 1];
        const welcome = current?.lastAssistantMessage ?? personaStageWelcome(flow.currentStage);
        setPersonaSetupMessages([personaSetupMessage("assistant", welcome, true)]);
      }
    } catch (error) {
      setPersonaSetupMessages([
        {
          ...personaSetupMessage("assistant", ""),
          status: "error",
          error: readableError(error),
        },
      ]);
    } finally {
      setIsStreaming(false);
    }
  };

  const restartPersonaSetup = async () => {
    if (isStreaming) return;
    setMessage("");
    setPersonaReportDraft(null);
    setIsStreaming(true);
    try {
      const flow = await window.desktop.personaFlow.start();
      setPersonaFlow(flow);
      setPersonaResumeChoiceOpen(false);
      setPersonaSelectedOptionIds([]);
      setPersonaFinalAnswer("");
      setPersonaSetupMessages([
        personaSetupMessage("assistant", personaStageWelcome(flow.currentStage), true),
      ]);
    } catch (error) {
      setPersonaSetupMessages([
        {
          ...personaSetupMessage("assistant", ""),
          status: "error",
          error: readableError(error),
        },
      ]);
    } finally {
      setIsStreaming(false);
    }
  };

  const continuePersonaSetup = () => {
    if (!personaFlow) return;
    const restored = loadPersonaTranscript(window.localStorage, personaFlow).map((entry) =>
      personaSetupMessage(entry.role, entry.content, entry.role === "assistant"),
    );
    setPersonaSetupMessages(restored);
    setPersonaResumeChoiceOpen(false);
    requestLatestMessage(true);
  };

  function continuePersonaSetupAfterImport(names: string[]) {
    const prompt =
      `我刚添加了这些本地参考资料：${names.join("、")}。` +
      "资料正文已经由客户端在本地读取，并将在本次请求中一并提供。" +
      "请先分析已有资料：信息足够就继续形成用户画像报告；仍有关键缺失时，只追问当前最必要的问题。";
    if (!personaSetupOpen) {
      void (async () => {
        await beginPersonaSetup();
        await sendPersonaAgentMessage(prompt, false, true);
      })();
      return;
    }
    void sendPersonaAgentMessage(prompt, false, true);
  }

  useLayoutEffect(() => {
    const apply = (prefersDark = systemPrefersDark()) => {
      applyAppearance(document.documentElement, resolveAppearance(ui.appearance, prefersDark));
    };
    apply();
    if (ui.appearance.mode !== "system") return;
    return watchSystemTheme(apply);
  }, [ui.appearance]);

  useEffect(() => {
    if (
      !personaSetupOpen ||
      personaResumeChoiceOpen ||
      isStreaming ||
      personaConvergenceActive ||
      personaReportDraft ||
      personaDocumentOpen
    ) {
      return;
    }
    const frame = requestAnimationFrame(() => messageInputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [
    isStreaming,
    personaConvergenceActive,
    personaDocumentOpen,
    personaReportDraft,
    personaResumeChoiceOpen,
    personaSetupOpen,
  ]);

  useEffect(() => {
    if (!personaFlow || !personaSetupOpen || personaResumeChoiceOpen) return;
    const visibleMessages = personaSetupMessages
      .filter((entry) => !entry.hidden && entry.status === "complete" && entry.content.trim())
      .map((entry) => ({ role: entry.role, content: entry.content }));
    if (visibleMessages.length === 0) return;
    savePersonaTranscript(window.localStorage, personaFlow.flowId, visibleMessages);
  }, [personaFlow, personaResumeChoiceOpen, personaSetupMessages, personaSetupOpen]);

  useEffect(() => {
    if (!ui.selectedProjectId && projects.data?.[0]) ui.selectProject(projects.data[0].id);
  }, [projects.data, ui]);

  useEffect(() => {
    if (!personaDeleteConfirm) return;
    const cancelDelete = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || deletePersonaRag.isPending) return;
      setPersonaDeleteConfirm(false);
      setPersonaDeleteError(null);
    };
    window.addEventListener("keydown", cancelDelete);
    return () => window.removeEventListener("keydown", cancelDelete);
  }, [deletePersonaRag.isPending, personaDeleteConfirm]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: switching projects must clear the active transcript
  useEffect(() => {
    resetForProjectChange();
  }, [ui.selectedProjectId]);

  const sendMessage = async () => {
    if (personaSetupOpen) {
      await sendPersonaAgentMessage(message);
      return;
    }
    const prompt = message.trim();
    let projectId = ui.selectedProjectId;
    if (!prompt || isStreaming) return;

    if (contentAgentType === "product_promotion") {
      await sendProductPromotionAnswer(
        { selectedOptions: [], customInput: prompt, skipped: false, ranked: false },
        prompt,
      );
      return;
    }

    const requestId = crypto.randomUUID();
    const assistantId = crypto.randomUUID();
    const history: ChatMessage[] = conversationMessages
      .filter((entry) => !entry.modelExcluded && entry.content.trim())
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
        preserveForNextProjectChange();
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
    setPublishCenterOpen(false);
    setPublishCenterSeed(null);
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
      <WorkspaceFallback
        error={initializationError ?? null}
        onChooseWorkspace={() => void chooseWorkspace()}
      />
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
    ready: "Agent 已连接",
    unconfigured: "Agent 未配置",
    unavailable: "Agent 未连接",
  } as const;
  const personaOnboardingActive = personaRag.data?.ready !== true;

  return (
    <main
      className={personaOnboardingActive ? "shell persona-onboarding" : "shell"}
      aria-label={personaOnboardingActive ? "用户画像首次引导" : undefined}
    >
      <WorkspaceSidebar
        inert={personaOnboardingActive}
        workspacePath={workspace.data}
        workspaces={workspaces.data ?? []}
        taskName={taskName}
        search={search}
        projects={visibleProjects}
        selectedProjectId={ui.selectedProjectId}
        pendingDeleteProjectId={pendingDeleteProjectId}
        taskDeletePending={deleteTask.isPending}
        taskDeleteError={taskDeleteError}
        streaming={isStreaming}
        personaPending={personaRag.isPending}
        personaError={personaRag.isError}
        personaReady={personaRag.data?.ready === true}
        personaFileCount={personaRag.data?.fileCount ?? 0}
        agentState={displayedAgentState}
        agentLabel={agentLabels[displayedAgentState]}
        personaSetupOpen={personaSetupOpen}
        personaReadPending={readPersonaDocument.isPending}
        personaDeletePending={deletePersonaRag.isPending}
        personaDocumentOpen={personaDocumentOpen}
        personaDocumentError={personaDocumentError}
        onActivateWorkspace={(path) => {
          void window.desktop.workspace.activate(path).then(refreshWorkspace);
        }}
        onChooseWorkspace={() => void chooseWorkspace()}
        onTaskNameChange={setTaskName}
        onCreateTask={() => createTask.mutate()}
        onSearchChange={setSearch}
        onSelectProject={(id) => {
          setPendingDeleteProjectId(null);
          ui.selectProject(id);
        }}
        onRequestDeleteProject={(id) => {
          setTaskDeleteError(null);
          setPendingDeleteProjectId(id);
        }}
        onCancelDeleteProject={() => setPendingDeleteProjectId(null)}
        onConfirmDeleteProject={(id) => deleteTask.mutate(id)}
        onOpenPersona={() => {
          if (personaRag.data?.ready) readPersonaDocument.mutate();
          else void beginPersonaSetup();
        }}
        onRequestDeletePersona={() => {
          setPersonaDeleteError(null);
          setPersonaDeleteConfirm(true);
        }}
        onOpenPublishCenter={() => setPublishCenterOpen(true)}
        onOpenSettings={ui.openSettings}
      />

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
            {personaDocumentOpen ? (
              <PersonaDocumentEditor
                path={personaDocumentPath}
                content={personaDocumentContent}
                error={personaDocumentError}
                saving={savePersonaDocument.isPending}
                saved={savePersonaDocument.isSuccess}
                onClose={() => {
                  setPersonaDocumentOpen(false);
                  setPersonaDocumentError(null);
                }}
                onChange={(content) => {
                  savePersonaDocument.reset();
                  setPersonaDocumentContent(content);
                }}
                onSave={() => savePersonaDocument.mutate(personaDocumentContent)}
              />
            ) : conversationMessages.length === 0 && personaSetupOpen ? (
              <PersonaFlowView
                flow={personaFlow}
                resumeChoiceOpen={personaResumeChoiceOpen}
                messages={personaSetupMessages}
                busy={isStreaming}
                selectionRequired={Boolean(personaSelectionRequired)}
                finalConfirmationRequired={Boolean(personaFinalConfirmationRequired)}
                selectionMultiple={personaSelectionMultiple}
                selectedOptionIds={personaSelectedOptionIds}
                finalAnswer={personaFinalAnswer}
                reportDraft={personaReportDraft}
                reportSaving={confirmPersonaRag.isPending}
                reportError={
                  confirmPersonaRag.isError ? readableError(confirmPersonaRag.error) : null
                }
                onRestart={() => void restartPersonaSetup()}
                onContinue={continuePersonaSetup}
                onToggleOption={togglePersonaConvergenceOption}
                onFinalAnswerChange={(value, clearSelection) => {
                  setPersonaFinalAnswer(value);
                  if (clearSelection) setPersonaSelectedOptionIds([]);
                }}
                onSkipStage={() =>
                  void sendPersonaAgentMessage("跳过本阶段", true, false, null, true)
                }
                onSubmitSelection={submitPersonaConvergence}
                onConfirmStage={() =>
                  void sendPersonaAgentMessage("确认当前结论", true, false, null, false, true)
                }
                onSubmitCorrection={submitPersonaFinalCorrection}
                onReportChange={(value) => {
                  confirmPersonaRag.reset();
                  setPersonaReportDraft(value);
                }}
                onConfirmReport={() =>
                  personaReportDraft && confirmPersonaRag.mutate({ markdown: personaReportDraft })
                }
              />
            ) : conversationMessages.length === 0 &&
              personaRag.data?.ready &&
              contentAgentType === "product_promotion" &&
              !productPlatformSelectionConfirmed ? (
              <ProductPlatformPicker
                selected={productTargetPlatforms}
                onBack={returnToContentTypePicker}
                onToggle={toggleProductPlatform}
                onConfirm={confirmProductPlatforms}
              />
            ) : conversationMessages.length === 0 && personaRag.data?.ready ? (
              <ContentTypePicker onSelect={selectContentAgent} />
            ) : conversationMessages.length === 0 ? (
              <PersonaOnboardingCard
                pending={personaRag.isPending}
                error={personaRag.isError ? readableError(personaRag.error) : null}
                onBegin={() => void beginPersonaSetup()}
              />
            ) : (
              <div className="message-list" aria-live="polite">
                {contentAgentType ? (
                  <button
                    type="button"
                    className="content-agent-back"
                    disabled={isStreaming}
                    onClick={
                      contentAgentType === "product_promotion"
                        ? returnToProductPlatformPicker
                        : returnToContentTypePicker
                    }
                  >
                    <span aria-hidden="true">←</span>
                    {contentAgentType === "product_promotion" ? "返回平台选择" : "返回内容类型选择"}
                  </button>
                ) : null}
                {conversationMessages.map((entry) => (
                  <ChatBubble key={entry.id} message={entry} />
                ))}
                {contentAgentType === "product_promotion" &&
                productAgentResponse?.status === "questioning" ? (
                  <ProductQuestionCard
                    response={productAgentResponse}
                    selectedOptionIds={productSelectedOptionIds}
                    customInput={productCustomInput}
                    busy={isStreaming}
                    onToggleOption={toggleProductOption}
                    onCustomInputChange={setProductCustomInput}
                    onSkip={skipProductQuestion}
                    onSubmit={submitProductAnswer}
                  />
                ) : null}
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
        {!personaDocumentOpen &&
        ((personaSetupOpen &&
          !personaResumeChoiceOpen &&
          !personaReportDraft &&
          !personaConvergenceActive) ||
          (!personaSetupOpen &&
            conversationMessages.length > 0 &&
            !(
              contentAgentType === "product_promotion" &&
              (productAgentResponse || isStreaming)
            ))) ? (
          <ChatComposer
            personaMode={personaSetupOpen}
            personaStage={personaFlow?.currentStage ?? null}
            personaDropActive={personaDropActive}
            personaUploadPending={personaUploadPending}
            streaming={isStreaming}
            selectedProjectId={ui.selectedProjectId}
            contentAgentType={contentAgentType}
            message={message}
            inputRef={messageInputRef}
            onMessageChange={setMessage}
            onSend={() => void sendMessage()}
            onAttach={() => {
              if (personaSetupOpen) importPersonaRagFiles.mutate();
            }}
            onDragOver={handlePersonaDragOver}
            onDragLeave={() => setPersonaDropActive(false)}
            onDrop={handlePersonaDrop}
          />
        ) : null}
      </section>

      <ArtifactPanel
        inert={personaOnboardingActive}
        artifacts={artifacts.data ?? []}
        selectedPath={ui.selectedArtifactPath}
        preview={preview.data ?? null}
        onSelect={ui.selectArtifact}
        onRefresh={() => void artifacts.refetch()}
        onOpen={() =>
          void window.desktop.files.open(
            required(ui.selectedProjectId, "未选择任务"),
            required(ui.selectedArtifactPath, "未选择生成物"),
          )
        }
        onReveal={() =>
          void window.desktop.files.reveal(
            required(ui.selectedProjectId, "未选择任务"),
            required(ui.selectedArtifactPath, "未选择生成物"),
          )
        }
        onSendToPublishCenter={(artifact, artifactPreview) => {
          setPublishCenterSeed([
            {
              key: crypto.randomUUID(),
              title: artifact?.name.replace(/\.[^.]+$/, "") || "Agent 生成内容",
              content: artifactPreview.content ?? "",
            },
          ]);
          setPublishCenterOpen(true);
        }}
      />
      <PublishCenter
        open={publishCenterOpen}
        workspacePath={workspace.data ?? null}
        seed={publishCenterSeed}
        onSeedConsumed={() => setPublishCenterSeed(null)}
        onClose={() => setPublishCenterOpen(false)}
      />
      {personaOnboardingActive ? null : <SettingsPanel />}
      {personaDeleteConfirm ? (
        <PersonaDeleteDialog
          error={personaDeleteError}
          deleting={deletePersonaRag.isPending}
          onCancel={() => {
            setPersonaDeleteConfirm(false);
            setPersonaDeleteError(null);
          }}
          onConfirm={() => deletePersonaRag.mutate()}
        />
      ) : null}
    </main>
  );
}

function readableError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/^Error invoking remote method '[^']+': Error:\s*/, "")
    .replace(/^Error:\s*/, "");
}
