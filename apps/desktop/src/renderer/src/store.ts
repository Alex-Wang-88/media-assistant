import { create } from "zustand";
import {
  type Appearance,
  type AppearanceMode,
  type ColorScheme,
  customizeAppearance,
  DEFAULT_APPEARANCE,
  loadAppearance,
  loadSavedThemePresets,
  type ManualAppearance,
  type SavedThemePreset,
  selectThemePreset,
  storeAppearance,
  storeSavedThemePresets,
  type ThemeColors,
  type ThemePresetId,
} from "./appearance";

type UiState = {
  selectedProjectId: string | null;
  selectedArtifactPath: string | null;
  knowledgeEnabled: boolean;
  strategyEnabled: boolean;
  autoExecute: boolean;
  settingsOpen: boolean;
  appearance: Appearance;
  savedThemePresets: SavedThemePreset[];
  activeSavedThemeId: string | null;
  appearanceSaveError: string | null;
  appearanceSaveNotice: string | null;
  selectProject(id: string): void;
  resetProject(): void;
  selectArtifact(path: string | null): void;
  setToggle(key: "knowledgeEnabled" | "strategyEnabled" | "autoExecute", value: boolean): void;
  openSettings(): void;
  closeSettings(): void;
  setThemeMode(mode: AppearanceMode): void;
  chooseThemePreset(id: ThemePresetId): void;
  chooseSavedThemePreset(id: string): void;
  deleteSavedThemePreset(id: string): void;
  customizeTheme(scheme: ColorScheme, patch: Partial<ThemeColors>): void;
  saveThemeCustomization(name: string): void;
  resetThemeCustomization(): void;
};

const initialAppearance = loadAppearance();
const initialSavedThemePresets = loadSavedThemePresets();
const initialManualAppearance = initialAppearance.manual;
const initialActiveSavedThemeId = initialManualAppearance
  ? initialSavedThemePresets.find((preset) => sameManual(preset.manual, initialManualAppearance))
      ?.id
  : null;

export const useUiStore = create<UiState>((set) => ({
  selectedProjectId: null,
  selectedArtifactPath: null,
  knowledgeEnabled: true,
  strategyEnabled: false,
  autoExecute: false,
  settingsOpen: false,
  appearance: initialAppearance,
  savedThemePresets: initialSavedThemePresets,
  activeSavedThemeId: initialActiveSavedThemeId ?? null,
  appearanceSaveError: null,
  appearanceSaveNotice: null,
  selectProject: (id) => set({ selectedProjectId: id, selectedArtifactPath: null }),
  resetProject: () => set({ selectedProjectId: null, selectedArtifactPath: null }),
  selectArtifact: (path) => set({ selectedArtifactPath: path }),
  setToggle: (key, value) => set({ [key]: value }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  setThemeMode: (mode) =>
    set((state) => {
      const appearance = { ...state.appearance, mode };
      const saved = storeAppearance(appearance);
      return {
        appearance,
        appearanceSaveError: saved ? null : "外观设置暂时无法保存，重新启动后可能恢复原值。",
        appearanceSaveNotice: null,
      };
    }),
  chooseThemePreset: (id) =>
    set((state) => {
      const appearance = selectThemePreset(state.appearance, id);
      const saved = storeAppearance(appearance);
      return {
        appearance,
        activeSavedThemeId: null,
        appearanceSaveError: saved ? null : "外观设置暂时无法保存，重新启动后可能恢复原值。",
        appearanceSaveNotice: null,
      };
    }),
  chooseSavedThemePreset: (id) =>
    set((state) => {
      const preset = state.savedThemePresets.find((entry) => entry.id === id);
      if (!preset) return state;
      const appearance: Appearance = {
        mode: state.appearance.mode,
        presetId: null,
        manual: cloneManual(preset.manual),
      };
      const saved = storeAppearance(appearance);
      return {
        appearance,
        activeSavedThemeId: preset.id,
        appearanceSaveError: saved ? null : "外观设置暂时无法保存，重新启动后可能恢复原值。",
        appearanceSaveNotice: null,
      };
    }),
  deleteSavedThemePreset: (id) =>
    set((state) => {
      const preset = state.savedThemePresets.find((entry) => entry.id === id);
      if (!preset) return state;
      const savedThemePresets = state.savedThemePresets.filter((entry) => entry.id !== id);
      const saved = storeSavedThemePresets(savedThemePresets);
      return {
        savedThemePresets,
        activeSavedThemeId: state.activeSavedThemeId === id ? null : state.activeSavedThemeId,
        appearanceSaveError: saved
          ? null
          : "自定义预设已从当前界面删除，但暂时无法保存，重新启动后可能恢复。",
        appearanceSaveNotice: saved ? `已删除“${preset.name}”预设。` : null,
      };
    }),
  customizeTheme: (scheme, patch) =>
    set((state) => {
      const appearance = customizeAppearance(state.appearance, scheme, patch);
      return {
        appearance,
        activeSavedThemeId: null,
        appearanceSaveError: null,
        appearanceSaveNotice: null,
      };
    }),
  saveThemeCustomization: (name) =>
    set((state) => {
      const normalizedName = name.trim().slice(0, 24);
      if (!normalizedName) {
        return {
          appearanceSaveError: "请先填写方案名称。",
          appearanceSaveNotice: null,
        };
      }
      if (!state.appearance.manual) {
        return {
          appearanceSaveError: "请先调整背景颜色或字体颜色，再保存自定义方案。",
          appearanceSaveNotice: null,
        };
      }

      const existing = state.savedThemePresets.find(
        (preset) =>
          preset.name.toLocaleLowerCase("zh-CN") === normalizedName.toLocaleLowerCase("zh-CN"),
      );
      const preset: SavedThemePreset = {
        id: existing?.id ?? createSavedThemeId(),
        name: normalizedName,
        manual: cloneManual(state.appearance.manual),
      };
      const savedThemePresets = existing
        ? state.savedThemePresets.map((entry) => (entry.id === existing.id ? preset : entry))
        : [...state.savedThemePresets, preset];
      const appearanceSaved = storeAppearance(state.appearance);
      const presetsSaved = storeSavedThemePresets(savedThemePresets);
      const saved = appearanceSaved && presetsSaved;
      return {
        savedThemePresets,
        activeSavedThemeId: preset.id,
        appearanceSaveError: saved ? null : "外观设置暂时无法保存，重新启动后可能恢复原值。",
        appearanceSaveNotice: saved ? `已保存为“${normalizedName}”预设。` : null,
      };
    }),
  resetThemeCustomization: () =>
    set((state) => {
      const presetId =
        state.appearance.manual?.basePresetId ??
        state.appearance.presetId ??
        DEFAULT_APPEARANCE.presetId;
      if (!presetId) return state;
      const appearance = selectThemePreset(state.appearance, presetId);
      const saved = storeAppearance(appearance);
      return {
        appearance,
        activeSavedThemeId: null,
        appearanceSaveError: saved ? null : "外观设置暂时无法保存，重新启动后可能恢复原值。",
        appearanceSaveNotice: null,
      };
    }),
}));

function cloneManual(manual: ManualAppearance): ManualAppearance {
  return {
    basePresetId: manual.basePresetId,
    backgrounds: { ...manual.backgrounds },
    foreground: manual.foreground,
  };
}

function sameManual(first: ManualAppearance, second: ManualAppearance): boolean {
  return (
    first.basePresetId === second.basePresetId &&
    first.backgrounds.dark === second.backgrounds.dark &&
    first.backgrounds.light === second.backgrounds.light &&
    first.foreground === second.foreground
  );
}

function createSavedThemeId(): string {
  try {
    return `custom-${crypto.randomUUID()}`;
  } catch {
    return `custom-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}
