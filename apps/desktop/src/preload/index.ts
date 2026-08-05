import type {
  AgentStatus,
  Artifact,
  BilibiliAccount,
  ChatSendInput,
  ChatStreamEvent,
  CreateProjectInput,
  DesktopApi,
  FilePreview,
  LocalPublishImage,
  PersonaFlowState,
  PersonaFlowTurnInput,
  PersonaFlowTurnResult,
  PersonaRagConfirmInput,
  PersonaRagDocument,
  PersonaRagDroppedFile,
  PersonaRagImportResult,
  PersonaRagStatus,
  PlatformContentGenerateInput,
  PlatformContentResult,
  ProductPromotionAgentApiTurnResult,
  ProductPromotionTurnInput,
  Project,
  PublishAutomationResult,
  PublishDraftState,
  WorkspaceEntry,
  ZhihuAccount,
} from "@yoom/desktop-contracts";
import { contextBridge, ipcRenderer } from "electron";
import { createChatEventGate } from "./chat-event";

const channels = {
  workspaceSelect: "workspace:select",
  workspaceCurrent: "workspace:current",
  workspaceList: "workspace:list",
  workspaceActivate: "workspace:activate",
  tasksCreate: "tasks:create",
  tasksList: "tasks:list",
  tasksDelete: "tasks:delete",
  personaRagStatus: "persona-rag:status",
  personaRagConfirm: "persona-rag:confirm",
  personaRagReadDocument: "persona-rag:read-document",
  personaRagSaveDocument: "persona-rag:save-document",
  personaRagDelete: "persona-rag:delete",
  personaRagImportFiles: "persona-rag:import-files",
  personaRagImportDroppedFiles: "persona-rag:import-dropped-files",
  personaFlowLoad: "persona-flow:load",
  personaFlowStart: "persona-flow:start",
  personaFlowTurn: "persona-flow:turn",
  productPromotionTurn: "product-promotion:turn",
  platformContentGenerate: "platform-content:generate",
  filesListOutputs: "files:list-outputs",
  filesPreview: "files:preview",
  filesOpen: "files:open",
  filesReveal: "files:reveal",
  knowledgeSearch: "knowledge:search",
  chatStatus: "chat:status",
  chatSend: "chat:send",
  chatEvent: "chat:event",
  publishStart: "publish:start",
  publishDraftsLoad: "publish-drafts:load",
  publishDraftsSave: "publish-drafts:save",
  publishImagesSelect: "publish-images:select",
  publishImagesRelease: "publish-images:release",
  publishBilibiliAccountsList: "publish:bilibili-accounts-list",
  publishBilibiliAccountCreate: "publish:bilibili-account-create",
  publishBilibiliAccountDelete: "publish:bilibili-account-delete",
  publishBilibiliOpen: "publish:bilibili-open",
  publishBilibiliFill: "publish:bilibili-fill",
  publishZhihuAccountsList: "publish:zhihu-accounts-list",
  publishZhihuAccountCreate: "publish:zhihu-account-create",
  publishZhihuAccountDelete: "publish:zhihu-account-delete",
  publishZhihuOpen: "publish:zhihu-open",
  publishZhihuFill: "publish:zhihu-fill",
} as const;

function expectString(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("IPC 返回值应为字符串");
  return value;
}

function expectNullableString(value: unknown): string | null {
  if (value === null) return null;
  return expectString(value);
}

function expectArray<T>(value: unknown): T[] {
  if (!Array.isArray(value)) throw new TypeError("IPC 返回值应为数组");
  return value as T[];
}

function expectObject<T>(value: unknown): T {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("IPC 返回值应为对象");
  }
  return value as T;
}

function expectAgentStatus(value: unknown): AgentStatus {
  const status = expectObject<Record<string, unknown>>(value);
  if (
    !["ready", "unconfigured", "unavailable"].includes(String(status.state)) ||
    (status.detail !== undefined && typeof status.detail !== "string")
  ) {
    throw new TypeError("Agent 状态格式无效");
  }
  return status as AgentStatus;
}

const api: DesktopApi = {
  workspace: {
    select: () => ipcRenderer.invoke(channels.workspaceSelect).then(expectNullableString),
    current: () => ipcRenderer.invoke(channels.workspaceCurrent).then(expectNullableString),
    list: () =>
      ipcRenderer
        .invoke(channels.workspaceList)
        .then((value: unknown) => expectArray<WorkspaceEntry>(value)),
    activate: (path) => ipcRenderer.invoke(channels.workspaceActivate, { path }).then(expectString),
  },
  tasks: {
    create: (input: CreateProjectInput) =>
      ipcRenderer
        .invoke(channels.tasksCreate, input)
        .then((value: unknown) => expectObject<Project>(value)),
    list: () =>
      ipcRenderer.invoke(channels.tasksList).then((value: unknown) => expectArray<Project>(value)),
    delete: (projectId) =>
      ipcRenderer.invoke(channels.tasksDelete, { projectId }).then(() => undefined),
  },
  personaRag: {
    status: () =>
      ipcRenderer
        .invoke(channels.personaRagStatus)
        .then((value: unknown) => expectObject<PersonaRagStatus>(value)),
    confirm: (input: PersonaRagConfirmInput) =>
      ipcRenderer
        .invoke(channels.personaRagConfirm, input)
        .then((value: unknown) => expectObject<PersonaRagStatus>(value)),
    readDocument: () =>
      ipcRenderer
        .invoke(channels.personaRagReadDocument)
        .then((value: unknown) => expectObject<PersonaRagDocument>(value)),
    saveDocument: (content: string) =>
      ipcRenderer
        .invoke(channels.personaRagSaveDocument, { content })
        .then((value: unknown) => expectObject<PersonaRagStatus>(value)),
    delete: () =>
      ipcRenderer
        .invoke(channels.personaRagDelete)
        .then((value: unknown) => expectObject<PersonaRagStatus>(value)),
    importFiles: () =>
      ipcRenderer
        .invoke(channels.personaRagImportFiles)
        .then((value: unknown) => expectObject<PersonaRagImportResult>(value)),
    importDroppedFiles: (files: PersonaRagDroppedFile[]) =>
      ipcRenderer
        .invoke(channels.personaRagImportDroppedFiles, files)
        .then((value: unknown) => expectObject<PersonaRagImportResult>(value)),
  },
  personaFlow: {
    load: () =>
      ipcRenderer.invoke(channels.personaFlowLoad).then((value: unknown) => {
        if (value === null) return null;
        return expectObject<PersonaFlowState>(value);
      }),
    start: () =>
      ipcRenderer
        .invoke(channels.personaFlowStart)
        .then((value: unknown) => expectObject<PersonaFlowState>(value)),
    turn: (input: PersonaFlowTurnInput) =>
      ipcRenderer
        .invoke(channels.personaFlowTurn, input)
        .then((value: unknown) => expectObject<PersonaFlowTurnResult>(value)),
  },
  productPromotion: {
    turn: (input: ProductPromotionTurnInput) =>
      ipcRenderer
        .invoke(channels.productPromotionTurn, input)
        .then((value: unknown) => expectObject<ProductPromotionAgentApiTurnResult>(value)),
  },
  platformContent: {
    generate: (input: PlatformContentGenerateInput) =>
      ipcRenderer
        .invoke(channels.platformContentGenerate, input)
        .then((value: unknown) => expectObject<PlatformContentResult>(value)),
  },
  files: {
    listOutputs: (projectId) =>
      ipcRenderer
        .invoke(channels.filesListOutputs, { projectId })
        .then((value: unknown) => expectArray<Artifact>(value)),
    preview: (projectId, path) =>
      ipcRenderer
        .invoke(channels.filesPreview, { projectId, path })
        .then((value: unknown) => expectObject<FilePreview>(value)),
    open: (projectId, path) => ipcRenderer.invoke(channels.filesOpen, { projectId, path }),
    reveal: (projectId, path) => ipcRenderer.invoke(channels.filesReveal, { projectId, path }),
  },
  knowledge: {
    search: (projectId, query) =>
      ipcRenderer
        .invoke(channels.knowledgeSearch, { projectId, query, limit: 5 })
        .then((value: unknown) =>
          expectArray<{ source: string; excerpt: string; score: number }>(value),
        ),
  },
  chat: {
    status: () => ipcRenderer.invoke(channels.chatStatus).then(expectAgentStatus),
    send: async (input: ChatSendInput, onEvent: (event: ChatStreamEvent) => void) => {
      const gate = createChatEventGate(input.requestId, onEvent);
      const listener = (_event: Electron.IpcRendererEvent, raw: unknown) => {
        gate.handle(raw);
      };
      ipcRenderer.on(channels.chatEvent, listener);
      try {
        await ipcRenderer.invoke(channels.chatSend, input);
        await gate.waitForTerminal();
      } finally {
        ipcRenderer.removeListener(channels.chatEvent, listener);
      }
    },
  },
  publish: {
    start: (input) =>
      ipcRenderer
        .invoke(channels.publishStart, input)
        .then((value: unknown) => expectObject<{ jobId: string }>(value)),
    loadDrafts: () =>
      ipcRenderer.invoke(channels.publishDraftsLoad).then((value: unknown) => {
        if (value === null) return null;
        return expectObject<PublishDraftState>(value);
      }),
    saveDrafts: (state) =>
      ipcRenderer.invoke(channels.publishDraftsSave, state).then(() => undefined),
    selectImages: (remaining) =>
      ipcRenderer
        .invoke(channels.publishImagesSelect, { remaining })
        .then((value: unknown) => expectArray<LocalPublishImage>(value)),
    releaseImages: (ids) =>
      ipcRenderer.invoke(channels.publishImagesRelease, { ids }).then(() => undefined),
    listBilibiliAccounts: () =>
      ipcRenderer
        .invoke(channels.publishBilibiliAccountsList)
        .then((value: unknown) => expectArray<BilibiliAccount>(value)),
    createBilibiliAccount: () =>
      ipcRenderer
        .invoke(channels.publishBilibiliAccountCreate)
        .then((value: unknown) => expectObject<BilibiliAccount>(value)),
    deleteBilibiliAccount: (accountId) =>
      ipcRenderer
        .invoke(channels.publishBilibiliAccountDelete, { accountId })
        .then((value: unknown) => expectArray<BilibiliAccount>(value)),
    openBilibili: (input) =>
      ipcRenderer
        .invoke(channels.publishBilibiliOpen, input)
        .then((value: unknown) => expectObject<PublishAutomationResult>(value)),
    fillBilibili: (input) =>
      ipcRenderer
        .invoke(channels.publishBilibiliFill, input)
        .then((value: unknown) => expectObject<PublishAutomationResult>(value)),
    listZhihuAccounts: () =>
      ipcRenderer
        .invoke(channels.publishZhihuAccountsList)
        .then((value: unknown) => expectArray<ZhihuAccount>(value)),
    createZhihuAccount: () =>
      ipcRenderer
        .invoke(channels.publishZhihuAccountCreate)
        .then((value: unknown) => expectObject<ZhihuAccount>(value)),
    deleteZhihuAccount: (accountId) =>
      ipcRenderer
        .invoke(channels.publishZhihuAccountDelete, { accountId })
        .then((value: unknown) => expectArray<ZhihuAccount>(value)),
    openZhihu: (input) =>
      ipcRenderer
        .invoke(channels.publishZhihuOpen, input)
        .then((value: unknown) => expectObject<PublishAutomationResult>(value)),
    fillZhihu: (input) =>
      ipcRenderer
        .invoke(channels.publishZhihuFill, input)
        .then((value: unknown) => expectObject<PublishAutomationResult>(value)),
  },
};

contextBridge.exposeInMainWorld("desktop", api);
