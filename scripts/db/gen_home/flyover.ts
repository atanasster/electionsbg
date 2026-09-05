// The ONE artifact behind the home flyover, the article and the video —
// `docs/plans/home-flyover-v1.md` §3 and §6.2.
//
//   npm run db:gen-home-flyover
//
// Writes the COMMITTED `data/home/flyover.json`: pre-projected geometry, three money layers
// by oblast, the buyer→contractor flow matrix, the elections and prices overlays, and the
// caption figures. `/` fetches this one object AFTER the band arms, and nothing else.
//
// ⚠️⚠️ THE THREE MONEY LAYERS ARE THREE TAPS, NEVER A TOTAL. An ИСУН-funded contract is in
// `fund_projects` AND in `contracts`; a farm subsidy is in neither. Summing them is not an
// approximation, it is a different quantity with no name. No caption, tile, chapter or video
// scene may add them, and nothing in this file computes such a sum.
//
// ⚠️ EVERY NUMBER HERE NAMES ITS BASIS, because three of them are nearly equal and none is
// interchangeable with another. Measured 2026-09-06 against the local corpus at
// `computedAt=2026-09-03`; re-measure with `npm run db:gen-home-flyover -- --dry-run`, which
// prints the whole table. The RELATIONSHIPS are the durable content, not the digits:
//
//   €94,117,596,157  the corpus at `tag = 'contract'`               → `flows.coverage.totalEur`
//   €93,907,350,255  `data/home/hub_stats.json`'s procurement tile  → `figures.procTotalEur`
//   €93,182,404,820  the sum whose BUYER has a resolved seat        → `coverage.buyerPlacedEur`
//
// The first two differ by 0.22% (the tile excludes the 628 empty-`contractor_eik` rows); the
// third is what the columns are actually built from, at 99.0% of the corpus. Do not
// „reconcile" them — the caption headline quotes the tile, because that is the number a
// reader sees one screen below, and the columns quote the placed sum, because that is what
// they draw.
//
// ⚠️ AND THE ARCS ARE ONLY A QUARTER COVERED. €22.1bn of €94.1bn has BOTH ends resolved to
// an oblast — the contractor side is the gap — so `flows.coverage` carries the whole
// decomposition and every arcs surface must say it in words. Hiding it in a tooltip turns a
// partial view into a false one (plan §14).
//
// A missing input DROPS its layer and records that in `available`; it never writes a zero,
// because a zero column is a claim about that oblast rather than an absence of data. The
// elections overlay is the normal case for that: `data/<date>/region_votes.json` is
// gitignored, so a fresh clone legitimately has no elections layer.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { allRows, end } from "../lib/pg";
import {
  isEmpty,
  missingRelations,
  warnSkip,
} from "../gen_procurement/preflight";
import {
  projectCommittedRegions,
  type FlyoverCity,
  type FlyoverRegion,
} from "../../geo/project_regions";
import {
  OBLAST_CODES,
  assertLayerCoverage,
  assertNamesResolved,
  oblastFromCode,
  oblastFromName,
  oblastPopulation,
} from "./oblastCodes";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const OUT = path.join(ROOT, "data/home/flyover.json");

/**
 * Uncompressed ceiling, asserted at generation. `/` is budgeted in REQUESTS as well as bytes
 * (plan §2.4/§2.5): splitting the geometry into a second object would buy headroom at the
 * cost of the very thing this budget exists to protect.
 */
export const MAX_BYTES = 48 * 1024;

/** Layer keys, in the order the columns programme cycles them. */
export const LAYERS = ["proc", "funds", "agri"] as const;
export type LayerId = (typeof LAYERS)[number];

export interface FlyoverCoverage {
  /** The whole corpus at `tag = 'contract'`. */
  totalEur: number;
  /** Both ends resolved to an oblast — what the arcs draw. */
  bothPlacedEur: number;
  /** The BUYER side alone — what the procurement columns are built from. */
  buyerPlacedEur: number;
  /**
   * The rest, partitioned so that `sum(unplaced) + bothPlacedEur === totalEur` exactly. Five
   * buckets rather than the plan's four: the contractor-placed-but-buyer-unplaced remainder
   * is small (€0.17bn) and folding it into a neighbour would make one of them mean two
   * things.
   */
  unplaced: {
    /** Contractor is in the Commerce Registry but has no resolvable seat. */
    trNoSeat: number;
    /** Contractor EIK is not in the Commerce Registry at all — foreign firms, BULSTAT bodies. */
    notInTr: number;
    /** `obed-` consortium carriers: a member set, not a registered seat. */
    carriers: number;
    /** `ph-` filler registration numbers and `np-` natural persons. */
    synthetic: number;
    /** Contractor placed, buyer not. */
    buyerUnplaced: number;
  };
}

export interface FlyoverFlows {
  scope: string;
  /** The 28 oblast codes, sorted — row and column keys of `m`. */
  keys: string[];
  /** `m[buyer][contractor]` in whole M€. */
  m: number[][];
  coverage: FlyoverCoverage;
}

export interface FlyoverElectionRegion {
  nick: string;
  color: string;
  /** Winner's share of that МИР's valid party votes, in percent to one decimal. */
  share: number;
}

export interface FlyoverArtifactV1 {
  v: 1;
  /** MAX SOURCE VINTAGE — the latest contract date, never `now`. */
  computedAt: string;
  frame: { w: number; h: number };
  geo: {
    regions: Record<string, FlyoverRegion>;
    cities: Record<string, FlyoverCity>;
  };
  /**
   * Per scope, per layer, whole M€ by oblast.
   *
   * ⚠️ ONLY `proc` IS SCOPED. `agri_subsidies` is annual and `fund_projects` carries NO date
   * column at all (CLAUDE.md), so a parliament window over either would be invented rather
   * than measured. `available.scopedLayers` says so rather than leaving a consumer to infer
   * it from a missing key.
   */
  layers: Record<string, Partial<Record<LayerId, Record<string, number>>>>;
  pop: Record<string, number>;
  flows: FlyoverFlows;
  elections?: Record<string, Record<string, FlyoverElectionRegion>>;
  prices?: {
    asOf: string;
    /** ⚠️ МИР keys (31), not oblast codes — the price panel's own grain, and the polygons'. */
    byMir: Record<string, number>;
    national: number;
  };
  /**
   * The caption NUMBERS, never prose.
   *
   * ⚠️ MONEY HERE IS WHOLE EUROS, while `layers.*` and `flows.m` are whole M€. The `Eur`
   * suffix is the marker and must survive any rename.
   */
  figures: {
    /** The /procurement tile's own €, NOT the corpus — see the header's three bases. */
    procTotalEur: number;
    /** Rows at `tag = 'contract'`. */
    procContracts: number;
    /**
     * Sofia city's share of the BUYER-PLACED procurement layer (`layers.all.proc`, 99.0% of
     * the corpus).
     */
    sofiaBuyerShare: number;
    /**
     * ⚠️ THE NEXT THREE ARE SHARES OF `flows.coverage.bothPlacedEur` — 23.5% of the corpus,
     * not of procurement — which is why each carries `Arc` in its name. A caption quoting one
     * as „…% of procurement money" is false by a factor of four, and every arcs surface must
     * state the coverage in words (plan §14). They sit two lines below `sofiaBuyerShare`,
     * whose denominator is four times larger.
     */
    sameOblastArcShare: number;
    intoSofiaArcShare: number;
    outOfSofiaArcShare: number;
    /** `[buyer, contractor, M€]` — the largest cross-oblast cell of the flow matrix. */
    topFlow: [string, string, number];
    /**
     * ⚠️ THE FUNDS LAYER IS ~48% OF ITS CORPUS AND EVERY SURFACE MUST SAY SO. The
     * national-scope programmes have no single oblast to sit in: 4.6% of ROWS are unplaced
     * and they hold 52% of the MONEY, so a row-share caveat is true and misleading.
     * `fundsPlacedEur / fundsTotalEur` is the share a caption quotes — the funds analogue of
     * `flows.coverage`, and the trap CLAUDE.md records verbatim for `placedMoneyPct`.
     */
    fundsPlacedEur: number;
    fundsTotalEur: number;
    /** `agri_subsidies.oblast` has no NULL/blank rows, so this really is the total. */
    agriTotalEur: number;
  };
  available: {
    proc: boolean;
    funds: boolean;
    agri: boolean;
    flows: boolean;
    elections: boolean;
    prices: boolean;
    /** Which layers carry more than the `all` scope. */
    scopedLayers: LayerId[];
  };
}

/** Whole M€, the money grain of every layer and of the flow matrix. */
const meur = (eur: number): number => Math.round(eur / 1e6);

/** Three decimals — the grain every share in `figures` is published at. */
const share3 = (x: number): number => Math.round(x * 1000) / 1000;

const num = (v: unknown): number => Number(v ?? 0);

/**
 * A scope's date predicate over `contracts.date` (a `text` ISO day, so string comparison is
 * both correct and index-usable). An open-ended scope — the sitting parliament — has no
 * upper bound, which is why the bound is interpolated rather than bound as a parameter that
 * would have to be nullable.
 */
const isoDay = (v: string, field: string): string => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    throw new Error(
      `flyover: procurement_scopes.${field} = ${JSON.stringify(v)} is not an ISO day. ` +
        `It is interpolated into SQL, so a malformed value is either a silently wrong window ` +
        `or a syntax error — neither of which names the row that caused it.`,
    );
  }
  return v;
};

const scopeWhere = (from: string | null, to: string | null): string => {
  const parts: string[] = [];
  if (from) parts.push(`c.date >= '${isoDay(from, "date_from")}'`);
  if (to) parts.push(`c.date < '${isoDay(to, "date_to")}'`);
  return parts.length ? ` AND ${parts.join(" AND ")}` : "";
};

interface ScopeRow {
  scope_key: string;
  date_from: string | null;
  date_to: string | null;
}

/**
 * `all` plus the SITTING parliament. Year windows are deliberately out of v1 (plan §12): two
 * scopes keep the artifact inside its byte budget, and a year slider belongs to a
 * procurement page rather than to the entry page.
 */
export const flyoverScopes = async (): Promise<ScopeRow[]> => {
  const rows = (await allRows(
    `SELECT scope_key, nullif(date_from, '') AS date_from, nullif(date_to, '') AS date_to
       FROM procurement_scopes
      WHERE scope_key = 'all' OR scope_key LIKE 'ns:%'
      ORDER BY sort_ord ASC`,
  )) as ScopeRow[];
  const all = rows.find((r) => r.scope_key === "all");
  const latestNs = rows.find((r) => r.scope_key.startsWith("ns:"));
  const out: ScopeRow[] = [];
  if (all) out.push(all);
  if (latestNs) out.push(latestNs);
  return out;
};

/** Procurement € by the BUYER's seat oblast, at `tag = 'contract'`. */
const procByOblast = async (
  from: string | null,
  to: string | null,
): Promise<Record<string, number>> => {
  const rows = (await allRows(
    `SELECT s.oblast AS name, sum(c.amount_eur::numeric) AS eur
       FROM contracts c
       JOIN awarder_seats s ON s.eik = c.awarder_eik
      WHERE c.tag = 'contract'${scopeWhere(from, to)}
      GROUP BY 1`,
  )) as { name: string; eur: string }[];
  // ⚠️ THE 28-OBLAST REFUSAL IS FOR THE ALL-TIME LAYER ONLY. Over a window days old — which
  // the sitting-parliament scope is every time an election lands — an oblast that has signed
  // no contract yet is a MEASUREMENT, and refusing there would abort a 60-step db:refresh for
  // being right. An unresolvable NAME is still refused in both: that is a fold defect either
  // way, and it is the arm that can silently move money between oblasts.
  const window = Boolean(from || to);
  return foldByName(rows, window ? `proc (windowed)` : "proc", !window);
};

const foldByName = (
  rows: { name: string | null; eur: string | number }[],
  layer: string,
  requireAll = true,
): Record<string, number> => {
  const acc = new Map<string, number>();
  const unresolved: string[] = [];
  for (const r of rows) {
    const code = oblastFromName(r.name);
    if (!code) {
      // A NULL/blank name is „unplaced" — `oblastFromName`'s own contract — not a value this
      // module failed to place. Reporting it would send an operator to add `null` to
      // NAME_ALIASES, which is exactly the wrong-table misdirection `fixIn` exists to prevent.
      if (r.name?.trim()) unresolved.push(r.name);
      continue;
    }
    acc.set(code, (acc.get(code) ?? 0) + num(r.eur));
  }
  if (requireAll) assertLayerCoverage(layer, acc, unresolved, "NAME_ALIASES");
  else assertNamesResolved(layer, unresolved, "NAME_ALIASES");
  return sortedMeur(acc);
};

const foldByCode = (
  rows: { code: string | null; eur: string | number }[],
  layer: string,
): Record<string, number> => {
  const acc = new Map<string, number>();
  const unresolved: string[] = [];
  for (const r of rows) {
    const code = oblastFromCode(r.code);
    if (!code) {
      // A NULL/blank oblast is „no place", not a bad code: it is the half of the funds
      // corpus whose programme is national, and it is reported as coverage, not as a fault.
      if (r.code) unresolved.push(r.code);
      continue;
    }
    acc.set(code, (acc.get(code) ?? 0) + num(r.eur));
  }
  assertLayerCoverage(layer, acc, unresolved, "CODE_FOLD");
  return sortedMeur(acc);
};

const sortedMeur = (acc: Map<string, number>): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const code of OBLAST_CODES) out[code] = meur(acc.get(code) ?? 0);
  return out;
};

/** The buyer→contractor matrix, both ends placed, plus the coverage decomposition. */
export const buildFlows = async (): Promise<FlyoverFlows> => {
  const cells = (await allRows(
    `SELECT s.oblast AS buyer, p.oblast AS con, sum(c.amount_eur::numeric) AS eur
       FROM contracts c
       JOIN awarder_seats s ON s.eik = c.awarder_eik
       JOIN tr_company_place p ON p.uic = c.contractor_eik
      WHERE c.tag = 'contract'
      GROUP BY 1, 2`,
  )) as { buyer: string | null; con: string | null; eur: string }[];

  const idx = new Map(OBLAST_CODES.map((c, i) => [c, i]));
  const m = OBLAST_CODES.map(() => OBLAST_CODES.map(() => 0));
  const unresolved: string[] = [];
  const seen = new Set<string>();
  for (const c of cells) {
    const b = oblastFromName(c.buyer);
    const k = oblastFromName(c.con);
    // Blank is „unplaced" and is counted by the coverage query below, not refused here.
    if (!b && c.buyer?.trim()) unresolved.push(c.buyer);
    if (!k && c.con?.trim()) unresolved.push(c.con);
    if (!b || !k) continue;
    seen.add(b);
    m[idx.get(b)!][idx.get(k)!] += num(c.eur);
  }
  assertLayerCoverage("flows", seen, unresolved, "NAME_ALIASES");

  const [cov] = (await allRows(
    `WITH c AS (
       SELECT c.amount_eur::numeric AS eur,
              c.contractor_eik AS eik,
              (s.eik IS NOT NULL) AS buyer_placed,
              (p.uic IS NOT NULL) AS con_placed,
              (t.uic IS NOT NULL) AS in_tr
         FROM contracts c
         LEFT JOIN awarder_seats s ON s.eik = c.awarder_eik
         LEFT JOIN tr_company_place p ON p.uic = c.contractor_eik
         LEFT JOIN tr_companies t ON t.uic = c.contractor_eik
        WHERE c.tag = 'contract'
     )
     SELECT sum(eur) AS total,
            sum(eur) FILTER (WHERE buyer_placed) AS buyer_placed,
            sum(eur) FILTER (WHERE bucket = 'bothPlaced')    AS both_placed,
            sum(eur) FILTER (WHERE bucket = 'trNoSeat')      AS tr_no_seat,
            sum(eur) FILTER (WHERE bucket = 'notInTr')       AS not_in_tr,
            sum(eur) FILTER (WHERE bucket = 'carriers')      AS carriers,
            sum(eur) FILTER (WHERE bucket = 'synthetic')     AS synthetic,
            sum(eur) FILTER (WHERE bucket = 'buyerUnplaced') AS buyer_unplaced
       FROM (
         SELECT eur, buyer_placed,
                CASE
                  WHEN eik LIKE 'obed-%' THEN 'carriers'
                  WHEN eik LIKE 'ph-%' OR eik LIKE 'np-%' THEN 'synthetic'
                  WHEN con_placed AND buyer_placed THEN 'bothPlaced'
                  WHEN con_placed THEN 'buyerUnplaced'
                  WHEN in_tr THEN 'trNoSeat'
                  ELSE 'notInTr'
                END AS bucket
           FROM c
       ) b`,
  )) as Record<string, string | null>[];

  const eur = (k: string) => Math.round(num(cov[k]));
  const coverage: FlyoverCoverage = {
    totalEur: eur("total"),
    bothPlacedEur: eur("both_placed"),
    buyerPlacedEur: eur("buyer_placed"),
    unplaced: {
      trNoSeat: eur("tr_no_seat"),
      notInTr: eur("not_in_tr"),
      carriers: eur("carriers"),
      synthetic: eur("synthetic"),
      buyerUnplaced: eur("buyer_unplaced"),
    },
  };

  // ⚠️ The partition must be EXACT, or `unplaced` stops being a decomposition and becomes a
  // list of loosely related figures a reader would still add up. The buckets are computed in
  // one CASE over one scan, so a gap here means a bucket predicate stopped matching.
  const parts =
    coverage.bothPlacedEur +
    Object.values(coverage.unplaced).reduce((a, b) => a + b, 0);
  if (Math.abs(parts - coverage.totalEur) > 1) {
    throw new Error(
      `flyover: the coverage buckets sum to ${parts} against a corpus of ` +
        `${coverage.totalEur} — the partition has a hole`,
    );
  }

  return {
    scope: "all",
    keys: [...OBLAST_CODES],
    m: m.map((row) => row.map(meur)),
    coverage,
  };
};

/** The winner and their share per МИР, for the two most recent parliamentary elections. */
export const buildElections = (): {
  elections?: Record<string, Record<string, FlyoverElectionRegion>>;
  missing: string[];
} => {
  interface ElectionRec {
    name: string;
  }
  const registry: ElectionRec[] = JSON.parse(
    fs.readFileSync(path.join(ROOT, "src/data/json/elections.json"), "utf8"),
  );
  // ⚠️ DERIVED, not `slice(0, 2)`. The registry is newest-first today and carries no date
  // field to filter on, so a re-sort — or a merge with the presidential registry now in
  // flight — would silently show the two OLDEST elections with every gate green.
  const dates = registry
    .map((e) => e.name)
    .sort()
    .slice(-2)
    .reverse();
  const out: Record<string, Record<string, FlyoverElectionRegion>> = {};
  const missing: string[] = [];
  for (const date of dates) {
    const votesPath = path.join(ROOT, `data/${date}/region_votes.json`);
    const partiesPath = path.join(ROOT, `data/${date}/cik_parties.json`);
    // Name the file that is actually absent: with the votes present and the parties missing,
    // a fixed message tells the operator a file that IS there is the problem.
    const absent = [votesPath, partiesPath]
      .filter((p) => !fs.existsSync(p))
      .map((p) => path.relative(ROOT, p));
    if (absent.length) {
      missing.push(...absent);
      continue;
    }
    const regions: {
      key: string;
      results: { votes: { partyNum: number; totalVotes: number }[] };
    }[] = JSON.parse(fs.readFileSync(votesPath, "utf8"));
    const parties: { number: number; color: string; nickName: string }[] =
      JSON.parse(fs.readFileSync(partiesPath, "utf8"));
    const byNum = new Map(parties.map((p) => [p.number, p]));
    const perRegion: Record<string, FlyoverElectionRegion> = {};
    for (const r of regions) {
      // МИР 32 is the abroad district: it has votes and no polygon, so it has no place on a
      // map of Bulgaria. Dropping it here rather than at render time keeps the artifact's
      // keys equal to the geometry's.
      if (!oblastFromCode(r.key)) continue;
      const votes = r.results?.votes ?? [];
      const total = votes.reduce((a, v) => a + (v.totalVotes || 0), 0);
      if (!total) continue;
      const top = votes.reduce((a, v) => (v.totalVotes > a.totalVotes ? v : a));
      const party = byNum.get(top.partyNum);
      if (!party) continue;
      perRegion[r.key] = {
        nick: party.nickName,
        color: party.color,
        share: Math.round((top.totalVotes / total) * 1000) / 10,
      };
    }
    if (Object.keys(perRegion).length) {
      out[date] = Object.fromEntries(
        Object.entries(perRegion).sort(([a], [b]) => (a < b ? -1 : 1)),
      );
    }
  }
  return Object.keys(out).length ? { elections: out, missing } : { missing };
};

/** The retail basket index against 2 Jan 2026, per МИР, from the price payload. */
export const buildPrices = async (): Promise<
  FlyoverArtifactV1["prices"] | undefined
> => {
  // ⚠️ NOT IN THE `need` PREFLIGHT, AND IT CANNOT BE: a missing price corpus must DROP the
  // overlay, not skip the whole artifact. `048_prices.sql` has no applier anywhere in
  // `db:refresh` — only `scripts/prices/{ingest,build_payloads}.ts`, neither of which is a
  // chain step — so on a clone that never ran the prices ingest this relation is simply
  // absent, and an unguarded 42P01 here would abort the chain five steps from the end, after
  // the ~90-minute contracts and person work had already run.
  if ((await missingRelations(["price_payloads"])).length) return undefined;
  const rows = (await allRows(
    `SELECT payload FROM price_payloads WHERE kind = 'index' LIMIT 1`,
  )) as { payload: Record<string, unknown> }[];
  const payload = rows[0]?.payload;
  if (!payload) return undefined;
  const asOf = String(payload.dataAsOf ?? payload.latestDate ?? "");
  const last = (series: unknown): number | null => {
    const arr = (series as { index?: { v: number }[] } | undefined)?.index;
    const v = arr?.[arr.length - 1]?.v;
    return typeof v === "number" ? v : null;
  };
  const national = last(payload.national);
  const regions = (payload.regions ?? {}) as Record<string, unknown>;
  const byMir: Record<string, number> = {};
  for (const key of Object.keys(regions).sort()) {
    const v = last(regions[key]);
    if (v !== null) byMir[key] = v;
  }
  if (!asOf || national === null || !Object.keys(byMir).length)
    return undefined;
  return { asOf, byMir, national };
};

interface RunOptions {
  /** Print the coverage table and the byte cost without writing. */
  dryRun?: boolean;
}

export const buildArtifact = async (): Promise<FlyoverArtifactV1 | null> => {
  // Skip-and-warn on a missing dependency, per the db:refresh chain contract: aborting would
  // take a 60-step reload down, and writing a partial artifact would overwrite a good served
  // file with a worse one.
  const need = [
    "contracts",
    "awarder_seats",
    "tr_company_place",
    "tr_companies",
    "procurement_scopes",
  ];
  const absent = await missingRelations(need);
  if (absent.length) {
    warnSkip(
      "home_flyover",
      `missing relation(s): ${absent.join(", ")}`,
      "run the loaders that build them, then npm run db:gen-home-flyover",
    );
    return null;
  }
  // ⚠️ The guard asks the same question every query below asks. `isEmpty("contracts")` alone
  // would pass a corpus of amendments only, after which `max(date)` is NULL and all 28 oblasts
  // are missing — a refusal three steps away from its cause.
  const [{ max_date: computedAt, n: procContracts }] = (await allRows(
    `SELECT max(date) AS max_date, count(*)::int AS n
       FROM contracts WHERE tag = 'contract'`,
  )) as { max_date: string; n: number }[];
  if (!procContracts) {
    warnSkip(
      "home_flyover",
      "contracts holds no row at tag = 'contract'",
      "run npm run db:load:pg, then npm run db:gen-home-flyover",
    );
    return null;
  }
  // `procurement_scopes` is the „present but never loaded" case: its migration can be applied
  // without the loader having run, and an empty table gives `flyoverScopes()` nothing to
  // return — after which `layers.all` is undefined and the failure is a TypeError naming
  // neither the dependency nor the fix.
  if (await isEmpty("procurement_scopes")) {
    warnSkip(
      "home_flyover",
      "procurement_scopes is empty",
      "run npm run db:load:procurement-scopes:pg, then npm run db:gen-home-flyover",
    );
    return null;
  }

  const { geo, stats } = projectCommittedRegions();

  const scopes = await flyoverScopes();
  const layers: FlyoverArtifactV1["layers"] = {};
  for (const s of scopes) {
    layers[s.scope_key] = { proc: await procByOblast(s.date_from, s.date_to) };
  }
  const allLayers = layers.all;
  if (!allLayers) {
    warnSkip(
      "home_flyover",
      "procurement_scopes carries no `all` row",
      "run npm run db:load:procurement-scopes:pg, then npm run db:gen-home-flyover",
    );
    return null;
  }

  const fundsAbsent = (await missingRelations(["fund_projects"])).length > 0;
  const agriAbsent = (await missingRelations(["agri_subsidies"])).length > 0;
  let fundsPlacedEur = 0;
  let fundsTotalEur = 0;
  let agriTotalEur = 0;
  if (!fundsAbsent && !(await isEmpty("fund_projects"))) {
    const rows = (await allRows(
      `SELECT oblast AS code, sum(grant_eur::numeric) AS eur
         FROM fund_projects GROUP BY 1`,
    )) as { code: string | null; eur: string }[];
    allLayers.funds = foldByCode(rows, "funds");
    // ⚠️ BOTH, ALWAYS. The unplaced half is the national-scope programmes, and it is 52% of
    // the money against 4.6% of the rows — so a consumer given only the numerator publishes
    // „€16.1 млрд. европейски средства" about a €33.7bn corpus.
    fundsPlacedEur = Math.round(
      rows
        .filter((r) => oblastFromCode(r.code))
        .reduce((a, r) => a + num(r.eur), 0),
    );
    fundsTotalEur = Math.round(rows.reduce((a, r) => a + num(r.eur), 0));
  }
  if (!agriAbsent && !(await isEmpty("agri_subsidies"))) {
    const rows = (await allRows(
      `SELECT oblast AS name, sum(total_eur::numeric) AS eur
         FROM agri_subsidies GROUP BY 1`,
    )) as { name: string | null; eur: string }[];
    allLayers.agri = foldByName(rows, "agri");
    agriTotalEur = Math.round(rows.reduce((a, r) => a + num(r.eur), 0));
  }

  const flows = await buildFlows();
  const { elections, missing: electionsMissing } = buildElections();
  if (electionsMissing.length) {
    console.warn(
      `home_flyover: no elections overlay for ${electionsMissing.join(", ")} ` +
        `(gitignored per-election tree) — recorded in available.elections`,
    );
  }
  const prices = await buildPrices();

  // ⚠️ The headline € is the TILE's, not the corpus's: it is the number the /procurement tile
  // one screen below shows, and two figures on one screen that disagree by €0.2bn read as an
  // error in both. The corpus total lives in `flows.coverage.totalEur` and is what every
  // coverage share is measured against.
  const hubStats = JSON.parse(
    fs.readFileSync(path.join(ROOT, "data/home/hub_stats.json"), "utf8"),
  ) as { tiles?: { procurement?: { value?: number } } };
  const procTotalEur = Math.round(hubStats.tiles?.procurement?.value ?? 0);
  if (!procTotalEur) {
    throw new Error(
      "flyover: data/home/hub_stats.json carries no procurement tile value — the caption " +
        "headline has no basis, and inventing one from the corpus would put two different " +
        "numbers on one screen",
    );
  }

  const sofia = flows.keys.indexOf("SOF");
  const totalM = flows.m.reduce((a, r) => a + r.reduce((x, y) => x + y, 0), 0);
  const sameM = flows.m.reduce((a, r, i) => a + r[i], 0);
  const intoSofiaM = flows.m.reduce(
    (a, r, i) => a + (i === sofia ? 0 : r[sofia]),
    0,
  );
  const outOfSofiaM = flows.m[sofia].reduce(
    (a, v, j) => a + (j === sofia ? 0 : v),
    0,
  );
  let topFlow: [string, string, number] = ["", "", 0];
  for (let i = 0; i < flows.keys.length; i++) {
    for (let j = 0; j < flows.keys.length; j++) {
      if (i === j) continue;
      if (flows.m[i][j] > topFlow[2]) {
        topFlow = [flows.keys[i], flows.keys[j], flows.m[i][j]];
      }
    }
  }

  const procAll = allLayers.proc ?? {};
  const procAllTotal = Object.values(procAll).reduce((a, b) => a + b, 0);

  const artifact: FlyoverArtifactV1 = {
    v: 1,
    computedAt,
    frame: geo.frame,
    geo: { regions: geo.regions, cities: geo.cities },
    layers,
    pop: oblastPopulation(),
    flows,
    ...(elections ? { elections } : {}),
    ...(prices ? { prices } : {}),
    figures: {
      procTotalEur,
      procContracts,
      sofiaBuyerShare: share3(
        procAllTotal ? (procAll.SOF ?? 0) / procAllTotal : 0,
      ),
      sameOblastArcShare: share3(totalM ? sameM / totalM : 0),
      intoSofiaArcShare: share3(totalM ? intoSofiaM / totalM : 0),
      outOfSofiaArcShare: share3(totalM ? outOfSofiaM / totalM : 0),
      topFlow,
      fundsPlacedEur,
      fundsTotalEur,
      agriTotalEur,
    },
    available: {
      proc: Boolean(allLayers.proc),
      funds: Boolean(allLayers.funds),
      agri: Boolean(allLayers.agri),
      flows: flows.coverage.bothPlacedEur > 0,
      elections: Boolean(elections),
      prices: Boolean(prices),
      scopedLayers: ["proc"],
    },
  };

  console.log(
    `home_flyover: geometry ${stats.points} points / ${stats.bytes} B · ` +
      `scopes ${scopes.map((s) => s.scope_key).join(", ")}`,
  );
  const cov = flows.coverage;
  const pct = (v: number) => ((v / cov.totalEur) * 100).toFixed(1).padStart(5);
  console.log(
    [
      `home_flyover coverage (tag='contract', €${(cov.totalEur / 1e9).toFixed(2)}bn):`,
      `  both ends placed  ${pct(cov.bothPlacedEur)}%  — what the arcs draw`,
      `  buyer placed      ${pct(cov.buyerPlacedEur)}%  — what the columns draw`,
      `  contractor in TR, no seat ${pct(cov.unplaced.trNoSeat)}%`,
      `  contractor not in TR      ${pct(cov.unplaced.notInTr)}%`,
      `  consortium carriers       ${pct(cov.unplaced.carriers)}%`,
      `  synthetic ids             ${pct(cov.unplaced.synthetic)}%`,
      `  buyer unplaced            ${pct(cov.unplaced.buyerUnplaced)}%`,
    ].join("\n"),
  );

  return artifact;
};

export const run = async (opts: RunOptions = {}): Promise<void> => {
  const artifact = await buildArtifact();
  if (!artifact) return;
  const body = JSON.stringify(artifact) + "\n";
  const bytes = Buffer.byteLength(body);
  if (bytes > MAX_BYTES) {
    throw new Error(
      `flyover: ${bytes} bytes exceeds the ${MAX_BYTES}-byte budget. ` +
        `Raise the geometry tolerance rather than splitting the artifact — the second ` +
        `request is the cost the budget exists to avoid (plan §3).`,
    );
  }
  if (opts.dryRun) {
    console.log(`home_flyover: ${bytes} bytes (dry run, nothing written)`);
    return;
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const tmp = `${OUT}.tmp`;
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, OUT);
  console.log(
    `home_flyover: wrote data/home/flyover.json · ${bytes} of ${MAX_BYTES} bytes · ` +
      `computedAt=${artifact.computedAt}`,
  );
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  run({ dryRun: process.argv.includes("--dry-run") })
    .then(() => end())
    .catch(async (e) => {
      console.error(e);
      await end();
      process.exit(1);
    });
}
