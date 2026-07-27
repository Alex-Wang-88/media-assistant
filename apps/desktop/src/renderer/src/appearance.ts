export type AppearanceMode = "system" | "light" | "dark";
export type ColorScheme = "light" | "dark";
export type ThemePresetId =
  | "classic-blue"
  | "emerald-green"
  | "warm-orange"
  | "elegant-purple"
  | "graphite-gray";
export type HexColor = `#${string}`;

export type ThemeColors = {
  background: HexColor;
  foreground: HexColor;
};

export type ManualAppearance = {
  basePresetId: ThemePresetId;
  backgrounds: Record<ColorScheme, HexColor>;
  foreground: HexColor | null;
};

export type Appearance = {
  mode: AppearanceMode;
  presetId: ThemePresetId | null;
  manual: ManualAppearance | null;
};

export type SavedThemePreset = {
  id: string;
  name: string;
  manual: ManualAppearance;
};

export type ThemePreset = {
  id: ThemePresetId;
  label: string;
  dark: ThemeColors;
  light: ThemeColors;
};

export type AppearanceTokens = Record<`--${string}`, string>;

export type ResolvedAppearance = ThemeColors & {
  mode: AppearanceMode;
  scheme: ColorScheme;
  presetId: ThemePresetId | null;
  tokens: AppearanceTokens;
};

export type AppearanceStorage = Pick<Storage, "getItem" | "setItem">;

export const THEME_PRESETS = [
  {
    id: "classic-blue",
    label: "经典蓝",
    dark: { background: "#2c3e50", foreground: "#ecf0f1" },
    light: { background: "#edf4fa", foreground: "#23313f" },
  },
  {
    id: "emerald-green",
    label: "翡翠绿",
    dark: { background: "#173d36", foreground: "#e9fff8" },
    light: { background: "#e8f5f0", foreground: "#173c34" },
  },
  {
    id: "warm-orange",
    label: "暖橙",
    dark: { background: "#4a2f1f", foreground: "#fff2df" },
    light: { background: "#fff3e6", foreground: "#4b2b17" },
  },
  {
    id: "elegant-purple",
    label: "雅致紫",
    dark: { background: "#3d2b52", foreground: "#f5eaff" },
    light: { background: "#f2eafa", foreground: "#372446" },
  },
  {
    id: "graphite-gray",
    label: "石墨灰",
    dark: { background: "#30343b", foreground: "#f0f2f5" },
    light: { background: "#f1f2f4", foreground: "#2d3137" },
  },
] as const satisfies readonly ThemePreset[];

export const DEFAULT_APPEARANCE: Appearance = {
  mode: "system",
  presetId: "graphite-gray",
  manual: null,
};

export const APPEARANCE_STORAGE_KEY = "media-assistant:appearance";
export const SAVED_THEME_PRESETS_STORAGE_KEY = "media-assistant:saved-theme-presets";

export function isHexColor(value: unknown): value is HexColor {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

export function resolveColorScheme(mode: AppearanceMode, prefersDark: boolean): ColorScheme {
  if (mode === "system") return prefersDark ? "dark" : "light";
  return mode;
}

export function resolveAppearance(
  appearance: Appearance,
  prefersDark: boolean,
): ResolvedAppearance {
  const normalized = normalizeAppearance(appearance);
  const scheme = resolveColorScheme(normalized.mode, prefersDark);
  const colors = colorsForScheme(normalized, scheme);
  return {
    ...colors,
    mode: normalized.mode,
    scheme,
    presetId: normalized.presetId,
    tokens: buildAppearanceTokens(colors, scheme),
  };
}

export function deriveModeBackground(background: string, targetScheme: ColorScheme): HexColor {
  const normalized = normalizeHex(background) ?? DEFAULT_APPEARANCE_COLOR.background;
  const [red, green, blue] = hexToRgb(normalized);
  const [hue, saturation] = rgbToHsl(red, green, blue);
  const lightness = targetScheme === "dark" ? 58 / 255 : 235 / 255;
  return rgbToHex(...hslToRgb(hue, saturation, lightness));
}

export function customizeAppearance(
  appearance: Appearance,
  currentScheme: ColorScheme,
  patch: Partial<ThemeColors>,
): Appearance {
  const normalized = normalizeAppearance(appearance);
  const current = colorsForScheme(normalized, currentScheme);
  const otherScheme: ColorScheme = currentScheme === "dark" ? "light" : "dark";
  const other = colorsForScheme(normalized, otherScheme);
  const nextBackground = normalizeHex(patch.background) ?? current.background;
  const nextForeground =
    patch.foreground === undefined
      ? (normalized.manual?.foreground ?? null)
      : (normalizeHex(patch.foreground) ?? normalized.manual?.foreground ?? null);
  const basePresetId = normalized.manual?.basePresetId ?? normalized.presetId ?? DEFAULT_PRESET_ID;
  const backgrounds: Record<ColorScheme, HexColor> = normalized.manual
    ? { ...normalized.manual.backgrounds }
    : {
        dark: currentScheme === "dark" ? current.background : other.background,
        light: currentScheme === "light" ? current.background : other.background,
      };

  if (patch.background !== undefined && isHexColor(patch.background)) {
    backgrounds[currentScheme] = nextBackground;
    backgrounds[otherScheme] = deriveModeBackground(nextBackground, otherScheme);
  }

  return {
    mode: normalized.mode,
    presetId: null,
    manual: {
      basePresetId,
      backgrounds,
      foreground: nextForeground,
    },
  };
}

export function selectThemePreset(appearance: Appearance, presetId: ThemePresetId): Appearance {
  const normalized = normalizeAppearance(appearance);
  const validPreset = findPreset(presetId) ? presetId : DEFAULT_PRESET_ID;
  return { mode: normalized.mode, presetId: validPreset, manual: null };
}

export function normalizeAppearance(value: unknown): Appearance {
  if (!isRecord(value)) return cloneDefaultAppearance();

  const mode = isAppearanceMode(value.mode) ? value.mode : DEFAULT_APPEARANCE.mode;
  const presetId = isThemePresetId(value.presetId) ? value.presetId : null;
  const manual = normalizeManualAppearance(value.manual, presetId ?? DEFAULT_PRESET_ID);

  if (manual) return { mode, presetId: null, manual };
  return {
    mode,
    presetId: presetId ?? DEFAULT_PRESET_ID,
    manual: null,
  };
}

export function loadAppearance(storage: AppearanceStorage | null = browserStorage()): Appearance {
  if (!storage) return cloneDefaultAppearance();
  try {
    const stored = storage.getItem(APPEARANCE_STORAGE_KEY);
    return stored ? normalizeAppearance(JSON.parse(stored)) : cloneDefaultAppearance();
  } catch {
    return cloneDefaultAppearance();
  }
}

export function storeAppearance(
  appearance: Appearance,
  storage: AppearanceStorage | null = browserStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(normalizeAppearance(appearance)));
    return true;
  } catch {
    return false;
  }
}

export function loadSavedThemePresets(
  storage: AppearanceStorage | null = browserStorage(),
): SavedThemePreset[] {
  if (!storage) return [];
  try {
    const stored = storage.getItem(SAVED_THEME_PRESETS_STORAGE_KEY);
    return stored ? normalizeSavedThemePresets(JSON.parse(stored)) : [];
  } catch {
    return [];
  }
}

export function storeSavedThemePresets(
  presets: readonly SavedThemePreset[],
  storage: AppearanceStorage | null = browserStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(
      SAVED_THEME_PRESETS_STORAGE_KEY,
      JSON.stringify(normalizeSavedThemePresets(presets)),
    );
    return true;
  } catch {
    return false;
  }
}

export function normalizeSavedThemePresets(value: unknown): SavedThemePreset[] {
  if (!Array.isArray(value)) return [];
  const presets: SavedThemePreset[] = [];
  const usedIds = new Set<string>();

  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.name !== "string") continue;
    const id = item.id.trim();
    const name = item.name.trim().slice(0, 24);
    const manual = normalizeManualAppearance(item.manual, DEFAULT_PRESET_ID);
    if (!id || !name || !manual || usedIds.has(id)) continue;
    usedIds.add(id);
    presets.push({ id, name, manual });
  }

  return presets;
}

export function applyAppearance(root: HTMLElement, appearance: ResolvedAppearance): void {
  for (const [name, value] of Object.entries(appearance.tokens)) {
    root.style.setProperty(name, value);
  }
  root.dataset.colorScheme = appearance.scheme;
  root.dataset.appearanceMode = appearance.mode;
  root.dataset.themePreset = appearance.presetId ?? "custom";
  root.style.colorScheme = appearance.scheme;
}

export function systemPrefersDark(
  matchMedia: typeof window.matchMedia | undefined = browserMatchMedia(),
): boolean {
  try {
    return matchMedia?.("(prefers-color-scheme: dark)").matches ?? true;
  } catch {
    return true;
  }
}

export function watchSystemTheme(
  listener: (prefersDark: boolean) => void,
  matchMedia: typeof window.matchMedia | undefined = browserMatchMedia(),
): () => void {
  if (!matchMedia) return () => {};
  try {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event: MediaQueryListEvent) => listener(event.matches);
    media.addEventListener("change", handleChange);
    listener(media.matches);
    return () => media.removeEventListener("change", handleChange);
  } catch {
    return () => {};
  }
}

const DEFAULT_PRESET_ID: ThemePresetId = "graphite-gray";
const DEFAULT_APPEARANCE_COLOR = THEME_PRESETS.find((preset) => preset.id === DEFAULT_PRESET_ID)
  ?.dark ?? { background: "#30343b", foreground: "#f0f2f5" };

function colorsForScheme(appearance: Appearance, scheme: ColorScheme): ThemeColors {
  const preset =
    findPreset(appearance.manual?.basePresetId ?? appearance.presetId) ??
    findPreset(DEFAULT_PRESET_ID);
  const presetColors = preset?.[scheme] ?? DEFAULT_APPEARANCE_COLOR;
  if (appearance.manual) {
    return {
      background: appearance.manual.backgrounds[scheme],
      foreground: appearance.manual.foreground ?? presetColors.foreground,
    };
  }
  return presetColors;
}

function buildAppearanceTokens(colors: ThemeColors, scheme: ColorScheme): AppearanceTokens {
  const { background, foreground } = colors;
  const neutral = scheme === "dark" ? "#ffffff" : "#000000";
  const panel = mixHex(background, neutral, scheme === "dark" ? 0.07 : 0.035);
  const artifact = mixHex(background, neutral, scheme === "dark" ? 0.05 : 0.025);
  const element = mixHex(background, neutral, scheme === "dark" ? 0.12 : 0.07);
  const elevated = mixHex(background, neutral, scheme === "dark" ? 0.18 : 0.12);
  const border = mixHex(background, neutral, scheme === "dark" ? 0.22 : 0.15);
  const borderSubtle = mixHex(background, neutral, scheme === "dark" ? 0.14 : 0.09);
  const borderActive = mixHex(background, neutral, scheme === "dark" ? 0.34 : 0.28);
  const textMuted = mixHex(foreground, background, 0.38);
  const textDim = mixHex(foreground, background, 0.56);
  const textFaint = mixHex(foreground, background, 0.7);
  const primary = deriveAccent(background);
  const primaryHover = mixHex(primary, neutral, scheme === "dark" ? 0.14 : 0.12);
  const primaryContrast = contrastColor(primary);
  const success = scheme === "dark" ? "#69c58d" : "#267a4d";
  const warning = scheme === "dark" ? "#e3aa62" : "#a86416";
  const error = scheme === "dark" ? "#df7e78" : "#b8443d";
  const scrollThumb = mixHex(foreground, background, 0.42);

  return {
    "--bg": background,
    "--bg-panel": panel,
    "--artifact-bg": artifact,
    "--bg-element": element,
    "--bg-elevated": elevated,
    "--border": border,
    "--border-subtle": borderSubtle,
    "--border-active": borderActive,
    "--text": foreground,
    "--text-muted": textMuted,
    "--text-dim": textDim,
    "--text-faint": textFaint,
    "--primary": primary,
    "--primary-contrast": primaryContrast,
    "--primary-hover": primaryHover,
    "--success": success,
    "--warning": warning,
    "--error": error,
    "--info": primary,
    "--shadow": scheme === "dark" ? "#000000b8" : "#26334338",
    "--focus-ring": withAlpha(primary, 0.2),
    "--scrollbar-thumb": scrollThumb,
    "--send-bg": primary,
    "--send-fg": primaryContrast,
    "--send-hover": primaryHover,
    "--new-task-bg": primary,
    "--new-task-fg": primaryContrast,
    "--new-task-hover": primaryHover,
    "--logo-bg": primary,
    "--logo-fg": primaryContrast,
    "--toggle-on": primary,
    "--toggle-off": elevated,
    "--project-active-bg": elevated,
    "--project-hover-bg": element,
    "--suggestion-bg": panel,
    "--suggestion-border": borderSubtle,
    "--suggestion-hover-bg": element,
    "--composer-bg": panel,
    "--composer-border": border,
    "--composer-focus-border": primary,
    "--user-bubble-bg": elevated,
    "--user-bubble-border": border,
    "--tool-call-bg": panel,
    "--tool-call-border": borderSubtle,
    "--preview-icon-bg": elevated,
    "--msg-bg": background,
    "--msg-gradient": panel,
    "--code-bg": mixHex(background, neutral, scheme === "dark" ? 0.025 : 0.015),
  };
}

function deriveAccent(background: HexColor): HexColor {
  const [red, green, blue] = hexToRgb(background);
  let [hue, saturation, lightness] = rgbToHsl(red, green, blue);
  if (saturation < 0.01) {
    hue = 215 / 360;
    saturation = 0.18;
  } else {
    saturation = Math.max(saturation, 150 / 255);
  }
  lightness = lightness < 135 / 255 ? 145 / 255 : 125 / 255;
  return rgbToHex(...hslToRgb(hue, saturation, lightness));
}

function contrastColor(color: HexColor): HexColor {
  const linearize = (channel: number) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const [redChannel, greenChannel, blueChannel] = hexToRgb(color);
  const red = linearize(redChannel);
  const green = linearize(greenChannel);
  const blue = linearize(blueChannel);
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  return luminance > 0.42 ? "#111111" : "#ffffff";
}

function mixHex(first: string, second: string, amount: number): HexColor {
  const firstHex = normalizeHex(first) ?? "#000000";
  const secondHex = normalizeHex(second) ?? "#000000";
  const firstRgb = hexToRgb(firstHex);
  const secondRgb = hexToRgb(secondHex);
  return rgbToHex(
    Math.round(firstRgb[0] + (secondRgb[0] - firstRgb[0]) * amount),
    Math.round(firstRgb[1] + (secondRgb[1] - firstRgb[1]) * amount),
    Math.round(firstRgb[2] + (secondRgb[2] - firstRgb[2]) * amount),
  );
}

function withAlpha(color: HexColor, alpha: number): HexColor {
  return `${color}${Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0")}` as HexColor;
}

function normalizeManualAppearance(
  value: unknown,
  fallbackPresetId: ThemePresetId,
): ManualAppearance | null {
  if (!isRecord(value) || !isRecord(value.backgrounds)) return null;
  const basePresetId = isThemePresetId(value.basePresetId) ? value.basePresetId : fallbackPresetId;
  const dark = normalizeHex(value.backgrounds.dark);
  const light = normalizeHex(value.backgrounds.light);
  const foreground = value.foreground === null ? null : normalizeHex(value.foreground);
  if (!dark || !light || (value.foreground !== null && !foreground)) return null;
  return { basePresetId, backgrounds: { dark, light }, foreground };
}

function normalizeHex(value: unknown): HexColor | null {
  return isHexColor(value) ? (value.toLowerCase() as HexColor) : null;
}

function isAppearanceMode(value: unknown): value is AppearanceMode {
  return value === "system" || value === "light" || value === "dark";
}

function isThemePresetId(value: unknown): value is ThemePresetId {
  return typeof value === "string" && THEME_PRESETS.some((preset) => preset.id === value);
}

function findPreset(id: unknown): ThemePreset | undefined {
  return THEME_PRESETS.find((preset) => preset.id === id);
}

function cloneDefaultAppearance(): Appearance {
  return { ...DEFAULT_APPEARANCE };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function browserStorage(): AppearanceStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function browserMatchMedia(): typeof window.matchMedia | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.matchMedia.bind(window);
  } catch {
    return undefined;
  }
}

function hexToRgb(color: HexColor): [number, number, number] {
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ];
}

function rgbToHex(red: number, green: number, blue: number): HexColor {
  const component = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, "0");
  return `#${component(red)}${component(green)}${component(blue)}`;
}

function rgbToHsl(red: number, green: number, blue: number): [number, number, number] {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const maximum = Math.max(r, g, b);
  const minimum = Math.min(r, g, b);
  const delta = maximum - minimum;
  const lightness = (maximum + minimum) / 2;
  if (delta === 0) return [0, 0, lightness];

  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;
  if (maximum === r) hue = ((g - b) / delta) % 6;
  else if (maximum === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  hue /= 6;
  if (hue < 0) hue += 1;
  return [hue, saturation, lightness];
}

function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const section = hue * 6;
  const intermediate = chroma * (1 - Math.abs((section % 2) - 1));
  let red = 0;
  let green = 0;
  let blue = 0;

  if (section < 1) [red, green] = [chroma, intermediate];
  else if (section < 2) [red, green] = [intermediate, chroma];
  else if (section < 3) [green, blue] = [chroma, intermediate];
  else if (section < 4) [green, blue] = [intermediate, chroma];
  else if (section < 5) [red, blue] = [intermediate, chroma];
  else [red, blue] = [chroma, intermediate];

  const offset = lightness - chroma / 2;
  return [(red + offset) * 255, (green + offset) * 255, (blue + offset) * 255];
}
