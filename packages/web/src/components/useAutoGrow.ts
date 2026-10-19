import { useLayoutEffect, useRef } from "react";

/**
 * A textarea that grows with its text (its CSS max-height, if any, then makes it scroll), measured again when
 * its text changes or its width does (a panel opening, the window turning into a phone's).
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
    return () => observer.disconnect();
  }, [value]);
  return ref;
}
