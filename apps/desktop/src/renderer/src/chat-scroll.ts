import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";

const BOTTOM_TOLERANCE = 1;
const FOLLOW_THRESHOLD = 24;
const SCROLLBAR_INSET = 8;
const MIN_THUMB_SIZE = 28;

interface AutoScroll {
  startScrollTop: number;
  endScrollTop: number;
  startThumbTop: number;
  endThumbTop: number;
  startThumbHeight: number;
  endThumbHeight: number;
}

interface ThumbGeometry {
  height: number;
  top: number;
}

export function useChatScroll(messages: readonly unknown[]) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const scrollbarThumbRef = useRef<HTMLDivElement>(null);
  const followsLatest = useRef(true);
  const autoScroll = useRef<AutoScroll | null>(null);
  const requestedBottom = useRef<number | null>(null);
  const dragState = useRef<{
    pointerId: number;
    startY: number;
    startScrollTop: number;
    scrollRange: number;
    thumbRange: number;
  } | null>(null);

  const updateScrollbar = useCallback(() => {
    const viewport = viewportRef.current;
    const thumb = scrollbarThumbRef.current;
    if (!viewport || !thumb) return;

    const automatic = autoScroll.current;
    if (automatic) {
      const distance = automatic.endScrollTop - automatic.startScrollTop;
      const progress =
        Math.abs(distance) <= BOTTOM_TOLERANCE
          ? 1
          : clamp((viewport.scrollTop - automatic.startScrollTop) / distance, 0, 1);
      applyThumbGeometry(thumb, {
        height: mix(automatic.startThumbHeight, automatic.endThumbHeight, progress),
        top: mix(automatic.startThumbTop, automatic.endThumbTop, progress),
      });
      if (progress >= 1 - Number.EPSILON) autoScroll.current = null;
      return;
    }

    const geometry = scrollbarGeometry(viewport, viewport.scrollTop);
    if (!geometry) {
      thumb.hidden = true;
      return;
    }
    applyThumbGeometry(thumb, geometry);
  }, []);

  const requestScroll = useCallback(() => {
    followsLatest.current = true;
  }, []);

  const cancelScroll = useCallback(() => {
    followsLatest.current = false;
    autoScroll.current = null;
    requestedBottom.current = null;
  }, []);

  const handleScroll = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const bottom = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    if (autoScroll.current) {
      updateScrollbar();
      if (bottom - viewport.scrollTop <= BOTTOM_TOLERANCE) {
        autoScroll.current = null;
        requestedBottom.current = null;
        updateScrollbar();
      }
      return;
    }
    followsLatest.current = bottom - viewport.scrollTop <= FOLLOW_THRESHOLD;
    updateScrollbar();
  }, [updateScrollbar]);

  const handleUserScrollIntent = useCallback((event?: { deltaY?: number }) => {
    if (event?.deltaY !== undefined && event.deltaY >= 0) return;
    followsLatest.current = false;
    autoScroll.current = null;
    requestedBottom.current = null;
  }, []);

  const handleThumbPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const trackHeight = Math.max(0, viewport.clientHeight - SCROLLBAR_INSET * 2);
      const thumbHeight = event.currentTarget.getBoundingClientRect().height;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      event.currentTarget.dataset.dragging = "true";
      handleUserScrollIntent();
      followsLatest.current = false;
      dragState.current = {
        pointerId: event.pointerId,
        startY: event.clientY,
        startScrollTop: viewport.scrollTop,
        scrollRange: Math.max(0, viewport.scrollHeight - viewport.clientHeight),
        thumbRange: Math.max(1, trackHeight - thumbHeight),
      };
    },
    [handleUserScrollIntent],
  );

  const handleThumbPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const viewport = viewportRef.current;
      const drag = dragState.current;
      if (!viewport || !drag || drag.pointerId !== event.pointerId) return;
      viewport.scrollTop =
        drag.startScrollTop + ((event.clientY - drag.startY) / drag.thumbRange) * drag.scrollRange;
      updateScrollbar();
    },
    [updateScrollbar],
  );

  const handleThumbPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragState.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      event.currentTarget.releasePointerCapture(event.pointerId);
      delete event.currentTarget.dataset.dragging;
      dragState.current = null;
      handleScroll();
    },
    [handleScroll],
  );

  const syncToLatest = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    if (!followsLatest.current) {
      updateScrollbar();
      return;
    }

    const bottom = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    const distance = bottom - viewport.scrollTop;
    if (Math.abs(distance) <= BOTTOM_TOLERANCE) {
      autoScroll.current = null;
      requestedBottom.current = null;
      updateScrollbar();
      return;
    }
    if (
      requestedBottom.current !== null &&
      Math.abs(requestedBottom.current - bottom) <= BOTTOM_TOLERANCE
    ) {
      return;
    }

    const thumb = scrollbarThumbRef.current;
    const endGeometry = scrollbarGeometry(viewport, bottom);
    if (thumb && endGeometry) {
      const currentGeometry =
        readThumbGeometry(thumb) ?? scrollbarGeometry(viewport, viewport.scrollTop) ?? endGeometry;
      autoScroll.current = {
        startScrollTop: viewport.scrollTop,
        endScrollTop: bottom,
        startThumbTop: currentGeometry.top,
        endThumbTop: endGeometry.top,
        startThumbHeight: currentGeometry.height,
        endThumbHeight: endGeometry.height,
      };
      applyThumbGeometry(thumb, currentGeometry);
    }
    requestedBottom.current = bottom;
    viewport.scrollTo({ top: bottom, behavior: "smooth" });
  }, [updateScrollbar]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") return;

    let observedContent: Element | null = null;
    const resizeObserver = new ResizeObserver(() => syncToLatest());
    const observeCurrentContent = () => {
      const nextContent = viewport.firstElementChild;
      if (observedContent === nextContent) return;
      if (observedContent) resizeObserver.unobserve(observedContent);
      observedContent = nextContent;
      if (observedContent) resizeObserver.observe(observedContent);
    };

    resizeObserver.observe(viewport);
    observeCurrentContent();
    const mutationObserver =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(() => observeCurrentContent());
    mutationObserver?.observe(viewport, { childList: true });

    return () => {
      mutationObserver?.disconnect();
      resizeObserver.disconnect();
    };
  }, [syncToLatest]);

  useLayoutEffect(() => {
    if (messages.length === 0) {
      autoScroll.current = null;
      requestedBottom.current = null;
      updateScrollbar();
      return;
    }
    syncToLatest();
  }, [messages, syncToLatest, updateScrollbar]);

  return {
    viewportRef,
    scrollbarThumbRef,
    requestScroll,
    cancelScroll,
    handleScroll,
    handleUserScrollIntent,
    handleThumbPointerDown,
    handleThumbPointerMove,
    handleThumbPointerUp,
  };
}

function scrollbarGeometry(viewport: HTMLDivElement, scrollTop: number): ThumbGeometry | null {
  const scrollRange = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
  if (scrollRange <= BOTTOM_TOLERANCE) return null;
  const trackHeight = Math.max(0, viewport.clientHeight - SCROLLBAR_INSET * 2);
  const height = Math.max(
    MIN_THUMB_SIZE,
    trackHeight * (viewport.clientHeight / viewport.scrollHeight),
  );
  const thumbRange = Math.max(0, trackHeight - height);
  return { height, top: thumbRange * (scrollTop / scrollRange) };
}

function readThumbGeometry(thumb: HTMLDivElement): ThumbGeometry | null {
  if (thumb.hidden) return null;
  const height = Number.parseFloat(thumb.style.height);
  const top = Number.parseFloat(thumb.style.transform.match(/translateY\((.+)px\)/)?.[1] ?? "");
  return Number.isFinite(height) && Number.isFinite(top) ? { height, top } : null;
}

function applyThumbGeometry(thumb: HTMLDivElement, geometry: ThumbGeometry) {
  thumb.style.height = `${geometry.height}px`;
  thumb.style.transform = `translateY(${geometry.top}px)`;
  thumb.hidden = false;
}

function mix(start: number, end: number, progress: number) {
  return start + (end - start) * progress;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
