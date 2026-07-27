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
  it("collects answers in chat, uploads references, and reveals shortcuts after building", async () => {
    let ready = false;
    const profile = {
      brandOverview: "社区咖啡店",
      audience: "附近居民与上班族",
      positioning: "手冲咖啡和社区空间",
      fixedFacts: "每天 8 点至 20 点营业",
      contentBoundaries: "未经确认不发布折扣",
    };
    const importFiles = vi.fn(async () => ({ names: ["menu.pdf"] }));
    const confirm = vi.fn(async () => {
      ready = true;
      return { ready: true, fileCount: 2, path: "/workspace/企业知识库/用户Persona RAG" };
    });
    let agentTurn = 0;
    const send = vi.fn(async (input: ChatSendInput, onEvent: (event: ChatStreamEvent) => void) => {
      agentTurn += 1;
      onEvent({ type: "start", requestId: input.requestId });
      if (agentTurn === 1) {
        onEvent({
          type: "text-delta",
          requestId: input.requestId,
          delta: "我已经看过现有资料。你希望这个品牌长期给人留下什么印象？",
        });
      } else {
        onEvent({
          type: "tool-call",
          requestId: input.requestId,
          toolCallId: "proposal-1",
          name: "propose_persona",
          arguments: JSON.stringify(profile),
          status: "completed",
          result: "Persona 草稿已生成，等待用户确认",
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
          importFiles,
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
    const start = await screen.findByRole("button", { name: "开始构建画像" });
    await waitFor(() => expect(start.hasAttribute("disabled")).toBe(false));
    fireEvent.click(start);
    expect(await screen.findByText(/你希望这个品牌长期给人留下什么印象/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "上传参考资料" }));
    expect(await screen.findByText(/已上传 1 个本地资料：menu.pdf/)).toBeTruthy();

    const textarea = screen.getByPlaceholderText("回答上方问题…");
    fireEvent.change(textarea, { target: { value: "温暖、专业、值得每天到访" } });
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));

    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("用户画像草稿待确认")).toBeTruthy();
    expect(screen.queryByText("制定首发策略")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "确认并保存" }));

    await waitFor(() => expect(confirm).toHaveBeenCalledWith(profile));
    expect(await screen.findByText("制定首发策略")).toBeTruthy();
    expect(screen.getByText("画像已就绪")).toBeTruthy();
    expect(screen.getByRole("button", { name: "查看或更新画像" })).toBeTruthy();
    queryClient.clear();
  });
});
