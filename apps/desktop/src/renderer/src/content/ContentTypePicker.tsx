import { Icon } from "../ui/Icon";
import type { ContentAgentType } from "./platforms";

export function ContentTypePicker({ onSelect }: { onSelect(type: ContentAgentType): void }) {
  return (
    <div className="welcome-card content-type-picker">
      <span className="welcome-mark">
        <Icon name="spark" />
      </span>
      <h1>选择本次内容类型</h1>
      <p>不同类型会进入不同的智能体对话流程。选择后才会显示对话输入框。</p>
      <div className="content-type-options">
        <button type="button" onClick={() => onSelect("product_promotion")}>
          <strong>产品推广文案</strong>
          <span>围绕具体产品、卖点和活动生成内容</span>
        </button>
        <button type="button" onClick={() => onSelect("company_pr")}>
          <strong>公司软文</strong>
          <span>围绕品牌、企业动态或公司主题生成内容</span>
        </button>
      </div>
    </div>
  );
}
