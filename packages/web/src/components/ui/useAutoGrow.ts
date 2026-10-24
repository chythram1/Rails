import { useLayoutEffect, useRef } from "react";

/**
 * A textarea that grows with its text (its CSS max-height, if any, then makes it scroll), measured again when
 * its text changes, its width does (a panel opening, the window turning into a phone's) or a font finishes
 * loading (the text wraps differently in it, at the same width).
 */
export function useAutoGrow(value: string) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    };
    fit();
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return; // its own height change; nothing to do
      width = el.clientWidth;
      fit();
    });
    observer.observe(el);
    document.fonts?.addEventListener("loadingdone", fit);
    return () => {
      observer.disconnect();
      document.fonts?.removeEventListener("loadingdone", fit);
    };
  }, [value]);
  return ref;
}
