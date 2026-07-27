// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  APPEARANCE_STORAGE_KEY,
  applyAppearance,
  customizeAppearance,
  DEFAULT_APPEARANCE,
  deriveModeBackground,
  loadAppearance,
  loadSavedThemePresets,
  normalizeAppearance,
  normalizeSavedThemePresets,
  resolveAppearance,
  resolveColorScheme,
  SAVED_THEME_PRESETS_STORAGE_KEY,
  selectThemePreset,
  storeAppearance,
  storeSavedThemePresets,
  THEME_PRESETS,
  watchSystemTheme,
} from "../src/renderer/src/appearance";

afterEach(() => {
  document.documentElement.removeAttribute("data-color-scheme");
  document.documentElement.removeAttribute("data-appearance-mode");
  document.documentElement.removeAttribute("data-theme-preset");
  document.documentElement.removeAttribute("style");
});

describe("appearance settings", () => {
  it("provides five Chinese presets with fixed dark and light colors", () => {
    expect(
      THEME_PRESETS.map(({ label, dark, light }) => ({
        label,
        dark: [dark.background, dark.foreground],
        light: [light.background, light.foreground],
      })),
    ).toEqual([
      {
        label: "经典蓝",
        dark: ["#2c3e50", "#ecf0f1"],
        light: ["#edf4fa", "#23313f"],
      },
      {
        label: "翡翠绿",
        dark: ["#173d36", "#e9fff8"],
        light: ["#e8f5f0", "#173c34"],
      },
      {
        label: "暖橙",
        dark: ["#4a2f1f", "#fff2df"],
        light: ["#fff3e6", "#4b2b17"],
      },
      {
        label: "雅致紫",
        dark: ["#3d2b52", "#f5eaff"],
        light: ["#f2eafa", "#372446"],
      },
      {
        label: "石墨灰",
        dark: ["#30343b", "#f0f2f5"],
        light: ["#f1f2f4", "#2d3137"],
      },
    ]);
  });

  it("resolves explicit modes and follows the current system mode", () => {
    expect(resolveColorScheme("dark", false)).toBe("dark");
    expect(resolveColorScheme("light", true)).toBe("light");
    expect(resolveColorScheme("system", true)).toBe("dark");
    expect(resolveColorScheme("system", false)).toBe("light");
  });

  it("derives paired backgrounds while keeping a manual font color unchanged", () => {
    expect(deriveModeBackground("#808080", "dark")).toBe("#3a3a3a");
    expect(deriveModeBackground("#808080", "light")).toBe("#ebebeb");

    const backgroundOnly = customizeAppearance(DEFAULT_APPEARANCE, "dark", {
      background: "#173d36",
    });
    expect(resolveAppearance(backgroundOnly, true).foreground).toBe("#f0f2f5");
    expect(resolveAppearance(backgroundOnly, false).foreground).toBe("#2d3137");

    let appearance = backgroundOnly;
    appearance = customizeAppearance(appearance, "dark", { foreground: "#ffcc00" });

    expect(appearance.presetId).toBeNull();
    expect(appearance.manual?.basePresetId).toBe("graphite-gray");
    expect(appearance.manual?.backgrounds.dark).toBe("#173d36");
    expect(appearance.manual?.backgrounds.light).toBe(deriveModeBackground("#173d36", "light"));
    expect(resolveAppearance(appearance, true).foreground).toBe("#ffcc00");
    expect(resolveAppearance(appearance, false).foreground).toBe("#ffcc00");
  });

  it("clears manual colors when a Chinese preset is selected", () => {
    const custom = customizeAppearance(DEFAULT_APPEARANCE, "dark", {
      foreground: "#ffcc00",
    });
    const selected = selectThemePreset(custom, "emerald-green");

    expect(selected.manual).toBeNull();
    expect(selected.presetId).toBe("emerald-green");
    expect(resolveAppearance(selected, true).background).toBe("#173d36");
  });

  it("persists only valid appearance data and recovers from damaged data", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const custom = customizeAppearance(DEFAULT_APPEARANCE, "light", {
      background: "#fef6e8",
      foreground: "#3c2f24",
    });

    expect(storeAppearance(custom, storage)).toBe(true);
    expect(JSON.parse(values.get(APPEARANCE_STORAGE_KEY) ?? "{}").presetId).toBeNull();
    expect(loadAppearance(storage)).toEqual(custom);

    values.set(APPEARANCE_STORAGE_KEY, "{not-json");
    expect(loadAppearance(storage)).toEqual(DEFAULT_APPEARANCE);
    expect(
      normalizeAppearance({
        mode: "light",
        presetId: null,
        manual: {
          backgrounds: { dark: "#123456", light: "invalid" },
          foreground: "#abcdef",
        },
      }),
    ).toEqual({ ...DEFAULT_APPEARANCE, mode: "light" });

    expect(
      storeAppearance(DEFAULT_APPEARANCE, {
        getItem: () => null,
        setItem: () => {
          throw new Error("storage disabled");
        },
      }),
    ).toBe(false);
  });

  it("persists named custom theme presets and rejects damaged entries", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const custom = customizeAppearance(DEFAULT_APPEARANCE, "dark", {
      background: "#173d36",
      foreground: "#ffcc00",
    });
    const manual = custom.manual;
    if (!manual) throw new Error("expected a manual appearance");
    const presets = [
      {
        id: "custom-night-sea",
        name: "夜海",
        manual,
      },
    ];

    expect(storeSavedThemePresets(presets, storage)).toBe(true);
    expect(loadSavedThemePresets(storage)).toEqual(presets);
    expect(JSON.parse(values.get(SAVED_THEME_PRESETS_STORAGE_KEY) ?? "[]")).toHaveLength(1);
    expect(
      normalizeSavedThemePresets([
        ...presets,
        { id: "", name: "无效", manual },
        { id: "broken", name: "", manual },
        { id: "bad-colors", name: "损坏", manual: { backgrounds: {} } },
      ]),
    ).toEqual(presets);

    values.set(SAVED_THEME_PRESETS_STORAGE_KEY, "{not-json");
    expect(loadSavedThemePresets(storage)).toEqual([]);
  });

  it("applies the resolved palette to every major root token", () => {
    const resolved = resolveAppearance(
      { ...DEFAULT_APPEARANCE, mode: "light", presetId: "classic-blue" },
      true,
    );
    applyAppearance(document.documentElement, resolved);

    expect(document.documentElement.dataset.colorScheme).toBe("light");
    expect(document.documentElement.dataset.themePreset).toBe("classic-blue");
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(document.documentElement.style.getPropertyValue("--bg")).toBe("#edf4fa");
    expect(document.documentElement.style.getPropertyValue("--text")).toBe("#23313f");
    expect(document.documentElement.style.getPropertyValue("--composer-bg")).not.toBe("");
    expect(document.documentElement.style.getPropertyValue("--scrollbar-thumb")).not.toBe("");

    const custom = customizeAppearance(DEFAULT_APPEARANCE, "dark", {
      background: "#173d36",
    });
    applyAppearance(document.documentElement, resolveAppearance(custom, true));
    expect(document.documentElement.dataset.themePreset).toBe("custom");
  });

  it("subscribes to system changes and removes the same listener", () => {
    let changeListener: ((event: { matches: boolean }) => void) | undefined;
    const addEventListener = vi.fn(
      (_type: string, listener: (event: { matches: boolean }) => void) => {
        changeListener = listener;
      },
    );
    const removeEventListener = vi.fn();
    const matchMedia = vi.fn(
      () =>
        ({
          matches: false,
          addEventListener,
          removeEventListener,
        }) as unknown as MediaQueryList,
    );
    const listener = vi.fn();

    const stop = watchSystemTheme(listener, matchMedia);
    changeListener?.({ matches: true });
    stop();

    expect(listener).toHaveBeenNthCalledWith(1, false);
    expect(listener).toHaveBeenNthCalledWith(2, true);
    expect(addEventListener).toHaveBeenCalledWith("change", expect.any(Function));
    expect(removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
  });
});
