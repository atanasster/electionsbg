// Preload hints for the data files a prerendered route fetches on first render.
//
// Split out of index.ts (which runs main() on import and so cannot be unit
// tested) because exactly one property here fails silently and expensively:
// a preload href that does not match the eventual fetch URL byte-for-byte
// makes the browser download the file TWICE — the page still works, nothing
// errors, and the "optimisation" costs bandwidth instead of saving it.
//
// dataUrlFor mirrors dataUrl() in src/data/dataUrl.ts. The two cannot share a
// module: src/ reads import.meta.env, which a tsx build script does not have.
// dataPreload.test.ts pins them together instead — by executing the real
// dataUrl() body, not by restating its behaviour.

/** Mirror of src/data/dataUrl.ts — including the empty-base pass-through. */
export const dataUrlFor = (base: string, p: string): string =>
  base ? `${base}${p.startsWith("/") ? p : `/${p}`}` : p;

/**
 * A data path is only preloadable if it is written the way src/ hands it to
 * dataUrl(): a site-absolute path, no origin, no query, no fragment.
 *
 * Each clause rejects a shape that breaks the byte-for-byte match:
 * - not site-absolute (`macro.json`) — resolves against the ROUTE's directory
 *   (`/indicators/macro.json`) in the empty-base case, a 404 nothing surfaces.
 * - protocol-relative (`//host/x.json`) or origin-bearing
 *   (`https://…/x.json`) — double-prefixed into `https://…https://…`.
 * - a first segment ending in a colon (`/c:/x.json`) — a Windows-style or
 *   pseudo-scheme path that no fetch in src/ ever produces; it is rejected so
 *   a hand-edited entry cannot smuggle one past the other two clauses.
 * - a query or fragment (`/macro.json?v=2`) — dataUrl() receives a bare path,
 *   so anything appended here makes the preload href differ from the fetch URL.
 */
export const isPreloadablePath = (p: string): boolean =>
  p.startsWith("/") &&
  !p.startsWith("//") &&
  !/^\/\w+:/.test(p) &&
  !/[?#]/.test(p);

export class PreloadPathError extends Error {}

/**
 * Render one `<link rel="preload" as="fetch">` per declared data path,
 * indented for the prerender's `<!-- SEO -->` block.
 *
 * @param paths - Site-absolute data paths, exactly as `dataUrl()` receives
 *   them. Undefined or empty yields no links.
 * @param base - Data origin (`VITE_DATA_BASE_URL`), or `""` for same-origin.
 * @param escape - HTML attribute escaper, injected so this module stays a leaf
 *   with no import into the prerender's html helpers.
 * @returns One indented `<link>` line per path.
 * @throws {PreloadPathError} When an entry is not a bare site-absolute path,
 *   or is listed twice. The build must fail rather than ship an href that
 *   misses the fetch it exists to warm.
 */
export const renderPreloadLinks = (
  paths: readonly string[] | undefined,
  base: string,
  escape: (s: string) => string,
): string[] => {
  if (!paths?.length) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    if (!isPreloadablePath(p)) {
      throw new PreloadPathError(
        `preloadData entry ${JSON.stringify(p)} must be a bare site-absolute ` +
          `path written exactly as dataUrl() receives it (e.g. "/macro.json").`,
      );
    }
    // Throw rather than collapse: a duplicate means the route list has drifted,
    // which is the same reason a malformed path throws. Silently accepting one
    // shape of drift and aborting on another would be two rules, not one.
    if (seen.has(p)) {
      throw new PreloadPathError(
        `preloadData lists ${JSON.stringify(p)} twice — the route list has drifted.`,
      );
    }
    seen.add(p);
    // Two attributes here are load-bearing and neither is obvious.
    //
    // `crossorigin`: these are fetched by fetch() in CORS mode, and a preload
    // whose CORS mode differs from the eventual request is discarded and
    // re-downloaded — the exact double-fetch this is meant to avoid.
    //
    // `fetchpriority="low"`: as="fetch" defaults to HIGH, which puts the data
    // in direct bandwidth competition with the render-blocking JS chain. The
    // page paints from JS (#root is empty), so data winning that race delays
    // the very thing it is waiting for. Measured on /indicators/economy with
    // ALL FOUR of its paths declared (~81 KB on-wire, the shipped set) —
    // Pixel 5, 150ms RTT, 4x CPU, median of 3 runs:
    //
    //          1.6Mbps LCP   10Mbps LCP
    //   none     5648          3280
    //   high     6000          2892
    //   low      5872          2676
    //
    // i.e. `low` is the best preload variant at both bandwidths. Note it is
    // still a NET LOSS at 1.6Mbps: on a starved link any extra parallel byte
    // costs more than the earlier start saves, so the byte count is the
    // controlling variable and the table above is only evidence for a set of
    // roughly this size. Re-measure before adding a fifth path. It is kept
    // because 1.6Mbps is Lighthouse's synthetic floor rather than a typical 4G
    // connection, and because the data arriving sooner is what fills the charts.
    out.push(
      `    <link rel="preload" as="fetch" crossorigin fetchpriority="low" href="${escape(
        dataUrlFor(base, p),
      )}" />`,
    );
  }
  return out;
};
