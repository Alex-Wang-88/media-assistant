import type { ProductPromotionAgentResponse } from "@yoom/desktop-contracts";

export function ProductQuestionCard({
  response,
  selectedOptionIds,
  customInput,
  busy,
  onToggleOption,
  onCustomInputChange,
  onSkip,
  onSubmit,
}: {
  response: ProductPromotionAgentResponse;
  selectedOptionIds: string[];
  customInput: string;
  busy: boolean;
  onToggleOption(optionId: string): void;
  onCustomInputChange(value: string): void;
  onSkip(): void;
  onSubmit(): void;
}) {
  return (
    <section className="persona-question-card product-question-card">
      <header>
        <strong>
          {response.selectionMode === "multiple"
            ? response.rankSelections
              ? `请按优先级选择，最多 ${response.maxSelections ?? response.options.length} 项，也可以补充文字`
              : response.maxSelections
                ? `最多选择 ${response.maxSelections} 项，也可以补充文字`
                : "可多选，也可以补充文字"
            : response.selectionMode === "single"
              ? "请选择一项，也可以补充文字"
              : "请输入你的回答"}
        </strong>
      </header>
      {response.selectionMode !== "text" ? (
        <div className={`persona-question-options ${response.selectionMode}`}>
          {response.options.map((option) => {
            const priority = selectedOptionIds.indexOf(option.id);
            const selected = priority >= 0;
            const maxSelections =
              response.selectionMode === "single"
                ? 1
                : (response.maxSelections ?? response.options.length);
            const selectionLimitReached =
              response.selectionMode === "multiple" &&
              !selected &&
              selectedOptionIds.length >= maxSelections;
            return (
              <button
                type="button"
                key={option.id}
                className={selected ? "selected" : ""}
                aria-pressed={selected}
                disabled={busy || selectionLimitReached}
                onClick={() => onToggleOption(option.id)}
              >
                <span aria-hidden="true">
                  {selected ? (response.rankSelections ? priority + 1 : "✓") : ""}
                </span>
                {option.label}
              </button>
            );
          })}
        </div>
      ) : null}
      {response.allowCustomInput ? (
        <textarea
          className="product-question-input"
          value={customInput}
          disabled={busy}
          placeholder={response.selectionMode === "text" ? "请输入具体信息…" : "需要时可继续补充…"}
          onChange={(event) => onCustomInputChange(event.target.value)}
        />
      ) : null}
      <footer>
        {response.allowSkip ? (
          <button type="button" disabled={busy} onClick={onSkip}>
            跳过
          </button>
        ) : null}
        <button
          type="button"
          className="primary"
          disabled={busy || (selectedOptionIds.length === 0 && !customInput.trim())}
          onClick={onSubmit}
        >
          提交回答
        </button>
      </footer>
    </section>
  );
}
