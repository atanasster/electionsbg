// One-shot, offline, idempotent enrichment of data/procurement/awarders/<eik>.json
// with a human-readable `seat` block (settlement · município · oblast).
//
// Why this exists: the awarder page (/awarder/:eik) should name where a buyer
// sits. Two sources feed it:
//
//   1. Geo-resolved awarders already carry `geo.ekatte` (stamped by
//      enrich_awarders_geo.ts from cached OCDS buyer addresses). We turn that
//      EKATTE into inline names via the EKATTE registry.
//
//   2. Legacy-CSV-only awarders (active before 2026, never in a cached
//      fortnight bundle) have no geo block at all — yet their *contract-name
//      variants* often embed the seat as a trailing settlement marker, e.g.
//      `Средно общообразователно училище "Йордан Йовков" с. Рибново`. We parse
//      that locality and resolve it through the same EKATTE resolver, which
//      only returns a match when the settlement name is globally unique — so a
//      wrong seat is essentially impossible (ambiguous names stay unresolved).
//
// Names are inlined onto the rollup so the SPA needs no EKATTE registry to
// render the seat. This script is safe to re-run; it only writes files whose
// `seat` actually changes.
//
// Usage:
//   npx tsx scripts/procurement/enrich_awarder_seats.ts        # write
//   npx tsx scripts/procurement/enrich_awarder_seats.ts --dry  # report only
//
// NB (offline): reads only on-disk data/ — no network. After it runs, the new
// `seat` fields live in gitignored awarder shards; sync them to the data bucket
// (npm run bucket:sync / :all) before they appear on prod.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getResolver, type EkatteEntry } from "./resolve_ekatte";
import { canonicalJson } from "./validate";
import type { AwarderRollup, AwarderSeat } from "./types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const AWARDERS_DIR = path.resolve(__dirname, "../../data/procurement/awarders");
const CONTRACTS_DIR = path.resolve(
  __dirname,
  "../../data/procurement/awarder_contracts",
);

// Settlement-marker pattern. We only parse the *awarder name* (the buyer's own
// legal name), never the contract title — the title can name a place of
// performance that differs from the seat. Markers: с. / гр. / село / град /
// община. Capture up to three following capitalised Cyrillic words (covers
// "Стара Загора", "Долна баня"). Trailing punctuation is trimmed downstream.
const SEAT_MARKER =
  /(?:^|[\s"'„“(,.])(?:с\.|гр\.|село|град|общ\.|община)\s+([А-ЯЁ][а-яёа-я]+(?:[\s-][А-ЯЁ]?[а-яёа-я]+){0,2})/gu;

const cleanCandidate = (s: string): string =>
  s
    .replace(/["'„“”»«).,;:–-]+$/u, "")
    .replace(/\s+/g, " ")
    .trim();

// Pull distinct seat candidates out of every awarder-name variant we have for
// this buyer (the rollup name + every awarderName seen on its contracts).
const seatCandidates = (eik: string, rollupName: string): string[] => {
  const names = new Set<string>([rollupName]);
  const cf = path.join(CONTRACTS_DIR, `${eik}.json`);
  if (fs.existsSync(cf)) {
    try {
      const doc = JSON.parse(fs.readFileSync(cf, "utf8")) as {
        contracts?: Array<{ awarderName?: string }>;
      };
      for (const c of doc.contracts ?? []) {
        if (c.awarderName) names.add(c.awarderName);
      }
    } catch {
      /* ignore unreadable contract sidecar */
    }
  }
  const out = new Set<string>();
  for (const name of names) {
    for (const m of name.matchAll(SEAT_MARKER)) {
      const cand = cleanCandidate(m[1]);
      if (cand) out.add(cand);
    }
  }
  return [...out];
};

const seatFromEntry = (
  entry: EkatteEntry,
  source: "geo" | "name",
  geo?: AwarderRollup["geo"],
): AwarderSeat => ({
  ekatte: entry.ekatte,
  settlement: entry.name,
  municipality: entry.obshtina,
  oblast: entry.province,
  isVillage: entry.is_village,
  source,
  // Tier/local-HQ only exist on the geo block (name-parsed seats have neither).
  tier: geo?.tier,
  isLocalHQ: geo?.isLocalHQ,
});

const sameSeat = (a: AwarderSeat | undefined, b: AwarderSeat): boolean =>
  !!a &&
  a.ekatte === b.ekatte &&
  a.settlement === b.settlement &&
  a.municipality === b.municipality &&
  a.oblast === b.oblast &&
  a.isVillage === b.isVillage &&
  a.source === b.source;

// Resolve one awarder's seat: prefer its already-resolved buyer-HQ EKATTE, else
// a UNIQUE settlement name parsed from the buyer's name variants (ambiguous →
// none). Shared by the JSON enrichment and the PG loader.
const resolveSeat = (
  aw: AwarderRollup,
  resolver: ReturnType<typeof getResolver>,
  byEkatte: Map<string, EkatteEntry>,
): AwarderSeat | undefined => {
  const geoEkatte = aw.geo?.ekatte;
  if (geoEkatte && byEkatte.has(geoEkatte)) {
    return seatFromEntry(byEkatte.get(geoEkatte)!, "geo", aw.geo);
  }
  const resolved = new Map<string, EkatteEntry>();
  for (const c of seatCandidates(aw.eik, aw.name)) {
    const r = resolver.resolve({ locality: c });
    if (r.ekatte && r.matched) resolved.set(r.ekatte, r.matched);
  }
  return resolved.size === 1
    ? seatFromEntry([...resolved.values()][0], "name")
    : undefined;
};

// eik → resolved seat for every awarder shard (no file writes) — the source for
// the PG awarder_seats table (load_awarder_seats_pg.ts), so the DB company page
// can build a geographic footprint entirely from Postgres.
export const computeAwarderSeats = (): Map<string, AwarderSeat> => {
  const out = new Map<string, AwarderSeat>();
  if (!fs.existsSync(AWARDERS_DIR)) return out;
  const resolver = getResolver();
  const byEkatte = new Map<string, EkatteEntry>();
  for (const e of resolver.entries) byEkatte.set(e.ekatte, e);
  for (const file of fs.readdirSync(AWARDERS_DIR)) {
    if (!file.endsWith(".json")) continue;
    const aw = JSON.parse(
      fs.readFileSync(path.join(AWARDERS_DIR, file), "utf8"),
    ) as AwarderRollup;
    const seat = resolveSeat(aw, resolver, byEkatte);
    if (seat) out.set(aw.eik, seat);
  }
  return out;
};

export interface EnrichSeatsResult {
  total: number;
  fromGeo: number;
  fromName: number;
  unresolved: number;
  conflicts: number;
  written: number;
  unchanged: number;
}

export const enrichAwarderSeats = (
  opts: { dry?: boolean } = {},
): EnrichSeatsResult => {
  const resolver = getResolver();
  const byEkatte = new Map<string, EkatteEntry>();
  for (const e of resolver.entries) byEkatte.set(e.ekatte, e);

  const res: EnrichSeatsResult = {
    total: 0,
    fromGeo: 0,
    fromName: 0,
    unresolved: 0,
    conflicts: 0,
    written: 0,
    unchanged: 0,
  };

  if (!fs.existsSync(AWARDERS_DIR)) return res;
  const files = fs.readdirSync(AWARDERS_DIR).filter((f) => f.endsWith(".json"));

  for (const file of files) {
    res.total += 1;
    const filePath = path.join(AWARDERS_DIR, file);
    const aw = JSON.parse(fs.readFileSync(filePath, "utf8")) as AwarderRollup;

    const seat = resolveSeat(aw, resolver, byEkatte);
    if (!seat) {
      res.unresolved += 1;
      continue;
    }
    if (seat.source === "geo") res.fromGeo += 1;
    else res.fromName += 1;

    if (sameSeat(aw.seat, seat)) {
      res.unchanged += 1;
      continue;
    }
    aw.seat = seat;
    if (!opts.dry) fs.writeFileSync(filePath, canonicalJson(aw));
    res.written += 1;
  }

  return res;
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const dry = process.argv.includes("--dry");
  const r = enrichAwarderSeats({ dry });
  console.log(`Awarders total        : ${r.total}`);
  console.log(`  seat from geo.ekatte: ${r.fromGeo}`);
  console.log(`  seat from name parse: ${r.fromName}`);
  console.log(`  unresolved (no seat): ${r.unresolved}`);
  console.log(`  name conflicts      : ${r.conflicts}`);
  console.log(`  ${dry ? "would write" : "written"}        : ${r.written}`);
  console.log(`  unchanged           : ${r.unchanged}`);
}
