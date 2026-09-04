import type { Platform, PlatformContentPlatform } from "@yoom/desktop-contracts";

export type ContentAgentType = "product_promotion" | "company_pr";

export const PRODUCT_PLATFORM_OPTIONS: Array<{
  id: Platform;
  label: string;
  description: string;
  enabled: boolean;
}> = [
  { id: "bilibili", label: "哔哩哔哩", description: "生成 B 站动态标题和正文", enabled: true },
  { id: "wechat", label: "微信公众号", description: "平台 Agent 暂未接入", enabled: false },
  { id: "toutiao", label: "今日头条", description: "平台 Agent 暂未接入", enabled: false },
  { id: "zhihu", label: "知乎", description: "生成知乎文章标题和正文", enabled: true },
  { id: "weibo", label: "微博", description: "平台 Agent 暂未接入", enabled: false },
  { id: "xiaohongshu", label: "小红书", description: "平台 Agent 暂未接入", enabled: false },
  { id: "x", label: "X（Twitter）", description: "生成适合 X 的短帖文案", enabled: true },
];

export const CONTENT_AGENT_WELCOME: Record<ContentAgentType, string> = {
  product_promotion:
    "你好，接下来请告诉我本次想推广的产品是什么。可以先从产品名称、主要卖点或活动信息开始。",
  company_pr:
    "你好，接下来请告诉我这次公司软文想表达的主题。可以是品牌故事、企业动态、公司理念或其他方向。",
};

export function isProductContentPlatform(platform: Platform): platform is PlatformContentPlatform {
  return PRODUCT_PLATFORM_OPTIONS.some((option) => option.id === platform && option.enabled);
}
