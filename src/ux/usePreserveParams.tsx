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
