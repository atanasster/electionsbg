// Ingest the ДФ „Земеделие" (CAP paying agency) subsidy corpus straight into
// Postgres — the single source of truth. No JSON intermediary on disk: the raw
// per-year sheets are pulled from data.egov.bg (cached under raw_data/agri/ by
// source.ts), normalised + EUR-converted here, and written directly to the PG
// tables the app serves from.
//
//   npm run agri:ingest            (needs `npm run db:pg:up` first)
//
// Targets (schema/pg/046_agri_subsidies.sql):
//   • agri_subsidies — per (year × beneficiary × scheme) detail row (the browse +
//                      per-EIK scope + all serving aggregates)
//   • agri_payloads  — precomputed jsonb blobs: 'overview' (national dashboard)
//                      and 'recipient' (per-legal-entity rollup), computed here in
//                      Node so local↔cloud parity is byte-exact.
//
// All money is EUR (converted at the locked changeover rate). Concentration and
// "top recipients" cover LEGAL ENTITIES ONLY (rows carrying an EIK); individuals
// are published as name+oblast with no stable id, so merging them risks namesake
// collisions ([[project_procurement_namesake_fix]]) — reported as an aggregate.

import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { PoolClient } from "pg";
import { AGRI_YEARS, loadYearSheet } from "./source";
import { AGRI_SEU_YEARS, parseSeuYear } from "./seu_fetch";
import { parseAmount } from "./parse_amount";
import { exec, getPool, withClient, end } from "../db/lib/pg";
import { recordIngestBatch } from "../db/lib/ingest_changelog";
import {
  createStageTable,
  addStagePrimaryKey,
  mergeFromStage,
  type StageMergeSpec,
} from "../db/lib/stage_merge";

const BGN_PER_EUR = 1.95583; // locked euro-adoption rate

// The paying agency's own EIK (and other pure state-intervention payees) surface
// as "recipients" for публично складиране / market-intervention flows — real
// money, but not farm beneficiaries. Excluded from the attributable analytics
// (top recipients + concentration) so "who gets farm money" isn't distorted; the
// rows stay in the detail table and are still queryable.
const PAYER_EIKS = new Set(["121100421"]); // ДФ „Земеделие"

// Legal-entity EIK count with the payer(s) removed — the same basis used for
// concentration + top recipients, so the "companies" headline KPI and the
// "among N firms" concentration count never differ by one when the payer appears.
const countEntities = <T>(m: Map<string, T>): number => {
  let n = m.size;
  for (const p of PAYER_EIKS) if (m.has(p)) n -= 1;
  return n;
};

const SCHEMA_DIR = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "db",
  "schema",
  "pg",
);

interface AgriRow {
  year: number;
  eik: string | null;
  name: string;
  oblast: string;
  scheme: string;
  schemeDesc: string;
  dpEur: number;
  marketEur: number;
  ruralEur: number;
  totalEur: number;
}

interface Recipient {
  eik: string;
  name: string;
  oblast: string;
  totalEur: number;
  dpEur: number;
  marketEur: number;
  ruralEur: number;
  paymentCount: number;
  byYear: Map<number, number>;
  byScheme: Map<string, number>;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const toEur = (bgn: number): number =>
  Math.round((bgn / BGN_PER_EUR) * 100) / 100;

const colFinder = (header: unknown[]) => {
  const h = header.map((c) => String(c ?? "").trim());
  return (re: RegExp): number => h.findIndex((c) => re.test(c));
};

// ── detail-row insert ─────────────────────────────────────────────────────────
const COLS = [
  "year",
  "eik",
  "name",
  "oblast",
  "scheme",
  "scheme_desc",
  "dp_eur",
  "market_eur",
  "rural_eur",
  "total_eur",
];
const N = COLS.length;
const BATCH = 1000; // 1000 × 10 = 10k params (< 65535)

const rowParams = (r: AgriRow) => [
  r.year,
  r.eik ?? null,
  r.name || "",
  r.oblast || null,
  r.scheme || null,
  r.schemeDesc || null,
  r.dpEur,
  r.marketEur,
  r.ruralEur,
  r.totalEur,
];

// Rows land in the UNLOGGED stage twin, never the served table — the 2.5M-row
// build under a TRUNCATE held an AccessExclusiveLock for the whole load, which
// is the documented 55P03 / 500s-on-prod failure mode for served tables
// (reference_stage_merge_reload, reference_contracts_reload_lock).
const insertRows = async (c: PoolClient, rows: AgriRow[]): Promise<void> => {
  const insertCols = COLS.join(", ");
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const values = batch
      .map(
        (_, r) => `(${COLS.map((_, col) => `$${r * N + col + 1}`).join(",")})`,
      )
      .join(",");
    await c.query(
      `INSERT INTO agri_subsidies_stage (${insertCols}) VALUES ${values}`,
      batch.flatMap(rowParams),
    );
  }
};

const insertPayloads = async (
  c: PoolClient,
  rows: { kind: string; key: string; text: string }[],
): Promise<void> => {
  const PB = 500;
  for (let i = 0; i < rows.length; i += PB) {
    const batch = rows.slice(i, i + PB);
    const values = batch
      .map((_, r) => `($${r * 3 + 1},$${r * 3 + 2},$${r * 3 + 3}::jsonb)`)
      .join(",");
    // No ON CONFLICT: the stage twin is created empty immediately before this
    // runs, so a (kind,key) collision can only mean a real bug (e.g. a
    // duplicate overview key) — it fails loudly at addStagePrimaryKey, before
    // the merge, rather than silently dropping the second row.
    await c.query(
      `INSERT INTO agri_payloads_stage (kind, key, payload) VALUES ${values}`,
      batch.flatMap((p) => [p.kind, p.key, p.text]),
    );
  }
};

const waitForPg = async (): Promise<void> => {
  for (let i = 0; i < 30; i++) {
    try {
      await getPool().query("SELECT 1");
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error("Postgres not reachable — run `npm run db:pg:up`.");
};

/**
 * The whole agri build: parse (egov cache + СЕУ CSVs) → stage → publish.
 * `offline: true` is the pure-load path (`npm run db:load:agri:pg`): every
 * source must already be in raw_data/agri/, and a PARTIAL cache throws — a
 * missing egov year or СЕУ CSV silently dropping FY rows is exactly the
 * shrunken-corpus failure the guards below exist for. `offline: false` is the
 * fetch+load path (`npm run agri:ingest`, the update-agri skill).
 */
export const runAgriIngest = async ({
  offline = false,
}: { offline?: boolean } = {}) => {
  await waitForPg();
  const schemaSql = readFileSync(
    path.join(SCHEMA_DIR, "046_agri_subsidies.sql"),
    "utf8",
  );
  await exec(schemaSql);
  await exec(
    readFileSync(path.join(SCHEMA_DIR, "005_ingest_tracking.sql"), "utf8"),
  );

  const recipients = new Map<string, Recipient>();
  const totalsByYear: {
    year: number;
    totalEur: number;
    rowCount: number;
    entityEur: number;
    individualEur: number;
    entityCount: number;
    individualCount: number;
  }[] = [];
  let latestYear = 0;
  let rowsTotal = 0;
  // Per-financial-year working sets, retained so the dashboard's Обхват (scope)
  // selector can render any single year — not just the latest — plus an
  // all-years aggregate.
  interface YearWS {
    total: number;
    entityEur: number;
    individualEur: number;
    entityCount: number;
    individualCount: number;
    byScheme: Map<string, number>;
    byOblast: Map<string, number>;
    entityTotals: Map<string, number>; // eik → that year's total
  }
  const perYear = new Map<number, YearWS>();
  // Мярка code → its fullest Описание (descriptive name), for the by-scheme
  // tooltip. Source is inconsistent (some Мярка are codes like СЕПП, some are
  // already the long name); keep the longest description seen per code.
  const schemeDescr = new Map<string, string>();
  // All-years accumulators for the 'all' scope.
  const allByScheme = new Map<string, number>();
  const allByOblast = new Map<string, number>();
  const allIndividuals = new Set<string>();
  let allEntityEur = 0;
  let allIndividualEur = 0;

  // Accumulate ONE year's already-normalised, EUR-converted rows (egov or СЕУ)
  // into the shared rollups and stream them into agri_subsidies. Both sources
  // feed the same per-year overview payloads, concentration, top recipients, etc.
  const processYear = async (
    c: PoolClient,
    year: number,
    yearRows: AgriRow[],
  ): Promise<void> => {
    const yearEntityTotals = new Map<string, number>();
    const individualsSeen = new Set<string>();
    const byScheme = new Map<string, number>();
    const byOblast = new Map<string, number>();
    let yTotal = 0;
    let yEntityEur = 0;
    let yIndividualEur = 0;
    for (const row of yearRows) {
      const {
        eik,
        name,
        oblast,
        scheme,
        dpEur,
        marketEur,
        ruralEur,
        totalEur,
      } = row;
      yTotal += totalEur;
      if (scheme) byScheme.set(scheme, (byScheme.get(scheme) ?? 0) + totalEur);
      if (oblast) byOblast.set(oblast, (byOblast.get(oblast) ?? 0) + totalEur);
      if (eik) {
        yEntityEur += totalEur;
        yearEntityTotals.set(eik, (yearEntityTotals.get(eik) ?? 0) + totalEur);
        let rec = recipients.get(eik);
        if (!rec) {
          rec = {
            eik,
            name,
            oblast,
            totalEur: 0,
            dpEur: 0,
            marketEur: 0,
            ruralEur: 0,
            paymentCount: 0,
            byYear: new Map(),
            byScheme: new Map(),
          };
          recipients.set(eik, rec);
        }
        if (name.length > rec.name.length) rec.name = name;
        if (oblast) rec.oblast = oblast;
        rec.totalEur += totalEur;
        rec.dpEur += dpEur;
        rec.marketEur += marketEur;
        rec.ruralEur += ruralEur;
        rec.paymentCount += 1;
        rec.byYear.set(year, (rec.byYear.get(year) ?? 0) + totalEur);
        if (scheme)
          rec.byScheme.set(scheme, (rec.byScheme.get(scheme) ?? 0) + totalEur);
      } else {
        yIndividualEur += totalEur;
        individualsSeen.add(`${name}|${oblast}`);
      }
    }
    await insertRows(c, yearRows);
    rowsTotal += yearRows.length;
    totalsByYear.push({
      year,
      totalEur: round2(yTotal),
      rowCount: yearRows.length,
      entityEur: round2(yEntityEur),
      individualEur: round2(yIndividualEur),
      entityCount: countEntities(yearEntityTotals),
      individualCount: individualsSeen.size,
    });
    perYear.set(year, {
      total: yTotal,
      entityEur: yEntityEur,
      individualEur: yIndividualEur,
      entityCount: countEntities(yearEntityTotals),
      individualCount: individualsSeen.size,
      byScheme,
      byOblast,
      entityTotals: yearEntityTotals,
    });
    for (const [k, v] of byScheme)
      allByScheme.set(k, (allByScheme.get(k) ?? 0) + v);
    for (const [k, v] of byOblast)
      allByOblast.set(k, (allByOblast.get(k) ?? 0) + v);
    for (const k of individualsSeen) allIndividuals.add(k);
    allEntityEur += yEntityEur;
    allIndividualEur += yIndividualEur;
    if (year >= latestYear) latestYear = year;
    console.log(
      `FY${year}: ${yearRows.length} rows, €${(yTotal / 1e6).toFixed(1)}M, ${yearEntityTotals.size} legal entities`,
    );
  };

  // Normalised name key for the СЕУ→egov EIK backfill (the register has no EIK).
  const normName = (s: string): string =>
    s.toUpperCase().replace(/\s+/g, " ").trim();

  // Build every year's rows into an UNLOGGED stage twin — no lock is ever
  // taken on the served table during the (long) build. A failed run leaves the
  // stage behind for postmortem (the live table untouched; the next run's
  // DROP IF EXISTS clears it) and only the short DELETE+INSERT publish below
  // touches the served table, under RowExclusiveLock.
  await exec("DROP TABLE IF EXISTS agri_subsidies_stage");
  await exec(
    "CREATE UNLOGGED TABLE agri_subsidies_stage (LIKE agri_subsidies INCLUDING DEFAULTS)",
  );
  await withClient(async (c) => {
    await c.query("BEGIN");

    for (const year of AGRI_YEARS) {
      const sheet = await loadYearSheet(year, offline);
      if (!sheet.length || !Array.isArray(sheet[0])) {
        // Malformed ≠ absent: offline this is a defect in the cache and must
        // not quietly shrink the corpus by a whole financial year.
        if (offline)
          throw new Error(`FY${year}: unexpected cached sheet shape`);
        console.warn(`FY${year}: unexpected sheet shape — skipped`);
        continue;
      }
      const find = colFinder(sheet[0]);
      const iEik = find(/^ЕИК$|булстат/i);
      const iName = find(/бенефициент|получател|име/i);
      const iOblast = find(/област/i);
      const iDp = find(/ЕФГЗ-ДП/i);
      const iMarket = find(/^ЕФГЗ$/i);
      const iRural = find(/ЕЗФРСР/i);
      const iTotal = find(/^общо$/i);
      const iDesc = find(/описание/i);
      const iScheme = find(/^мярка$/i);

      const yearRows: AgriRow[] = [];
      for (let r = 1; r < sheet.length; r++) {
        const row = sheet[r];
        if (!row) continue;
        const eikRaw = iEik >= 0 ? String(row[iEik] ?? "").trim() : "";
        const eik = /^\d{9,13}$/.test(eikRaw) ? eikRaw : null;
        const name = iName >= 0 ? String(row[iName] ?? "").trim() : "";
        const oblast = iOblast >= 0 ? String(row[iOblast] ?? "").trim() : "";
        const dpEur = toEur(parseAmount(row[iDp]));
        const marketEur = toEur(parseAmount(row[iMarket]));
        const ruralEur = toEur(parseAmount(row[iRural]));
        const totalEur =
          iTotal >= 0
            ? toEur(parseAmount(row[iTotal]))
            : round2(dpEur + marketEur + ruralEur);
        if (!name && !eik) continue;
        const schemeDesc = iDesc >= 0 ? String(row[iDesc] ?? "").trim() : "";
        const scheme =
          iScheme >= 0 ? String(row[iScheme] ?? "").trim() : schemeDesc;
        if (scheme && schemeDesc && schemeDesc !== scheme) {
          const prev = schemeDescr.get(scheme);
          if (!prev || schemeDesc.length > prev.length)
            schemeDescr.set(scheme, schemeDesc);
        }

        yearRows.push({
          year,
          eik,
          name,
          oblast,
          scheme,
          schemeDesc,
          dpEur,
          marketEur,
          ruralEur,
          totalEur,
        });
      }
      // A header-only cached sheet parses "cleanly" to zero rows — offline
      // that is a whole financial year silently absent, which the corpus-level
      // shrink guard cannot catch on a first load into an empty database.
      if (offline && yearRows.length === 0)
        throw new Error(`FY${year}: cached sheet has no data rows`);
      await processYear(c, year, yearRows);
    }

    // ── СЕУ current-window years (FY2024/2025) ──────────────────────────────────
    // The egov portal stops at FY2023; the latest 1–2 financial years come from
    // the СЕУ register (scripts/agri/seu_fetch.ts, cached by `npm run agri:seu`),
    // which has NO EIK column — recover it by exact name-match against the egov
    // entities loaded above. Recurring big recipients relink to their EIK (and so
    // to /company, procurement, EU funds); genuinely new entrants stay name-only,
    // like individuals. СЕУ amounts are BGN, converted like egov.
    const nameToEik = new Map<string, string>();
    for (const rec of recipients.values()) {
      const k = normName(rec.name);
      if (k && !nameToEik.has(k)) nameToEik.set(k, rec.eik);
    }
    for (const year of AGRI_SEU_YEARS) {
      const groups = parseSeuYear(year);
      if (!groups.length) {
        // Offline, a missing СЕУ CSV means the cache is PARTIAL — throwing
        // beats silently publishing a corpus without FY2024/2025 (T2.1).
        if (offline)
          throw new Error(
            `SEU FY${year}: no cached CSV in raw_data/agri/ — run \`npm run agri:seu\``,
          );
        console.warn(`SEU FY${year}: no cached CSV — run \`npm run agri:seu\``);
        continue;
      }
      let matched = 0;
      const yearRows: AgriRow[] = groups.map((g) => {
        const dpEur = toEur(g.efgzBgn);
        const ruralEur = toEur(g.ruralBgn);
        const eik = nameToEik.get(normName(g.name)) ?? null;
        if (eik) matched++;
        return {
          year,
          eik,
          name: g.name,
          oblast: g.oblast,
          scheme: g.scheme,
          schemeDesc: g.scheme,
          dpEur,
          marketEur: 0,
          ruralEur,
          totalEur: round2(dpEur + ruralEur),
        };
      });
      await processYear(c, year, yearRows);
      console.log(
        `  ↳ SEU FY${year}: ${matched}/${yearRows.length} groups EIK-matched to egov`,
      );
    }

    await c.query("COMMIT");
  });

  await exec("ANALYZE agri_subsidies_stage");

  // Shrink guard (same shape as sync_cloud's): a half-parsed source must not
  // replace a full corpus. Growth is fine; an empty or sharply smaller stage
  // is a build defect.
  const counts = await getPool().query<{ live: string; staged: string }>(
    `SELECT (SELECT count(*) FROM agri_subsidies) AS live,
            (SELECT count(*) FROM agri_subsidies_stage) AS staged`,
  );
  const live = Number(counts.rows[0].live);
  const staged = Number(counts.rows[0].staged);
  if (staged === 0)
    throw new Error("agri stage is empty — refusing to publish");
  if (live > 0 && staged < live * 0.95)
    throw new Error(
      `agri stage would shrink the corpus ${live} → ${staged} (>5%) — refusing to publish`,
    );

  // Publish: DELETE + INSERT…SELECT in ONE transaction. Both take only
  // RowExclusiveLock, which does not conflict with readers' AccessShare —
  // MVCC keeps every concurrent SELECT on the pre-delete snapshot, so the
  // browse never sees an empty or half-loaded table and is never blocked
  // (the TRUNCATE this replaces held AccessExclusive for the whole load: the
  // documented 55P03 / 500s-on-prod shape, reference_stage_merge_reload).
  //
  // NOT a rename swap, deliberately: person_browse_table (120) and
  // company_public_money (127) are MATERIALIZED VIEWS over this table, and a
  // matview follows the table's OID through a rename — the first attempt left
  // both matviews pointing at agri_subsidies_old and the drop refused with
  // 2BP01. Same reason stage_merge.ts's header gives for price_product_days:
  // the live table must keep its identity. The cost is one full-table churn of
  // dead tuples per reload (a few reloads a year; autovacuum absorbs it), and
  // the live indexes absorbing 2.5M incremental inserts — maintenance, not the
  // parallel index BUILD 046's /dev/shm warning is about.
  await withClient(async (c) => {
    await c.query("BEGIN");
    await c.query("DELETE FROM agri_subsidies");
    await c.query(
      `INSERT INTO agri_subsidies (id, ${COLS.join(", ")})
       SELECT id, ${COLS.join(", ")} FROM agri_subsidies_stage`,
    );
    const { rows: par } = await c.query<{ n: string }>(
      "SELECT count(*) AS n FROM agri_subsidies",
    );
    if (Number(par[0].n) !== staged)
      throw new Error(
        `agri publish parity failed: live ${par[0].n} vs staged ${staged}`,
      );
    // "What changed" — atomic with the publish. A yearly bulk load always
    // exceeds the 500-row threshold → one coalesced summary line.
    await recordIngestBatch(c, {
      source: "agri_subsidy",
      table: "agri_subsidies",
      keyExpr:
        "md5(t.year || '|' || coalesce(t.eik, t.name) || '|' || coalesce(t.oblast,'') || '|' || coalesce(t.scheme,'') || '|' || coalesce(t.total_eur::text,''))",
      nameExpr: "t.name",
      detailExpr: "t.scheme_desc",
      amountExpr: "t.total_eur::double precision",
      rowsTotal,
    });
    await c.query("COMMIT");
  });
  await exec("DROP TABLE IF EXISTS agri_subsidies_stage");

  // ── precomputed payloads → agri_payloads (jsonb in PG, not on disk) ──────────
  const payloadRows: { kind: string; key: string; text: string }[] = [];
  for (const rec of recipients.values()) {
    // No per-recipient payload for the payer/state-intervention EIKs — their
    // "subsidies" are ДФЗ's own техническа помощ / публично складиране, not farm
    // money received, so they must not surface a "Земеделски субсидии" tile on
    // /company/:eik or a /farm/:eik page. (Already excluded from the analytics.)
    if (PAYER_EIKS.has(rec.eik)) continue;
    const byYear = [...rec.byYear.entries()]
      .map(([year, totalEur]) => ({ year, totalEur: round2(totalEur) }))
      .sort((a, b) => a.year - b.year);
    const byScheme = [...rec.byScheme.entries()]
      .map(([scheme, totalEur]) => ({
        scheme,
        desc: schemeDescr.get(scheme),
        totalEur: round2(totalEur),
      }))
      .sort((a, b) => b.totalEur - a.totalEur);
    payloadRows.push({
      kind: "recipient",
      key: rec.eik,
      text: JSON.stringify({
        eik: rec.eik,
        name: rec.name,
        oblast: rec.oblast,
        totalEur: round2(rec.totalEur),
        dpEur: round2(rec.dpEur),
        marketEur: round2(rec.marketEur),
        ruralEur: round2(rec.ruralEur),
        paymentCount: rec.paymentCount,
        firstYear: byYear[0]?.year ?? latestYear,
        lastYear: byYear[byYear.length - 1]?.year ?? latestYear,
        byYear,
        byScheme,
      }),
    });
  }

  // Overview payload for one scope (a single financial year, or all years).
  // The dashboard's Обхват selector fetches by scope key ('2023' / 'all'), so
  // every KPI, the concentration curve, the scheme + oblast splits and the top
  // recipients re-anchor to that scope. `years` + `totalsByYear` are shared
  // across payloads (they drive the selector and the always-on year trend).
  const sharedYears = totalsByYear.map((t) => t.year);
  const buildOverview = (
    scope: string,
    scopeYear: number | null,
    ws: YearWS,
  ) => {
    const entPairs = [...ws.entityTotals.entries()].filter(
      ([e]) => !PAYER_EIKS.has(e),
    );
    const entTotals = entPairs.map(([, v]) => v).sort((a, b) => b - a);
    const entityEur = entTotals.reduce((a, b) => a + b, 0);
    const cum = (n: number) => entTotals.slice(0, n).reduce((a, b) => a + b, 0);
    const share = (v: number) =>
      entityEur > 0 ? round2((v / entityEur) * 100) : 0;
    const asc = [...entTotals].sort((a, b) => a - b);
    const lorenz: { x: number; y: number }[] = [{ x: 0, y: 0 }];
    const STEPS = 25;
    for (let i = 1; i <= STEPS; i++) {
      const upto = Math.round((asc.length * i) / STEPS);
      const running = asc.slice(0, upto).reduce((a, b) => a + b, 0);
      lorenz.push({
        x: round2((i / STEPS) * 100),
        y: entityEur > 0 ? round2((running / entityEur) * 100) : 0,
      });
    }
    const topScheme = [...ws.byScheme.entries()].sort((a, b) => b[1] - a[1])[0];
    const schemeTotal = [...ws.byScheme.values()].reduce((a, b) => a + b, 0);
    const byScheme = [...ws.byScheme.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([scheme, totalEur]) => ({
        scheme,
        desc: schemeDescr.get(scheme) ?? scheme,
        totalEur: round2(totalEur),
        share: schemeTotal > 0 ? round2((totalEur / schemeTotal) * 100) : 0,
      }));
    const oblastTotal = [...ws.byOblast.values()].reduce((a, b) => a + b, 0);
    const byOblast = [...ws.byOblast.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([oblast, totalEur]) => ({
        oblast,
        totalEur: round2(totalEur),
        share: oblastTotal > 0 ? round2((totalEur / oblastTotal) * 100) : 0,
      }));
    // Top recipients ranked by THIS scope's totals (that year's payments, or
    // all-time for 'all'); identity/history from the all-time recipient rollup.
    const topRecipients = entPairs
      .sort((a, b) => b[1] - a[1])
      .slice(0, 60)
      .map(([eik, total]) => {
        const rec = recipients.get(eik);
        const yrs = rec ? [...rec.byYear.keys()].sort((a, b) => a - b) : [];
        return {
          eik,
          name: rec?.name ?? eik,
          oblast: rec?.oblast ?? "",
          totalEur: round2(total),
          firstYear: yrs[0] ?? scopeYear ?? latestYear,
          lastYear: yrs[yrs.length - 1] ?? scopeYear ?? latestYear,
          yearCount: yrs.length,
        };
      });
    return {
      generatedFrom: "data.egov.bg org 56 — ДФ „Земеделие“",
      bgnPerEur: BGN_PER_EUR,
      scope,
      scopeYear,
      years: sharedYears,
      latestYear,
      headline: {
        totalEur: round2(ws.total),
        entityEur: round2(ws.entityEur),
        individualEur: round2(ws.individualEur),
        entityCount: ws.entityCount,
        individualCount: ws.individualCount,
        topScheme: topScheme
          ? { scheme: topScheme[0], totalEur: round2(topScheme[1]) }
          : null,
      },
      totalsByYear,
      byScheme,
      byOblast,
      concentration: {
        year: scopeYear,
        scope,
        basis: "legal-entities",
        entityCount: entTotals.length,
        entityEur: round2(entityEur),
        top1Share: share(cum(1)),
        top10Share: share(cum(10)),
        top100Share: share(cum(100)),
        top1000Share: share(cum(1000)),
        lorenz,
      },
      topRecipients,
    };
  };

  // Per-year overview payloads (key = the year), keyed so ?fy=<year> resolves.
  for (const [year, ws] of perYear)
    payloadRows.push({
      kind: "overview",
      key: String(year),
      text: JSON.stringify(buildOverview(String(year), year, ws)),
    });
  // All-years aggregate (?fy=all): scheme/oblast summed, concentration + top
  // recipients over all-time per-EIK totals.
  const allEntityTotals = new Map<string, number>();
  for (const rec of recipients.values())
    allEntityTotals.set(rec.eik, rec.totalEur);
  const allWS: YearWS = {
    total: totalsByYear.reduce((a, t) => a + t.totalEur, 0),
    entityEur: allEntityEur,
    individualEur: allIndividualEur,
    entityCount: countEntities(recipients),
    individualCount: allIndividuals.size,
    byScheme: allByScheme,
    byOblast: allByOblast,
    entityTotals: allEntityTotals,
  };
  payloadRows.push({
    kind: "overview",
    key: "all",
    text: JSON.stringify(buildOverview("all", null, allWS)),
  });
  // Default view (no ?fy) = the latest financial year.
  const latestWS = perYear.get(latestYear);
  if (latestWS)
    payloadRows.push({
      kind: "overview",
      key: "",
      text: JSON.stringify(
        buildOverview(String(latestYear), latestYear, latestWS),
      ),
    });

  // agri_payloads has a natural PK (kind, key), so it takes the standard
  // stage-merge shape: build the twin, merge under RowExclusiveLock, readers
  // never blocked (scripts/db/lib/stage_merge.ts).
  const payloadSpec: StageMergeSpec = {
    table: "agri_payloads",
    source: "agri_payloads_stage",
    keys: ["kind", "key"],
    cols: ["kind", "key", "payload"],
  };
  await withClient(async (c) => {
    await createStageTable(c, payloadSpec);
    await insertPayloads(c, payloadRows);
    await addStagePrimaryKey(c, payloadSpec);
    await c.query("BEGIN");
    await mergeFromStage(c, payloadSpec);
    await c.query("COMMIT");
    await c.query("DROP TABLE IF EXISTS agri_payloads_stage");
  });

  // The beneficiary dimension behind the /subsidies search typeahead. It MUST
  // be refreshed here, after the corpus commits, and it is the one object in
  // 046 that a re-apply cannot repair: `CREATE MATERIALIZED VIEW IF NOT EXISTS`
  // runs at the TOP of this function, three statements before the stage build,
  // so on a cold database it is created from an EMPTY agri_subsidies and stays
  // empty for ever — the search would answer "no matches" for all 16.7k
  // beneficiaries with nothing failing anywhere.
  await withClient(async (c) => {
    await c.query("REFRESH MATERIALIZED VIEW agri_beneficiary");
    const { rows } = await c.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM agri_beneficiary",
    );
    console.log(`  agri_beneficiary refreshed → ${rows[0].n} beneficiaries`);
  });

  console.log(
    `\nloaded → Postgres: ${rowsTotal} agri rows + ${payloadRows.length} payloads (${recipients.size} recipients across ${totalsByYear.length} years)`,
  );
  await end();
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runAgriIngest({ offline: false }).catch(async (e) => {
    console.error(e);
    await end();
    process.exit(1);
  });
}
