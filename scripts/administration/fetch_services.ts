// Административен регистър — services catalogue (iisda.government.bg). The
// register is an xajax (ancient PHP AJAX-over-XML) app: the service list loads
// via a GET that returns XML whose CDATA holds the row HTML. We replay that GET
// directly (no headless browser), page through each provider tier, and parse
// out every service (id, name) + its tier.
//
// Reverse-engineered contract (captured from the live pager, 2026-07-14):
//   GET /adm_services/services/<tier>/?xjxfun=getItemList&xjxr=<ts>
//        &xjxargs[]=N<pageIndex0>&xjxargs[]=N<tierTotal>
//   → <xjx><cmd ... ><![CDATA[S <div class="list-tree">…row HTML… ]]></cmd></xjx>
// Rows: <span class="number-level">ID</span> <a href="…/service/ID">NAME</a>
// grouped under <li class="level-1">GROUP</li> (an administration name for the
// central tier, a service CATEGORY for the municipal tier — so per-tier TOTALS
// are the uniform metric; the flat service list is the catalogue).
//
//   npx tsx scripts/administration/fetch_services.ts
//
// Writes two artifacts:
//   data/administration/services_overview.json  — totals by tier (the tile)
//   data/administration/services_catalog.json   — the full id/name/tier list

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");
const DIR = path.resolve(REPO_ROOT, "data/administration");

const BASE = "https://iisda.government.bg/adm_services/services";
const UA = "Mozilla/5.0 (compatible; electionsbg-admin/1.0)";

const TIERS = [
  {
    key: "central",
    path: "from_central_administrations",
    bg: "Централни администрации",
    en: "Central administrations",
  },
  {
    key: "special_territorial",
    path: "from_special_territorial_administrations",
    bg: "Специализирани териториални",
    en: "Specialised territorial",
  },
  {
    key: "regional",
    path: "from_regional_administrations",
    bg: "Областни администрации",
    en: "Regional administrations",
  },
  {
    key: "municipal",
    path: "from_municipality_administrations",
    bg: "Общински администрации",
    en: "Municipal administrations",
  },
] as const;

const decode = (s: string): string =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#171;/g, "«")
    .replace(/&#187;/g, "»")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

const fetchTotal = async (tierPath: string): Promise<number> => {
  const r = await fetch(`${BASE}/${tierPath}`, {
    headers: { "User-Agent": UA },
  });
  const html = await r.text();
  const m = html.match(/id="totalCount"[^>]*>(\d+)/);
  return m ? Number(m[1]) : 0;
};

interface Service {
  id: string;
  name: string;
  tier: string;
}

// Capture BOTH the display span (group 1) and the authoritative href id
// (group 2 — the one every /service/<id> link and the dedupe key use); today
// they coincide (ids 7–3506), but capturing the href id keeps links correct
// even if the register ever renders a distinct display number.
const ROW_RE =
  /number-level">(\d+)<\/span>\s*<a href="\/adm_services\/services\/service\/(\d+)"[^>]*>([\s\S]*?)<\/a>/g;

const fetchPage = async (
  tierPath: string,
  pageIndex: number,
  total: number,
): Promise<Service[]> => {
  const ts = 1_700_000_000_000 + pageIndex; // deterministic (no Date.now in probe)
  const url =
    `${BASE}/${tierPath}/?xjxfun=getItemList&xjxr=${ts}` +
    `&xjxargs%5B%5D=N${pageIndex}&xjxargs%5B%5D=N${total}`;
  const r = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "X-Requested-With": "XMLHttpRequest",
      Referer: `${BASE}/${tierPath}`,
    },
  });
  const xml = await r.text();
  const out: Service[] = [];
  let m: RegExpExecArray | null;
  ROW_RE.lastIndex = 0;
  while ((m = ROW_RE.exec(xml)) !== null) {
    const [, spanId, hrefId, name] = m;
    if (spanId !== hrefId)
      console.log(
        `  ⚠ ${tierPath}: display span ${spanId} ≠ href id ${hrefId} — using href id`,
      );
    out.push({ id: hrefId, name: decode(name), tier: "" });
  }
  return out;
};

const run = async (): Promise<void> => {
  const byTier: Array<{ key: string; bg: string; en: string; count: number }> =
    [];
  const all: Service[] = [];
  const seen = new Set<string>();

  for (const tier of TIERS) {
    const total = await fetchTotal(tier.path);
    byTier.push({ key: tier.key, bg: tier.bg, en: tier.en, count: total });
    // Count DISTINCT services collected (not raw rows) — a service offered by
    // several administrations repeats in the central-tier grouping, so counting
    // raw rows could hit `total` before all distinct services are seen. Stop when
    // we've reached the register's own total, when a page returns nothing, or when
    // a full page adds no new services (the pager stopped advancing).
    let distinct = 0;
    let page = 0;
    for (; distinct < total && page < 400; page++) {
      const rows = await fetchPage(tier.path, page, total);
      if (!rows.length) break;
      let added = 0;
      for (const s of rows) {
        const dedupeKey = `${tier.key}:${s.id}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        all.push({ ...s, tier: tier.key });
        added++;
      }
      distinct += added;
      if (added === 0) break; // no progress — pager repeated; stop
    }
    if (page >= 400 && distinct < total)
      console.log(
        `  ⚠ ${tier.key}: hit 400-page cap at ${distinct}/${total} — truncated`,
      );
    console.log(`  ${tier.key}: total=${total}, scraped=${distinct}`);
  }

  const grandTotal = byTier.reduce((a, t) => a + t.count, 0);
  const generatedAt = new Date().toISOString();
  const source = {
    name: "Административен регистър (ИИСДА)",
    url: "https://iisda.government.bg/adm_services/services",
  };

  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(
    path.join(DIR, "services_overview.json"),
    JSON.stringify({ generatedAt, source, total: grandTotal, byTier }, null, 2),
  );
  fs.writeFileSync(
    path.join(DIR, "services_catalog.json"),
    JSON.stringify(
      { generatedAt, source, count: all.length, services: all },
      null,
      2,
    ),
  );
  console.log(
    `✓ overview: ${grandTotal} services across ${byTier.length} tiers`,
  );
  console.log(`✓ catalog: ${all.length} distinct service rows`);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
