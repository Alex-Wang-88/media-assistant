// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_APPEARANCE } from "../src/renderer/src/appearance";
import { SettingsPanel } from "../src/renderer/src/SettingsPanel";
import { useUiStore } from "../src/renderer/src/store";

afterEach(() => {
  cleanup();
  useUiStore.setState({
    settingsOpen: false,
    appearance: DEFAULT_APPEARANCE,
    savedThemePresets: [],
    activeSavedThemeId: null,
    appearanceSaveError: null,
    appearanceSaveNotice: null,
  });
});

describe("settings appearance panel", () => {
  it("opens with three Chinese modes and five Chinese presets", () => {
    useUiStore.setState({ settingsOpen: true, appearance: DEFAULT_APPEARANCE });
    const { container } = render(createElement(SettingsPanel));

    expect(screen.getByRole("dialog", { name: "外观" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "深色" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "浅色" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "跟随系统" })).toBeTruthy();
    for (const label of ["经典蓝", "翡翠绿", "暖橙", "雅致紫", "石墨灰"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText("预设主题")).toBeTruthy();
    expect(screen.queryByText("内置主题")).toBeNull();
    expect(screen.queryByText("深")).toBeNull();
    expect(screen.queryByText("浅")).toBeNull();
    expect(container.querySelectorAll(".theme-card-palette")).toHaveLength(5);
    expect(container.querySelector(".theme-card-palettes")).toBeNull();
  });

  it("confirms a color inside the picker and saves custom colors separately", () => {
    useUiStore.setState({
      settingsOpen: true,
      appearance: { ...DEFAULT_APPEARANCE, mode: "dark" },
    });
    render(createElement(SettingsPanel));

    fireEvent.click(screen.getByRole("button", { name: "选择深色背景颜色" }));
    const picker = screen.getByRole("dialog", { name: "背景颜色调色盘" });
    expect(within(picker).getByText("颜色区域：左右调整饱和度，上下调整明暗")).toBeTruthy();
    expect(within(picker).getByText("色相：左右滑动切换颜色")).toBeTruthy();
    fireEvent.change(within(picker).getByLabelText("背景颜色调色盘色值"), {
      target: { value: "#173d36" },
    });
    expect(useUiStore.getState().appearance.manual).toBeNull();
    fireEvent.click(within(picker).getByRole("button", { name: "确认" }));
    expect(useUiStore.getState().appearance.manual?.backgrounds.dark).toBe("#173d36");

    fireEvent.change(screen.getByLabelText("字体颜色"), {
      target: { value: "#ffcc00" },
    });
    fireEvent.change(screen.getByLabelText("方案名称"), {
      target: { value: "夜海" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    const manual = useUiStore.getState().appearance.manual;
    expect(manual?.backgrounds.dark).toBe("#173d36");
    expect(manual?.foreground).toBe("#ffcc00");
    expect(useUiStore.getState().savedThemePresets).toHaveLength(1);
    expect(useUiStore.getState().savedThemePresets[0]?.name).toBe("夜海");
    expect(screen.getByRole("radio", { name: /夜海/ })).toBeTruthy();

    fireEvent.click(screen.getByText("翡翠绿"));
    expect(useUiStore.getState().appearance.presetId).toBe("emerald-green");
    expect(useUiStore.getState().appearance.manual).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: /夜海/ }));
    expect(useUiStore.getState().appearance.manual?.backgrounds.dark).toBe("#173d36");
    expect(useUiStore.getState().appearance.manual?.foreground).toBe("#ffcc00");
    expect(useUiStore.getState().activeSavedThemeId).toBeTruthy();

    fireEvent.click(screen.getByText("翡翠绿"));
    fireEvent.change(screen.getByLabelText("背景颜色"), {
      target: { value: "#21453d" },
    });
    fireEvent.click(screen.getByRole("button", { name: "恢复预设颜色" }));
    expect(useUiStore.getState().appearance.presetId).toBe("emerald-green");
    expect(useUiStore.getState().appearance.manual).toBeNull();
  });

  it("closes from the completion action", () => {
    useUiStore.setState({ settingsOpen: true, appearance: DEFAULT_APPEARANCE });
    render(createElement(SettingsPanel));

    fireEvent.click(screen.getByRole("button", { name: "完成" }));
    expect(useUiStore.getState().settingsOpen).toBe(false);
  });

  it("keeps keyboard focus inside the modal", () => {
    useUiStore.setState({ settingsOpen: true, appearance: DEFAULT_APPEARANCE });
    render(createElement(SettingsPanel));

    const done = screen.getByRole("button", { name: "完成" });
    const close = screen
      .getAllByRole("button", { name: "关闭外观设置" })
      .find((button) => button.getAttribute("tabindex") !== "-1");
    expect(close).toBeTruthy();

    done.focus();
    fireEvent.keyDown(done, { key: "Tab" });
    expect(document.activeElement).toBe(close);

    close?.focus();
    fireEvent.keyDown(close as HTMLButtonElement, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(done);
  });
});
