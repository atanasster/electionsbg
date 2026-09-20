#!/usr/bin/env node
/**
 * harvest_browser.mjs — the browser tier, headless.
 *
 * 17 of the 59 registered outlets cannot be reached by a plain HTTP client,
 * and four of them are in the top twenty (dir.bg #2, blitz.bg #3, offnews.bg
 * #16, dnevnik.bg #18, plus bta.bg — the national agency — and capital.bg).
 * Until this existed the whole tier was a Claude session driving a Browser
 * tool by hand: navigate, wait out the Cloudflare challenge, harvest anchors
 * with evaluate(), write a scratch file, hand it back to save_articles.py. A
 * cron job skipped every one of them.
 *
 * Two modes, chosen from the registry's own feed_method:
 *
 *   browser_then_rss / browser_then_sitemap
 *       A real feed exists but a bare client is 403'd. Clear the challenge in
 *       a real browser, then fetch the feed from the PAGE'S OWN JS CONTEXT and
 *       print the XML, which save_articles pipes through the same tested
 *       parser via `fetch_latest_articles.py --stdin=<kind>`.
 *
 *   browser_render_scrape
 *       No machine feed at all. Harvest article links from the rendered
 *       homepage into <out>/<domain>.urls. Then --route decides whether the
 *       article PAGES are plain-HTTP fetchable; when they are not, the pages
 *       are fetched in the browser into <out>/<domain>.jsonl for
 *       `save_articles.py --prefetched=`.
 *
 * ⚠️ IT NEVER CLICKS ANYTHING. Cloudflare's ordinary JS challenge is cleared
 * by a genuine browser by design and waiting it out is not evasion; an
 * INTERACTIVE checkbox is a different thing entirely, and this stops with
 * blocked_captcha rather than solving it. That line is the whole reason the
 * tier is allowed to be automated at all.
 *
 * Prints exactly ONE JSON object on stdout, same contract as the Python
 * scripts. Exit 0 success, 3 a deliberate stop (blocked_captcha,
 * robots_disallowed, bot_refused, wrong_method), 4 a real failure.
 *
 * Usage:
 *   node news/scripts/harvest_browser.mjs <domain> [--n=100]
 *        [--out=news/data/_browser] [--timeout=600] [--route]
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = process.env.DATA_BG_ROOT || path.resolve(SCRIPT_DIR, "..", "..");
const DATA_DIR = path.join(REPO_ROOT, "news", "data");
const CSV_PATH = path.join(DATA_DIR, "bg_news_sites.csv");

// The same honest identity fetch_latest_articles.py sends. Playwright's
// default UA names HeadlessChrome, which several Cloudflare configurations
// treat as a bot signal — but the point here is to be identifiable, not to
// look like a person, so the bot name stays and only the engine string is
// dropped.
const BOT_NAME = "NaiasnoBot";
const UA = `${BOT_NAME}/1.0 (+https://electionsbg.com/about; public-interest media monitoring) Chrome/124.0.0.0`;

// Measured clear times for the ordinary JS challenge: blitz.bg ~12s,
// dnevnik.bg ~5 min, capital.bg ~10 min. The default budget covers the first
// two; --timeout raises it for the third.
const DEFAULT_TIMEOUT_S = 600;
const CHALLENGE_POLL_MS = 3000;

const NAV_WORDS =
  /^(вход|регистрация|абонамент|контакт|за нас|реклама|начало|още|всички|архив|условия|поверителност|search|home|next|previous|коментари|сподели|начало)$/i;

// First path segments that are never an article. Learned from the measured
// harvest: blitz's top three hits were /vremeto/ weather widgets and
// flagman's were /archives/ and /info/ chrome.
// ⚠️ Kept close to the set MEASURED during the hand-driven harvest. Widening
// it is the tempting mistake: several outlets put real articles under
// /novini/ (glasove.com) and /video/ (a video report is still a report), so
// adding those drops the very content this tier exists to collect.
const JUNK_SEGMENTS = new Set([
  "vremeto", "page", "horoskop", "tv", "tag", "tags", "category",
  "categories", "search", "author", "avtor", "rubrika", "archives", "archive",
  "arhiv", "info", "contacts", "kontakti", "about", "za-nas", "reklama",
  "privacy", "terms", "login", "register", "abonament", "programa",
]);

// Kept in lockstep with _TRACKING_PARAM_RE in save_articles.py.
const TRACKING_PARAM_RE =
  /^(utm_[a-z_]+|fbclid|gclid|msclkid|yclid|igshid|mc_[ce]id|_ga|ref|referrer|source|amp)$/i;

/**
 * The ONE JSON object this script prints, then stop.
 *
 * process.exit() is deliberate and immediate. Closing the browser first was
 * tried and is WRONG: the close is async, so execution continued into the
 * next `page.evaluate()` while the target was being torn down, and every
 * domain printed a success object followed by a
 * "Target page, context or browser has been closed" failure — two objects,
 * breaking the very contract this function exists to keep. Playwright reaps
 * its own browser process when node exits, so there is nothing to leak.
 */
function out(payload, code = 0) {
  process.stdout.write(JSON.stringify(payload) + "\n");
  process.exit(code);
}

function parseCsv(text) {
  // The registry is written by Python's csv module: quoted fields, embedded
  // commas, no embedded newlines in practice. This handles quotes because a
  // feed_notes cell routinely contains commas.
  const rows = [];
  const lines = text.split(/\r?\n/).filter((l) => l.length);
  const header = splitCsvLine(lines[0]);
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const row = {};
    header.forEach((h, i) => (row[h] = cells[i] ?? ""));
    rows.push(row);
  }
  return rows;
}

function splitCsvLine(line) {
  const cells = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { cells.push(cur); cur = ""; }
    else cur += ch;
  }
  cells.push(cur);
  return cells;
}

function registryRow(domain) {
  if (!fs.existsSync(CSV_PATH)) return null;
  const rows = parseCsv(fs.readFileSync(CSV_PATH, "utf-8"));
  return rows.find((r) => r.domain === domain) || null;
}

function col(row, prefix) {
  const key = Object.keys(row).find((k) => k.startsWith(prefix));
  return key ? (row[key] || "").trim() : "";
}

/**
 * A minimal robots.txt check, deliberately conservative.
 *
 * It understands User-agent grouping, Disallow, Allow and Crawl-delay, which
 * is what the Bulgarian registry's robots files actually use. Anything it
 * cannot parse it treats as ALLOWED — the same convention the Python side
 * uses, and the same one robots.txt itself specifies. A wildcard `*` inside a
 * path is honoured; `$` anchoring is honoured.
 */
function parseRobots(text) {
  const groups = [];
  let current = null;
  let crawlDelay = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === "user-agent") {
      if (!current || current.rules.length || current.delay !== null) {
        current = { agents: [], rules: [], delay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (current && (field === "disallow" || field === "allow")) {
      current.rules.push({ allow: field === "allow", path: value });
    } else if (current && field === "crawl-delay") {
      const n = parseFloat(value);
      if (!Number.isNaN(n)) current.delay = n;
    }
  }
  // RFC 9309 §2.2.1: a crawler must obey EVERY group whose user-agent matches,
  // not merely the first. Several registry robots.txt files carry a second
  // `User-agent: *` block further down, and reading only the first ignored it.
  const token = BOT_NAME.toLowerCase();
  let matching = groups.filter((g) => g.agents.includes(token));
  if (!matching.length) matching = groups.filter((g) => g.agents.includes("*"));
  if (!matching.length) return { allows: () => true, delay: null };
  crawlDelay = matching.map((g) => g.delay).find((d) => d !== null) ?? null;
  const compiled = matching.flatMap((g) => g.rules)
    .filter((r) => r.path !== "")
    .map((r) => ({ allow: r.allow, re: pathToRegExp(r.path), len: r.path.length }));
  return {
    delay: crawlDelay,
    allows(pathname) {
      // Longest match wins, Allow beats Disallow on a tie — the de-facto rule
      // every major crawler follows.
      let best = null;
      for (const rule of compiled) {
        if (rule.re.test(pathname) && (!best || rule.len > best.len ||
            (rule.len === best.len && rule.allow))) best = rule;
      }
      return best ? best.allow : true;
    },
  };
}

function pathToRegExp(p) {
  let anchored = false;
  let src = p;
  if (src.endsWith("$")) { anchored = true; src = src.slice(0, -1); }
  const escaped = src
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp("^" + escaped + (anchored ? "$" : ""));
}

async function loadRobots(page, origin) {
  try {
    const text = await page.evaluate(async (u) => {
      const r = await fetch(u, { credentials: "omit" });
      return r.ok ? await r.text() : null;
    }, `${origin}/robots.txt`);
    if (typeof text === "string") return parseRobots(text);
  } catch { /* unknown means allowed */ }
  return { allows: () => true, delay: null };
}

/**
 * Wait out Cloudflare's ordinary JS challenge. Returns "clear",
 * "interactive" (an actual checkbox — STOP) or "timeout".
 *
 * Never clicks, never types, never touches the widget.
 */
/** Is this page a bot challenge, and does it demand a click?
 *
 * ⚠️ THE BULGARIAN INTERSTITIAL COUNTS. Cloudflare serves „Един момент…" to a
 * bg-BG client, and with only the English markers this returned "not
 * challenging" for it: measured on blitz.bg, all 20 escalated article pages
 * stored the interstitial instead of the article, and the extractor then
 * refused them as `non_article_page` — a wrong capture reported as a content
 * problem.
 */
function challengeState({ title = "", body = "", widget = false } = {}) {
  const t = String(title).toLowerCase();
  const b = String(body).toLowerCase();
  const challenging =
    t.includes("just a moment") ||
    t.includes("един момент") ||
    t.includes("attention required") ||
    t.includes("изчакайте") ||
    b.includes("checking your browser") ||
    b.includes("проверка на браузъра") ||
    b.includes("проверява сигурността на връзката");
  const interactive = widget ||
    b.includes("verify you are human") ||
    b.includes("потвърдете, че сте човек");
  return { challenging, interactive };
}


async function settle(page, budgetMs, needLinks = true) {
  const deadline = Date.now() + budgetMs;
  // Once the challenge is gone, content should appear quickly; waiting the
  // whole budget for it teaches nothing.
  const contentDeadline = Date.now() + Math.min(budgetMs, 60000);
  while (Date.now() < deadline) {
    const raw = await page.evaluate(() => ({
      title: document.title || "",
      body: (document.body?.innerText || "").slice(0, 3000),
      widget: !!document.querySelector('input[type="checkbox"][name*="cf"]') ||
              !!document.querySelector("#challenge-stage input"),
      links: document.querySelectorAll("a[href]").length,
    }));
    // Decided HERE, not in the page, so the markers are testable without a
    // browser — which is how the Bulgarian interstitial went unnoticed.
    const state = { ...challengeState(raw), links: raw.links };
    if (state.interactive) return "interactive";
    // Two DIFFERENT conditions, deliberately separated: the challenge being
    // gone, and the page having rendered content. Conflating them made every
    // timeout report "the JS challenge did not clear", which is what sent the
    // browser_then_* bug above to the wrong diagnosis for a whole session.
    if (!state.challenging) {
      if (!needLinks || state.links > 20) return "clear";
      if (Date.now() > contentDeadline) return "no_content";
    }
    await page.waitForTimeout(CHALLENGE_POLL_MS);
  }
  return "timeout";
}

/** Whether a link belongs to the same OUTLET as the page it was found on.
 *
 * Two things this must get right, each of which silently emptied a harvest:
 *
 *  * a bare -> www redirect is the same site. bta.bg serves from www.bta.bg,
 *    so every one of its links failed a `startsWith(origin)` test and it
 *    reported ZERO articles.
 *  * an outlet's own SUBDOMAINS are the outlet. dir.bg's homepage carries 378
 *    links to dnes.dir.bg, 274 to impressio.dir.bg, 242 to business.dir.bg
 *    and 223 to corner.dir.bg — rejecting them left the #2 outlet with 2
 *    links, a topic index and a film page.
 *
 * Registrable-domain matching would need a public-suffix list; comparing the
 * last two labels is enough for a registry that is entirely .bg/.com/.net/.eu
 * second-level domains, and it is the conservative direction: it can admit a
 * sibling site under one registrable domain, never a stranger. */
function sameSite(a, b) {
  const base = (u) => {
    try {
      const h = new URL(u).hostname.toLowerCase().replace(/^www\./, "");
      const parts = h.split(".");
      return parts.length <= 2 ? h : parts.slice(-2).join(".");
    } catch { return null; }
  };
  const ba = base(a);
  return ba !== null && ba === base(b);
}

async function harvestLinks(page, origin, n, robots) {
  const raw = await page.evaluate(() =>
    [...document.querySelectorAll("a[href]")].map((a) => ({
      // innerText is empty for a link whose headline sits in a child element
      // that is not laid out yet; textContent is the fallback.
      title: ((a.innerText || a.textContent || "").trim().replace(/\s+/g, " ")),
      url: a.href,
    })));
  const seen = new Set();
  const kept = [];
  for (const item of raw) {
    const key = keepLink(item, origin, robots);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    kept.push(item.url);
    if (kept.length >= n) break;
  }
  return kept;
}

/**
 * Whether one harvested anchor is an article link, and its dedupe key.
 * Returns null to reject. Extracted so it can be tested without a browser.
 */
function keepLink(item, origin, robots) {
  if (!item.url || !sameSite(item.url, origin)) return null;
  if (!item.title || item.title.length < 30 || NAV_WORDS.test(item.title)) return null;
  let u;
  try { u = new URL(item.url); } catch { return null; }
  const segments = u.pathname.split("/").filter(Boolean);
  if (!segments.length) return null;               // the homepage itself
  if (JUNK_SEGMENTS.has(segments[0].toLowerCase())) return null;
  if (robots && !robots.allows(u.pathname)) return null;  // the site said no
  // Tracking params are stripped here too, or two links to one article take
  // two of the --n slots and the saver then dedupes them away — the harvest
  // silently under-delivers. Kept in lockstep with canonical_url's
  // _TRACKING_PARAM_RE in save_articles.py.
  const params = new URLSearchParams(u.search);
  for (const key of [...params.keys()]) {
    if (TRACKING_PARAM_RE.test(key)) params.delete(key);
  }
  const query = params.toString();
  return "https://" + u.hostname.toLowerCase().replace(/^www\./, "")
    + (u.pathname.replace(/\/$/, "") || "/") + (query ? "?" + query : "");
}

/** Fetch each url in the cleared browser, one JSONL line per rendered page.
 *
 * ⚠️ EACH PAGE IS CHALLENGED SEPARATELY. Clearing the challenge on the entry
 * URL does not clear it on an article: measured on blitz.bg, every one of 20
 * article pages came back as Cloudflare's „Just a moment…" interstitial —
 * 6,440 bytes of `noindex` HTML that the extractor then (correctly) refused
 * as `non_article_page`. Without the per-page wait this step replaces one
 * failure mode with a quieter one: a stored page that is not the article.
 */
async function fetchPages(page, urls, jsonlPath, robots, challengeMs = 60000,
                          totalMs = 0) {
  const stream = fs.createWriteStream(jsonlPath, { flags: "w" });
  let fetched = 0;
  let challenged = 0;
  let refused = 0;
  let skipped = 0;
  const perPageDelay = Math.max(400, (robots?.delay ?? 0) * 1000);
  // ⚠️ STOP CLEANLY, never by being killed: the caller's `timeout` would
  // discard the JSONL of every page already fetched.
  const deadline = totalMs ? Date.now() + totalMs : 0;
  for (const url of urls) {
    if (deadline && Date.now() > deadline) { skipped = urls.length - fetched - challenged - refused; break; }
    try {
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      // ⚠️ goto RESOLVES on 403/404/5xx — it throws only on a navigation
      // failure. Without this check an "access denied" body of a few KB is
      // stored and counted as a fetch.
      if (response && !response.ok()) {
        refused++;
        await page.waitForTimeout(perPageDelay);
        continue;
      }
      // needLinks=false: an article page is content, not a link index.
      const state = await settle(page, challengeMs, false);
      if (state !== "clear") {
        challenged++;
        await page.waitForTimeout(perPageDelay);
        continue;
      }
      const html = await page.evaluate(() => document.documentElement.outerHTML);
      if (html && html.length > 500) {
        stream.write(JSON.stringify({ url, html }) + "\n");
        fetched++;
      }
    } catch { /* one bad page must not sink the harvest */ }
    await page.waitForTimeout(perPageDelay);
  }
  await new Promise((r) => stream.end(r));
  return { fetched, challenged, refused, skipped };
}


async function main() {
  const argv = process.argv.slice(2);
  const flags = Object.fromEntries(
    argv.filter((a) => a.startsWith("--")).map((a) => {
      const eq = a.indexOf("=");
      return eq < 0 ? [a.slice(2), true]
                    : [a.slice(2, eq), a.slice(eq + 1)];
    }));
  const positional = argv.filter((a) => !a.startsWith("--"));
  if (!positional.length) {
    out({ error: "usage", detail: "harvest_browser.mjs <domain> [--n=100] [--out=DIR] [--timeout=600] [--route]" }, 1);
  }
  const domain = positional[0];
  const n = Number.parseInt(flags.n ?? "100", 10);
  if (!Number.isFinite(n) || n <= 0) {
    out({ error: "usage", detail: `--n needs a positive integer, got ${JSON.stringify(flags.n)}` }, 1);
  }
  const outDir = flags.out || path.join(DATA_DIR, "_browser");
  // --prefetch-urls: fetch THESE urls in the cleared browser, harvesting
  // nothing. The escalation path for pages a plain HTTP client was refused —
  // the feed modes have no page-level browser step of their own, and neither
  // does the direct tier (plan §3.2/§6.3).
  const prefetchUrlsFile = flags["prefetch-urls"] || "";
  // The ENTRY page's challenge (--timeout) and an ARTICLE page's (this) are
  // different budgets: a cold context can need minutes on the entry and must
  // not spend that on each of N articles.
  const pageTimeoutS = Number.parseInt(
    flags["page-timeout"] ?? flags.timeout ?? String(DEFAULT_TIMEOUT_S), 10);
  const budgetS = Number.parseInt(flags.timeout ?? String(DEFAULT_TIMEOUT_S), 10);
  if (!Number.isFinite(budgetS) || budgetS <= 0) {
    out({ error: "usage", detail: `--timeout needs seconds, got ${JSON.stringify(flags.timeout)}` }, 1);
  }
  const budgetMs = budgetS * 1000;

  const row = registryRow(domain);
  if (!row) out({ domain, error: "domain_not_in_registry", detail: `no row for ${domain} in ${CSV_PATH}` }, 2);
  if (col(row, "bot_policy_") === "bot_refused") {
    out({ domain, error: "bot_refused",
          detail: "this site refuses an identified bot; respecting that is the point of having an honest identity" }, 3);
  }
  const method = col(row, "feed_method_");
  const feedUrl = col(row, "feed_url_");
  // An escalation may target ANY tier: 24chasa.bg is a direct-tier domain
  // that fails exactly like the browser ones.
  if (!method.startsWith("browser_") && !prefetchUrlsFile) {
    out({ domain, error: "wrong_method",
          detail: `${method} needs no browser — use fetch_latest_articles.py / save_articles.py directly` }, 3);
  }

  // WHERE TO NAVIGATE, and the two ways this has been got wrong:
  //
  //  * browser_render_scrape — the registry's feed_url IS the page to render,
  //    and it is not always the bare origin. bta.bg serves its Bulgarian
  //    edition at /bg, so navigating to https://bta.bg harvested ZERO links.
  //
  //  * browser_then_* — feed_url is an XML DOCUMENT. Chrome renders XML with
  //    zero <a href>, so settle()'s "the page has links" clear-condition can
  //    never be met and all five domains burned the full timeout and reported
  //    "the JS challenge did not clear" against a feed that has no challenge.
  //    The browser is here to clear the challenge for the ORIGIN, after which
  //    the page's own fetch() gets the feed. It must be the feed's origin
  //    rather than https://<domain>/ — capital.bg and marica.bg serve from
  //    www., and a bare->www fetch() from the page context is cross-origin.
  const isFeedMode = !prefetchUrlsFile &&
                     (method === "browser_then_rss" ||
                      method === "browser_then_sitemap");
  let prefetchUrls = [];
  if (prefetchUrlsFile) {
    try {
      prefetchUrls = fs.readFileSync(prefetchUrlsFile, "utf-8")
        .split("\n").map((l) => l.trim())
        .filter((l) => l.startsWith("http"));
    } catch (e) {
      out({ domain, error: "usage",
            detail: `--prefetch-urls: ${e.message}` }, 1);
    }
    if (!prefetchUrls.length) {
      out({ domain, mode: "browser_prefetch", requested: 0, prefetched: 0,
            detail: "no urls to fetch" });
    }
  }
  let entryUrl;
  try {
    entryUrl = prefetchUrlsFile
      // The article's own origin, so the challenge is cleared where the
      // pages live (www. vs bare is a different origin to the browser).
      ? new URL(prefetchUrls[0]).origin + "/"
      : isFeedMode
      ? new URL(feedUrl).origin + "/"
      : (feedUrl && feedUrl.startsWith("http") ? feedUrl : `https://${domain}/`);
  } catch (e) {
    out({ domain, error: "bad_registry_row",
          detail: `feed_url ${JSON.stringify(feedUrl)} is not a URL: ${e.message}` }, 3);
  }
  const origin = new URL(entryUrl).origin;
  let browser;
  try {
    // ⚠️ HEADED IS A DIFFERENT BOT SCORE, not a cosmetic choice. Headless
    // Chromium could not clear blitz.bg's PER-ARTICLE challenge in 240 s
    // (measured: 3 of 3 pages stayed on „Един момент…"), while the same
    // navigation headed clears it. `update-local-elections` reached the same
    // conclusion for CIK's Turnstile. It needs a logged-in GUI session, so it
    // is opt-in: NEWS_BROWSER_HEADED=1.
    const headed = process.env.NEWS_BROWSER_HEADED === "1";
    browser = await chromium.launch({ headless: !headed });
    // ⚠️ REUSE THE CLEARED STATE. capital.bg's challenge was measured at ~10
    // minutes and dnevnik.bg's at ~5; paying that once per cookie lifetime
    // instead of once per sweep is the difference between an hour-long tier
    // and a few minutes. A stale/corrupt file is ignored, never fatal — the
    // challenge is simply cleared again.
    fs.mkdirSync(outDir, { recursive: true });
    const statePath = path.join(outDir, `${domain}.state.json`);
    let storageState;
    try {
      if (fs.existsSync(statePath)) storageState = JSON.parse(
        fs.readFileSync(statePath, "utf-8"));
    } catch { storageState = undefined; }
    const context = await browser.newContext({
      userAgent: UA,
      locale: "bg-BG",
      extraHTTPHeaders: { "Accept-Language": "bg-BG,bg;q=0.9,en;q=0.8" },
      ...(storageState ? { storageState } : {}),
    });
    const page = await context.newPage();
    // Images and fonts are pure cost here: nothing downstream reads them and
    // a homepage carries dozens.
    await page.route("**/*", (route) => {
      const type = route.request().resourceType();
      // Both calls reject if the page has already navigated away or closed —
      // an unhandled rejection would take the process down mid-harvest.
      const done = (type === "image" || type === "font" || type === "media")
        ? route.abort() : route.continue();
      Promise.resolve(done).catch(() => {});
    });

    try {
      await page.goto(entryUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    } catch (e) {
      out({ domain, error: "fetch_failed", detail: `goto ${entryUrl}: ${e.message}` }, 4);
    }

    // needLinks is about a LINK INDEX. Prefetch mode is handed its URLs, and
    // a feed's origin page need not be one either — requiring 20 links there
    // fails an open origin that has nothing to do with the challenge.
    const state = await settle(page, budgetMs, !isFeedMode && !prefetchUrlsFile);
    if (state === "no_content") {
      out({ domain, error: "fetch_failed",
            detail: "the challenge cleared but the page rendered fewer than " +
                    "20 links — this is a rendering or entry-URL problem, " +
                    `not a challenge. Entry was ${entryUrl}.` }, 4);
    }
    if (state === "interactive") {
      out({ domain, error: "blocked_captcha",
            detail: "an INTERACTIVE challenge is present. This script never clicks one — " +
                    "solving bot-detection is off limits regardless of how trivial it looks." }, 3);
    }
    if (state !== "clear") {
      // A parseable but DEAD cf_clearance would otherwise be reused for ever.
      try { fs.unlinkSync(statePath); } catch { /* nothing to drop */ }
    }
    if (state === "timeout") {
      out({ domain, error: "fetch_failed",
            detail: `the JS challenge did not clear within ${budgetMs / 1000}s. ` +
                    "dnevnik.bg has been measured at ~5 min and capital.bg at " +
                    "~10; raise --timeout. If the entry URL is an XML feed " +
                    "rather than a page, that is a registry/mode bug, not a " +
                    "challenge." }, 4);
    }

    // The cookies that cleared the challenge, for the next sweep.
    try {
      await context.storageState({ path: statePath });
    } catch { /* a state we cannot save is not a harvest failure */ }

    const robots = await loadRobots(page, origin);
    fs.mkdirSync(outDir, { recursive: true });

    if (prefetchUrlsFile) {
      const allowed = prefetchUrls.filter(
        (u) => { try { return robots.allows(new URL(u).pathname); }
                 catch { return false; } });
      const jsonlPath = path.join(outDir, `${domain}.retry.jsonl`);
      const written = await fetchPages(page, allowed, jsonlPath, robots,
                                       pageTimeoutS * 1000,
                                       (pageTimeoutS + 15) * 1000 * allowed.length);
      out({ domain, mode: "browser_prefetch", entry: entryUrl,
            requested: prefetchUrls.length, allowed: allowed.length,
            prefetched: written.fetched, challenged: written.challenged,
            refused: written.refused, skipped_deadline: written.skipped,
            jsonl_path: jsonlPath,
            crawl_delay: robots.delay,
            next: `python3 news/scripts/save_articles.py ${domain} ${prefetchUrls.length} --prefetched=${jsonlPath}` });
    }

    if (isFeedMode) {
      const kind = method === "browser_then_sitemap" ? "sitemap" : "rss";
      if (!robots.allows(new URL(feedUrl).pathname)) {
        out({ domain, error: "robots_disallowed",
              detail: `robots.txt forbids ${feedUrl} for ${BOT_NAME}` }, 3);
      }
      const xml = await page.evaluate(async (u) => {
        const r = await fetch(u, { credentials: "omit" });
        return r.ok ? await r.text() : null;
      }, feedUrl);
      if (!xml) out({ domain, error: "fetch_failed", detail: `the page context could not fetch ${feedUrl}` }, 4);
      const xmlPath = path.join(outDir, `${domain}.${kind}.xml`);
      fs.writeFileSync(xmlPath, xml, "utf-8");
      out({ domain, mode: "browser_then_fetch", stdin_mode: kind,
            feed_url: feedUrl, xml_path: xmlPath, bytes: xml.length,
            crawl_delay: robots.delay,
            next: `cat ${xmlPath} | python3 news/scripts/fetch_latest_articles.py --stdin=${kind} ${domain} <N>` });
    }

    // browser_render_scrape
    const links = await harvestLinks(page, origin, n, robots);
    const urlsPath = path.join(outDir, `${domain}.urls`);
    fs.writeFileSync(urlsPath, links.join("\n") + (links.length ? "\n" : ""), "utf-8");

    const result = {
      domain, mode: "browser_render_scrape", entry: entryUrl,
      harvested: links.length,
      urls_path: urlsPath, crawl_delay: robots.delay,
      // A homepage exposes 30-100 article links. That IS the ceiling for this
      // tier, not a failure to reach N.
      // A homepage exposes 30-100 article links, so falling short of --n is
      // the tier's ceiling. ZERO (or near it) is not — it means the entry URL,
      // the same-site rule or the junk filter is wrong, and calling that a
      // ceiling is how bta.bg reported success while collecting nothing.
      note: links.length && links.length < n
        ? `the homepage exposed ${links.length} article links; that is the tier's ceiling, not a failure`
        : undefined,
    };

    if (!flags.route || !links.length) {
      result.next = `python3 news/scripts/save_articles.py ${domain} ${n} --urls-file=${urlsPath}`;
      out(result);
    }

    // --route: does a plain HTTP client get the article, or must the browser?
    const probe = await page.evaluate(async (u) => {
      try {
        const r = await fetch(u, { credentials: "omit" });
        const text = r.ok ? await r.text() : "";
        return { status: r.status, len: text.length };
      } catch (e) { return { status: 0, len: 0, error: String(e) }; }
    }, links[0]);
    result.probe = probe;

    if (probe.status === 200 && probe.len > 5000) {
      result.route = "plain_http";
      result.next = `python3 news/scripts/save_articles.py ${domain} ${n} --urls-file=${urlsPath}`;
      out(result);
    }

    // The article pages need the browser too. Fetch each one's rendered HTML.
    const jsonlPath = path.join(outDir, `${domain}.jsonl`);
    const fetched = await fetchPages(page, links, jsonlPath, robots,
                                     pageTimeoutS * 1000, budgetMs);
    result.route = "browser_fetch";
    result.prefetched = fetched.fetched;
    result.challenged = fetched.challenged;
    result.refused = fetched.refused;
    result.jsonl_path = jsonlPath;
    result.next = `python3 news/scripts/save_articles.py ${domain} ${n} --prefetched=${jsonlPath}`;
    out(result);
  } catch (e) {
    out({ domain, error: "fetch_failed", detail: `${e.name}: ${e.message}` }, 4);
  }
  // No `finally { browser.close() }`: out() calls process.exit(), which skips
  // finally blocks, so it would be dead code that LOOKS like cleanup. Node's
  // exit reaps the browser process.
}

// The pure decision logic is exported so harvest_browser.test.mjs can pin it
// without a browser: the CSV reader, the robots parser, the same-site rule and
// the link filter are where the bugs were (a bare->www redirect dropped an
// entire outlet's harvest, and an over-wide junk set dropped /novini/).
export { challengeState,
         parseCsv, splitCsvLine, parseRobots, pathToRegExp, sameSite,
         keepLink, JUNK_SEGMENTS, NAV_WORDS, BOT_NAME, UA };

// `node harvest_browser.mjs` runs; `import` does not.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
