// Scrape the America for Bulgaria Foundation (ABF) Project Database
// (us4bg.org/our-projects) → data/ngo/abf/projects.json.
//
// The database is Cloudflare + Elementor-AJAX walled (curl/WebFetch get a 403 /
// CF challenge). Headed Playwright passes it (the repo's cik_fetch pattern): load
// the page, let CF clear, submit the "Projects Filter" form → the WordPress
// admin-ajax.php proxy calls the backend api.us4bg.org and returns
//   { data: { data: { Page, TotalPages, html, fields:{ url, pagesize } } } }
// where `html` is a block of <article class="us4bg-project"> rows carrying
// span.us4bg-project-name / span.us4bg-grantee-name / the amount / area / period.
//
// Strategy: set the form's `form_fields[pagesize]` to a large value (3000) BEFORE
// submitting so one submit returns every project in a single response (measured:
// all ~1286 come back, TotalPages=1). The submit must run in the browser's own JS
// context — a replayed request-context POST is CF-blocked (403). Grantee names are
// ENGLISH — matching them to the Cyrillic TR register is the ingest's job
// (scripts/ngo/load_ngo_funding_pg.ts, via data/ngo/abf_aliases.json); here we just
// capture faithfully.
//
//   npm run ngo:abf-fetch
//
// See docs/plans/ngo-risk-signals-v1.md (Phase 3 / ABF).

import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const LIST_URL =
  "https://us4bg.org/our-projects/?project_year=all&project_area=all&project_search=";
// Committed (not raw_data): ABF needs a HEADED browser to pass Cloudflare, so it
// can't run in the cloud loader/cron — the scraped snapshot ships as a data
// artifact (like budget_subsidies.json) that db:load:ngo-funding:pg reads.
const OUT_DIR = fileURLToPath(new URL("../../data/ngo/abf", import.meta.url));
const BIG_PAGESIZE = 3000;

export interface AbfProject {
  projectId: string | null;
  name: string;
  grantee: string;
  amountRaw: string;
  currency: string | null;
  amount: number | null;
  area: string | null;
  period: string | null;
  year: number | null;
}

const decode = (s: string): string =>
  s
    .replace(/&#8211;/g, "–")
    .replace(/&#8217;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();

// Parse the admin-ajax `html` block into structured rows.
export const parseAbfHtml = (html: string): AbfProject[] => {
  const out: AbfProject[] = [];
  const articles = html.split(/<article\b/i).slice(1);
  for (const a of articles) {
    const idM = a.match(/project_id=(\d+)/);
    const nameM = a.match(
      /class="us4bg-project-name"[^>]*>([\s\S]*?)<\/span>/i,
    );
    const grM = a.match(/class="us4bg-grantee-name"[^>]*>([\s\S]*?)<\/span>/i);
    // The area/period sit in the project-area-title <p>; the amount is the
    // remaining col with a currency token.
    const areaM = a.match(
      /us4bg-project-area-title[\s\S]*?<p>([\s\S]*?)<\/p>/i,
    );
    const amtM = a.match(/((?:EUR|BGN|USD)\s*[\d.,]+)/i);
    if (!nameM && !grM) continue;
    const areaBlock = areaM ? decode(areaM[1]) : "";
    // areaBlock is "November 2025 – November 2028 Business Enabling Environment"
    const periodM = areaBlock.match(
      /^([A-Za-z]+ \d{4}(?:\s*–\s*[A-Za-z]+ \d{4})?)/,
    );
    const period = periodM ? periodM[1] : null;
    const area = period ? areaBlock.slice(period.length).trim() : areaBlock;
    const yearM = areaBlock.match(/(\d{4})/);
    const amountRaw = amtM ? decode(amtM[1]) : "";
    const curM = amountRaw.match(/^(EUR|BGN|USD)/i);
    const numM = amountRaw.replace(/[^\d.,]/g, "").replace(/,/g, "");
    out.push({
      projectId: idM ? idM[1] : null,
      name: nameM ? decode(nameM[1]) : "",
      grantee: grM ? decode(grM[1]) : "",
      amountRaw,
      currency: curM ? curM[1].toUpperCase() : null,
      amount: numM ? Number(numM) : null,
      area: area || null,
      period,
      year: yearM ? Number(yearM[1]) : null,
    });
  }
  return out;
};

export const fetchAbfProjects = async (): Promise<AbfProject[]> => {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: false });
  const all: AbfProject[] = [];
  const seen = new Set<string>();
  try {
    const page = await (await browser.newContext()).newPage();
    await page.goto(LIST_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForTimeout(6000); // let the Cloudflare challenge clear

    // Widen the page size BEFORE submitting so a single request returns every
    // project (server honours PageSize; measured: 3000 → all ~1286 in one page).
    // The POST must run in the browser's own JS context — a replayed request
    // context POST is CF-blocked (403).
    const set = await page.evaluate((n) => {
      const els = [
        ...document.querySelectorAll<HTMLInputElement>(
          '[name="form_fields[pagesize]"]',
        ),
      ];
      els.forEach((e) => {
        e.value = String(n);
        e.setAttribute("value", String(n));
      });
      return els.length;
    }, BIG_PAGESIZE);
    if (!set)
      console.warn("[abf] pagesize field not found — may paginate at 10");

    const respP = page.waitForResponse(
      (r) => /admin-ajax/i.test(r.url()) && r.request().method() === "POST",
      { timeout: 30_000 },
    );
    await page.click("button.elementor-button");
    const resp = await respP;
    const j = (await resp.json()) as {
      data?: { data?: { html?: string; TotalPages?: number } };
    };
    const d = j?.data?.data ?? {};
    for (const p of parseAbfHtml(d.html ?? "")) {
      const key = p.projectId ?? `${p.name}|${p.grantee}|${p.amountRaw}`;
      if (!seen.has(key)) {
        seen.add(key);
        all.push(p);
      }
    }
    console.log(
      `[abf] captured ${all.length} projects in one request (TotalPages=${d.TotalPages})`,
    );
    if ((d.TotalPages ?? 1) > 1)
      console.warn(
        `[abf] server clamped PageSize — got only page 1 of ${d.TotalPages}; a pager loop is needed`,
      );
  } finally {
    await browser.close();
  }
  return all;
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const t0 = Date.now();
  fetchAbfProjects()
    .then((rows) => {
      mkdirSync(OUT_DIR, { recursive: true });
      writeFileSync(`${OUT_DIR}/projects.json`, JSON.stringify(rows, null, 1));
      const eur = rows
        .filter((r) => r.currency === "EUR")
        .reduce((s, r) => s + (r.amount ?? 0), 0);
      console.log(
        `[abf] wrote ${rows.length} projects (€${Math.round(eur).toLocaleString()} EUR-denominated) in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
      );
      process.exit(0);
    })
    .catch((e) => {
      console.error("[abf] failed:", e.message);
      process.exit(1);
    });
}
