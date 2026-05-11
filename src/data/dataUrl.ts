// Resolve a data path to a fully-qualified URL.
//
// In production we serve large/changing JSON from a separate CDN-fronted
// GCS bucket so we don't have to redeploy the entire site to ship new
// data. In development we serve everything from Vite's local public/ dir
// (or wherever VITE_DATA_BASE_URL is pointed for staging).
//
// Usage: `fetch(dataUrl("/parliament/index.json"))`. Accepts both string
// and template-literal paths. Pass-through is safe when BASE is empty.
//
// IMPORTANT: every data fetch in src/ should go through this helper. The
// build pipeline depends on a single, greppable seam to swap origins.

const BASE = (import.meta.env.VITE_DATA_BASE_URL ?? "") as string;

export const dataUrl = (path: string): string => {
  if (!BASE) return path;
  return `${BASE}${path.startsWith("/") ? path : `/${path}`}`;
};
