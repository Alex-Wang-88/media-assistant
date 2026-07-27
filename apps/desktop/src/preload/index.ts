import type {
  AgentStatus,
  Artifact,
  ChatSendInput,
  ChatStreamEvent,
  CreateProjectInput,
  DesktopApi,
  FilePreview,
  PersonaProfileInput,
  PersonaRagImportResult,
  PersonaRagStatus,
  Project,
  WorkspaceEntry,
} from "@yoom/desktop-contracts";
import { contextBridge, ipcRenderer } from "electron";
import { expectChatStreamEvent } from "./chat-event";

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
  personaRagImportFiles: "persona-rag:import-files",
  filesListOutputs: "files:list-outputs",
  filesPreview: "files:preview",
  filesOpen: "files:open",
  filesReveal: "files:reveal",
  knowledgeSearch: "knowledge:search",
  chatStatus: "chat:status",
  chatSend: "chat:send",
  chatEvent: "chat:event",
  publishStart: "publish:start",
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
    confirm: (input: PersonaProfileInput) =>
      ipcRenderer
        .invoke(channels.personaRagConfirm, input)
        .then((value: unknown) => expectObject<PersonaRagStatus>(value)),
    importFiles: () =>
      ipcRenderer
        .invoke(channels.personaRagImportFiles)
        .then((value: unknown) => expectObject<PersonaRagImportResult>(value)),
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
      const listener = (_event: Electron.IpcRendererEvent, raw: unknown) => {
        const event = expectChatStreamEvent(raw);
        if (event.requestId === input.requestId) onEvent(event);
      };
      ipcRenderer.on(channels.chatEvent, listener);
      try {
        await ipcRenderer.invoke(channels.chatSend, input);
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
  },
};

contextBridge.exposeInMainWorld("desktop", api);
