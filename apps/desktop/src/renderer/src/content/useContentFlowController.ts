import { useQueryClient } from "@tanstack/react-query";
import type {
  ChatMessage,
  Platform,
  PlatformContentPlatform,
  ProductPromotionAgentResponse,
  ProductPromotionAnswer,
} from "@yoom/desktop-contracts";
import { type Dispatch, type SetStateAction, useRef, useState } from "react";
import type { ConversationMessage } from "../chat-state";
import { personaSetupMessage } from "../persona/persona-report";
import type { PublishCenterSeed } from "../publish/publish-draft-model";
import {
  CONTENT_AGENT_WELCOME,
  type ContentAgentType,
  isProductContentPlatform,
  PRODUCT_PLATFORM_OPTIONS,
} from "./platforms";

export function useContentFlowController({
  selectedProjectId,
  selectProject,
  conversationMessages,
  setConversationMessages,
  isStreaming,
  setIsStreaming,
  setMessage,
  requestLatestMessage,
  cancelLatestMessage,
  setAgentRequestFailed,
  openPublishCenter,
  focusComposer,
}: {
  selectedProjectId: string | null;
  selectProject(projectId: string): void;
  conversationMessages: ConversationMessage[];
  setConversationMessages: Dispatch<SetStateAction<ConversationMessage[]>>;
  isStreaming: boolean;
  setIsStreaming: Dispatch<SetStateAction<boolean>>;
  setMessage: Dispatch<SetStateAction<string>>;
  requestLatestMessage(immediate?: boolean): void;
  cancelLatestMessage(): void;
  setAgentRequestFailed: Dispatch<SetStateAction<boolean>>;
  openPublishCenter(seed: PublishCenterSeed[]): void;
  focusComposer(): void;
}) {
  const queryClient = useQueryClient();
  const [contentAgentType, setContentAgentType] = useState<ContentAgentType | null>(null);
  const contentAgentSessionId = useRef<string | null>(null);
  const [productAgentMessages, setProductAgentMessages] = useState<ChatMessage[]>([]);
  const [productAgentResponse, setProductAgentResponse] =
    useState<ProductPromotionAgentResponse | null>(null);
  const [productSelectedOptionIds, setProductSelectedOptionIds] = useState<string[]>([]);
  const [productCustomInput, setProductCustomInput] = useState("");
  const [productTargetPlatforms, setProductTargetPlatforms] = useState<PlatformContentPlatform[]>(
    [],
  );
  const [productPlatformSelectionConfirmed, setProductPlatformSelectionConfirmed] = useState(false);
  const skipNextProjectReset = useRef(false);

  const selectContentAgent = (type: ContentAgentType) => {
    contentAgentSessionId.current = type === "product_promotion" ? null : crypto.randomUUID();
    setProductAgentMessages([]);
    setProductAgentResponse(null);
    setProductSelectedOptionIds([]);
    setProductCustomInput("");
    setProductTargetPlatforms([]);
    setProductPlatformSelectionConfirmed(false);
    setContentAgentType(type);
    setConversationMessages(
      type === "product_promotion"
        ? []
        : [personaSetupMessage("assistant", CONTENT_AGENT_WELCOME[type], true)],
    );
    setMessage("");
    if (type !== "product_promotion") focusComposer();
  };

  const toggleProductPlatform = (platform: Platform) => {
    if (
      !isProductContentPlatform(platform) ||
      !PRODUCT_PLATFORM_OPTIONS.some((option) => option.id === platform && option.enabled)
    ) {
      return;
    }
    setProductTargetPlatforms((current) =>
      current.includes(platform)
        ? current.filter((candidate) => candidate !== platform)
        : [...current, platform],
    );
  };

  const confirmProductPlatforms = () => {
    if (productTargetPlatforms.length === 0) return;
    contentAgentSessionId.current = crypto.randomUUID();
    setProductPlatformSelectionConfirmed(true);
    setConversationMessages([
      personaSetupMessage("assistant", CONTENT_AGENT_WELCOME.product_promotion, true),
    ]);
    setMessage("");
    focusComposer();
  };

  const returnToProductPlatformPicker = () => {
    cancelLatestMessage();
    contentAgentSessionId.current = null;
    setProductAgentMessages([]);
    setProductAgentResponse(null);
    setProductSelectedOptionIds([]);
    setProductCustomInput("");
    setProductPlatformSelectionConfirmed(false);
    setConversationMessages([]);
    setMessage("");
    setAgentRequestFailed(false);
  };

  const returnToContentTypePicker = () => {
    cancelLatestMessage();
    contentAgentSessionId.current = null;
    setProductAgentMessages([]);
    setProductAgentResponse(null);
    setProductSelectedOptionIds([]);
    setProductCustomInput("");
    setProductTargetPlatforms([]);
    setProductPlatformSelectionConfirmed(false);
    setContentAgentType(null);
    setConversationMessages([]);
    setMessage("");
    setAgentRequestFailed(false);
  };

  const resetForProjectChange = () => {
    if (skipNextProjectReset.current) {
      skipNextProjectReset.current = false;
      return;
    }
    setConversationMessages([]);
    setContentAgentType(null);
    contentAgentSessionId.current = null;
    setProductAgentMessages([]);
    setProductAgentResponse(null);
    setProductSelectedOptionIds([]);
    setProductCustomInput("");
    setProductTargetPlatforms([]);
    setProductPlatformSelectionConfirmed(false);
    setMessage("");
    setIsStreaming(false);
    cancelLatestMessage();
  };

  const preserveForNextProjectChange = () => {
    skipNextProjectReset.current = true;
  };

  const sendProductPromotionAnswer = async (
    answer: ProductPromotionAnswer,
    visibleAnswer: string,
  ) => {
    const sessionId = contentAgentSessionId.current;
    const targetPlatforms = productTargetPlatforms;
    if (!sessionId || targetPlatforms.length === 0 || isStreaming) return;
    const assistantId = crypto.randomUUID();
    const previousResponse = productAgentResponse;
    const userEntry = personaSetupMessage("user", visibleAnswer);
    const assistantEntry: ConversationMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      status: "streaming",
      tools: [],
    };
    requestLatestMessage();
    setConversationMessages((current) => [...current, userEntry, assistantEntry]);
    setProductAgentResponse(null);
    setMessage("");
    setIsStreaming(true);
    try {
      let projectId = selectedProjectId;
      if (!projectId) {
        const project = await window.desktop.tasks.create({
          name: visibleAnswer.split(/\r?\n/, 1)[0]?.slice(0, 40) || "产品推广",
        });
        projectId = project.id;
        skipNextProjectReset.current = true;
        selectProject(project.id);
        await queryClient.invalidateQueries({ queryKey: ["projects"] });
      }
      const result = await window.desktop.productPromotion.turn({
        requestId: crypto.randomUUID(),
        sessionId,
        messages: productAgentMessages,
        answer,
      });
      const nextProductAgentMessages: ChatMessage[] = [
        ...productAgentMessages,
        { role: "user", content: result.userMessage },
        { role: "assistant", content: result.assistantMessage },
      ];
      setProductAgentMessages(nextProductAgentMessages);
      setProductSelectedOptionIds([]);
      setProductCustomInput("");
      if (result.response.status === "completed") {
        const productDraft = result.response.finalContent ?? "";
        const productConversation: ChatMessage[] = [
          ...conversationMessages
            .filter(
              (entry) =>
                !entry.modelExcluded && entry.status === "complete" && entry.content.trim(),
            )
            .map((entry) => ({ role: entry.role, content: entry.content })),
          { role: "user", content: visibleAnswer },
        ];
        setConversationMessages((current) =>
          current.map((entry) =>
            entry.id === assistantId
              ? {
                  ...entry,
                  content: `正在生成${targetPlatforms
                    .map(
                      (platform) =>
                        PRODUCT_PLATFORM_OPTIONS.find((option) => option.id === platform)?.label ??
                        platform,
                    )
                    .join("、")}文案…`,
                  status: "streaming",
                }
              : entry,
          ),
        );
        const platformResults = await Promise.all(
          targetPlatforms.map((platform) =>
            window.desktop.platformContent.generate({
              requestId: crypto.randomUUID(),
              sessionId: crypto.randomUUID(),
              projectId,
              platform,
              productConversation,
              productDraft,
            }),
          ),
        );
        openPublishCenter(
          platformResults.map((platformResult) => ({
            key: crypto.randomUUID(),
            title: platformResult.title,
            content: platformResult.content,
            platform: platformResult.platform,
          })),
        );
        setProductAgentResponse(null);
        setConversationMessages((current) =>
          current.map((entry) =>
            entry.id === assistantId
              ? { ...entry, content: "", hidden: true, status: "complete" }
              : entry,
          ),
        );
        setAgentRequestFailed(false);
        return;
      }
      setProductAgentResponse(result.response);
      const assistantContent = result.response.question ?? "请继续补充产品信息。";
      setConversationMessages((current) =>
        current.map((entry) =>
          entry.id === assistantId
            ? { ...entry, content: assistantContent, status: "complete" }
            : entry,
        ),
      );
      setAgentRequestFailed(false);
      requestLatestMessage(true);
    } catch (error) {
      setProductAgentResponse(previousResponse);
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

  const toggleProductOption = (optionId: string) => {
    if (!productAgentResponse || productAgentResponse.selectionMode === "text") return;
    setProductSelectedOptionIds((current) => {
      if (productAgentResponse.selectionMode === "single") {
        return current.includes(optionId) ? [] : [optionId];
      }
      const maxSelections =
        productAgentResponse.maxSelections ?? productAgentResponse.options.length;
      if (!current.includes(optionId) && current.length >= maxSelections) return current;
      return current.includes(optionId)
        ? current.filter((id) => id !== optionId)
        : [...current, optionId];
    });
  };

  const submitProductAnswer = () => {
    if (productAgentResponse?.status !== "questioning") return;
    const selectedOptions = productSelectedOptionIds
      .map(
        (optionId) => productAgentResponse.options.find((option) => option.id === optionId)?.label,
      )
      .filter((label): label is string => Boolean(label));
    const customInput = productCustomInput.trim();
    if (selectedOptions.length === 0 && !customInput) return;
    const displayedSelections = productAgentResponse.rankSelections
      ? selectedOptions.map((label, index) => `${index + 1}. ${label}`)
      : selectedOptions;
    const visibleAnswer = [...displayedSelections, ...(customInput ? [customInput] : [])].join(
      "；",
    );
    void sendProductPromotionAnswer(
      {
        selectedOptions,
        customInput,
        skipped: false,
        ranked: productAgentResponse.rankSelections,
      },
      visibleAnswer,
    );
  };

  const skipProductQuestion = () => {
    if (!productAgentResponse?.allowSkip) return;
    void sendProductPromotionAnswer(
      { selectedOptions: [], customInput: "", skipped: true, ranked: false },
      "跳过当前问题",
    );
  };

  return {
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
  };
}

function readableError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/^Error invoking remote method '[^']+': Error:\s*/, "")
    .replace(/^Error:\s*/, "");
}
