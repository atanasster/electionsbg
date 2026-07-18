// Build the МОН institution-register crosswalk: ЕИК (БУЛСТАТ) → EKATTE, for the
// ~2.7k schools / kindergartens / ЦПЛР in ri.mon.bg. This is the ONLY source
// that closes the ЕИК↔НЕИСПУО loop deterministically: the МОН open data
// (data.egov.bg) dropped its ЕИК column, and no other open register joins a
// budget institution's ЕИК to its address. Each institution's registry card
// carries its own БУЛСТАТ + a numeric settlement code that IS the EKATTE, so
// the crosswalk needs no name-matching — it corrects the fuzzy tiers in
// awarder_geo_map (Tier R).
//
// ri.mon.bg is an Angular SPA behind Cloudflare; its JSON API (ri-api.mon.bg)
// 403s a plain fetch (CF checks TLS/JA3). So, like scripts/parsers_local/
// cik_fetch.ts, we drive a HEADED Playwright browser + a navigator.webdriver
// stealth shim to clear the CF challenge once, then run the API calls via
// page.evaluate (in-page fetch, same cleared session). A desktop window pops up
// during the crawl — acceptable for a local-machine ingest.
//
// API (discovered by inspecting the SPA bundle + intercepting XHR):
//   POST /data/get/public-register {"isRIActive":1}
//        → { data: { publicInstitutions: [{ instid, procID, ... }] } }
//   POST /data/get/institution     {"instid": "<id>", "procID": "<id>"}
//        → { data: [{ bulstat, codeNEISPUO, settlementTown(=EKATTE), ... }] }
//
// Output: data/procurement/derived/mon_ri_eik_crosswalk.json
//   { generatedAt, source, count, awarders: { <eik>: { ekatte, neispuo } } }
//
// Run: `npx tsx scripts/procurement/mon_ri_crawl.ts`  (then re-run
// awarder_geo_map.ts + npm run procurement:ingest to apply).

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { canonicalJson } from "./validate";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = "https://ri.mon.bg";
const OUT_FILE = path.resolve(
  __dirname,
  "../../data/procurement/derived/mon_ri_eik_crosswalk.json",
);
const EKATTE_INDEX_FILE = path.resolve(
  __dirname,
  "../../data/ekatte_index.json",
);
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

interface RawInst {
  eik: string;
  ekatte: number;
  neispuo: number;
}

// The whole crawl runs INSIDE the page (one cleared CF session) — list the
// active institutions, then fan out (concurrency 8) over the detail cards to
// pull bulstat + settlementTown(=EKATTE) + НЕИСПУО. Passed to page.evaluate as a
// STRING (not a function ref): tsx/esbuild rewrites named arrows with a `__name`
// helper that doesn't exist in the page, so a serialized function reference
// throws "__name is not defined". A string body sidesteps that entirely.
const IN_PAGE_CRAWL = `(async () => {
  const post = async (p, b) => (await (await fetch('https://ri-api.mon.bg' + p, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b),
  })).json());
  const active = await post('/data/get/public-register', { isRIActive: 1 });
  const list = (active.data && active.data.publicInstitutions) || [];
  const out = [];
  const CONC = 8;
  const detail = async (it) => {
    try {
      const j = await post('/data/get/institution', { instid: String(it.instid), procID: String(it.procID) });
      const d = j.data && j.data[0];
      if (d && d.bulstat && d.settlementTown != null)
        out.push({ eik: String(d.bulstat), ekatte: Number(d.settlementTown), neispuo: Number(d.codeNEISPUO) });
    } catch (e) { /* skip a single failed card */ }
  };
  for (let i = 0; i < list.length; i += CONC)
    await Promise.all(list.slice(i, i + CONC).map(detail));
  return out;
})()`;

const main = async (): Promise<void> => {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    headless: false,
    args: ["--disable-blink-features=AutomationControlled"],
  });
  let raw: RawInst[];
  try {
    const ctx = await browser.newContext({
      userAgent: UA,
      viewport: { width: 1280, height: 800 },
      locale: "bg-BG",
    });
    const page = await ctx.newPage();
    // Strip the navigator.webdriver flag — CF's bot detection checks it.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
    });
    // Warm: load the SPA so Cloudflare issues cf_clearance for this context.
    await page.goto(ROOT, { waitUntil: "load", timeout: 60_000 });
    // A second settle pass — CF sometimes needs one reload to clear.
    await page.waitForTimeout(4000);
    console.log("→ crawling ri.mon.bg institution register…");
    raw = (await page.evaluate(IN_PAGE_CRAWL)) as RawInst[];
  } finally {
    await browser.close();
  }
  console.log(`  fetched ${raw.length} institution card(s)`);

  const validEk = new Set(
    (
      JSON.parse(fs.readFileSync(EKATTE_INDEX_FILE, "utf8")) as {
        ekatte: string;
      }[]
    ).map((e) => String(e.ekatte)),
  );
  const awarders: Record<string, { ekatte: string; neispuo: number }> = {};
  let badEik = 0;
  let badEkatte = 0;
  for (const r of raw) {
    if (!/^\d{9}$|^\d{13}$/.test(r.eik)) {
      badEik++;
      continue;
    }
    const ekatte = String(r.ekatte).padStart(5, "0");
    if (!validEk.has(ekatte)) {
      badEkatte++;
      continue;
    }
    // First writer wins; a duplicate EIK is a rare register artifact.
    if (!awarders[r.eik]) awarders[r.eik] = { ekatte, neispuo: r.neispuo };
  }

  fs.writeFileSync(
    OUT_FILE,
    canonicalJson({
      generatedAt: new Date().toISOString(),
      source: "ri.mon.bg /data/get/institution (bulstat field)",
      count: Object.keys(awarders).length,
      awarders,
    }),
  );
  console.log(
    `✓ wrote ${OUT_FILE}\n` +
      `  ${Object.keys(awarders).length} eik→EKATTE ` +
      `(${badEik} malformed eik, ${badEkatte} non-registry ekatte skipped)`,
  );
  console.log(
    `→ now re-run: npx tsx scripts/procurement/awarder_geo_map.ts && npm run procurement:ingest`,
  );
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
