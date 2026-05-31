import { useEffect, useRef, useState } from "react";

// Defer expensive work (typically a large data fetch) until an element scrolls
// near the viewport. Attach `ref` to a sentinel element; `inView` latches
// `true` the first time it intersects and never flips back, so the deferred
// work runs once and stays mounted.
//
// Used by below-the-fold dashboard tiles whose payload is heavy — e.g. the
// per-município section shard, which is ~3.9MB for Sofia — so they cost nothing
// on pages the user never scrolls through.
//
// `rootMargin` pre-loads slightly before the element reaches the viewport so
// the data is usually ready by the time it becomes visible.
export const useInView = <T extends HTMLElement = HTMLDivElement>(
  rootMargin = "400px",
): { ref: React.RefObject<T | null>; inView: boolean } => {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (inView) return;
    // Prerender / environments without IntersectionObserver: don't stall —
    // treat the element as visible so the deferred work still runs.
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [inView, rootMargin]);

  return { ref, inView };
};
