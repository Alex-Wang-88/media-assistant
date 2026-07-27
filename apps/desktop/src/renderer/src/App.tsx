import * as Switch from "@radix-ui/react-switch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type Artifact,
  type ChatMessage,
  type PersonaAgentDocument,
  type PersonaProfileInput,
  type PersonaRagConfirmInput,
  type PersonaRagImportResult,
  type Project,
  personaAgentDocumentSchema,
} from "@yoom/desktop-contracts";
import {
  memo,
  type DragEvent as ReactDragEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  modelExcluded = false,
): ConversationMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    status: "complete",
    tools: [],
    ...(modelExcluded ? { modelExcluded: true } : {}),
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

type PersonaSetupStage = "welcome" | "agent";

type PersonaQuestion = {
  id: string;
  text: string;
  mode: "single" | "multiple" | "text";
  options: string[];
  allowCustom: boolean;
  allowSkip: boolean;
};

function parsePersonaPayload(source: string): Record<string, unknown> | null {
  const normalized = source
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    const payload = JSON.parse(normalized) as unknown;
    return typeof payload === "object" && payload !== null && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function parsePersonaQuestion(source: string): PersonaQuestion | null {
  const payload = parsePersonaPayload(source);
  if (payload?.status !== "asking") return null;
  try {
    const rawQuestion = payload.question;
    if (typeof rawQuestion !== "object" || rawQuestion === null || Array.isArray(rawQuestion)) {
      return null;
    }
    const question = rawQuestion as Record<string, unknown>;
    if (
      typeof question.id !== "string" ||
      typeof question.text !== "string" ||
      (question.mode !== "single" && question.mode !== "multiple" && question.mode !== "text")
    ) {
      return null;
    }
    const options = Array.isArray(question.options)
      ? question.options.filter((option): option is string => typeof option === "string")
      : [];
    return {
      id: question.id,
      text: question.text,
      mode: question.mode,
      options,
      allowCustom: question.allow_custom === true,
      allowSkip: question.allow_skip === true,
    };
  } catch {
    return null;
  }
}

function parseCompletedPersona(
  source: string,
): { document: PersonaAgentDocument; draft: PersonaProfileInput } | null {
  const payload = parsePersonaPayload(source);
  const parsed = personaAgentDocumentSchema.safeParse(payload);
  if (!parsed.success) return null;
  const profile = parsed.data.profile;
  const scalar = (value: string | null) => value ?? "";
  const joinSection = (values: string[], fallback: string) =>
    values.filter(Boolean).join("；") || fallback;
  return {
    document: parsed.data,
    draft: {
      brandOverview: joinSection(
        [
          scalar(profile.account_represents),
          scalar(profile.business_type),
          ...profile.offerings,
          scalar(profile.industry),
        ],
        "未提供",
      ),
      audience: joinSection(profile.target_audiences, "未提供"),
      positioning: joinSection(
        [...profile.memory_points, ...profile.long_term_topics, ...profile.customer_scenarios],
        "未提供",
      ),
      fixedFacts: joinSection(profile.fixed_facts, "暂无已确认的固定事实"),
      contentBoundaries: joinSection(profile.prohibited_content, "暂无已确认的内容边界"),
    },
  };
}

type PersonaScalarField = "industry" | "account_represents" | "business_type";
type PersonaListField =
  | "offerings"
  | "target_audiences"
  | "customer_scenarios"
  | "memory_points"
  | "long_term_topics"
  | "fixed_facts"
  | "prohibited_content";

const personaScalarFields: { key: PersonaScalarField; label: string }[] = [
  { key: "industry", label: "所属行业" },
  { key: "account_represents", label: "账号主体" },
  { key: "business_type", label: "具体业务类型" },
];

const personaListFields: { key: PersonaListField; label: string }[] = [
  { key: "offerings", label: "产品、服务或内容" },
  { key: "target_audiences", label: "目标人群" },
  { key: "customer_scenarios", label: "客户选择场景" },
  { key: "memory_points", label: "希望形成的记忆点" },
  { key: "long_term_topics", label: "长期内容主题" },
  { key: "fixed_facts", label: "固定事实" },
  { key: "prohibited_content", label: "禁止或避免的内容" },
];

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
  const [personaCompletedDocument, setPersonaCompletedDocument] =
    useState<PersonaAgentDocument | null>(null);
  const [personaEditDocument, setPersonaEditDocument] = useState<PersonaAgentDocument | null>(null);
  const [personaDocumentOpen, setPersonaDocumentOpen] = useState(false);
  const [personaDocumentPath, setPersonaDocumentPath] = useState("");
  const [personaDocumentContent, setPersonaDocumentContent] = useState("");
  const [personaDocumentError, setPersonaDocumentError] = useState<string | null>(null);
  const [personaDropActive, setPersonaDropActive] = useState(false);
  const [personaSetupStage, setPersonaSetupStage] = useState<PersonaSetupStage>("welcome");
  const [personaQuestion, setPersonaQuestion] = useState<PersonaQuestion | null>(null);
  const [personaSelectedOptions, setPersonaSelectedOptions] = useState<string[]>([]);
  const [personaCustomAnswer, setPersonaCustomAnswer] = useState("");
  const [personaDeleteConfirm, setPersonaDeleteConfirm] = useState(false);
  const [personaDeleteError, setPersonaDeleteError] = useState<string | null>(null);
  const personaSessionId = useRef(crypto.randomUUID());
  const skipNextProjectReset = useRef(false);
  const activeScrollItems = useMemo(
    () =>
      personaSetupOpen
        ? [
            ...personaSetupMessages,
            ...(personaQuestion ? [`question:${personaQuestion.id}`] : []),
            ...(personaDraft ? ["persona-draft"] : []),
            ...(personaEditDocument ? ["persona-edit"] : []),
          ]
        : conversationMessages,
    [
      conversationMessages,
      personaDraft,
      personaEditDocument,
      personaQuestion,
      personaSetupMessages,
      personaSetupOpen,
    ],
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
  const handlePersonaFilesImported = (result: PersonaRagImportResult) => {
    if (result.names.length === 0) return;
    const firstAgentRequest = personaSetupStage !== "agent";
    setPersonaDraft(null);
    setPersonaCompletedDocument(null);
    setPersonaEditDocument(null);
    setPersonaQuestion(null);
    setPersonaSelectedOptions([]);
    setPersonaCustomAnswer("");
    setPersonaSetupStage("agent");
    void personaRag.refetch();
    continuePersonaSetupAfterImport(result.names, firstAgentRequest ? [] : personaSetupMessages);
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
      setPersonaDraft(null);
      setPersonaCompletedDocument(null);
      setPersonaEditDocument(null);
      setPersonaSetupStage("welcome");
      setPersonaQuestion(null);
      setPersonaSelectedOptions([]);
      setPersonaCustomAnswer("");
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
      setPersonaDraft(null);
      setPersonaCompletedDocument(null);
      setPersonaEditDocument(null);
      setPersonaDocumentOpen(false);
      setPersonaDocumentPath("");
      setPersonaDocumentContent("");
      setPersonaDocumentError(null);
      setPersonaSetupStage("welcome");
      setPersonaQuestion(null);
      setPersonaSelectedOptions([]);
      setPersonaCustomAnswer("");
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
    previousMessages = personaSetupMessages,
    includeReferences = false,
  ) => {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt || isStreaming) return;
    const requestId = crypto.randomUUID();
    const assistantId = crypto.randomUUID();
    const history: ChatMessage[] = previousMessages
      .filter((entry) => !entry.modelExcluded)
      .map((entry) => ({ role: entry.role, content: entry.modelContent ?? entry.content }))
      .filter((entry) => entry.content.trim());
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
    if (showUserMessage) {
      setPersonaDraft(null);
      setPersonaCompletedDocument(null);
      setPersonaEditDocument(null);
      setPersonaQuestion(null);
      setPersonaSelectedOptions([]);
      setPersonaCustomAnswer("");
    }
    setMessage("");
    setIsStreaming(true);
    let proposedDraft: PersonaProfileInput | null = null;
    let rawAssistantContent = "";
    try {
      await window.desktop.chat.send(
        {
          requestId,
          sessionId: personaSessionId.current,
          messages: [...history, { role: "user", content: normalizedPrompt }],
          knowledgeEnabled: true,
          strategyEnabled: false,
          autoExecute: false,
          mode: "persona_setup",
          includePersonaReferences: includeReferences,
        },
        (event) => {
          if (event.type === "text-delta") {
            rawAssistantContent += event.delta;
            return;
          }
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
      const structuredQuestion = parsePersonaQuestion(rawAssistantContent);
      const completedPersona = parseCompletedPersona(rawAssistantContent);
      const nextDraft = proposedDraft ?? completedPersona?.draft ?? null;
      requestLatestMessage(true);
      setPersonaCompletedDocument(completedPersona?.document ?? null);
      setPersonaEditDocument(null);
      if (structuredQuestion) {
        setPersonaQuestion(structuredQuestion);
        setPersonaSelectedOptions([]);
        setPersonaCustomAnswer("");
        setPersonaSetupMessages((current) =>
          current.map((entry) =>
            entry.id === assistantId
              ? {
                  ...entry,
                  content: structuredQuestion.text,
                  modelContent: rawAssistantContent,
                  status: "complete",
                }
              : entry,
          ),
        );
      } else if (nextDraft) {
        setPersonaQuestion(null);
        setPersonaDraft(nextDraft);
        setPersonaSetupMessages((current) =>
          current.map((entry) =>
            entry.id === assistantId
              ? {
                  ...entry,
                  content: formatPersonaDraft(nextDraft),
                  ...(rawAssistantContent ? { modelContent: rawAssistantContent } : {}),
                  status: "complete",
                }
              : entry,
          ),
        );
      } else if (rawAssistantContent) {
        setPersonaSetupMessages((current) =>
          current.map((entry) =>
            entry.id === assistantId
              ? { ...entry, content: rawAssistantContent, status: "complete" }
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
    personaSessionId.current = crypto.randomUUID();
    setPersonaDocumentOpen(false);
    setPersonaSetupOpen(true);
    setPersonaSetupStage("welcome");
    setPersonaSetupMessages([
      personaSetupMessage(
        "assistant",
        "欢迎使用用户画像助手。我会通过简短对话了解账号主体、目标人群、长期定位和内容边界，并整理出可由你自由修改的画像草稿。",
        true,
      ),
    ]);
    setPersonaDraft(null);
    setPersonaCompletedDocument(null);
    setPersonaEditDocument(null);
    setPersonaQuestion(null);
    setPersonaSelectedOptions([]);
    setPersonaCustomAnswer("");
    setMessage("");
  };

  const startPersonaConversation = () => {
    setPersonaSetupStage("agent");
    setPersonaQuestion(null);
    void sendPersonaAgentMessage(
      "请开始通过自然对话帮助我建立长期用户画像，并先提出当前最必要的一个问题。",
      false,
      [],
    );
  };

  const updatePersonaScalar = (key: PersonaScalarField, value: string) => {
    setPersonaEditDocument((current) =>
      current
        ? {
            ...current,
            profile: {
              ...current.profile,
              [key]: value.trim() ? value : null,
            },
          }
        : current,
    );
  };

  const updatePersonaList = (key: PersonaListField, value: string) => {
    setPersonaEditDocument((current) =>
      current
        ? {
            ...current,
            profile: {
              ...current.profile,
              [key]: value
                .split(/\r?\n/)
                .map((item) => item.trim())
                .filter(Boolean),
            },
          }
        : current,
    );
  };

  const togglePersonaOption = (option: string) => {
    setPersonaSelectedOptions((current) => {
      if (personaQuestion?.mode === "single") return current.includes(option) ? [] : [option];
      return current.includes(option)
        ? current.filter((candidate) => candidate !== option)
        : [...current, option];
    });
    if (personaQuestion?.mode === "single") setPersonaCustomAnswer("");
  };

  const submitPersonaQuestion = () => {
    if (!personaQuestion) return;
    const custom = personaCustomAnswer.trim();
    const answer =
      personaQuestion.mode === "multiple"
        ? [...personaSelectedOptions, ...(custom ? [custom] : [])].join("、")
        : custom || personaSelectedOptions[0] || "";
    if (!answer) return;
    void sendPersonaAgentMessage(answer);
  };

  const skipPersonaQuestion = () => {
    if (!personaQuestion?.allowSkip) return;
    void sendPersonaAgentMessage("跳过");
  };

  function continuePersonaSetupAfterImport(
    names: string[],
    previousMessages = personaSetupMessages,
  ) {
    const prompt =
      `我刚添加了这些本地参考资料：${names.join("、")}。` +
      "资料正文已经由客户端在本地读取，并将在本次请求中一并提供。" +
      "请先分析已有资料：信息足够就形成用户画像草稿；仍有关键缺失时，只追问当前最必要的问题。";
    if (!personaSetupOpen) {
      setPersonaSetupOpen(true);
      setPersonaSetupMessages([]);
      setMessage("");
      void sendPersonaAgentMessage(prompt, false, [], true);
      return;
    }
    void sendPersonaAgentMessage(prompt, false, previousMessages, true);
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
    ready: "Agent 已连接",
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
          <div className={`persona-sidebar-meta ${displayedAgentState}`}>
            <span />
            {agentLabels[displayedAgentState]}
            {personaRag.data?.ready ? ` · ${personaRag.data.fileCount} 个本地文件` : ""}
          </div>
          <div className="persona-sidebar-buttons">
            <button
              type="button"
              className="persona-sidebar-primary"
              disabled={
                personaRag.isPending ||
                isStreaming ||
                personaSetupOpen ||
                readPersonaDocument.isPending ||
                deletePersonaRag.isPending
              }
              onClick={() => {
                if (personaRag.data?.ready) readPersonaDocument.mutate();
                else beginPersonaSetup();
              }}
            >
              {personaSetupOpen
                ? "正在构建"
                : readPersonaDocument.isPending
                  ? "正在打开…"
                  : personaDocumentOpen
                    ? "正在查看画像"
                    : personaRag.data?.ready
                      ? "查看或更新画像"
                      : "开始构建画像"}
            </button>
            {personaRag.data?.ready ? (
              <button
                type="button"
                className="persona-sidebar-delete"
                aria-label="删除用户画像"
                title="删除用户画像"
                disabled={deletePersonaRag.isPending}
                onClick={() => {
                  setPersonaDeleteError(null);
                  setPersonaDeleteConfirm(true);
                }}
              >
                <Icon name="trash" />
              </button>
            ) : null}
          </div>
          {personaDeleteConfirm ? (
            <div className="persona-delete-confirm" role="alert">
              <span>确定删除本地用户画像？</span>
              <div>
                <button
                  type="button"
                  disabled={deletePersonaRag.isPending}
                  onClick={() => {
                    setPersonaDeleteConfirm(false);
                    setPersonaDeleteError(null);
                  }}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="danger"
                  disabled={deletePersonaRag.isPending}
                  onClick={() => deletePersonaRag.mutate()}
                >
                  {deletePersonaRag.isPending ? "正在删除…" : "确认删除"}
                </button>
              </div>
            </div>
          ) : null}
          {personaDeleteError ? (
            <p className="persona-rag-error" role="alert">
              {personaDeleteError}
            </p>
          ) : null}
          {personaDocumentError && !personaDocumentOpen ? (
            <p className="persona-rag-error" role="alert">
              {personaDocumentError}
            </p>
          ) : null}
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
            {personaDocumentOpen ? (
              <section className="persona-document-editor">
                <header>
                  <div>
                    <strong>用户画像主文件</strong>
                    <small title={personaDocumentPath}>{personaDocumentPath}</small>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setPersonaDocumentOpen(false);
                      setPersonaDocumentError(null);
                    }}
                  >
                    关闭
                  </button>
                </header>
                <textarea
                  aria-label="用户画像主文件内容"
                  value={personaDocumentContent}
                  spellCheck={false}
                  onChange={(event) => {
                    savePersonaDocument.reset();
                    setPersonaDocumentContent(event.target.value);
                  }}
                />
                <footer>
                  <span>
                    {savePersonaDocument.isSuccess
                      ? "修改已保存到本地"
                      : "Markdown 文件，可直接修改标题和内容"}
                  </span>
                  <button
                    type="button"
                    className="primary"
                    disabled={!personaDocumentContent.trim() || savePersonaDocument.isPending}
                    onClick={() => savePersonaDocument.mutate(personaDocumentContent)}
                  >
                    {savePersonaDocument.isPending ? "正在保存…" : "保存修改"}
                  </button>
                </footer>
                {personaDocumentError ? (
                  <p className="persona-rag-error" role="alert">
                    {personaDocumentError}
                  </p>
                ) : null}
              </section>
            ) : conversationMessages.length === 0 && personaSetupOpen ? (
              <div className="persona-setup-conversation">
                <header>
                  <div>
                    <strong>建立用户画像</strong>
                    <small>Agent 会根据已有回答和本地资料动态追问</small>
                  </div>
                  <div className="persona-setup-actions">
                    <button
                      type="button"
                      disabled={isStreaming}
                      onClick={() => {
                        setPersonaSetupOpen(false);
                        setPersonaSetupMessages([]);
                        setPersonaDraft(null);
                        setPersonaCompletedDocument(null);
                        setPersonaEditDocument(null);
                        setPersonaSetupStage("welcome");
                        setPersonaQuestion(null);
                        setPersonaSelectedOptions([]);
                        setPersonaCustomAnswer("");
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
                {personaSetupStage === "welcome" ? (
                  <div className="persona-trigger-actions">
                    <button type="button" className="primary" onClick={startPersonaConversation}>
                      开始建立画像
                    </button>
                  </div>
                ) : null}
                {personaQuestion ? (
                  <section className="persona-question-card" aria-label={personaQuestion.text}>
                    <header>
                      <strong>
                        {personaQuestion.mode === "single"
                          ? "请选择一项"
                          : personaQuestion.mode === "multiple"
                            ? "可选择多项"
                            : "请输入回答"}
                      </strong>
                    </header>
                    {personaQuestion.options.length > 0 ? (
                      <div className="persona-question-options">
                        {personaQuestion.options.map((option) => {
                          const selected = personaSelectedOptions.includes(option);
                          return (
                            <button
                              type="button"
                              key={option}
                              className={selected ? "selected" : ""}
                              aria-pressed={selected}
                              onClick={() => togglePersonaOption(option)}
                            >
                              <span>{selected ? "✓" : ""}</span>
                              {option}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                    {personaQuestion.mode === "text" || personaQuestion.allowCustom ? (
                      <input
                        value={personaCustomAnswer}
                        onChange={(event) => {
                          setPersonaCustomAnswer(event.target.value);
                          if (personaQuestion.mode === "single") setPersonaSelectedOptions([]);
                        }}
                        onKeyDown={(event) => {
                          if (
                            event.key === "Enter" &&
                            !event.nativeEvent.isComposing &&
                            personaCustomAnswer.trim()
                          ) {
                            event.preventDefault();
                            submitPersonaQuestion();
                          }
                        }}
                        placeholder="手动输入"
                      />
                    ) : null}
                    <footer>
                      {personaQuestion.allowSkip ? (
                        <button type="button" onClick={skipPersonaQuestion}>
                          跳过
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="primary"
                        disabled={
                          personaQuestion.mode === "multiple"
                            ? personaSelectedOptions.length === 0 && !personaCustomAnswer.trim()
                            : !personaSelectedOptions[0] && !personaCustomAnswer.trim()
                        }
                        onClick={submitPersonaQuestion}
                      >
                        提交回答
                      </button>
                    </footer>
                  </section>
                ) : null}
                {personaDraft ? (
                  <article className="persona-draft-card">
                    <header>
                      <div>
                        <strong>用户画像草稿待确认</strong>
                        <small>确认前不会写入本地主文件</small>
                      </div>
                    </header>
                    {personaEditDocument ? (
                      <div className="persona-profile-edit-form">
                        <p>所有字段均可自由修改；列表字段每行填写一项，空行会自动忽略。</p>
                        <div className="persona-profile-edit-grid">
                          {personaScalarFields.map((field) => (
                            <label key={field.key}>
                              <span>{field.label}</span>
                              <input
                                value={personaEditDocument.profile[field.key] ?? ""}
                                onChange={(event) =>
                                  updatePersonaScalar(field.key, event.target.value)
                                }
                              />
                            </label>
                          ))}
                          {personaListFields.map((field) => (
                            <label key={field.key}>
                              <span>{field.label}</span>
                              <textarea
                                value={personaEditDocument.profile[field.key].join("\n")}
                                onChange={(event) =>
                                  updatePersonaList(field.key, event.target.value)
                                }
                              />
                            </label>
                          ))}
                        </div>
                      </div>
                    ) : (
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
                    )}
                    {confirmPersonaRag.isError ? (
                      <p className="persona-rag-error" role="alert">
                        保存失败：{readableError(confirmPersonaRag.error)}
                      </p>
                    ) : null}
                    <footer>
                      <button
                        type="button"
                        onClick={() => {
                          if (personaEditDocument) {
                            setPersonaEditDocument(null);
                            return;
                          }
                          if (personaCompletedDocument) {
                            setPersonaEditDocument(structuredClone(personaCompletedDocument));
                            requestLatestMessage(true);
                            return;
                          }
                          setPersonaDraft(null);
                          setPersonaCompletedDocument(null);
                        }}
                      >
                        {personaEditDocument
                          ? "取消修改"
                          : personaCompletedDocument
                            ? "修改画像"
                            : "继续对话修改"}
                      </button>
                      <button
                        type="button"
                        className="primary"
                        disabled={confirmPersonaRag.isPending}
                        onClick={() =>
                          confirmPersonaRag.mutate(
                            personaEditDocument ?? personaCompletedDocument ?? personaDraft,
                          )
                        }
                      >
                        {confirmPersonaRag.isPending
                          ? "正在保存…"
                          : personaEditDocument
                            ? "保存修改后的画像"
                            : "确认并保存"}
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
                    <small>进入后由你决定是否添加参考资料</small>
                  </span>
                </button>
                {personaRag.isError ? (
                  <p className="persona-rag-error" role="alert">
                    {readableError(personaRag.error)}
                  </p>
                ) : null}
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
        {!personaDocumentOpen &&
        ((personaSetupOpen && personaSetupStage === "agent") ||
          (!personaSetupOpen && (personaRag.data?.ready || conversationMessages.length > 0))) ? (
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
            <fieldset
              aria-label={
                personaSetupOpen ? "用户画像对话输入区，可拖拽上传资料" : "任务对话输入区"
              }
              className={
                personaSetupOpen && personaDropActive ? "composer drop-active" : "composer"
              }
              onDragEnter={personaSetupOpen ? handlePersonaDragOver : undefined}
              onDragOver={personaSetupOpen ? handlePersonaDragOver : undefined}
              onDragLeave={personaSetupOpen ? () => setPersonaDropActive(false) : undefined}
              onDrop={personaSetupOpen ? handlePersonaDrop : undefined}
            >
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
                  disabled={personaSetupOpen && (personaUploadPending || isStreaming)}
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
            </fieldset>
          </div>
        ) : null}
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
