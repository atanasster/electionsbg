// Flip the document's robots meta to "noindex, follow" while a personal / non-canonical
// route is mounted, restoring the previous value on leave.
//
// index.html ships `index, follow`; a client-only route with no stable, shareable content
// (a reader's watchlist, a URL-built query) must not be indexed. Best-effort for
// JS-executing crawlers — the durable guard is simply not prerendering the route and not
// listing it in the sitemap. (Pattern lifted from ProjectFileScreen's inline version.)

import { useEffect } from "react";

export const useNoindex = (active = true): void => {
  useEffect(() => {
    if (!active) return;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!meta) return;
    const prev = meta.content;
    meta.content = "noindex, follow";
    return () => {
      meta.content = prev;
    };
  }, [active]);
};
