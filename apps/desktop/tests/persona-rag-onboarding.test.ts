// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ChatSendInput, ChatStreamEvent, DesktopApi } from "@yoom/desktop-contracts";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/renderer/src/App";
import { useUiStore } from "../src/renderer/src/store";

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "desktop");
  useUiStore.setState({
    selectedProjectId: null,
    selectedArtifactPath: null,
    settingsOpen: false,
  });
});

describe("Persona RAG guided onboarding", () => {
  it("collects answers, freely edits the completed profile, saves it, and deletes it", async () => {
    let ready = false;
    const completedProfile = {
      industry: "宠物服务",
      account_represents: "品牌",
      business_type: "宠物生活服务",
      offerings: ["宠物洗护"],
      target_audiences: ["养宠家庭", "年轻上班族"],
      customer_scenarios: ["日常护理"],
      memory_points: ["专业耐心"],
      long_term_topics: ["科学养宠"],
      fixed_facts: [],
      prohibited_content: [],
    };
    const completedDocument = {
      status: "completed",
      profile: completedProfile,
      current_step: "completed",
      question: null,
    };
    const importFiles = vi.fn(async () => ({ names: ["menu.pdf"] }));
    const importDroppedFiles = vi.fn(async () => ({ names: ["brand-facts.txt"] }));
    const confirm = vi.fn(async () => {
      ready = true;
      return { ready: true, fileCount: 2, path: "/workspace/企业知识库/用户Persona RAG" };
    });
    const readDocument = vi.fn(async () => ({
      path: "/workspace/企业知识库/用户Persona RAG/persona.md",
      content: "# 用户画像\n\n## 目标人群\n\n- 养宠家庭\n",
    }));
    const saveDocument = vi.fn(async () => ({
      ready: true,
      fileCount: 2,
      path: "/workspace/企业知识库/用户Persona RAG",
    }));
    const deletePersona = vi.fn(async () => {
      ready = false;
      return {
        ready: false,
        fileCount: 0,
        path: "/workspace/企业知识库/用户Persona RAG",
      };
    });
    let agentTurn = 0;
    const send = vi.fn(async (input: ChatSendInput, onEvent: (event: ChatStreamEvent) => void) => {
      agentTurn += 1;
      onEvent({ type: "start", requestId: input.requestId });
      if (agentTurn === 1) {
        onEvent({
          type: "text-delta",
          requestId: input.requestId,
          delta: JSON.stringify({
            status: "asking",
            profile: {},
            current_step: "0",
            question: {
              id: "industry",
              text: "你所在的行业是什么？",
              mode: "single",
              options: [
                "互联网与科技",
                "教育与培训",
                "电商与零售",
                "餐饮与食品",
                "医疗与健康",
                "文化与传媒",
              ],
              allow_custom: true,
              allow_skip: true,
            },
          }),
        });
      } else if (agentTurn === 2) {
        onEvent({
          type: "text-delta",
          requestId: input.requestId,
          delta: JSON.stringify({
            status: "asking",
            profile: { industry: "宠物服务" },
            current_step: "3",
            question: {
              id: "target_audiences",
              text: "你主要希望影响哪些人群？",
              mode: "multiple",
              options: [
                "养宠家庭",
                "年轻上班族",
                "新手宠物主",
                "资深宠物主",
                "社区居民",
                "宠物行业从业者",
              ],
              allow_custom: true,
              allow_skip: true,
            },
          }),
        });
      } else {
        onEvent({
          type: "text-delta",
          requestId: input.requestId,
          delta: JSON.stringify({
            status: "completed",
            profile: completedProfile,
            current_step: "completed",
            question: null,
          }),
        });
      }
      onEvent({ type: "finish", requestId: input.requestId });
    });
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: {
        workspace: {
          current: async () => "/workspace",
          list: async () => [{ name: "测试工作区", path: "/workspace", isDefault: true }],
          select: async () => null,
          activate: async () => "/workspace",
        },
        tasks: {
          create: vi.fn(),
          list: async () => [],
          delete: vi.fn(),
        },
        personaRag: {
          status: async () => ({
            ready,
            fileCount: ready ? 2 : 0,
            path: "/workspace/企业知识库/用户Persona RAG",
          }),
          confirm,
          readDocument,
          saveDocument,
          delete: deletePersona,
          importFiles,
          importDroppedFiles,
        },
        files: {
          listOutputs: vi.fn(),
          preview: vi.fn(),
          open: vi.fn(),
          reveal: vi.fn(),
        },
        knowledge: { search: vi.fn() },
        chat: {
          status: async () => ({ state: "unconfigured" as const }),
          send,
        },
        publish: { start: vi.fn() },
      } satisfies DesktopApi,
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(createElement(QueryClientProvider, { client: queryClient }, createElement(App)));

    expect(await screen.findByText("用户画像")).toBeTruthy();
    expect(screen.getByText("尚未构建")).toBeTruthy();
    expect(
      screen.queryByText("用户画像确认保存后会显示四个快捷入口；画像文件被删除后会回到这里。"),
    ).toBeNull();
    expect(screen.queryByPlaceholderText("告诉 Agent 你想做什么…")).toBeNull();
    expect(screen.queryByRole("button", { name: /上传参考资料/ })).toBeNull();
    const enterSetup = screen.getByRole("button", { name: /与 Agent 对话建立画像/ });
    await waitFor(() => expect(enterSetup.hasAttribute("disabled")).toBe(false));
    fireEvent.click(enterSetup);
    expect(await screen.findByText(/欢迎使用用户画像助手/)).toBeTruthy();
    expect(send).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText("回答上方问题…")).toBeNull();
    const messagesViewport = document.querySelector(".messages") as HTMLDivElement;
    Object.defineProperties(messagesViewport, {
      scrollHeight: { configurable: true, value: 1_000 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    });
    const scrollTo = vi.fn(({ top }: ScrollToOptions) => {
      messagesViewport.scrollTop = Number(top);
    });
    Object.defineProperty(messagesViewport, "scrollTo", {
      configurable: true,
      value: scrollTo,
    });

    fireEvent.click(screen.getByRole("button", { name: "开始建立画像" }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      mode: "persona_setup",
      includePersonaReferences: false,
    });
    expect(send.mock.calls[0]?.[0].messages.at(-1)?.content).toContain("请开始通过自然对话");
    expect(importFiles).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "上传参考资料" })).toBeNull();
    expect(await screen.findByText("你所在的行业是什么？")).toBeTruthy();
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 600, behavior: "auto" }));
    expect(screen.getByRole("button", { name: "上传画像参考资料" })).toBeTruthy();
    expect(screen.queryByText(/"current_step"/)).toBeNull();
    expect(screen.getByRole("button", { name: "跳过" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "餐饮与食品" }));
    expect(screen.getByRole("button", { name: /餐饮与食品/ }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    const customAnswer = screen.getByPlaceholderText("手动输入");
    fireEvent.change(customAnswer, { target: { value: "宠物服务" } });
    expect(screen.getByRole("button", { name: "餐饮与食品" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
    fireEvent.click(screen.getByRole("button", { name: "提交回答" }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[1]?.[0].sessionId).toBe(send.mock.calls[0]?.[0].sessionId);
    expect(send.mock.calls[1]?.[0].messages.at(-1)).toEqual({
      role: "user",
      content: "宠物服务",
    });
    expect(send.mock.calls[1]?.[0].includePersonaReferences).toBe(false);
    expect(send.mock.calls[1]?.[0].messages).toEqual([
      expect.objectContaining({
        role: "user",
        content: expect.stringContaining("请开始通过自然对话"),
      }),
      expect.objectContaining({
        role: "assistant",
        content: expect.stringContaining('"current_step":"0"'),
      }),
      { role: "user", content: "宠物服务" },
    ]);
    expect(await screen.findByText("你主要希望影响哪些人群？")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "养宠家庭" }));
    fireEvent.click(screen.getByRole("button", { name: "年轻上班族" }));
    fireEvent.click(screen.getByRole("button", { name: "提交回答" }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(3));
    expect(send.mock.calls[2]?.[0].sessionId).toBe(send.mock.calls[0]?.[0].sessionId);
    expect(send.mock.calls[2]?.[0].messages.at(-1)).toEqual({
      role: "user",
      content: "养宠家庭、年轻上班族",
    });
    expect(await screen.findByText("用户画像草稿待确认")).toBeTruthy();
    expect(screen.queryByText("制定首发策略")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "修改画像" }));
    const industryEditor = screen.getByLabelText("所属行业");
    fireEvent.change(industryEditor, { target: { value: "宠物服务与零售" } });
    const audienceEditor = screen.getByLabelText("目标人群");
    fireEvent.change(audienceEditor, { target: { value: "养宠家庭\n城市独居青年" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修改后的画像" }));

    await waitFor(() =>
      expect(confirm).toHaveBeenCalledWith({
        ...completedDocument,
        profile: {
          ...completedProfile,
          industry: "宠物服务与零售",
          target_audiences: ["养宠家庭", "城市独居青年"],
        },
      }),
    );
    expect(await screen.findByText("制定首发策略")).toBeTruthy();
    expect(screen.getByText("画像已就绪")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "查看或更新画像" }));
    expect(await screen.findByText("用户画像主文件")).toBeTruthy();
    const editor = screen.getByLabelText("用户画像主文件内容");
    fireEvent.change(editor, { target: { value: "# 用户画像\n\n用户手动修改" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    await waitFor(() => expect(saveDocument).toHaveBeenCalledWith("# 用户画像\n\n用户手动修改"));
    fireEvent.click(screen.getByRole("button", { name: "删除用户画像" }));
    expect(screen.getByText("确定删除本地用户画像？")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(deletePersona).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("尚未构建")).toBeTruthy();
    expect(screen.getByRole("button", { name: "开始构建画像" })).toBeTruthy();
    queryClient.clear();
  });
});
