import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useAppText } from "../lib/i18n";

/** Maps a Transcript viewport onto the entire conversation edge, including its fixed dock. */
export function TranscriptScrollbar({ viewport }: { viewport: RefObject<HTMLDivElement | null> }) {
  const t = useAppText();
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointer: number; offset: number } | null>(null);
  const [geometry, setGeometry] = useState({
    height: 0,
    thumb: 0,
    top: 0,
    max: 0,
    scroll: 0,
    id: "",
  });
  useLayoutEffect(() => {
    const feed = viewport.current;
    const rail = track.current;
    if (!feed || !rail) return;
    const measure = () => {
      const height = rail.clientHeight;
      const max = Math.max(0, feed.scrollHeight - feed.clientHeight);
      const scroll = Math.min(max, Math.max(0, feed.scrollTop));
      const thumb = Math.min(
        height,
        Math.max(24, (height * feed.clientHeight) / Math.max(1, feed.scrollHeight)),
      );
      setGeometry({
        height,
        thumb,
        top: max ? (scroll / max) * (height - thumb) : 0,
        max,
        scroll,
        id: feed.id,
      });
    };
    let frame: number | undefined;
    const resize = new ResizeObserver(() => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = undefined;
        measure();
      });
    });
    resize.observe(feed);
    resize.observe(rail);
    if (feed.firstElementChild) resize.observe(feed.firstElementChild);
    feed.addEventListener("scroll", measure, { passive: true });
    measure();
    return () => {
      resize.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
      feed.removeEventListener("scroll", measure);
    };
  }, [viewport]);
  const move = (clientY: number, offset: number) => {
    const feed = viewport.current;
    const rail = track.current;
    if (!feed || !rail) return;
    const travel = geometry.height - geometry.thumb;
    feed.scrollTop =
      travel > 0
        ? Math.max(0, Math.min(1, (clientY - rail.getBoundingClientRect().top - offset) / travel)) *
          geometry.max
        : 0;
  };
  return (
    <div
      ref={track}
      role="scrollbar"
      aria-label={t("conversation.scrollbar")}
      aria-controls={geometry.id || undefined}
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={Math.round(geometry.max)}
      aria-valuenow={Math.round(geometry.scroll)}
      tabIndex={geometry.max > 0 ? 0 : -1}
      className="absolute inset-y-0 right-0 z-30 w-3 touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      style={{ visibility: geometry.max > 0 ? "visible" : "hidden" }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        const within =
          event.clientY - event.currentTarget.getBoundingClientRect().top - geometry.top;
        const offset = within >= 0 && within <= geometry.thumb ? within : geometry.thumb / 2;
        drag.current = { pointer: event.pointerId, offset };
        event.currentTarget.setPointerCapture(event.pointerId);
        move(event.clientY, offset);
      }}
      onPointerMove={(event) => {
        if (drag.current?.pointer === event.pointerId) move(event.clientY, drag.current.offset);
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointer === event.pointerId) {
          drag.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
      onKeyDown={(event) => {
        const feed = viewport.current;
        if (!feed) return;
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? geometry.max
              : event.key === "ArrowDown"
                ? feed.scrollTop + 40
                : event.key === "ArrowUp"
                  ? feed.scrollTop - 40
                  : event.key === "PageDown"
                    ? feed.scrollTop + feed.clientHeight
                    : event.key === "PageUp"
                      ? feed.scrollTop - feed.clientHeight
                      : undefined;
        if (next === undefined) return;
        event.preventDefault();
        feed.scrollTop = next;
      }}
    >
      <div
        aria-hidden="true"
        className="absolute left-1 right-1 rounded-full bg-muted-foreground/50"
        style={{ height: geometry.thumb, transform: `translateY(${geometry.top}px)` }}
      />
    </div>
  );
}
