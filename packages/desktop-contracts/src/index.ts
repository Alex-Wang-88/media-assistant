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
export type Platform = z.infer<typeof platformSchema>;

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
export const personaReportInputSchema = z.object({
  markdown: z.string().trim().min(1).max(2_000_000),
});
export type PersonaReportInput = z.infer<typeof personaReportInputSchema>;
export const personaRagConfirmInputSchema = personaReportInputSchema;
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

export const personaStageSchema = z.number().int().min(1).max(5);
export type PersonaStage = z.infer<typeof personaStageSchema>;

export const PERSONA_STAGE_WELCOMES: Record<number, string> = {
  1: "第1/5阶段：请告诉我，你目前主要经营什么业务？",
  2: "第2/5阶段：你的产品或服务主要卖给谁？",
  3: "第3/5阶段：在这些客户中，你现在最想优先吸引的是哪一类？",
  4: "第4/5阶段：客户为什么选择你，而不是其他同类产品或服务？",
  5: `第5/5阶段：你希望用户看完内容后产生哪些行动？

1. 留下联系方式；
2. 主动发起咨询；
3. 前往门店或线下场所；
4. 直接购买或成交。

可以选择一个或多个。如果多个都需要，请告诉我最优先的是哪一个。`,
};

export function personaStageWelcome(stage: PersonaStage): string {
  return PERSONA_STAGE_WELCOMES[stage] ?? "当前用户画像阶段尚未配置。";
}

export const personaStageStatusSchema = z.enum([
  "not_started",
  "collecting",
  "waiting_confirmation",
  "confirmed",
  "needs_revalidation",
]);
export type PersonaStageStatus = z.infer<typeof personaStageStatusSchema>;

export const personaStageValueSchema = z.union([
  z.string().max(2_000),
  z.boolean(),
  z.array(z.string().max(500)).max(20),
  z.null(),
]);
export const personaStageDataSchema = z.record(z.string().max(80), personaStageValueSchema);
export type PersonaStageData = z.infer<typeof personaStageDataSchema>;

export const personaStageStateSchema = z.object({
  stage: personaStageSchema,
  status: personaStageStatusSchema,
  revisionCount: z.number().int().nonnegative(),
  conversationId: z.string().min(1).max(200).nullable(),
  lastAssistantMessage: z.string().max(2_000).nullable().default(null),
  agentMessages: z.array(chatMessageSchema).max(100).default([]),
  stageData: personaStageDataSchema,
  result: personaStageDataSchema,
});
export type PersonaStageState = z.infer<typeof personaStageStateSchema>;

export const personaFlowStateSchema = z
  .object({
    version: z.literal(1),
    flowId: z.uuid(),
    stateVersion: z.number().int().nonnegative(),
    flowCompleted: z.boolean(),
    currentStage: personaStageSchema,
    stages: z.array(personaStageStateSchema).length(5),
    finalSummary: z.string().max(20_000).nullable(),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .refine(
    (flow) => flow.stages.every((stage, index) => stage.stage === index + 1),
    "画像阶段必须按 1 到 5 排列",
  );
export type PersonaFlowState = z.infer<typeof personaFlowStateSchema>;

export const personaAgentEventSchema = z.enum([
  "stage_start",
  "user_message",
  "confirm_stage",
  "modify_stage",
]);
export type PersonaAgentEvent = z.infer<typeof personaAgentEventSchema>;

export const personaAgentActionSchema = z.enum([
  "ask_question",
  "present_conclusion",
  "complete_stage",
  "generate_final_summary",
]);
export type PersonaAgentAction = z.infer<typeof personaAgentActionSchema>;

export const personaAgentTurnRequestSchema = z.object({
  requestId: z.uuid(),
  flowId: z.uuid(),
  stateVersion: z.number().int().nonnegative(),
  stage: personaStageSchema,
  event: personaAgentEventSchema,
  userMessage: z.string().trim().min(1).max(20_000).nullable(),
  referenceContext: z.string().max(50_000).nullable(),
  stageState: personaStageStateSchema,
  confirmedData: z.record(z.string(), personaStageDataSchema),
});
export type PersonaAgentTurnRequest = z.infer<typeof personaAgentTurnRequestSchema>;

export const personaAgentTurnResponseSchema = z
  .object({
    requestId: z.uuid(),
    flowId: z.uuid(),
    stateVersion: z.number().int().nonnegative(),
    stage: personaStageSchema,
    action: personaAgentActionSchema,
    question: z.string().trim().min(1).max(300).nullable(),
    conclusion: z.string().trim().min(1).max(500).nullable(),
    resultPatch: personaStageDataSchema,
    finalSummary: z.string().trim().min(1).max(20_000).nullable(),
  })
  .superRefine((response, context) => {
    if (response.action === "ask_question" && !response.question) {
      context.addIssue({ code: "custom", path: ["question"], message: "提问动作必须包含问题" });
    }
    if (response.action === "present_conclusion" && !response.conclusion) {
      context.addIssue({
        code: "custom",
        path: ["conclusion"],
        message: "展示结论必须包含结论文本",
      });
    }
    if (response.action === "generate_final_summary" && !response.finalSummary) {
      context.addIssue({
        code: "custom",
        path: ["finalSummary"],
        message: "最终汇总动作必须包含最终汇总",
      });
    }
  });
export type PersonaAgentTurnResponse = z.infer<typeof personaAgentTurnResponseSchema>;

export const personaAgentApiTurnResultSchema = z.object({
  response: personaAgentTurnResponseSchema,
  userMessage: z.string().min(1).max(100_000),
  assistantMessage: z.string().min(1).max(100_000),
});
export type PersonaAgentApiTurnResult = z.infer<typeof personaAgentApiTurnResultSchema>;

export const personaFlowTurnInputSchema = z.object({
  userMessage: z.string().trim().min(1).max(20_000),
  includePersonaReferences: z.boolean().default(false),
});
export type PersonaFlowTurnInput = z.infer<typeof personaFlowTurnInputSchema>;

export const personaFlowTurnResultSchema = z.object({
  flow: personaFlowStateSchema,
  response: personaAgentTurnResponseSchema,
});
export type PersonaFlowTurnResult = z.infer<typeof personaFlowTurnResultSchema>;

export const publishStartInputSchema = z.object({
  projectId: projectIdSchema,
  artifactPath: z.string().min(1),
  platform: platformSchema,
  approved: z.literal(true),
});

export const localPublishImageSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(255),
  path: z.string().min(1),
  mediaType: z.string().startsWith("image/"),
  size: z.number().int().nonnegative(),
  previewUrl: z.string().startsWith("data:image/"),
});
export type LocalPublishImage = z.infer<typeof localPublishImageSchema>;

export const publishDraftImageReferenceSchema = localPublishImageSchema.omit({ previewUrl: true });
export type PublishDraftImageReference = z.infer<typeof publishDraftImageReferenceSchema>;

export const publishDraftSchema = z.object({
  id: z.uuid(),
  title: z.string().max(80),
  platform: platformSchema.nullable(),
  bilibiliAccountId: z.uuid().nullable(),
  content: z.string().max(100_000),
  images: z.array(localPublishImageSchema).max(20),
  source: z.enum(["manual", "generated"]),
  pinned: z.boolean(),
});
export type PublishDraft = z.infer<typeof publishDraftSchema>;

export const persistedPublishDraftSchema = publishDraftSchema.extend({
  images: z.array(publishDraftImageReferenceSchema).max(20),
});
export type PersistedPublishDraft = z.infer<typeof persistedPublishDraftSchema>;

const autoPublishByPlatformSchema = z.record(platformSchema, z.boolean());

const publishDraftStateBaseSchema = z.object({
  version: z.literal(1),
  selectedDraftId: z.uuid(),
  autoPublishByPlatform: autoPublishByPlatformSchema,
});

export const publishDraftStateSchema = publishDraftStateBaseSchema
  .extend({
    drafts: z.array(publishDraftSchema).min(1).max(100),
  })
  .refine(
    (state) => state.drafts.some((draft) => draft.id === state.selectedDraftId),
    "选中的发布草稿不存在",
  );
export type PublishDraftState = z.infer<typeof publishDraftStateSchema>;

export const persistedPublishDraftStateSchema = publishDraftStateBaseSchema
  .extend({
    drafts: z.array(persistedPublishDraftSchema).min(1).max(100),
  })
  .refine(
    (state) => state.drafts.some((draft) => draft.id === state.selectedDraftId),
    "选中的发布草稿不存在",
  );
export type PersistedPublishDraftState = z.infer<typeof persistedPublishDraftStateSchema>;

export const selectPublishImagesInputSchema = z.object({
  remaining: z.number().int().min(1).max(20),
});
export const releasePublishImagesInputSchema = z.object({
  ids: z.array(z.uuid()).max(20),
});
export const bilibiliAccountSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(40),
});
export type BilibiliAccount = z.infer<typeof bilibiliAccountSchema>;
export const deleteBilibiliAccountInputSchema = z.object({
  accountId: z.uuid(),
});
export const bilibiliFillInputSchema = z.object({
  accountId: z.uuid(),
  title: z.string().max(80),
  content: z.string().trim().min(1).max(100_000),
  imageIds: z.array(z.uuid()).max(20),
  autoPublish: z.boolean().default(false),
});
export type BilibiliFillInput = z.infer<typeof bilibiliFillInputSchema>;

export const publishAutomationResultSchema = z.object({
  state: z.enum(["waiting_for_login", "filled", "published", "needs_attention"]),
  message: z.string().min(1),
});
export type PublishAutomationResult = z.infer<typeof publishAutomationResultSchema>;

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
  personaFlow: {
    load(): Promise<PersonaFlowState | null>;
    start(): Promise<PersonaFlowState>;
    turn(input: PersonaFlowTurnInput): Promise<PersonaFlowTurnResult>;
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
    loadDrafts(): Promise<PublishDraftState | null>;
    saveDrafts(state: PublishDraftState): Promise<void>;
    selectImages(remaining: number): Promise<LocalPublishImage[]>;
    releaseImages(ids: string[]): Promise<void>;
    listBilibiliAccounts(): Promise<BilibiliAccount[]>;
    createBilibiliAccount(): Promise<BilibiliAccount>;
    deleteBilibiliAccount(accountId: string): Promise<BilibiliAccount[]>;
    openBilibili(input: BilibiliFillInput): Promise<PublishAutomationResult>;
    fillBilibili(input: BilibiliFillInput): Promise<PublishAutomationResult>;
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
  personaFlowLoad: "persona-flow:load",
  personaFlowStart: "persona-flow:start",
  personaFlowTurn: "persona-flow:turn",
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
} as const;
