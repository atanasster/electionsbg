import { useSearchParams } from "react-router-dom";

const globalParams = [
  "elections",
  "recount",
  "view",
  "party_tabs",
  "summary",
  // `area` is the global place anchor (the crosshair pill). Preserve it across
  // @/ux/Link navigation so a pinned place survives moving between consumption
  // sub-pages (products / deals) and the location-aware views can read it.
  "area",
  // `pscope` is the shared time scope for every public-money view (procurement,
  // the sector packs, subsidies, culture). It belongs here for the same reason
  // `elections` does: it is a reader's global choice, not one page's state, and a
  // link that drops it answers for a different period under the same heading.
  // This list is an ALLOWLIST, so anything absent is STRIPPED — which is how the
  // place seat line's settlement crumb reset the scope on the way into
  // /procurement/settlement/:ekatte. Harmless on pages that ignore it.
  "pscope",
];

export const usePreserveParams = () => {
  const [searchParams] = useSearchParams();
  const useParams = (params?: { [key: string]: string }) => {
    // ⚠️ A FRESH COPY PER CALL. This used to strip and re-`set` on the hook's OWN
    // `searchParams` and hand the same object back, so every call MUTATED the shared instance —
    // and a caller that builds several links in one render leaked each one's params into the
    // next. Measured on /governance, whose head forces `?pscope=all` on one cell: the following
    // cell's `/funds/beneficiaries`, which deliberately forces nothing, came out carrying it,
    // so a scope-free destination silently answered for one window. Order-dependent, so it
    // moved whenever the cells were reordered.
    const next = new URLSearchParams(searchParams);
    for (const key of Array.from(next.keys()))
      if (!globalParams.includes(key)) next.delete(key);
    if (params)
      for (const [key, value] of Object.entries(params)) next.set(key, value);
    return next;
  };
  return useParams;
};
