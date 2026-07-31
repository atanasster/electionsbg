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
    Array.from(searchParams.entries()).forEach((entry) => {
      if (!globalParams.includes(entry[0])) {
        searchParams.delete(entry[0]);
      }
    });
    if (params) {
      Object.keys(params).forEach((key) => {
        searchParams.set(key, params[key]);
      });
    }
    return searchParams;
  };
  return useParams;
};
