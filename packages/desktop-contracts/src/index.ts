import { z } from "zod";

export const projectIdSchema = z.uuid();
export const artifactIdSchema = z.uuid();
export const platformSchema = z.enum([
  "wechat",
  "toutiao",
  "zhihu",
  "weibo",
  "bilibili",
  "xiaohongshu",
]);

export const projectSchema = z.object({
  id: projectIdSchema,
  name: z.string().trim().min(1).max(80),
  path: z.string().min(1),
  status: z.enum(["ready", "running", "attention", "completed"]),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type Project = z.infer<typeof projectSchema>;

export const createProjectInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
});
export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;
export const deleteProjectInputSchema = z.object({ projectId: projectIdSchema });
export type DeleteProjectInput = z.infer<typeof deleteProjectInputSchema>;

export const workspaceEntrySchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  isDefault: z.boolean(),
});
export const activateWorkspaceInputSchema = z.object({ path: z.string().min(1) });
export type WorkspaceEntry = z.infer<typeof workspaceEntrySchema>;

export const personaRagStatusSchema = z.object({
  ready: z.boolean(),
  fileCount: z.number().int().nonnegative(),
  path: z.string().min(1),
});
export type PersonaRagStatus = z.infer<typeof personaRagStatusSchema>;
export const personaProfileInputSchema = z.object({
  brandOverview: z.string().trim().min(1).max(10_000),
  audience: z.string().trim().min(1).max(10_000),
  positioning: z.string().trim().min(1).max(10_000),
  fixedFacts: z.string().trim().min(1).max(10_000),
  contentBoundaries: z.string().trim().min(1).max(10_000),
});
export type PersonaProfileInput = z.infer<typeof personaProfileInputSchema>;
const nullablePersonaValueSchema = z.string().trim().min(1).max(10_000).nullable();
const personaValueListSchema = z.array(z.string().trim().min(1).max(10_000)).max(1_000);
export const personaAgentProfileSchema = z.object({
  industry: nullablePersonaValueSchema,
  account_represents: nullablePersonaValueSchema,
  business_type: nullablePersonaValueSchema,
  offerings: personaValueListSchema,
  target_audiences: personaValueListSchema,
  customer_scenarios: personaValueListSchema,
  memory_points: personaValueListSchema,
  long_term_topics: personaValueListSchema,
  fixed_facts: personaValueListSchema,
  prohibited_content: personaValueListSchema,
});
export type PersonaAgentProfile = z.infer<typeof personaAgentProfileSchema>;
export const personaAgentDocumentSchema = z.object({
  status: z.literal("completed"),
  profile: personaAgentProfileSchema,
  current_step: z.literal("completed"),
  question: z.null(),
});
export type PersonaAgentDocument = z.infer<typeof personaAgentDocumentSchema>;
export const personaRagConfirmInputSchema = z.union([
  personaProfileInputSchema,
  personaAgentDocumentSchema,
]);
export type PersonaRagConfirmInput = z.infer<typeof personaRagConfirmInputSchema>;
export const personaRagDocumentSchema = z.object({
  path: z.string().min(1),
  content: z.string().max(2_000_000),
});
export type PersonaRagDocument = z.infer<typeof personaRagDocumentSchema>;
export const personaRagSaveDocumentInputSchema = z.object({
  content: z.string().trim().min(1).max(2_000_000),
});
export const personaRagImportResultSchema = z.object({
  names: z.array(z.string().min(1)),
});
export type PersonaRagImportResult = z.infer<typeof personaRagImportResultSchema>;
export const personaRagDroppedFilesSchema = z
  .array(
    z.object({
      name: z.string().trim().min(1).max(255),
      data: z.instanceof(Uint8Array).refine((value) => value.byteLength <= 20_000_000, {
        message: "单个文件不能超过 20 MB",
      }),
    }),
  )
  .min(1)
  .max(10)
  .refine((files) => files.reduce((total, file) => total + file.data.byteLength, 0) <= 50_000_000, {
    message: "一次上传的文件总大小不能超过 50 MB",
  });
export type PersonaRagDroppedFile = z.infer<typeof personaRagDroppedFilesSchema>[number];

export const artifactKindSchema = z.enum([
  "article",
  "image",
  "analytics_report",
  "strategy",
  "video",
  "publish_receipt",
  "input",
]);
export const artifactSchema = z.object({
  id: z.string().min(1),
  projectId: projectIdSchema,
  kind: artifactKindSchema,
  name: z.string().min(1),
  path: z.string().min(1),
  mediaType: z.string().min(1),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type Artifact = z.infer<typeof artifactSchema>;

export const listOutputsInputSchema = z.object({ projectId: projectIdSchema });
export const previewFileInputSchema = z.object({ projectId: projectIdSchema, path: z.string() });
export const fileActionInputSchema = previewFileInputSchema;
export const filePreviewSchema = z.object({
  path: z.string(),
  mediaType: z.string(),
  content: z.string().max(2_000_000).nullable(),
});
export type FilePreview = z.infer<typeof filePreviewSchema>;

export const knowledgeSearchInputSchema = z.object({
  projectId: projectIdSchema,
  query: z.string().trim().min(1).max(500),
  limit: z.number().int().min(1).max(20).default(5),
});
export const knowledgeHitSchema = z.object({
  source: z.string(),
  excerpt: z.string(),
  score: z.number().min(0).max(1),
});

export const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(100_000),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const chatSendInputSchema = z
  .object({
    requestId: z.uuid(),
    sessionId: z.uuid().optional(),
    projectId: projectIdSchema.optional(),
    messages: z.array(chatMessageSchema).min(1).max(100),
    knowledgeEnabled: z.boolean(),
    strategyEnabled: z.boolean(),
    autoExecute: z.boolean(),
    mode: z.enum(["chat", "persona_setup"]).optional(),
    includePersonaReferences: z.boolean().optional(),
  })
  .superRefine((value, context) => {
    if (value.mode !== "persona_setup" && !value.projectId) {
      context.addIssue({
        code: "custom",
        path: ["projectId"],
        message: "普通对话必须指定任务",
      });
    }
  });
export type ChatSendInput = z.infer<typeof chatSendInputSchema>;

export const agentStatusSchema = z.object({
  state: z.enum(["ready", "unconfigured", "unavailable"]),
  detail: z.string().optional(),
});
export type AgentStatus = z.infer<typeof agentStatusSchema>;

export const chatStreamEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("start"),
    requestId: z.uuid(),
  }),
  z.object({
    type: z.literal("text-delta"),
    requestId: z.uuid(),
    delta: z.string().min(1),
  }),
  z.object({
    type: z.literal("tool-call"),
    requestId: z.uuid(),
    toolCallId: z.string().min(1),
    name: z.string().min(1),
    arguments: z.string(),
    status: z.enum(["requested", "running", "completed", "failed"]),
    result: z.string().optional(),
  }),
  z.object({
    type: z.literal("finish"),
    requestId: z.uuid(),
  }),
  z.object({
    type: z.literal("error"),
    requestId: z.uuid(),
    message: z.string().min(1),
    retryable: z.boolean(),
  }),
]);
export type ChatStreamEvent = z.infer<typeof chatStreamEventSchema>;

export const publishStartInputSchema = z.object({
  projectId: projectIdSchema,
  artifactPath: z.string().min(1),
  platform: platformSchema,
  approved: z.literal(true),
});

export const deviceCommandSchema = z.discriminatedUnion("type", [
  z.object({ id: z.uuid(), type: z.literal("task.create"), payload: createProjectInputSchema }),
  z.object({
    id: z.uuid(),
    type: z.literal("chat.send"),
    payload: z.object({ projectId: projectIdSchema, message: z.string().min(1).max(20_000) }),
  }),
  z.object({
    id: z.uuid(),
    type: z.literal("article.generate"),
    payload: z.object({
      projectId: projectIdSchema,
      platform: platformSchema,
      instruction: z.string().min(1).max(20_000),
    }),
  }),
  z.object({
    id: z.uuid(),
    type: z.literal("image.process"),
    payload: z.object({
      projectId: projectIdSchema,
      capability: z.enum([
        "text_to_image",
        "image_edit",
        "product_image",
        "cover_generation",
        "poster_generation",
        "background_remove",
        "background_replace",
        "upscale",
        "style_transfer",
        "text_rendering",
      ]),
    }),
  }),
  z.object({
    id: z.uuid(),
    type: z.enum([
      "analytics.analyze",
      "publish.prepare",
      "publish.confirm",
      "job.cancel",
      "job.status",
    ]),
    payload: z.object({ projectId: projectIdSchema }).passthrough(),
  }),
]);
export type DeviceCommand = z.infer<typeof deviceCommandSchema>;

export interface DesktopApi {
  workspace: {
    select(): Promise<string | null>;
    current(): Promise<string | null>;
    list(): Promise<WorkspaceEntry[]>;
    activate(path: string): Promise<string>;
  };
  tasks: {
    create(input: CreateProjectInput): Promise<Project>;
    list(): Promise<Project[]>;
    delete(projectId: string): Promise<void>;
  };
  personaRag: {
    status(): Promise<PersonaRagStatus>;
    confirm(input: PersonaRagConfirmInput): Promise<PersonaRagStatus>;
    readDocument(): Promise<PersonaRagDocument>;
    saveDocument(content: string): Promise<PersonaRagStatus>;
    delete(): Promise<PersonaRagStatus>;
    importFiles(): Promise<PersonaRagImportResult>;
    importDroppedFiles(files: PersonaRagDroppedFile[]): Promise<PersonaRagImportResult>;
  };
  files: {
    listOutputs(projectId: string): Promise<Artifact[]>;
    preview(projectId: string, path: string): Promise<FilePreview>;
    open(projectId: string, path: string): Promise<void>;
    reveal(projectId: string, path: string): Promise<void>;
  };
  knowledge: {
    search(projectId: string, query: string): Promise<z.infer<typeof knowledgeHitSchema>[]>;
  };
  chat: {
    status(): Promise<AgentStatus>;
    send(input: ChatSendInput, onEvent: (event: ChatStreamEvent) => void): Promise<void>;
  };
  publish: {
    start(input: z.infer<typeof publishStartInputSchema>): Promise<{ jobId: string }>;
  };
}

export const ipcChannels = {
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
