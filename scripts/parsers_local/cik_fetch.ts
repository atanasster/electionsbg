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

// The CF challenge page is a small (~5–35 KB) HTML doc whose title is "Just
// a moment..." or "Един момент..." depending on Accept-Language. Real content
// pages on results.cik.bg are >50 KB, so size + missing-challenge-string is
// the most reliable "are we through?" signal.
const REAL_CONTENT_MIN_SIZE = 40_000;
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
    for (let i = 0; i < 60; i++) {
      const content = await page.content().catch(() => "");
      const isReal =
        content.length > REAL_CONTENT_MIN_SIZE &&
        !CHALLENGE_MARKERS.some((m) => content.includes(m));
      if (isReal) break;
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
  // Poll for real content (CF challenge clearing happens client-side after
  // page.goto resolves).
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const html = await s.page.content().catch(() => "");
    const isReal =
      html.length > REAL_CONTENT_MIN_SIZE &&
      !CHALLENGE_MARKERS.some((m) => html.includes(m));
    if (isReal) {
      return { status: finalStatus || 200, html };
    }
    if (html.includes("404 Not Found") && html.includes("nginx")) {
      return { status: 404, html: null };
    }
    await s.page.waitForTimeout(500);
  }
  // Timed out polling for real content — final fallback: return whatever's
  // there so the caller can decide.
  const html = await s.page.content().catch(() => "");
  return { status: finalStatus || 0, html: html || null };
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
