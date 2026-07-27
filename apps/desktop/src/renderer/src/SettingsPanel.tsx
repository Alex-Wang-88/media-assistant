import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  isHexColor,
  resolveAppearance,
  resolveColorScheme,
  systemPrefersDark,
  THEME_PRESETS,
  watchSystemTheme,
} from "./appearance";
import { useUiStore } from "./store";

const MODE_OPTIONS = [
  { value: "dark", label: "深色" },
  { value: "light", label: "浅色" },
  { value: "system", label: "跟随系统" },
] as const;

type EditableColor = "background" | "foreground";

type HsvColor = {
  hue: number;
  saturation: number;
  value: number;
};

type ColorPickerProps = {
  initialValue: string;
  label: string;
  onCancel(): void;
  onConfirm(value: string): void;
};

function ColorPicker({ initialValue, label, onCancel, onConfirm }: ColorPickerProps) {
  const [hsv, setHsv] = useState<HsvColor>(() => hexToHsv(initialValue));
  const [hexDraft, setHexDraft] = useState(initialValue.toUpperCase());
  const planeRef = useRef<HTMLDivElement>(null);
  const currentColor = hsvToHex(hsv);
  const hexIsValid = isHexColor(hexDraft.trim());

  const updateHsv = (next: HsvColor) => {
    setHsv(next);
    setHexDraft(hsvToHex(next).toUpperCase());
  };

  const updatePlane = (clientX: number, clientY: number) => {
    const rect = planeRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    updateHsv({
      ...hsv,
      saturation: clamp((clientX - rect.left) / rect.width),
      value: 1 - clamp((clientY - rect.top) / rect.height),
    });
  };

  return (
    <div className="custom-color-picker" role="dialog" aria-label={`${label}调色盘`}>
      <p className="custom-color-guide">颜色区域：左右调整饱和度，上下调整明暗</p>
      <div
        ref={planeRef}
        className="custom-color-plane"
        style={{
          background: `linear-gradient(to top, #000000, transparent), linear-gradient(to right, #ffffff, hsl(${hsv.hue} 100% 50%))`,
        }}
        role="slider"
        tabIndex={0}
        aria-label={`${label}饱和度和亮度`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(hsv.saturation * 100)}
        aria-valuetext={currentColor}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          updatePlane(event.clientX, event.clientY);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            updatePlane(event.clientX, event.clientY);
          }
        }}
      >
        <span
          className="custom-color-cursor"
          style={{
            left: `${hsv.saturation * 100}%`,
            top: `${(1 - hsv.value) * 100}%`,
            backgroundColor: currentColor,
          }}
        />
      </div>

      <label className="custom-color-hue-control">
        <span>色相：左右滑动切换颜色</span>
        <span className="custom-color-hue-row">
          <span className="custom-color-preview" style={{ backgroundColor: currentColor }} />
          <input
            className="custom-color-hue"
            type="range"
            min={0}
            max={360}
            value={Math.round(hsv.hue)}
            aria-label={`${label}色相，左右滑动切换颜色`}
            onChange={(event) => {
              updateHsv({ ...hsv, hue: Number(event.target.value) });
            }}
          />
        </span>
      </label>

      <label className="custom-color-hex">
        <span>颜色值</span>
        <input
          type="text"
          value={hexDraft}
          maxLength={7}
          spellCheck={false}
          aria-label={`${label}调色盘色值`}
          aria-invalid={!hexIsValid}
          onChange={(event) => {
            const value = event.target.value;
            setHexDraft(value);
            if (isHexColor(value.trim())) setHsv(hexToHsv(value.trim()));
          }}
        />
      </label>

      <div className="custom-color-picker-actions">
        <button type="button" className="custom-color-cancel" onClick={onCancel}>
          取消
        </button>
        <button
          type="button"
          className="custom-color-confirm"
          disabled={!hexIsValid}
          onClick={() => {
            const value = hexDraft.trim();
            if (isHexColor(value)) onConfirm(value.toLowerCase());
          }}
        >
          确认
        </button>
      </div>
    </div>
  );
}

export function SettingsPanel() {
  const settingsOpen = useUiStore((state) => state.settingsOpen);
  const appearance = useUiStore((state) => state.appearance);
  const closeSettings = useUiStore((state) => state.closeSettings);
  const setThemeMode = useUiStore((state) => state.setThemeMode);
  const chooseThemePreset = useUiStore((state) => state.chooseThemePreset);
  const savedThemePresets = useUiStore((state) => state.savedThemePresets);
  const activeSavedThemeId = useUiStore((state) => state.activeSavedThemeId);
  const chooseSavedThemePreset = useUiStore((state) => state.chooseSavedThemePreset);
  const deleteSavedThemePreset = useUiStore((state) => state.deleteSavedThemePreset);
  const customizeTheme = useUiStore((state) => state.customizeTheme);
  const saveThemeCustomization = useUiStore((state) => state.saveThemeCustomization);
  const resetThemeCustomization = useUiStore((state) => state.resetThemeCustomization);
  const appearanceSaveError = useUiStore((state) => state.appearanceSaveError);
  const appearanceSaveNotice = useUiStore((state) => state.appearanceSaveNotice);
  const [prefersDark, setPrefersDark] = useState(() => systemPrefersDark());
  const [openPicker, setOpenPicker] = useState<EditableColor | null>(null);
  const [themeName, setThemeName] = useState("");
  const [pendingDeleteThemeId, setPendingDeleteThemeId] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const doneButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const modeGroupName = useId();
  const presetGroupName = useId();
  const backgroundInputId = useId();
  const backgroundHelpId = useId();
  const backgroundErrorId = useId();
  const foregroundInputId = useId();
  const foregroundHelpId = useId();
  const foregroundErrorId = useId();

  const scheme = resolveColorScheme(appearance.mode, prefersDark);
  const resolved = useMemo(
    () => resolveAppearance(appearance, prefersDark),
    [appearance, prefersDark],
  );
  const [backgroundDraft, setBackgroundDraft] = useState<string>(resolved.background);
  const [foregroundDraft, setForegroundDraft] = useState<string>(resolved.foreground);
  const backgroundIsValid = isHexColor(backgroundDraft.trim());
  const foregroundIsValid = isHexColor(foregroundDraft.trim());
  const activePreset = THEME_PRESETS.find((preset) => preset.id === appearance.presetId);
  const activeSavedTheme = savedThemePresets.find((preset) => preset.id === activeSavedThemeId);

  useEffect(() => watchSystemTheme(setPrefersDark), []);

  useEffect(() => {
    if (!settingsOpen) return;
    setBackgroundDraft(resolved.background);
    setForegroundDraft(resolved.foreground);
    setOpenPicker(null);
    setPendingDeleteThemeId(null);
  }, [resolved.background, resolved.foreground, settingsOpen]);

  useEffect(() => {
    if (activeSavedTheme) setThemeName(activeSavedTheme.name);
  }, [activeSavedTheme]);

  useEffect(() => {
    if (!settingsOpen) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (openPicker) {
          setOpenPicker(null);
          return;
        }
        closeSettings();
        return;
      }
      if (event.key !== "Tab") return;

      const panel = panelRef.current;
      if (!panel) return;
      const first = closeButtonRef.current;
      const last = doneButtonRef.current;
      if (!first || !last) return;

      if (
        event.shiftKey &&
        (document.activeElement === first || !panel.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !panel.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    closeButtonRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [closeSettings, openPicker, settingsOpen]);

  const updateColor = (kind: EditableColor, value: string) => {
    if (kind === "background") setBackgroundDraft(value);
    else setForegroundDraft(value);

    const candidate = value.trim();
    if (!isHexColor(candidate)) return;
    if (kind === "background") customizeTheme(scheme, { background: candidate });
    else customizeTheme(scheme, { foreground: candidate });
  };

  const restoreInvalidDraft = (kind: EditableColor) => {
    if (kind === "background" && !backgroundIsValid) setBackgroundDraft(resolved.background);
    if (kind === "foreground" && !foregroundIsValid) setForegroundDraft(resolved.foreground);
  };

  if (!settingsOpen) return null;

  const schemeLabel = scheme === "dark" ? "深色" : "浅色";
  const customStatus = appearance.manual
    ? activeSavedTheme
      ? `当前使用“${activeSavedTheme.name}”自定义预设`
      : "当前使用尚未保存为预设的自定义颜色"
    : activePreset
      ? `当前使用“${activePreset.label}”预设`
      : "当前使用默认预设";

  return (
    <div className="settings-overlay">
      <button
        type="button"
        className="settings-backdrop"
        tabIndex={-1}
        aria-label="关闭外观设置"
        onClick={closeSettings}
      />
      <div
        ref={panelRef}
        className="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="settings-header">
          <div>
            <p className="settings-eyebrow">应用设置</p>
            <h2 id={titleId}>外观</h2>
            <p>选择主题，并按需要调整当前配色。</p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="settings-close"
            aria-label="关闭外观设置"
            onClick={closeSettings}
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <div className="settings-content">
          <fieldset className="settings-section">
            <legend>显示模式</legend>
            <p className="settings-section-copy">跟随系统会自动响应系统的深浅色设置。</p>
            <div className="mode-options">
              {MODE_OPTIONS.map((option) => (
                <label className="mode-option" key={option.value}>
                  <input
                    type="radio"
                    name={modeGroupName}
                    value={option.value}
                    checked={appearance.mode === option.value}
                    onChange={() => setThemeMode(option.value)}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="settings-section">
            <legend>预设主题</legend>
            <div className="theme-grid">
              {THEME_PRESETS.map((preset) => {
                const presetColors = preset[scheme];
                return (
                  <label className="theme-card" key={preset.id}>
                    <input
                      className="theme-card-radio"
                      type="radio"
                      name={presetGroupName}
                      value={preset.id}
                      checked={appearance.presetId === preset.id && appearance.manual === null}
                      onChange={() => {
                        setThemeName("");
                        chooseThemePreset(preset.id);
                      }}
                    />
                    <span
                      className="theme-card-palette"
                      style={{
                        backgroundColor: presetColors.background,
                        color: presetColors.foreground,
                      }}
                      aria-hidden="true"
                    >
                      <span
                        className="theme-swatch"
                        style={{ backgroundColor: presetColors.foreground }}
                      />
                    </span>
                    <span className="theme-card-copy">
                      <strong>{preset.label}</strong>
                    </span>
                  </label>
                );
              })}
              {savedThemePresets.map((preset) => {
                const presetColors = resolveAppearance(
                  {
                    mode: scheme,
                    presetId: null,
                    manual: preset.manual,
                  },
                  scheme === "dark",
                );
                return (
                  <div className="saved-theme-card-wrap" key={preset.id}>
                    <label className="theme-card saved-theme-card">
                      <input
                        className="theme-card-radio"
                        type="radio"
                        name={presetGroupName}
                        value={preset.id}
                        checked={activeSavedThemeId === preset.id}
                        onChange={() => {
                          setPendingDeleteThemeId(null);
                          setThemeName(preset.name);
                          chooseSavedThemePreset(preset.id);
                        }}
                      />
                      <span
                        className="theme-card-palette"
                        style={{
                          backgroundColor: presetColors.background,
                          color: presetColors.foreground,
                        }}
                        aria-hidden="true"
                      >
                        <span
                          className="theme-swatch"
                          style={{ backgroundColor: presetColors.foreground }}
                        />
                      </span>
                      <span className="theme-card-copy">
                        <strong>{preset.name}</strong>
                        <small>自定义预设</small>
                      </span>
                    </label>
                    {pendingDeleteThemeId === preset.id ? (
                      <span className="saved-theme-delete-confirm">
                        <button
                          type="button"
                          onClick={() => {
                            if (activeSavedThemeId === preset.id) setThemeName("");
                            deleteSavedThemePreset(preset.id);
                            setPendingDeleteThemeId(null);
                          }}
                        >
                          确认删除
                        </button>
                        <button type="button" onClick={() => setPendingDeleteThemeId(null)}>
                          取消
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="saved-theme-delete"
                        aria-label={`删除自定义预设“${preset.name}”`}
                        onClick={() => setPendingDeleteThemeId(preset.id)}
                      >
                        删除
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </fieldset>

          <section
            className="settings-section theme-customization"
            aria-labelledby={`${titleId}-自定义`}
          >
            <div className="settings-section-heading">
              <div>
                <h3 id={`${titleId}-自定义`}>自定义颜色</h3>
                <p className="settings-section-copy">
                  当前编辑{schemeLabel}配色，确认预览效果后点击保存。
                </p>
              </div>
              <button
                type="button"
                className="color-reset-all"
                disabled={appearance.manual === null}
                onClick={() => {
                  setThemeName("");
                  resetThemeCustomization();
                }}
              >
                恢复预设颜色
              </button>
            </div>

            <p className="settings-status" role="status">
              {customStatus}
            </p>

            <div className="color-controls">
              <div className="color-control">
                <div className="color-control-header">
                  <label htmlFor={backgroundInputId}>背景颜色</label>
                  <span>{schemeLabel}界面背景</span>
                </div>
                <div className="color-control-row">
                  <button
                    type="button"
                    className="color-native-input"
                    aria-label={`选择${schemeLabel}背景颜色`}
                    aria-expanded={openPicker === "background"}
                    style={{ backgroundColor: resolved.background }}
                    onClick={() =>
                      setOpenPicker((current) => (current === "background" ? null : "background"))
                    }
                  >
                    <span className="sr-only">打开背景颜色调色盘</span>
                  </button>
                  <input
                    id={backgroundInputId}
                    className="color-text-input"
                    type="text"
                    value={backgroundDraft}
                    inputMode="text"
                    maxLength={7}
                    spellCheck={false}
                    autoCapitalize="characters"
                    aria-invalid={!backgroundIsValid}
                    aria-describedby={
                      backgroundIsValid
                        ? backgroundHelpId
                        : `${backgroundHelpId} ${backgroundErrorId}`
                    }
                    placeholder="#RRGGBB"
                    onChange={(event) => updateColor("background", event.target.value)}
                    onBlur={() => restoreInvalidDraft("background")}
                  />
                </div>
                <small id={backgroundHelpId}>格式：#RRGGBB</small>
                {!backgroundIsValid && (
                  <small id={backgroundErrorId} className="color-error" role="alert">
                    请输入完整的六位十六进制色值。
                  </small>
                )}
                {openPicker === "background" && (
                  <ColorPicker
                    initialValue={backgroundIsValid ? backgroundDraft.trim() : resolved.background}
                    label="背景颜色"
                    onCancel={() => setOpenPicker(null)}
                    onConfirm={(value) => {
                      updateColor("background", value);
                      setOpenPicker(null);
                    }}
                  />
                )}
              </div>

              <div className="color-control">
                <div className="color-control-header">
                  <label htmlFor={foregroundInputId}>字体颜色</label>
                  <span>用于主要文字与图标</span>
                </div>
                <div className="color-control-row">
                  <button
                    type="button"
                    className="color-native-input"
                    aria-label="选择字体颜色"
                    aria-expanded={openPicker === "foreground"}
                    style={{ backgroundColor: resolved.foreground }}
                    onClick={() =>
                      setOpenPicker((current) => (current === "foreground" ? null : "foreground"))
                    }
                  >
                    <span className="sr-only">打开字体颜色调色盘</span>
                  </button>
                  <input
                    id={foregroundInputId}
                    className="color-text-input"
                    type="text"
                    value={foregroundDraft}
                    inputMode="text"
                    maxLength={7}
                    spellCheck={false}
                    autoCapitalize="characters"
                    aria-invalid={!foregroundIsValid}
                    aria-describedby={
                      foregroundIsValid
                        ? foregroundHelpId
                        : `${foregroundHelpId} ${foregroundErrorId}`
                    }
                    placeholder="#RRGGBB"
                    onChange={(event) => updateColor("foreground", event.target.value)}
                    onBlur={() => restoreInvalidDraft("foreground")}
                  />
                </div>
                <small id={foregroundHelpId}>格式：#RRGGBB</small>
                {!foregroundIsValid && (
                  <small id={foregroundErrorId} className="color-error" role="alert">
                    请输入完整的六位十六进制色值。
                  </small>
                )}
                {openPicker === "foreground" && (
                  <ColorPicker
                    initialValue={foregroundIsValid ? foregroundDraft.trim() : resolved.foreground}
                    label="字体颜色"
                    onCancel={() => setOpenPicker(null)}
                    onConfirm={(value) => {
                      updateColor("foreground", value);
                      setOpenPicker(null);
                    }}
                  />
                )}
              </div>
            </div>
            <div className="color-save-row">
              <label className="theme-name-field">
                <span>方案名称</span>
                <input
                  type="text"
                  value={themeName}
                  maxLength={24}
                  placeholder="例如：我的蓝色"
                  onChange={(event) => setThemeName(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="color-save"
                disabled={
                  !appearance.manual ||
                  !themeName.trim() ||
                  !backgroundIsValid ||
                  !foregroundIsValid
                }
                onClick={() => saveThemeCustomization(themeName)}
              >
                保存
              </button>
            </div>
          </section>

          <section className="settings-section" aria-labelledby={`${titleId}-预览`}>
            <h3 id={`${titleId}-预览`}>实时预览</h3>
            <article
              className="settings-preview"
              style={{
                backgroundColor: resolved.background,
                color: resolved.foreground,
                colorScheme: scheme,
              }}
              aria-label={`${schemeLabel}配色实时预览`}
            >
              <div className="settings-preview-toolbar">
                <strong>获客智能助手</strong>
                <span>{schemeLabel}模式</span>
              </div>
              <div className="settings-preview-surface">
                <p>这是一段界面文字，用来检查背景与字体颜色的搭配效果。</p>
                <button
                  type="button"
                  tabIndex={-1}
                  style={{
                    backgroundColor: resolved.foreground,
                    color: resolved.background,
                  }}
                >
                  示例按钮
                </button>
              </div>
            </article>
          </section>
        </div>

        <footer className="settings-footer">
          {appearanceSaveError ? (
            <span className="settings-save-error" role="alert">
              {appearanceSaveError}
            </span>
          ) : appearanceSaveNotice ? (
            <span className="settings-save-notice" role="status">
              {appearanceSaveNotice}
            </span>
          ) : (
            <span>自定义颜色可命名并保存为预设方案。</span>
          )}
          <button ref={doneButtonRef} type="button" onClick={closeSettings}>
            完成
          </button>
        </footer>
      </div>
    </div>
  );
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function hexToHsv(value: string): HsvColor {
  const normalized = value.replace("#", "");
  const red = Number.parseInt(normalized.slice(0, 2), 16) / 255;
  const green = Number.parseInt(normalized.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(normalized.slice(4, 6), 16) / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  let hue = 0;

  if (delta !== 0) {
    if (maximum === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (maximum === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }

  if (hue < 0) hue += 360;
  return {
    hue,
    saturation: maximum === 0 ? 0 : delta / maximum,
    value: maximum,
  };
}

function hsvToHex({ hue, saturation, value }: HsvColor): string {
  const chroma = value * saturation;
  const section = hue / 60;
  const secondary = chroma * (1 - Math.abs((section % 2) - 1));
  let [red, green, blue] = [0, 0, 0];

  if (section < 1) [red, green] = [chroma, secondary];
  else if (section < 2) [red, green] = [secondary, chroma];
  else if (section < 3) [green, blue] = [chroma, secondary];
  else if (section < 4) [green, blue] = [secondary, chroma];
  else if (section < 5) [red, blue] = [secondary, chroma];
  else [red, blue] = [chroma, secondary];

  const match = value - chroma;
  const channel = (component: number) =>
    Math.round((component + match) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(red)}${channel(green)}${channel(blue)}`;
}
