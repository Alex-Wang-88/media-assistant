// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useChatScroll } from "../src/renderer/src/chat-scroll";

describe("chat viewport following", () => {
  it("uses one smooth movement when a message is sent from history", () => {
    const viewport = createViewport(24, 700, 595);
    const { result, rerender } = renderChatScroll();
    result.current.viewportRef.current = viewport.element;

    act(() => result.current.requestScroll());
    rerender({ messages: [1] });

    expect(viewport.scrolls).toEqual([{ top: 105, behavior: "smooth" }]);
  });

  it("does not restart the same movement for stream events that do not change layout", () => {
    const viewport = createViewport(24, 700, 595);
    const { result, rerender } = renderChatScroll();
    result.current.viewportRef.current = viewport.element;

    act(() => result.current.requestScroll());
    rerender({ messages: [1] });
    rerender({ messages: [1, 2] });
    rerender({ messages: [1, 2, 3] });

    expect(viewport.scrolls).toEqual([{ top: 105, behavior: "smooth" }]);
  });

  it("keeps following response growth without direct scrollTop writes", () => {
    const viewport = createViewport(105, 700, 595);
    const { result, rerender } = renderChatScroll();
    result.current.viewportRef.current = viewport.element;

    act(() => result.current.requestScroll());
    rerender({ messages: [1] });
    viewport.setScrollHeight(760);
    rerender({ messages: [1, 2] });

    expect(viewport.scrolls).toEqual([{ top: 165, behavior: "smooth" }]);
    expect(viewport.writes).toEqual([]);
  });

  it("keeps the thumb still until native scroll progress arrives, then interpolates to the bottom", () => {
    const viewport = createViewport(105, 700, 595);
    const thumb = document.createElement("div");
    const { result, rerender } = renderChatScroll();
    result.current.viewportRef.current = viewport.element;
    result.current.scrollbarThumbRef.current = thumb;

    act(() => result.current.handleScroll());
    const initial = thumbGeometry(thumb);

    act(() => result.current.requestScroll());
    viewport.setScrollHeight(760);
    rerender({ messages: [1] });

    expect(viewport.scrolls).toEqual([{ top: 165, behavior: "smooth" }]);
    expect(thumbGeometry(thumb)).toEqual(initial);

    viewport.setScrollTop(120);
    act(() => result.current.handleScroll());
    const quarter = thumbGeometry(thumb);
    const finalHeight = scrollbarThumbHeight(760, 595);
    const finalTop = scrollbarTrackHeight(595) - finalHeight;
    expect(quarter.height).toBeCloseTo(initial.height + (finalHeight - initial.height) * 0.25);
    expect(quarter.top).toBeCloseTo(initial.top + (finalTop - initial.top) * 0.25);

    viewport.setScrollTop(135);
    act(() => result.current.handleScroll());
    const halfway = thumbGeometry(thumb);
    expect(halfway.height).toBeCloseTo(initial.height + (finalHeight - initial.height) * 0.5);
    expect(halfway.top).toBeCloseTo(initial.top + (finalTop - initial.top) * 0.5);

    viewport.setScrollTop(165);
    act(() => result.current.handleScroll());
    const finished = thumbGeometry(thumb);
    expect(finished.height).toBeCloseTo(finalHeight);
    expect(finished.top).toBeCloseTo(finalTop);
    expect(finished.top + finished.height).toBeCloseTo(scrollbarTrackHeight(595));
    expect(viewport.writes).toEqual([]);
  });

  it("shortens the thumb progressively with diminishing reductions as content grows", () => {
    const viewport = createViewport(105, 700, 595);
    const thumb = document.createElement("div");
    const { result, rerender } = renderChatScroll();
    result.current.viewportRef.current = viewport.element;
    result.current.scrollbarThumbRef.current = thumb;

    act(() => result.current.handleScroll());
    const heights = [thumbGeometry(thumb).height];
    const messageSets = [[1], [1, 2], [1, 2, 3]];

    act(() => result.current.requestScroll());
    for (const [index, messages] of messageSets.entries()) {
      const scrollHeight = 760 + index * 60;
      const bottom = scrollHeight - 595;
      viewport.setScrollHeight(scrollHeight);
      rerender({ messages });

      viewport.setScrollTop(bottom);
      act(() => result.current.handleScroll());
      const geometry = thumbGeometry(thumb);
      heights.push(geometry.height);
      expect(geometry.top + geometry.height).toBeCloseTo(scrollbarTrackHeight(595));
    }

    expect(viewport.scrolls).toEqual([
      { top: 165, behavior: "smooth" },
      { top: 225, behavior: "smooth" },
      { top: 285, behavior: "smooth" },
    ]);
    expect(heights[0]).toBeGreaterThan(heights[1] ?? Number.POSITIVE_INFINITY);
    expect(heights[1]).toBeGreaterThan(heights[2] ?? Number.POSITIVE_INFINITY);
    expect(heights[2]).toBeGreaterThan(heights[3] ?? Number.POSITIVE_INFINITY);

    const reductions = heights
      .slice(0, -1)
      .map((height, index) => height - (heights[index + 1] ?? 0));
    expect(reductions[0]).toBeGreaterThan(reductions[1] ?? Number.POSITIVE_INFINITY);
    expect(reductions[1]).toBeGreaterThan(reductions[2] ?? Number.POSITIVE_INFINITY);
    expect(reductions[2]).toBeGreaterThan(0);
  });

  it("does not move a viewport already at the bottom", () => {
    const viewport = createViewport(104.75, 700, 595);
    const { result, rerender } = renderChatScroll();
    result.current.viewportRef.current = viewport.element;

    act(() => result.current.requestScroll());
    rerender({ messages: [1] });

    expect(viewport.scrolls).toEqual([]);
  });

  it("stops following history browsing and resumes on the next send", () => {
    const viewport = createViewport(105, 700, 595);
    const { result, rerender } = renderChatScroll();
    result.current.viewportRef.current = viewport.element;

    act(() => result.current.requestScroll());
    rerender({ messages: [1] });
    viewport.setScrollTop(40);
    act(() => {
      result.current.handleUserScrollIntent();
      result.current.handleScroll();
    });
    viewport.setScrollHeight(760);
    rerender({ messages: [1, 2] });
    expect(viewport.scrolls).toEqual([]);

    act(() => result.current.requestScroll());
    rerender({ messages: [1, 2, 3] });
    expect(viewport.scrolls).toEqual([{ top: 165, behavior: "smooth" }]);
  });

  it("cancels a pending movement when the conversation resets", () => {
    const viewport = createViewport(24, 700, 595);
    const { result, rerender } = renderChatScroll();
    result.current.viewportRef.current = viewport.element;

    act(() => {
      result.current.requestScroll();
      result.current.cancelScroll();
    });
    rerender({ messages: [1] });

    expect(viewport.scrolls).toEqual([]);
  });
});

function renderChatScroll() {
  return renderHook(({ messages }) => useChatScroll(messages), {
    initialProps: { messages: [] as number[] },
  });
}

function scrollbarTrackHeight(clientHeight: number) {
  return clientHeight - 16;
}

function scrollbarThumbHeight(scrollHeight: number, clientHeight: number) {
  return Math.max(28, scrollbarTrackHeight(clientHeight) * (clientHeight / scrollHeight));
}

function thumbGeometry(thumb: HTMLDivElement) {
  return {
    height: Number.parseFloat(thumb.style.height),
    top: Number.parseFloat(thumb.style.transform.match(/translateY\((.+)px\)/)?.[1] ?? ""),
  };
}

function createViewport(initialTop: number, scrollHeight: number, clientHeight: number) {
  let scrollTop = initialTop;
  let currentScrollHeight = scrollHeight;
  const scrolls: ScrollToOptions[] = [];
  const writes: number[] = [];
  const element = {
    get scrollHeight() {
      return currentScrollHeight;
    },
    clientHeight,
    get scrollTop() {
      return scrollTop;
    },
    set scrollTop(value: number) {
      writes.push(value);
      scrollTop = value;
    },
    scrollTo(options: ScrollToOptions) {
      scrolls.push(options);
    },
  } as HTMLDivElement;
  return {
    element,
    scrolls,
    writes,
    setScrollHeight(value: number) {
      currentScrollHeight = value;
    },
    setScrollTop(value: number) {
      scrollTop = value;
    },
  };
}
