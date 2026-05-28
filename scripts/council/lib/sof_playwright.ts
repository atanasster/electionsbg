// Playwright-driven Liferay enumeration helper for Sofia council
// (council.sofia.bg).
//
// Sofia's site is a Liferay 7 portal. The session list at
//   /meetings-mandat-2023-2027
// is server-rendered via an AssetPublisher portlet — Playwright sees
// the same DOM curl + grep would IF the portlet pre-renders, but the
// session-detail page hydrates client-side, so we need a real browser
// to capture the rendered hrefs.
//
// Pagination uses the Liferay-standard URL parameter:
//   ?_com_liferay_..._INSTANCE_yino_cur=<page>
//   &_com_liferay_..._INSTANCE_yino_delta=20
//
// Sessions counted at the time of writing: 68 across 4 pages.
//
// Each session detail page exposes ~30-100 PDF hrefs of three kinds:
//   /documents/d/guest/r-<NNN>-<YYYY>         — per-resolution decision PDF
//   /documents/d/guest/r-<NNN>_pr-<N>         — resolution annexes (приложения)
//   /documents/d/guest/protokol-<sessionN>    — full session protocol (single)
//   /documents/d/guest/soa<YY>-vk<NN>-<...>   — proposal documents
// We only care about the first kind (per-resolution decision PDFs).

import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";

export type SofiaSession = {
  /** "Заседание №<N>" — session number */
  session: string;
  /** YYYY-MM-DD */
  date: string;
  /** Full Liferay asset_publisher URL */
  pageUrl: string;
  /** Optional "извънредно" / "тържествено" marker pulled from the slug */
  marker?: string;
};

export type SofiaResolutionRef = {
  /** Numeric resolution number — "303" from "r-303-2026" */
  number: string;
  /** Direct PDF URL */
  pdfUrl: string;
};

const MANDATE_URL = "https://council.sofia.bg/meetings-mandat-2023-2027";
const PORTLET_INSTANCE = "yino";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

// e.g. .../content/Заседание-№61-от-14.05.2026-година-извънредно?...
const SLUG_RE =
  /\/content\/.*?[Зз]аседание-№(\d+)-от-(\d{2})\.(\d{2})\.(\d{4})(?:-година)?(?:-([\p{L}-]+))?(?:\?|$)/u;

let session: { browser: Browser; ctx: BrowserContext; page: Page } | null =
  null;

const ensureBrowser = async (): Promise<{
  browser: Browser;
  ctx: BrowserContext;
  page: Page;
}> => {
  if (session) return session;
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: UA });
  const page = await ctx.newPage();
  session = { browser, ctx, page };
  return session;
};

export const closePlaywright = async (): Promise<void> => {
  if (!session) return;
  await session.browser.close();
  session = null;
};

const pageUrl = (cur: number): string =>
  `${MANDATE_URL}?_com_liferay_asset_publisher_web_portlet_AssetPublisherPortlet_INSTANCE_${PORTLET_INSTANCE}_cur=${cur}&_com_liferay_asset_publisher_web_portlet_AssetPublisherPortlet_INSTANCE_${PORTLET_INSTANCE}_delta=20`;

/**
 * Walk every pagination page of the mandate list and return the union
 * of session URLs. We page until a fetch returns zero new session
 * URLs (instead of pre-counting), so this works for any mandate size.
 */
export const enumerateSessions = async (
  opts: { maxPages?: number } = {},
): Promise<SofiaSession[]> => {
  const { page } = await ensureBrowser();
  const maxPages = opts.maxPages ?? 10; // mandate has 4 pages today, leave headroom
  const seen = new Set<string>();
  const out: SofiaSession[] = [];
  for (let cur = 1; cur <= maxPages; cur++) {
    await page.goto(pageUrl(cur), {
      waitUntil: "networkidle",
      timeout: 60000,
    });
    await page.waitForTimeout(2000);
    const hrefs = await page.$$eval("a[href]", (els) =>
      els.map((a) => (a as HTMLAnchorElement).href),
    );
    let newOnThisPage = 0;
    for (const href of hrefs) {
      if (!href.includes(`asset_publisher/${PORTLET_INSTANCE}/content/`))
        continue;
      if (seen.has(href)) continue;
      const decoded = decodeURIComponent(href);
      const m = decoded.match(SLUG_RE);
      if (!m) continue;
      seen.add(href);
      out.push({
        session: m[1],
        date: `${m[4]}-${m[3]}-${m[2]}`,
        pageUrl: href,
        marker: m[5],
      });
      newOnThisPage++;
    }
    if (newOnThisPage === 0) break;
  }
  out.sort((a, b) => (a.date < b.date ? 1 : -1));
  return out;
};

/**
 * Fetch one session detail page and return the per-resolution PDF
 * URLs. Matches `/documents/d/guest/r-<NNN>-<YYYY>` exactly — drops
 * the annex variants `r-NNN_pr-N`, the proposal documents
 * `soa<YY>-vk<NN>-<...>`, and the full-protokol PDF (which has the
 * ABBYY Cyrillic-to-Latin mojibake; see parsers/sof.ts header).
 */
export const enumerateResolutions = async (
  sessionPageUrl: string,
): Promise<SofiaResolutionRef[]> => {
  const { page } = await ensureBrowser();
  await page.goto(sessionPageUrl, {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  await page.waitForTimeout(2000);
  const hrefs = await page.$$eval("a[href]", (els) =>
    els.map((a) => (a as HTMLAnchorElement).href),
  );
  const out: SofiaResolutionRef[] = [];
  const seen = new Set<string>();
  for (const href of hrefs) {
    const m = href.match(/\/documents\/d\/guest\/r-(\d+)-\d{4}$/u);
    if (!m) continue;
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push({ number: m[1], pdfUrl: href });
  }
  return out;
};
