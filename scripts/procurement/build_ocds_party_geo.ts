// Tier E (doc-internal, settlement-level): build an EIK → {locality, nuts} map
// from the ЦАИС ЕОП OCDS "обявления" open-data file.
//
// The OCDS package carries `parties[].address.locality` + `.region` (NUTS), 100%
// populated, for EVERY party (buyer / reviewBody / informationService / …).
// Harvesting it by EIK across ALL parties — not just the buyer party on an
// awarder's own rows (what buildRollups does) — recovers buyers whose address we
// currently miss (only ~19% of awarders carry an OCDS address today).
//
// Unlike the contracts/tenders feeds, the in-bucket OCDS file only exists from
// 2026-01-01 onward (earlier days 404 — verified, see apps/web eopSource.ts), so
// this is a SMALL crawl (~one year of days). Settlement-level → feeds by_settlement
// directly (better than Tier D's oblast). Won't help the flat-only gap-fill schools
// (absent from OCDS) — those still need Tier B (МОН).
//
// Output: data/procurement/derived/ocds_party_geo_map.json
//   { generatedAt, parties, awarders: { <eik>: { locality, nuts, n } } }

import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";
import { command, run, optional, option, string, flag, boolean } from "cmd-ts";
import { canonicalEik, isValidEik } from "./eik";
import { canonicalJson } from "./validate";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROCUREMENT_DIR = path.resolve(__dirname, "../../data/procurement");
const OUT_FILE = path.join(
  PROCUREMENT_DIR,
  "derived",
  "ocds_party_geo_map.json",
);
const CACHE_DIR = path.resolve(
  __dirname,
  "../../raw_data/procurement/eop_ocds",
);
const EOP_BASE = "https://storage.eop.bg";
// The in-bucket OCDS export starts 2026-01-01; earlier days have only the flat
// files. ISO dates compare lexically, so a string floor is safe.
const OCDS_AVAILABLE_FROM = "2026-01-01";

interface OcdsParty {
  identifier?: { id?: string; scheme?: string };
  address?: { locality?: string; region?: string };
}
interface OcdsRelease {
  parties?: OcdsParty[];
}

const ocdsKey = (day: string): string => {
  const [y, m, d] = day.split("-");
  return `Автоматично генерирани данни за обявления, публикувани в ЦАИС ЕОП на ${d}.${m}.${y} г., съгласно стандарт OCDS.json`;
};
const dayUrl = (day: string): string =>
  `${EOP_BASE}/open-data-${day}/${encodeURIComponent(ocdsKey(day))}`;

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

const enumerateDays = (from: string, to: string): string[] => {
  const out: string[] = [];
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let t = start; t <= end; t += 86_400_000)
    out.push(new Date(t).toISOString().slice(0, 10));
  return out;
};

// Fetch one day's OCDS releases, caching gzipped. null = day not published.
const fetchDay = async (
  day: string,
  refresh: boolean,
): Promise<OcdsRelease[] | null> => {
  const cacheFile = path.join(CACHE_DIR, `${day}.json.gz`);
  if (!refresh && fs.existsSync(cacheFile)) {
    return JSON.parse(
      zlib.gunzipSync(fs.readFileSync(cacheFile)).toString("utf8"),
    ) as OcdsRelease[];
  }
  const url = dayUrl(day);
  const res = await fetch(url, {
    headers: {
      "User-Agent": "electionsbg.com data pipeline (procurement/eop-ocds)",
      Accept: "application/json",
    },
  });
  if (res.status === 403 || res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${day} → ${res.status} ${res.statusText}`);
  if (new URL(res.url || url).host !== new URL(url).host)
    throw new Error(`refusing cross-host redirect for ${day}: ${res.url}`);
  const pkg = await res.json();
  const releases: OcdsRelease[] = Array.isArray(pkg?.releases)
    ? pkg.releases
    : Array.isArray(pkg?.data?.releases)
      ? pkg.data.releases
      : [];
  // Cache only the slim parties slice — the full OCDS package is ~3 MB/day.
  const slim = releases.map((r) => ({
    parties: (r.parties ?? []).map((p) => ({
      identifier: { id: p.identifier?.id, scheme: p.identifier?.scheme },
      address: { locality: p.address?.locality, region: p.address?.region },
    })),
  }));
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cacheFile, zlib.gzipSync(JSON.stringify(slim)));
  return slim;
};

const isNuts = (v: string): boolean => /^BG\d{0,3}$/.test(v);

const main = async (args: {
  from: string;
  to: string;
  backfill: boolean;
  refreshCache: boolean;
  delayMs: number;
}): Promise<void> => {
  // Clamp the floor: nothing before the OCDS export existed.
  const from =
    args.from < OCDS_AVAILABLE_FROM ? OCDS_AVAILABLE_FROM : args.from;
  const days = enumerateDays(from, args.to);
  if (days.length > 40 && !args.backfill)
    throw new Error(
      `window is ${days.length} days — pass --backfill to confirm a large crawl`,
    );

  // 1. Fetch the window into the cache.
  let published = 0;
  let missing = 0;
  for (const day of days) {
    try {
      const recs = await fetchDay(day, args.refreshCache);
      if (recs == null) {
        missing++;
        continue;
      }
      published++;
    } catch (e) {
      console.log(`  ! ${day}: ${(e as Error).message}`);
      continue;
    }
    if (!args.refreshCache && args.delayMs > 0) await sleep(args.delayMs);
  }
  console.log(
    `→ fetched window ${from}…${args.to}: ${published} published / ${missing} unpublished day(s)`,
  );

  // 2. Rebuild the EIK → {locality, nuts} map from ALL cached days.
  if (!fs.existsSync(CACHE_DIR)) {
    console.error("no cached OCDS days yet — run a --backfill first");
    process.exit(1);
  }
  // eik → "locality\tnuts" → count (modal pick)
  const perEik = new Map<string, Map<string, number>>();
  let cachedDays = 0;
  let parties = 0;
  for (const f of fs.readdirSync(CACHE_DIR)) {
    if (!f.endsWith(".json.gz")) continue;
    cachedDays++;
    const releases = JSON.parse(
      zlib
        .gunzipSync(fs.readFileSync(path.join(CACHE_DIR, f)))
        .toString("utf8"),
    ) as OcdsRelease[];
    for (const r of releases) {
      for (const p of r.parties ?? []) {
        const ident = p.identifier ?? {};
        if (!/EIK/i.test(String(ident.scheme ?? ""))) continue;
        const eik = canonicalEik(ident.id);
        const locality = (p.address?.locality ?? "").trim();
        if (!isValidEik(eik) || !locality) continue;
        parties++;
        const nuts = (p.address?.region ?? "").trim();
        const k = `${locality}\t${isNuts(nuts) ? nuts : ""}`;
        const m = perEik.get(eik) ?? new Map<string, number>();
        m.set(k, (m.get(k) ?? 0) + 1);
        perEik.set(eik, m);
      }
    }
  }

  const awarders: Record<
    string,
    { locality: string; nuts: string; n: number }
  > = {};
  for (const [eik, counts] of perEik) {
    let best = "";
    let bestN = 0;
    let total = 0;
    for (const [k, n] of counts) {
      total += n;
      if (n > bestN) {
        best = k;
        bestN = n;
      }
    }
    const [locality, nuts] = best.split("\t");
    awarders[eik] = { locality, nuts: nuts || "", n: total };
  }

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(
    OUT_FILE,
    canonicalJson({
      generatedAt: new Date().toISOString(),
      parties: Object.keys(awarders).length,
      cachedDays,
      partyRowsSeen: parties,
      awarders,
    }),
  );
  console.log(
    `✓ wrote ${OUT_FILE}\n` +
      `  ${Object.keys(awarders).length} EIK(s) → locality from ${parties.toLocaleString()} party row(s) across ${cachedDays} cached day(s)`,
  );
  console.log(
    `→ now rebuild the geo map: npx tsx scripts/procurement/awarder_geo_map.ts`,
  );
};

const cli = command({
  name: "build_ocds_party_geo",
  args: {
    from: option({
      type: optional(string),
      long: "from",
      description:
        "First day (YYYY-MM-DD). Clamped to 2026-01-01. Default 30 days ago.",
    }),
    to: option({
      type: optional(string),
      long: "to",
      description: "Last day (YYYY-MM-DD). Default today.",
    }),
    backfill: flag({
      type: optional(boolean),
      long: "backfill",
      description: "Confirm a large (>40-day) crawl window.",
      defaultValue: () => false,
    }),
    refreshCache: flag({
      type: optional(boolean),
      long: "refresh-cache",
      description: "Re-download cached days.",
      defaultValue: () => false,
    }),
    delayMs: option({
      type: optional(string),
      long: "delay-ms",
      description: "Politeness delay between live day fetches (default 150).",
    }),
  },
  handler: (args) =>
    main({
      from:
        args.from ??
        new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10),
      to: args.to ?? new Date().toISOString().slice(0, 10),
      backfill: !!args.backfill,
      refreshCache: !!args.refreshCache,
      delayMs: args.delayMs ? parseInt(args.delayMs, 10) : 150,
    }),
});

run(cli, process.argv.slice(2));
