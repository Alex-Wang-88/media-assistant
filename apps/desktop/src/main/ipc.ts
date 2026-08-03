import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { basename, extname } from "node:path";
import {
  activateWorkspaceInputSchema,
  bilibiliFillInputSchema,
  chatSendInputSchema,
  createProjectInputSchema,
  deleteBilibiliAccountInputSchema,
  deleteProjectInputSchema,
  fileActionInputSchema,
  ipcChannels,
  knowledgeSearchInputSchema,
  listOutputsInputSchema,
  persistedPublishDraftStateSchema,
  personaFlowTurnInputSchema,
  personaRagConfirmInputSchema,
  personaRagDroppedFilesSchema,
  personaRagSaveDocumentInputSchema,
  previewFileInputSchema,
  publishDraftStateSchema,
  publishStartInputSchema,
  releasePublishImagesInputSchema,
  selectPublishImagesInputSchema,
} from "@yoom/desktop-contracts";
import {
  BrowserWindow,
  dialog,
  ipcMain,
  nativeImage,
  type OpenDialogOptions,
  shell,
} from "electron";
import {
  continueFillingBilibili,
  createBilibiliAccount,
  deleteBilibiliAccount,
  listBilibiliAccounts,
  openAndFillBilibili,
} from "./bilibili-publisher";
import { getAgentStatus, streamChat, turnPersonaAgent } from "./chat-client";
import {
  applyPersonaAgentTurnResponse,
  buildPersonaAgentTurnRequest,
  createPersonaFlowState,
  ensurePersonaStageConversation,
  normalizePersonaAgentTurnResponse,
} from "./persona-flow";
import type { Workspace } from "./workspace";

type WorkspaceAccess = {
  current(): Workspace | null;
  select(): Promise<Workspace | null>;
  list(): { name: string; path: string; isDefault: boolean }[];
  activate(path: string): Promise<Workspace>;
};

const selectedPublishImages = new Map<string, string>();

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
  ipcMain.handle(ipcChannels.personaFlowLoad, () => requireWorkspace(access).loadPersonaFlow());
  ipcMain.handle(ipcChannels.personaFlowStart, () => {
    const workspace = requireWorkspace(access);
    const flow = createPersonaFlowState();
    workspace.savePersonaFlow(flow);
    return flow;
  });
  ipcMain.handle(ipcChannels.personaFlowTurn, async (_event, raw) => {
    const input = personaFlowTurnInputSchema.parse(raw);
    const workspace = requireWorkspace(access);
    const stored = workspace.loadPersonaFlow();
    if (!stored) throw new Error("当前没有正在进行的用户画像流程");
    const flow = ensurePersonaStageConversation(stored);
    workspace.savePersonaFlow(flow);
    const requestEvent = input.skipStage
      ? "skip_stage"
      : input.selectedOption
        ? "select_option"
        : "user_message";
    const request = buildPersonaAgentTurnRequest(
      flow,
      requestEvent,
      input.userMessage,
      input.includePersonaReferences ? workspace.personaRagReferenceContext() : null,
      input.selectedOption,
    );
    const agentTurn = await turnPersonaAgent(request);
    const response = normalizePersonaAgentTurnResponse(flow, agentTurn.response);
    const next = applyPersonaAgentTurnResponse(
      flow,
      response,
      undefined,
      {
        userMessage: agentTurn.userMessage,
        assistantMessage: agentTurn.assistantMessage,
      },
      requestEvent,
    );
    workspace.savePersonaFlow(next);
    return { flow: next, response };
  });
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
      if (!event.sender.isDestroyed()) event.sender.send(ipcChannels.chatEvent, streamEvent);
    });
  });
  ipcMain.handle(ipcChannels.publishStart, (_event, raw) => {
    const input = publishStartInputSchema.parse(raw);
    requireWorkspace(access).resolveFile(input.projectId, input.artifactPath);
    return { jobId: randomUUID() };
  });
  ipcMain.handle(ipcChannels.publishDraftsLoad, () => {
    const stored = requireWorkspace(access).loadPublishDrafts();
    if (!stored) return null;
    return publishDraftStateSchema.parse({
      ...stored,
      drafts: stored.drafts.map((draft) => ({
        ...draft,
        images: draft.images.flatMap((image) => {
          const restored = localPublishImage(image.path, image.id);
          if (!restored) return [];
          selectedPublishImages.set(restored.id, restored.path);
          return [restored];
        }),
      })),
    });
  });
  ipcMain.handle(ipcChannels.publishDraftsSave, (_event, raw) => {
    const state = publishDraftStateSchema.parse(raw);
    const stored = persistedPublishDraftStateSchema.parse({
      ...state,
      drafts: state.drafts.map((draft) => ({
        ...draft,
        images: draft.images.flatMap(({ previewUrl: _previewUrl, ...image }) =>
          selectedPublishImages.get(image.id) === image.path ? [image] : [],
        ),
      })),
    });
    requireWorkspace(access).savePublishDrafts(stored);
  });
  ipcMain.handle(ipcChannels.publishImagesSelect, async (event, raw) => {
    const input = selectPublishImagesInputSchema.parse(raw);
    const parent = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      title: "选择发布配图",
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "图片",
          extensions: ["png", "jpg", "jpeg", "webp", "gif"],
        },
      ],
    };
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled) return [];
    return result.filePaths.slice(0, input.remaining).flatMap((path) => {
      const image = localPublishImage(path);
      if (!image) return [];
      selectedPublishImages.set(image.id, path);
      return [image];
    });
  });
  ipcMain.handle(ipcChannels.publishImagesRelease, (_event, raw) => {
    const input = releasePublishImagesInputSchema.parse(raw);
    for (const id of input.ids) selectedPublishImages.delete(id);
  });
  ipcMain.handle(ipcChannels.publishBilibiliAccountsList, () => listBilibiliAccounts());
  ipcMain.handle(ipcChannels.publishBilibiliAccountCreate, () => createBilibiliAccount());
  ipcMain.handle(ipcChannels.publishBilibiliAccountDelete, async (_event, raw) => {
    const input = deleteBilibiliAccountInputSchema.parse(raw);
    return deleteBilibiliAccount(input.accountId);
  });
  ipcMain.handle(ipcChannels.publishBilibiliOpen, async (_event, raw) => {
    const input = bilibiliFillInputSchema.parse(raw);
    return openAndFillBilibili(
      input.accountId,
      input.title,
      input.content,
      resolveSelectedPublishImages(input.imageIds),
      input.autoPublish,
    );
  });
  ipcMain.handle(ipcChannels.publishBilibiliFill, async (_event, raw) => {
    const input = bilibiliFillInputSchema.parse(raw);
    return continueFillingBilibili(
      input.accountId,
      input.title,
      input.content,
      resolveSelectedPublishImages(input.imageIds),
      input.autoPublish,
    );
  });
}

function resolveSelectedPublishImages(ids: readonly string[]): string[] {
  return ids.map((id) => {
    const path = selectedPublishImages.get(id);
    if (!path || !existsSync(path) || !statSync(path).isFile()) {
      throw new Error("选中的本地图片已移动或删除，请重新选择");
    }
    return path;
  });
}

function publishImageMediaType(path: string): string {
  const types: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
  };
  return types[extname(path).toLowerCase()] ?? "image/*";
}

function localPublishImage(path: string, id: string = randomUUID()) {
  if (!existsSync(path) || !statSync(path).isFile()) return null;
  const image = nativeImage.createFromPath(path);
  if (image.isEmpty()) return null;
  return {
    id,
    name: basename(path),
    path,
    mediaType: publishImageMediaType(path),
    size: statSync(path).size,
    previewUrl: image.resize({ width: 180, height: 180, quality: "good" }).toDataURL(),
  };
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
