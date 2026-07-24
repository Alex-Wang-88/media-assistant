import { randomUUID } from "node:crypto";
import {
  activateWorkspaceInputSchema,
  chatSendInputSchema,
  createProjectInputSchema,
  fileActionInputSchema,
  ipcChannels,
  knowledgeSearchInputSchema,
  listOutputsInputSchema,
  previewFileInputSchema,
  publishStartInputSchema,
} from "@yoom/desktop-contracts";
import { type BrowserWindow, ipcMain, shell } from "electron";
import { streamChat } from "./chat-client";
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
  ipcMain.handle(ipcChannels.chatSend, async (event, raw) => {
    const input = chatSendInputSchema.parse(raw);
    await streamChat(input, (streamEvent) => {
      if (!event.sender.isDestroyed()) event.sender.send(ipcChannels.chatEvent, streamEvent);
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
