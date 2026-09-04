import type { PersonaFlowState, PersonaStageOption } from "@yoom/desktop-contracts";
import type { ConversationMessage } from "../chat-state";
import { ChatBubble } from "../conversation/ChatBubble";

export function PersonaFlowView({
  flow,
  resumeChoiceOpen,
  messages,
  busy,
  selectionRequired,
  finalConfirmationRequired,
  selectionMultiple,
  selectedOptionIds,
  finalAnswer,
  reportDraft,
  reportSaving,
  reportError,
  onRestart,
  onContinue,
  onToggleOption,
  onFinalAnswerChange,
  onSkipStage,
  onSubmitSelection,
  onConfirmStage,
  onSubmitCorrection,
  onReportChange,
  onConfirmReport,
}: {
  flow: PersonaFlowState | null;
  resumeChoiceOpen: boolean;
  messages: ConversationMessage[];
  busy: boolean;
  selectionRequired: boolean;
  finalConfirmationRequired: boolean;
  selectionMultiple: boolean;
  selectedOptionIds: string[];
  finalAnswer: string;
  reportDraft: string | null;
  reportSaving: boolean;
  reportError: string | null;
  onRestart(): void;
  onContinue(): void;
  onToggleOption(option: PersonaStageOption): void;
  onFinalAnswerChange(value: string, clearSelection: boolean): void;
  onSkipStage(): void;
  onSubmitSelection(): void;
  onConfirmStage(): void;
  onSubmitCorrection(): void;
  onReportChange(value: string): void;
  onConfirmReport(): void;
}) {
  const activeStage = flow?.stages[flow.currentStage - 1] ?? null;
  return (
    <div className="persona-setup-conversation">
      <header>
        <div>
          <strong>建立用户画像</strong>
          <small>{flow ? `当前为第 ${flow.currentStage}/5 阶段` : "正在准备五阶段画像流程"}</small>
        </div>
        {!resumeChoiceOpen ? (
          <div className="persona-setup-actions">
            <button type="button" disabled={busy} onClick={onRestart}>
              重新开始画像
            </button>
          </div>
        ) : null}
      </header>
      {resumeChoiceOpen ? (
        <section className="persona-resume-choice" aria-labelledby="persona-resume-title">
          <div className="persona-resume-copy">
            <strong id="persona-resume-title">发现上次未完成的用户画像</strong>
            <p>可以恢复上次的全部对话和当前进度，也可以清空进度重新开始。</p>
          </div>
          <div className="persona-resume-actions">
            <button type="button" className="primary" onClick={onContinue}>
              继续上次画像
            </button>
            <button type="button" onClick={onRestart}>
              重新开始
            </button>
          </div>
        </section>
      ) : (
        <div className="message-list" aria-live="polite">
          {messages.map((entry) => (
            <ChatBubble key={entry.id} message={entry} />
          ))}
        </div>
      )}
      {!resumeChoiceOpen && selectionRequired && activeStage ? (
        <fieldset className="persona-convergence-options">
          <legend>
            {selectionMultiple
              ? "已达到本阶段问答上限，可选择多项、手动填写或跳过"
              : "已达到本阶段问答上限，请选择一项、手动填写或跳过"}
          </legend>
          <div className="persona-convergence-choice-list">
            {activeStage.options.map((option) => (
              <button
                type="button"
                key={option.id}
                disabled={busy}
                className={selectedOptionIds.includes(option.id) ? "selected" : ""}
                aria-pressed={selectedOptionIds.includes(option.id)}
                onClick={() => onToggleOption(option)}
              >
                <span aria-hidden="true">{selectedOptionIds.includes(option.id) ? "✓" : ""}</span>
                {option.label}
              </button>
            ))}
          </div>
          <label className="persona-convergence-manual">
            <span>以上都不符合，可以填写最后一次补充</span>
            <textarea
              value={finalAnswer}
              disabled={busy}
              placeholder="请输入最终答案"
              onChange={(event) => onFinalAnswerChange(event.target.value, true)}
            />
          </label>
          <div className="persona-convergence-actions">
            <button type="button" className="skip" disabled={busy} onClick={onSkipStage}>
              跳过本阶段
            </button>
            <button
              type="button"
              className="primary"
              disabled={busy || (!finalAnswer.trim() && selectedOptionIds.length === 0)}
              onClick={onSubmitSelection}
            >
              提交最终答案
            </button>
          </div>
        </fieldset>
      ) : null}
      {!resumeChoiceOpen && finalConfirmationRequired && activeStage ? (
        <fieldset className="persona-convergence-options persona-final-confirmation">
          <legend>这是本阶段最终结论</legend>
          <div className="persona-convergence-actions">
            <button type="button" className="skip" disabled={busy} onClick={onSkipStage}>
              跳过本阶段
            </button>
            <button type="button" className="primary" disabled={busy} onClick={onConfirmStage}>
              确认并进入下一阶段
            </button>
          </div>
          <label className="persona-convergence-manual">
            <span>仍不准确时，可提交最后一次修正</span>
            <textarea
              value={finalAnswer}
              disabled={busy}
              placeholder="请输入最终修正"
              onChange={(event) => onFinalAnswerChange(event.target.value, false)}
            />
          </label>
          <button
            type="button"
            className="persona-final-correction-submit"
            disabled={busy || !finalAnswer.trim()}
            onClick={onSubmitCorrection}
          >
            提交最终修正
          </button>
        </fieldset>
      ) : null}
      {!resumeChoiceOpen && reportDraft ? (
        <article className="persona-draft-card">
          <header>
            <div>
              <strong>用户画像报告待确认</strong>
              <small>可直接修改；确认前不会写入本地主文件</small>
            </div>
          </header>
          <textarea
            className="persona-report-editor"
            aria-label="用户画像报告内容"
            value={reportDraft}
            spellCheck={false}
            onChange={(event) => onReportChange(event.target.value)}
          />
          {reportError ? (
            <p className="persona-rag-error" role="alert">
              保存失败：{reportError}
            </p>
          ) : null}
          <footer>
            <button
              type="button"
              className="primary"
              disabled={!reportDraft.trim() || reportSaving}
              onClick={onConfirmReport}
            >
              {reportSaving ? "正在保存…" : "确认并保存到本地"}
            </button>
          </footer>
        </article>
      ) : null}
    </div>
  );
}
