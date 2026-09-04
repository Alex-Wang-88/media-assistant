import type { DragEvent as ReactDragEvent, RefObject } from "react";
import type { ContentAgentType } from "../content/platforms";
import { Icon } from "../ui/Icon";

export function ChatComposer({
  personaMode,
  personaStage,
  personaDropActive,
  personaUploadPending,
  streaming,
  selectedProjectId,
  contentAgentType,
  message,
  inputRef,
  onMessageChange,
  onSend,
  onAttach,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  personaMode: boolean;
  personaStage: number | null;
  personaDropActive: boolean;
  personaUploadPending: boolean;
  streaming: boolean;
  selectedProjectId: string | null;
  contentAgentType: ContentAgentType | null;
  message: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onMessageChange(value: string): void;
  onSend(): void;
  onAttach(): void;
  onDragOver(event: ReactDragEvent<HTMLElement>): void;
  onDragLeave(): void;
  onDrop(event: ReactDragEvent<HTMLElement>): void;
}) {
  return (
    <div className="composer-wrap">
      {personaMode ? (
        <div className="persona-setup-composer-label">
          正在建立用户画像
          {personaStage ? ` · 第 ${personaStage}/5 阶段` : ""}
          {" · 可随时上传补充资料"}
        </div>
      ) : null}
      <fieldset
        aria-label={personaMode ? "用户画像对话输入区，可拖拽上传资料" : "任务对话输入区"}
        className={personaMode && personaDropActive ? "composer drop-active" : "composer"}
        onDragEnter={personaMode ? onDragOver : undefined}
        onDragOver={personaMode ? onDragOver : undefined}
        onDragLeave={personaMode ? onDragLeave : undefined}
        onDrop={personaMode ? onDrop : undefined}
      >
        <textarea
          ref={inputRef}
          value={message}
          onChange={(event) => onMessageChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              onSend();
            }
          }}
          placeholder={
            personaMode
              ? "请输入你的回答…"
              : contentAgentType === "company_pr"
                ? "告诉我这次公司软文的主题…"
                : "告诉我这次要推广的产品…"
          }
          disabled={personaMode && streaming}
        />
        <div className="composer-actions">
          <button
            type="button"
            title={personaMode ? "上传画像参考资料" : "添加附件"}
            aria-label={personaMode ? "上传画像参考资料" : "添加附件"}
            className="attach"
            disabled={personaMode && (personaUploadPending || streaming)}
            onClick={onAttach}
          >
            <Icon name="paperclip" />
          </button>
          <span className="composer-note">
            {personaMode
              ? "支持一次选择多个本地资料"
              : selectedProjectId
                ? "支持图片、CSV、XLSX、PDF"
                : "首次发送将自动创建任务"}
          </span>
          <button
            className="send"
            type="button"
            aria-label="发送消息"
            onClick={onSend}
            disabled={!message.trim() || streaming}
          >
            {streaming ? <span className="button-spinner" /> : <Icon name="arrow-up" />}
          </button>
        </div>
      </fieldset>
    </div>
  );
}
