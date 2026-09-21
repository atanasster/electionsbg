// The case-slug charset, ONCE. A slug reaches a URL path (`/case/:slug`) and a
// data path (`/cases/<slug>.json`), so every side that mints or trusts one
// reads this — the Python registry loader (`news/scripts/cases.py`
// `SLUG_RE`) is the source of truth and `caseSlug.test.ts` pins the two
// regexes to one probe set.
export const CASE_SLUG_SAFE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const isCaseSlug = (slug: unknown): slug is string =>
  typeof slug === "string" && CASE_SLUG_SAFE.test(slug);
