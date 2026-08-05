// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { DesktopApi, PublishDraftState } from "@yoom/desktop-contracts";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublishCenter } from "../src/renderer/src/PublishCenter";

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "desktop");
});

describe("publish center persistence", () => {
  it("restores a draft and automatically saves later edits", async () => {
    const draftId = crypto.randomUUID();
    const restored: PublishDraftState = {
      version: 1,
      selectedDraftId: draftId,
      drafts: [
        {
          id: draftId,
          title: "已保存草稿",
          platform: "bilibili",
          bilibiliAccountId: null,
          content: "重启前正文",
          images: [],
          source: "manual",
          pinned: false,
        },
      ],
      autoPublishByPlatform: {
        wechat: false,
        toutiao: false,
        zhihu: false,
        weibo: false,
        bilibili: false,
        xiaohongshu: false,
      },
    };
    const saveDrafts = vi.fn(async () => undefined);
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: {
        publish: {
          loadDrafts: vi.fn(async () => restored),
          saveDrafts,
          listBilibiliAccounts: vi.fn(async () => []),
        },
      } as unknown as DesktopApi,
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(PublishCenter, {
          open: true,
          workspacePath: "/workspace",
          seed: null,
          onSeedConsumed: vi.fn(),
          onClose: vi.fn(),
        }),
      ),
    );

    const content = await screen.findByPlaceholderText("可以直接输入任何想发布的内容…");
    expect((content as HTMLTextAreaElement).value).toBe("重启前正文");
    fireEvent.change(content, { target: { value: "重启后修改" } });

    await waitFor(() => {
      expect(saveDrafts).toHaveBeenLastCalledWith(
        expect.objectContaining({
          selectedDraftId: draftId,
          drafts: [expect.objectContaining({ content: "重启后修改" })],
        }),
      );
    });
  });

  it("groups drafts by source and only lets free drafts choose any platform", async () => {
    const generatedDraftId = crypto.randomUUID();
    const manualDraftId = crypto.randomUUID();
    const restored: PublishDraftState = {
      version: 1,
      selectedDraftId: generatedDraftId,
      drafts: [
        {
          id: generatedDraftId,
          title: "Agent 推广任务",
          platform: "bilibili",
          bilibiliAccountId: null,
          content: "平台版本正文",
          images: [],
          source: "generated",
          pinned: false,
        },
        {
          id: manualDraftId,
          title: "自由内容",
          platform: null,
          bilibiliAccountId: null,
          content: "自由草稿正文",
          images: [],
          source: "manual",
          pinned: false,
        },
      ],
      autoPublishByPlatform: {
        wechat: false,
        toutiao: false,
        zhihu: false,
        weibo: false,
        bilibili: false,
        xiaohongshu: false,
      },
    };
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: {
        publish: {
          loadDrafts: vi.fn(async () => restored),
          saveDrafts: vi.fn(async () => undefined),
          listBilibiliAccounts: vi.fn(async () => []),
          releaseImages: vi.fn(async () => undefined),
        },
      } as unknown as DesktopApi,
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(PublishCenter, {
          open: true,
          workspacePath: "/workspace",
          seed: null,
          onSeedConsumed: vi.fn(),
          onClose: vi.fn(),
        }),
      ),
    );

    expect(await screen.findByRole("heading", { name: "Agent 生成" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "自由草稿" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "＋ 新建自由草稿" })).toBeTruthy();
    expect(screen.getByText("由 Agent 内容流程确定")).toBeTruthy();
    expect(screen.queryByLabelText("目标平台")).toBeNull();
    expect(screen.queryByText("来自生成内容")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "清除当前草稿" }));
    fireEvent.click(screen.getByRole("button", { name: "确认清空" }));

    await waitFor(() => {
      expect(screen.getByText("由 Agent 内容流程确定")).toBeTruthy();
      expect(screen.queryByLabelText("目标平台")).toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "自由内容" }));

    expect(screen.getByLabelText("目标平台")).toBeTruthy();
  });
});
