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

describe("Persona RAG plain-text onboarding", () => {
  it("asks for the industry, preserves chat history, edits the final report, and saves locally", async () => {
    let ready = false;
    const finalReport = [
      "你卖什么",
      "你批发进口家具，主打进口品质与可批量供货。",
      "",
      "内容核心定位",
      "稳定的进口品质供应与有竞争力的价格。",
      "",
      "内容反向定位",
      "不只炒作进口标签或低价噱头。",
      "",
      "卖给谁",
      "家具零售商与经销商。",
      "",
      "目标客户",
      "独立家具店主、连锁卖场采购、线上商家与区域经销商。",
      "",
      "核心优势",
      "价格优势和稳定品质。",
      "",
      "核心转化目标",
      "留下联系方式。",
      "",
      "辅助转化目标",
      "主动发起咨询。",
    ].join("\n");
    const confirm = vi.fn(async () => {
      ready = true;
      return { ready: true, fileCount: 1, path: "/workspace/企业知识库/用户Persona RAG" };
    });
    const saveDocument = vi.fn(async () => ({
      ready: true,
      fileCount: 1,
      path: "/workspace/企业知识库/用户Persona RAG",
    }));
    const deletePersona = vi.fn(async () => {
      ready = false;
      return { ready: false, fileCount: 0, path: "/workspace/企业知识库/用户Persona RAG" };
    });
    let turn = 0;
    const send = vi.fn(async (input: ChatSendInput, onEvent: (event: ChatStreamEvent) => void) => {
      turn += 1;
      onEvent({ type: "start", requestId: input.requestId });
      onEvent({
        type: "text-delta",
        requestId: input.requestId,
        delta:
          turn === 1 ? "我会重点强调进口家具的品质与设计感。这个判断符合实际情况吗？" : finalReport,
      });
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
        tasks: { create: vi.fn(), list: async () => [], delete: vi.fn() },
        personaRag: {
          status: async () => ({
            ready,
            fileCount: ready ? 1 : 0,
            path: "/workspace/企业知识库/用户Persona RAG",
          }),
          confirm,
          readDocument: async () => ({
            path: "/workspace/企业知识库/用户Persona RAG/persona.md",
            content: "# 用户画像\n\n用户已保存的报告",
          }),
          saveDocument,
          delete: deletePersona,
          importFiles: vi.fn(async () => ({ names: [] })),
          importDroppedFiles: vi.fn(async () => ({ names: [] })),
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
        publish: {
          start: vi.fn(),
          loadDrafts: vi.fn(async () => null),
          saveDrafts: vi.fn(async () => undefined),
          selectImages: vi.fn(),
          releaseImages: vi.fn(),
          listBilibiliAccounts: vi.fn(async () => []),
          createBilibiliAccount: vi.fn(),
          deleteBilibiliAccount: vi.fn(async () => []),
          openBilibili: vi.fn(),
          fillBilibili: vi.fn(),
        },
      } satisfies DesktopApi,
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(createElement(QueryClientProvider, { client: queryClient }, createElement(App)));

    const onboarding = await screen.findByLabelText("用户画像首次引导");
    expect(onboarding.classList.contains("persona-onboarding")).toBe(true);
    expect(screen.queryByRole("button", { name: "新建任务" })).toBeNull();
    expect(screen.queryByRole("button", { name: "设置" })).toBeNull();
    const enterSetup = await screen.findByRole("button", { name: /与 Agent 对话建立画像/ });
    await waitFor(() => expect(enterSetup.hasAttribute("disabled")).toBe(false));
    fireEvent.click(enterSetup);
    expect(await screen.findByText(/欢迎使用用户画像助手.*所在的行业是什么/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "暂时退出" })).toBeNull();
    expect(send).not.toHaveBeenCalled();

    const input = screen.getByPlaceholderText("请输入你的回答…");
    fireEvent.change(input, { target: { value: "进口家具" } });
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      mode: "persona_setup",
      includePersonaReferences: false,
      messages: [{ role: "user", content: "进口家具" }],
    });
    expect(await screen.findByText(/品质与设计感/)).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("请输入你的回答…"), {
      target: { value: "符合，请生成报告" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[1]?.[0].sessionId).toBe(send.mock.calls[0]?.[0].sessionId);
    expect(send.mock.calls[1]?.[0].messages).toEqual([
      { role: "user", content: "进口家具" },
      expect.objectContaining({
        role: "assistant",
        content: expect.stringContaining("品质与设计感"),
      }),
      { role: "user", content: "符合，请生成报告" },
    ]);

    expect(await screen.findByText("用户画像报告待确认")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "继续对话修改" })).toBeNull();
    expect(screen.queryByPlaceholderText("请输入你的回答…")).toBeNull();
    const reportEditor = screen.getByLabelText("用户画像报告内容");
    expect((reportEditor as HTMLTextAreaElement).value).toContain("# 用户画像");
    fireEvent.change(reportEditor, {
      target: { value: "# 用户画像\n\n## 你卖什么\n\n修改后的进口家具批发报告" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认并保存到本地" }));
    await waitFor(() =>
      expect(confirm).toHaveBeenCalledWith({
        markdown: "# 用户画像\n\n## 你卖什么\n\n修改后的进口家具批发报告",
      }),
    );

    expect(await screen.findByText("画像已就绪")).toBeTruthy();
    expect(screen.queryByLabelText("用户画像首次引导")).toBeNull();
    expect(screen.getByRole("button", { name: "新建任务" })).toBeTruthy();
    expect(screen.getByText("生成物")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "开始创建多平台推文" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "制定首发策略" })).toBeNull();
    expect(screen.queryByRole("switch", { name: "企业知识" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "任务对话输入区" })).toBeNull();
    const startCreating = screen.getByRole("button", { name: "开始创建多平台推文" });
    fireEvent.click(startCreating);
    expect(screen.getByRole("heading", { name: "选择本次内容类型" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /产品推广文案/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /公司软文/ })).toBeTruthy();
    expect(screen.queryByPlaceholderText("告诉我这次要推广的产品…")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /产品推广文案/ }));
    expect(await screen.findByText(/接下来请告诉我本次想推广的产品是什么/)).toBeTruthy();
    expect(screen.getByPlaceholderText("告诉我这次要推广的产品…")).toBeTruthy();
    expect(send).toHaveBeenCalledTimes(2);
    fireEvent.change(screen.getByPlaceholderText("告诉我这次要推广的产品…"), {
      target: { value: "尚未发送的产品内容" },
    });
    fireEvent.click(screen.getByRole("button", { name: "返回内容类型选择" }));
    expect(screen.getByRole("heading", { name: "选择本次内容类型" })).toBeTruthy();
    expect(screen.queryByText(/接下来请告诉我本次想推广的产品是什么/)).toBeNull();
    expect(screen.queryByPlaceholderText("告诉我这次要推广的产品…")).toBeNull();
    expect(send).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "查看或更新画像" }));
    const savedEditor = await screen.findByLabelText("用户画像主文件内容");
    fireEvent.change(savedEditor, { target: { value: "# 用户画像\n\n保存后的再次修改" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    await waitFor(() =>
      expect(saveDocument).toHaveBeenCalledWith("# 用户画像\n\n保存后的再次修改"),
    );

    fireEvent.click(screen.getByRole("button", { name: "删除用户画像" }));
    const deleteDialog = screen.getByRole("dialog", { name: "永久删除用户画像？" });
    expect(deleteDialog.textContent).toContain("删除后无法恢复");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog", { name: "永久删除用户画像？" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "删除用户画像" }));
    fireEvent.click(screen.getByRole("button", { name: "永久删除" }));
    await waitFor(() => expect(deletePersona).toHaveBeenCalledTimes(1));
    queryClient.clear();
  });
});
