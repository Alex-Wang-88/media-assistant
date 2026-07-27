import { randomUUID } from "node:crypto";
import {
  activateWorkspaceInputSchema,
  chatSendInputSchema,
  createProjectInputSchema,
  deleteProjectInputSchema,
  fileActionInputSchema,
  ipcChannels,
  knowledgeSearchInputSchema,
  listOutputsInputSchema,
  personaRagConfirmInputSchema,
  personaRagDroppedFilesSchema,
  personaRagSaveDocumentInputSchema,
  previewFileInputSchema,
  publishStartInputSchema,
} from "@yoom/desktop-contracts";
import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions, shell } from "electron";
import { getAgentStatus, streamChat } from "./chat-client";
import { validatePersonaProposal } from "./persona-agent";
import type { Workspace } from "./workspace";

type WorkspaceAccess = {
  current(): Workspace | null;
  select(): Promise<Workspace | null>;
  list(): { name: string; path: string; isDefault: boolean }[];
  activate(path: string): Promise<Workspace>;
};

export function registerIpc(access: WorkspaceAccess): void {
  ipcMain.handle(ipcChannels.workspaceCurrent, () => access.current()?.root ?? null);
  ipcMain.handle(ipcChannels.workspaceSelect, async () => {
    const workspace = await access.select();
    return workspace?.root ?? null;
  });
  ipcMain.handle(ipcChannels.workspaceList, () => access.list());
  ipcMain.handle(ipcChannels.workspaceActivate, async (_event, raw) => {
    const input = activateWorkspaceInputSchema.parse(raw);
    return (await access.activate(input.path)).root;
  });
  ipcMain.handle(ipcChannels.tasksCreate, (_event, raw) => {
    return requireWorkspace(access).createProject(createProjectInputSchema.parse(raw));
  });
  ipcMain.handle(ipcChannels.tasksList, () => requireWorkspace(access).listProjects());
  ipcMain.handle(ipcChannels.tasksDelete, (_event, raw) => {
    const input = deleteProjectInputSchema.parse(raw);
    requireWorkspace(access).deleteProject(input.projectId);
  });
  ipcMain.handle(ipcChannels.personaRagStatus, () => requireWorkspace(access).personaRagStatus());
  ipcMain.handle(ipcChannels.personaRagConfirm, (_event, raw) =>
    requireWorkspace(access).buildPersonaRag(personaRagConfirmInputSchema.parse(raw)),
  );
  ipcMain.handle(ipcChannels.personaRagReadDocument, () =>
    requireWorkspace(access).readPersonaDocument(),
  );
  ipcMain.handle(ipcChannels.personaRagSaveDocument, (_event, raw) => {
    const input = personaRagSaveDocumentInputSchema.parse(raw);
    return requireWorkspace(access).savePersonaDocument(input.content);
  });
  ipcMain.handle(ipcChannels.personaRagDelete, () => requireWorkspace(access).deletePersonaRag());
  ipcMain.handle(ipcChannels.personaRagImportFiles, async (event) => {
    const parent = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      title: "选择 Persona RAG 参考资料",
      properties: ["openFile", "multiSelections"],
    };
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled) return { names: [] };
    return {
      names: requireWorkspace(access).importPersonaRagFiles(result.filePaths),
    };
  });
  ipcMain.handle(ipcChannels.personaRagImportDroppedFiles, (_event, raw) => ({
    names: requireWorkspace(access).importDroppedPersonaRagFiles(
      personaRagDroppedFilesSchema.parse(raw),
    ),
  }));
  ipcMain.handle(ipcChannels.filesListOutputs, (_event, raw) => {
    const input = listOutputsInputSchema.parse(raw);
    return requireWorkspace(access).listOutputs(input.projectId);
  });
  ipcMain.handle(ipcChannels.filesPreview, (_event, raw) => {
    const input = previewFileInputSchema.parse(raw);
    return requireWorkspace(access).preview(input.projectId, input.path);
  });
  ipcMain.handle(ipcChannels.filesOpen, async (_event, raw) => {
    const input = fileActionInputSchema.parse(raw);
    const error = await shell.openPath(
      requireWorkspace(access).resolveFile(input.projectId, input.path),
    );
    if (error) throw new Error(error);
  });
  ipcMain.handle(ipcChannels.filesReveal, (_event, raw) => {
    const input = fileActionInputSchema.parse(raw);
    shell.showItemInFolder(requireWorkspace(access).resolveFile(input.projectId, input.path));
  });
  ipcMain.handle(ipcChannels.knowledgeSearch, (_event, raw) => {
    knowledgeSearchInputSchema.parse(raw);
    // The worker-backed vector store is the next implementation layer. An empty result is
    // safer than leaking unselected documents or forwarding the full knowledge base.
    return [];
  });
  ipcMain.handle(ipcChannels.chatStatus, () => getAgentStatus());
  ipcMain.handle(ipcChannels.chatSend, async (event, raw) => {
    const input = chatSendInputSchema.parse(raw);
    const workspace = requireWorkspace(access);
    const { includePersonaReferences, ...chatInput } = input;
    const agentInput =
      chatInput.mode === "persona_setup" && includePersonaReferences
        ? {
            ...chatInput,
            personaReferenceContext: workspace.personaRagReferenceContext(),
          }
        : chatInput;
    await streamChat(agentInput, (streamEvent) => {
      let outgoingEvent = streamEvent;
      if (
        chatInput.mode === "persona_setup" &&
        streamEvent.type === "tool-call" &&
        streamEvent.name === "propose_persona"
      ) {
        outgoingEvent = validatePersonaProposal(streamEvent);
      }
      if (!event.sender.isDestroyed()) event.sender.send(ipcChannels.chatEvent, outgoingEvent);
    });
  });
  ipcMain.handle(ipcChannels.publishStart, (_event, raw) => {
    const input = publishStartInputSchema.parse(raw);
    requireWorkspace(access).resolveFile(input.projectId, input.artifactPath);
    return { jobId: randomUUID() };
  });
}

function requireWorkspace(access: WorkspaceAccess): Workspace {
  const workspace = access.current();
  if (!workspace) throw new Error("请先选择工作区");
  return workspace;
}

export function guardWindowNavigation(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault();
  });
}
