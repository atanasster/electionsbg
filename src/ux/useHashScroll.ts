// Hash-anchor scroll for SPA navigation. Browsers handle `#foo` natively
// on full-page loads, but client-side route changes leave the page at the
// top — useLocation() updates `hash` without scrolling. Drop this hook
// into screens that expect deep links like `/governance#macro` or
// `/indicators#debt-emissions`.
//
// Pass any "screen settled" sentinels via `deps` (typically the relevant
// data payloads) so the scroll re-runs once layout shifts settle — without
// this, the target's bounding box can be 0/0 on the very first pass and
// the scroll lands above the visible chrome.

import { useEffect } from "react";
import { useLocation } from "react-router-dom";

export const useHashScroll = (deps: ReadonlyArray<unknown> = []) => {
  const { hash } = useLocation();
  useEffect(() => {
    if (!hash) return;
    const id = hash.replace(/^#/, "");
    if (!id) return;
    // rAF gives the DOM a tick to lay out the freshly-rendered sections
    // before we measure. Without it, getBoundingClientRect can return
    // 0/0 on the first paint.
    const raf = requestAnimationFrame(() => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(raf);
    // The caller-supplied deps let consumers re-run after data arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash, ...deps]);
};
