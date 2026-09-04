import type { Platform } from "@yoom/desktop-contracts";

export type PublishPlatformDefinition = {
  id: Platform;
  label: string;
  supportsAccounts: boolean;
  supportsFill: boolean;
  supportsAutoPublish: boolean;
  editor: "plain" | "blocks";
};

export const PUBLISH_PLATFORMS: Record<Platform, PublishPlatformDefinition> = {
  wechat: {
    id: "wechat",
    label: "微信公众号",
    supportsAccounts: false,
    supportsFill: false,
    supportsAutoPublish: false,
    editor: "plain",
  },
  toutiao: {
    id: "toutiao",
    label: "今日头条",
    supportsAccounts: false,
    supportsFill: false,
    supportsAutoPublish: false,
    editor: "plain",
  },
  zhihu: {
    id: "zhihu",
    label: "知乎",
    supportsAccounts: true,
    supportsFill: true,
    supportsAutoPublish: false,
    editor: "blocks",
  },
  weibo: {
    id: "weibo",
    label: "微博",
    supportsAccounts: false,
    supportsFill: false,
    supportsAutoPublish: false,
    editor: "plain",
  },
  bilibili: {
    id: "bilibili",
    label: "哔哩哔哩",
    supportsAccounts: true,
    supportsFill: true,
    supportsAutoPublish: true,
    editor: "plain",
  },
  xiaohongshu: {
    id: "xiaohongshu",
    label: "小红书",
    supportsAccounts: false,
    supportsFill: false,
    supportsAutoPublish: false,
    editor: "plain",
  },
  x: {
    id: "x",
    label: "X（Twitter）",
    supportsAccounts: true,
    supportsFill: true,
    supportsAutoPublish: true,
    editor: "plain",
  },
};

export const PLATFORM_LABELS = Object.fromEntries(
  Object.values(PUBLISH_PLATFORMS).map((platform) => [platform.id, platform.label]),
) as Record<Platform, string>;

export const DEFAULT_AUTO_PUBLISH_BY_PLATFORM = Object.fromEntries(
  Object.values(PUBLISH_PLATFORMS).map((platform) => [platform.id, false]),
) as Record<Platform, boolean>;
