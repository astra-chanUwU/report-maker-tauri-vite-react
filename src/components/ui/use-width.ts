import { useEffect, useState } from "react";

/** Tracks an element's rendered width so SVG charts can draw at 1:1 instead of letterboxing. */
export function useElementWidth<T extends Element>(fallback: number) {
  const [el, setEl] = useState<T | null>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, width] as const;
}
