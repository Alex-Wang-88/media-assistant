import type { Platform, PlatformContentPlatform } from "@yoom/desktop-contracts";
import { Icon } from "../ui/Icon";
import { PRODUCT_PLATFORM_OPTIONS } from "./platforms";

export function ProductPlatformPicker({
  selected,
  onBack,
  onToggle,
  onConfirm,
}: {
  selected: PlatformContentPlatform[];
  onBack(): void;
  onToggle(platform: Platform): void;
  onConfirm(): void;
}) {
  return (
    <div className="welcome-card content-type-picker platform-type-picker">
      <button type="button" className="content-agent-back platform-picker-back" onClick={onBack}>
        <span aria-hidden="true">←</span>
        返回内容类型选择
      </button>
      <span className="welcome-mark">
        <Icon name="spark" />
      </span>
      <h1>选择目标平台</h1>
      <p>可同时选择多个发布平台，产品问询完成后将分别调用对应的平台文案 Agent。</p>
      <div className="content-type-options platform-options">
        {PRODUCT_PLATFORM_OPTIONS.map((platform) => (
          <button
            type="button"
            key={platform.id}
            disabled={!platform.enabled}
            className={selected.some((candidate) => candidate === platform.id) ? "selected" : ""}
            aria-pressed={selected.some((candidate) => candidate === platform.id)}
            onClick={() => onToggle(platform.id)}
          >
            <strong>{platform.label}</strong>
            <span>{platform.description}</span>
          </button>
        ))}
      </div>
      <div className="platform-picker-actions">
        <button
          type="button"
          className="primary"
          disabled={selected.length === 0}
          onClick={onConfirm}
        >
          开始填写产品信息
        </button>
      </div>
    </div>
  );
}
