// Cloudflare-bypassing fetcher for results.cik.bg.
//
// What works:
//   - **Headed** Playwright (visible browser window) + `--disable-blink-features=
//     AutomationControlled` + a small `navigator.webdriver = false` stealth shim.
//     Verified empirically: with these, real HTML pages clear the per-resource
//     CF Turnstile challenge in <1 s and we get the full page body.
//
// What we tried and abandoned:
//   - Plain `fetch` with a borrowed cf_clearance cookie  →  403 (CF checks TLS).
//   - context.request.get / page.evaluate in-browser fetch in headless mode  →
//     each protected resource still triggers a per-URL Turnstile that headless
//     can't render and solve.
//   - csv.zip downloads in any mode  →  origin returns 404 for mi2023's path
//     anyway (CIK moved the bundle for mi2023 vs mi2019). The automated path
//     skips csv.zip entirely; section-level CSV ingest stays a manual step.
//
// The tradeoff: a desktop window pops up during ingest. Acceptable for a
// local-machine watcher (the user explicitly opted into Playwright). CI is
// possible via xvfb but not wired up here.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { Browser, BrowserContext, Cookie, Page } from "playwright";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STATE_FILE = path.resolve(__dirname, "../../state/cik_clearance.json");
const ROOT_URL = "https://results.cik.bg/";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

// The CF challenge page has a title of "Just a moment..." / "Един момент..."
// and pulls Turnstile from challenges.cloudflare.com. We detect "still on
// challenge" by the presence of any of those markers in the document. Real
// CIK pages carry "Резултати ::" in the <title> regardless of município
// size — small municípios (no kmetstvo, single mayor candidate) can be
// 9–35 KB; a strict size threshold falsely rejects them, so we rely on the
// positive marker instead.
const CIK_REAL_TITLE_MARKER = "Резултати ::";
const CHALLENGE_MARKERS = [
  "Just a moment",
  "Един момент",
  "challenges.cloudflare.com",
];

type PersistedClearance = {
  cookies: Cookie[];
  userAgent: string;
  capturedAt: string;
};

const readPersisted = (): PersistedClearance | null => {
  if (!fs.existsSync(STATE_FILE)) return null;
  try {
    return JSON.parse(
      fs.readFileSync(STATE_FILE, "utf-8"),
    ) as PersistedClearance;
  } catch {
    return null;
  }
};

const writePersisted = (c: PersistedClearance): void => {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(c, null, 2) + "\n", "utf-8");
};

type Session = { browser: Browser; ctx: BrowserContext; page: Page };
let session: Session | null = null;
let initializing: Promise<Session> | null = null;

const initSession = async (): Promise<Session> => {
  if (session) return session;
  if (initializing) return initializing;
  initializing = (async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({
      headless: false,
      args: ["--disable-blink-features=AutomationControlled"],
    });
    const ctx = await browser.newContext({
      userAgent: UA,
      viewport: { width: 1280, height: 800 },
      locale: "bg-BG",
    });
    const persisted = readPersisted();
    if (persisted?.cookies?.length) {
      try {
        await ctx.addCookies(persisted.cookies);
      } catch {
        /* malformed — re-warm */
      }
    }
    const page = await ctx.newPage();
    // Strip the navigator.webdriver flag — CF's bot detection checks it.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
    });
    // Warm: navigate to root and wait for either the cf_clearance cookie or
    // the real homepage content (whichever lands first).
    await page
      .goto(ROOT_URL, { waitUntil: "load", timeout: 60_000 })
      .catch(() => {});
    // Root warm-up: poll until the CF challenge markers disappear OR a
    // generous max wait. The root page isn't a results page so it won't
    // carry the "Резултати ::" marker — we accept any non-challenge body.
    for (let i = 0; i < 60; i++) {
      const content = await page.content().catch(() => "");
      const onChallenge = CHALLENGE_MARKERS.some((m) => content.includes(m));
      if (!onChallenge && content.length > 1000) break;
      await page.waitForTimeout(500);
    }
    const cookies = await ctx.cookies(ROOT_URL);
    if (cookies.length) {
      writePersisted({
        cookies,
        userAgent: UA,
        capturedAt: new Date().toISOString(),
      });
    }
    session = { browser, ctx, page };
    return session;
  })();
  try {
    return await initializing;
  } finally {
    initializing = null;
  }
};

/** Close the browser so the Node process can exit. */
export const shutdownCikFetch = async (): Promise<void> => {
  if (!session) return;
  const s = session;
  session = null;
  try {
    await s.browser.close();
  } catch {
    /* ignore */
  }
};

export type CikFetchOpts = {
  /** Treat HTTP 404 / page-not-found as null instead of throwing. */
  allow404?: boolean;
};

/**
 * Navigate the persistent page to a URL and poll until the body is either
 * real content (size + no challenge markers), an HTTP error from origin, or
 * a 30 s timeout elapses. Returns { status, html } where html is null on
 * non-2xx.
 */
const gotoAndExtract = async (
  url: string,
): Promise<{ status: number; html: string | null }> => {
  const s = await initSession();
  const response = await s.page
    .goto(url, { waitUntil: "load", timeout: 90_000 })
    .catch(() => null);
  // page.goto resolves on the LAST navigation — if CF redirects we get the
  // final response. status() is the final HTTP status from the origin.
  const finalStatus = response?.status() ?? 0;
  // 404 from origin (after CF cleared) shows nginx's small 404 body — detect
  // that directly so we don't waste 30 s polling.
  const initialContent = await s.page.content().catch(() => "");
  if (
    initialContent.includes("404 Not Found") &&
    initialContent.includes("nginx")
  ) {
    return { status: 404, html: null };
  }
  // Poll for the CIK results-page title to appear, the CF challenge to
  // clear, or a 15 s deadline. The positive marker (Резултати ::) is the
  // strongest signal we're past CF; we also accept any non-challenge body
  // for non-results pages (the homepage, an oblast index, etc.).
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const html = await s.page.content().catch(() => "");
    const onChallenge = CHALLENGE_MARKERS.some((m) => html.includes(m));
    if (onChallenge) {
      await s.page.waitForTimeout(300);
      continue;
    }
    if (html.includes("404 Not Found") && html.includes("nginx")) {
      return { status: 404, html: null };
    }
    if (html.includes(CIK_REAL_TITLE_MARKER) || html.length > 1000) {
      return { status: finalStatus || 200, html };
    }
    await s.page.waitForTimeout(300);
  }
  // Timed out — return whatever we have so the caller can decide.
  const html = await s.page.content().catch(() => "");
  return { status: finalStatus || 0, html: html || null };
};

/**
 * Download a binary resource (the per-cycle `mi{YYYY}.zip` section bundle)
 * through the CF-cleared Playwright session. The page-navigation path is the
 * one that clears Cloudflare (the raw context.request path is still
 * TLS-fingerprinted to 403), so we trigger a real browser download:
 * navigating to a `Content-Disposition: attachment` / `application/zip`
 * resource makes Chromium fire a `download` event and abort the navigation
 * (hence the swallowed goto rejection).
 *
 * `warmUrl` (a sibling HTML page of the same cycle) is visited first so the
 * cf_clearance cookie is fresh for the same path prefix — verified necessary
 * for the live mi2019/mi2023 archives whose per-resource Turnstile is
 * stricter than the static minr2015/mipvr2011 ones.
 *
 * ⚠ `strategy: "click"` EXISTS BECAUSE NAVIGATION IS NOT ALWAYS ENOUGH. The
 * `goto` path above fires no `download` event at all for `results.cik.bg/
 * pvrns2021/tur{1,2}/export.zip` — measured twice on 2026-09-05, ~50 s each,
 * against four other presidential archives that download by navigation in
 * 1–12 s. What works there is a real user gesture: warm the round's `csv.html`
 * and CLICK the anchor whose href ends in the zip's basename (130 MB in 21 s,
 * 200 application/zip). Per-cycle choice lives in
 * `scripts/parsers_presidential/sources.ts`, not here.
 *
 * Returns the absolute path on success, or null on timeout / failure so the
 * caller can fall back to the manual operator drop.
 */
export const cikDownloadFile = async (
  url: string,
  destPath: string,
  opts: {
    timeoutMs?: number;
    warmUrl?: string;
    /** `goto` (default) navigates at the zip; `click` warms `warmUrl` and clicks
     *  the anchor pointing at it. See the banner. */
    strategy?: "goto" | "click";
  } = {},
): Promise<string | null> => {
  const { timeoutMs = 120_000, warmUrl, strategy = "goto" } = opts;
  // `click` has nothing to click without a page to click it on.
  if (strategy === "click" && !warmUrl) {
    throw new Error(
      `cikDownloadFile: strategy "click" needs a warmUrl — the anchor is on that ` +
        `page, not on the zip's own URL (${url})`,
    );
  }
  const s = await initSession();
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  if (warmUrl) {
    await s.page
      .goto(warmUrl, { waitUntil: "load", timeout: 60_000 })
      .catch(() => {});
    for (let i = 0; i < 40; i++) {
      const c = await s.page.content().catch(() => "");
      const onChallenge = CHALLENGE_MARKERS.some((m) => c.includes(m));
      if (!onChallenge && c.length > 1000) break;
      await s.page.waitForTimeout(400);
    }
  }
  try {
    // waitForEvent races the navigation; page.goto rejects with ERR_ABORTED
    // once the download takes over — that rejection is expected.
    //
    // Under `click` the race is against a real gesture instead.
    //
    // ⚠ THE SELECTOR MUST NOT BE THE BASENAME ALONE. Three of the presidential
    // archives are named `export.zip`, and `page.click` takes the FIRST match
    // without a strict-mode error — so a warm page carrying links to both
    // rounds would silently download the wrong one, which the md5 check would
    // then reject with a confusing message. Match the full href first, fall
    // back to the PATH (the page may link relatively, `./export.zip`), and
    // resolve each candidate against the page URL before clicking.
    const clickTheArchive = async (): Promise<null> => {
      const wanted = new URL(url);
      const hrefs = await s.page.$$eval("a[href]", (as) =>
        as.map((a) => a.getAttribute("href") ?? ""),
      );
      const match = hrefs.find((h) => {
        try {
          return new URL(h, s.page.url()).href === wanted.href;
        } catch {
          return false;
        }
      });
      if (!match) {
        throw new Error(
          `No anchor on ${s.page.url()} resolves to ${url} — the warm page ` +
            `does not link this archive (${hrefs.length} links seen)`,
        );
      }
      await s.page.click(`a[href="${match}"]`, { timeout: timeoutMs });
      return null;
    };
    const [download] = await Promise.all([
      s.page.waitForEvent("download", { timeout: timeoutMs }),
      strategy === "click"
        ? clickTheArchive().catch(() => null)
        : s.page.goto(url, { timeout: timeoutMs }).catch(() => null),
    ]);
    await download.saveAs(destPath);
    const stat = fs.statSync(destPath);
    if (stat.size < 1024) {
      // A sub-1 KB "zip" is almost certainly a CF challenge HTML page saved
      // under the wrong extension — treat as failure.
      return null;
    }
    return destPath;
  } catch {
    return null;
  }
};

export type CikHeadResult = {
  status: number;
  lastModified: string | null;
  contentLength: string | null;
};

/**
 * Issue an HTTP HEAD request through the authenticated Playwright context so
 * the cf_clearance cookie is sent. Returns status + the two headers used for
 * fingerprinting csv.zip bundles.
 */
export const cikHead = async (url: string): Promise<CikHeadResult> => {
  const s = await initSession();
  try {
    const response = await s.ctx.request.fetch(url, { method: "HEAD" });
    const headers = response.headers();
    return {
      status: response.status(),
      lastModified: headers["last-modified"] ?? null,
      contentLength: headers["content-length"] ?? null,
    };
  } catch {
    return { status: 0, lastModified: null, contentLength: null };
  }
};

export const cikFetchText = async (
  url: string,
  opts: CikFetchOpts = {},
): Promise<string | null> => {
  const { status, html } = await gotoAndExtract(url);
  if (status === 404 && opts.allow404) return null;
  if (!html || (status >= 400 && status < 600)) {
    throw new Error(`cikFetch ${status} :: ${url}`);
  }
  return html;
};

/**
 * Convenience: read the live `<select>` options on the currently-loaded page.
 * Used by the OIK-catalogue discovery to walk oblast → município dropdowns.
 */
export const readSelectOptions = async (
  selectId: string,
): Promise<{ value: string; text: string }[]> => {
  const s = await initSession();
  return s.page.evaluate((id) => {
    const sel = document.getElementById(id) as HTMLSelectElement | null;
    if (!sel) return [];
    return Array.from(sel.options).map((o) => ({
      value: o.value,
      text: o.text.trim(),
    }));
  }, selectId);
};

/**
 * Locate the location-redirecting `<select>` on the currently-loaded page
 * whose option values look like NNNN.html or bare NN/NNNN codes. Returns
 * the option list. Used for pre-2019 cycles whose dropdowns aren't id'd
 * (`minr2015` has no id; `mipvr2011` uses `id="location_select"` with bare
 * numeric values and a JS-constructed redirect URL).
 */
export const readLocationSelectOptions = async (): Promise<
  { value: string; text: string }[]
> => {
  const s = await initSession();
  return s.page.evaluate(() => {
    const selects = Array.from(document.querySelectorAll("select"));
    const matches = selects
      .filter((sel) => {
        const onChange = sel.getAttribute("onchange") || "";
        if (!/location|document\.location/.test(onChange)) return false;
        const opts = Array.from(sel.options);
        const codeOpts = opts.filter((o) =>
          /^\s*\d{2,4}(\.html)?\s*$|\/\d{2,4}\.html/.test(o.value),
        );
        return codeOpts.length >= 2;
      })
      .sort((a, b) => b.options.length - a.options.length);
    if (matches.length === 0) return [];
    return Array.from(matches[0].options).map((o) => ({
      value: o.value,
      text: o.text.trim(),
    }));
  });
};

/**
 * Scrape every NNNN.html reference appearing on the currently-loaded page
 * (anchor hrefs + select options). Used as the broad-net OIK discovery
 * fallback for the 2015 layout, which doesn't expose a nested obshtina
 * dropdown — the navigation between municípios of an oblast happens via
 * inline anchor links in the page body.
 */
export const scrapeOikRefs = async (): Promise<string[]> => {
  const s = await initSession();
  // Inline regex + Set construction — Playwright serializes the function to
  // the page context where tsx-emitted helpers like __name don't exist, so
  // helper-defs inside the evaluate body must be avoided.
  return s.page.evaluate(() => {
    const codes = new Set<string>();
    document.querySelectorAll("a[href]").forEach((el) => {
      const raw = el.getAttribute("href");
      if (!raw) return;
      const m = raw.match(/(\d{4})\.html/);
      if (m) codes.add(m[1]);
    });
    document.querySelectorAll("option[value]").forEach((el) => {
      const raw = el.getAttribute("value");
      if (!raw) return;
      const m = raw.match(/(\d{4})\.html/);
      if (m) codes.add(m[1]);
    });
    return Array.from(codes).sort();
  });
};

/**
 * Scrape extended-OIK refs of the form `NNNN_NNNNNr` on the currently-loaded
 * page (Sofia/Plovdiv/Varna 2015: each район of a multi-район município
 * has its own page at `mestni/NNNN_NNNNNr.html`). The `r` suffix on the file
 * stem is part of the CIK convention; it's preserved so the parent join
 * key stays unambiguous. Returns the bare stems (without `.html`).
 */
export const scrapeRayonRefs = async (): Promise<string[]> => {
  const s = await initSession();
  return s.page.evaluate(() => {
    const stems = new Set<string>();
    document.querySelectorAll("a[href]").forEach((el) => {
      const raw = el.getAttribute("href");
      if (!raw) return;
      const m = raw.match(/(\d{4}_\d{5}r)\.html/);
      if (m) stems.add(m[1]);
    });
    return Array.from(stems).sort();
  });
};
