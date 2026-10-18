import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

// How a Sprocket chat's thread moves, after claude.ai's chat (its shipped code, October 2026):
// - Opening a chat shows its end, and the view follows new messages while it's at the very bottom.
// - Sending "seats" the new message at the top of the thread with room reserved below it for the reply,
//   unless more than half the visible area is already empty below the conversation: then the reply has
//   room where it is and nothing moves.
// - The reserved room (a spacer after the messages) shrinks as the reply grows, so nothing jumps; a long
//   reply streams on below the fold rather than dragging the view along. Once the room is out of view
//   (the user scrolled up) and no reply is being written, it's dropped.

/** Positions in the thread's scroll coordinates. `contentEnd` is where the messages end (the spacer's top). */
export interface ThreadGeo {
  scrollTop: number;
  viewport: number;
  contentEnd: number;
}

/** Room reserved after the messages: `room` px when the content ended at `contentAt`. */
export interface Page {
  room: number;
  contentAt: number;
}

/** Seat a sent message at the top unless over half the visible area is already empty below the messages. */
export const seatOnSend = (g: ThreadGeo): boolean => g.scrollTop + g.viewport - g.contentEnd <= g.viewport / 2;

/** The spacer's height now: the reserved room minus what the content has grown into it. */
export const spacerHeight = (page: Page | null, contentEnd: number): number =>
  page ? Math.max(0, page.room - (contentEnd - page.contentAt)) : 0;

/** Room needed below the content so it can scroll until `top` is the top of the view. */
export const roomToSeat = (top: number, g: Pick<ThreadGeo, "viewport" | "contentEnd">): number =>
  Math.max(0, top + g.viewport - g.contentEnd);

/** Space left above a seated message. */
const GAP = 16;
/** How much of the messages must be hidden below the view before "Jump to latest" shows. */
const HIDDEN = 80;
/** A glide: long enough to see the view travel (the browser's own smooth scroll is over in ~0.2 s and reads
 *  as a jump), eased out like claude.ai's glides: quick to start, gentle to land. */
const GLIDE_MS = 450;
const easeOut = (t: number) => 1 - (1 - t) ** 3;

/**
 * The thread's movement (see the top of this file). `spacer` is an empty element right after the messages;
 * call `onSend` just before a sent message is added. Returns whether content is hidden below the view and
 * a way to jump to it.
 */
export function useThreadScroll(
  thread: RefObject<HTMLDivElement | null>,
  spacer: RefObject<HTMLDivElement | null>,
  running: boolean,
  changes: unknown[],
) {
  const page = useRef<Page | null>(null);
  /** At the very bottom with nothing reserved: new messages keep the view there. Opening a chat starts so. */
  const following = useRef(true);
  const sending = useRef<"seat" | "stay" | null>(null);
  /** A glide is moving the view (its scroll events aren't the user's). */
  const gliding = useRef(false);
  const stopGlide = useRef<() => void>(() => {});
  const runningRef = useRef(running);
  runningRef.current = running;
  const [hidden, setHidden] = useState(false);

  const geo = (): ThreadGeo | null => {
    const el = thread.current;
    const sp = spacer.current;
    if (!el || !sp) return null;
    return { scrollTop: el.scrollTop, viewport: el.clientHeight, contentEnd: sp.offsetTop + parseFloat(getComputedStyle(el).paddingBottom) };
  };

  /** Move the view to `top` over GLIDE_MS (at once with reduced motion). The user's own wheel, touch or
   *  click on the thread takes over mid-way. */
  const glide = (el: HTMLElement, top: number) => {
    stopGlide.current();
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.scrollTop = top;
      return;
    }
    const from = el.scrollTop;
    const start = performance.now();
    let frame = 0;
    const stop = () => {
      cancelAnimationFrame(frame);
      clearTimeout(safety);
      for (const type of ["wheel", "touchstart", "pointerdown"] as const) el.removeEventListener(type, stop);
      gliding.current = false;
      stopGlide.current = () => {};
    };
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / GLIDE_MS);
      el.scrollTop = from + (top - from) * easeOut(t);
      if (t < 1) frame = requestAnimationFrame(step);
      else stop();
    };
    // Animation frames pause in background tabs: land there anyway.
    const safety = setTimeout(() => ((el.scrollTop = top), stop()), GLIDE_MS + 150);
    for (const type of ["wheel", "touchstart", "pointerdown"] as const) el.addEventListener(type, stop, { passive: true });
    gliding.current = true;
    stopGlide.current = stop;
    frame = requestAnimationFrame(step);
  };

  /** Size the spacer and say whether messages are hidden below. Unless the view just moved for a send,
   *  reserved room that's out of view (the user scrolled up) is dropped once no reply is being written. */
  const settle = (g: ThreadGeo, mayDrop = true) => {
    const el = thread.current!;
    if (mayDrop && page.current && !runningRef.current && !gliding.current && g.scrollTop + g.viewport <= g.contentEnd) page.current = null;
    spacer.current!.style.height = `${spacerHeight(page.current, g.contentEnd)}px`;
    setHidden(g.contentEnd - (el.scrollTop + g.viewport) > HIDDEN);
  };

  useLayoutEffect(() => {
    const el = thread.current;
    const g = geo();
    if (!el || !g) return;
    if (sending.current === "seat") {
      const sent = [...el.querySelectorAll<HTMLElement>(".sp-message.user")].at(-1);
      if (sent) {
        const top = Math.max(0, sent.offsetTop - GAP);
        page.current = { room: roomToSeat(top, g), contentAt: g.contentEnd };
        spacer.current!.style.height = `${spacerHeight(page.current, g.contentEnd)}px`;
        glide(el, top);
      }
    }
    const sent = sending.current !== null;
    sending.current = null;
    settle(geo()!, !sent); // measured again: seating may have just moved the view
    if (following.current) el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, changes);

  useEffect(() => {
    const el = thread.current;
    if (!el) return;
    const onScroll = () => {
      const g = geo();
      if (!g) return;
      if (!gliding.current) following.current = !page.current && el.scrollHeight - el.clientHeight - el.scrollTop <= 2;
      settle(g);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      stopGlide.current();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSend = () => {
    const g = geo();
    following.current = false;
    if (!g) return;
    if (seatOnSend(g)) sending.current = "seat";
    else {
      // The reply has room where it is: keep what's empty below as its room and don't move.
      sending.current = "stay";
      page.current = { room: spacer.current!.offsetHeight, contentAt: g.contentEnd };
    }
  };

  /** Show the end of the messages and follow from there (reserved room is no longer needed). */
  const jumpToLatest = () => {
    const el = thread.current;
    const g = geo();
    if (!el || !g) return;
    page.current = null;
    following.current = true;
    spacer.current!.style.height = "0px";
    glide(el, Math.max(0, g.contentEnd - g.viewport));
  };

  return { onSend, hidden, jumpToLatest };
}
