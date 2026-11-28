// Load the vaccines corpus into migration 206.
//
//   pnpm run db:load:vaccines:pg
//   pnpm run db:load:vaccines:pg:cloud
//
// TWO HALVES, and only one of them is always there.
//
// COMMITTED (data/health/vaccines/) — always loads, on a fresh clone too:
//   his_daily.jsonl       → his_immunization_daily (SCD-2 runs)
//   shortage_weeks.jsonl  → ial_shortage_week
//   flu_weeks.jsonl       → flu_incidence_week + flu_virology_week
//   season_plan.json / season_events.json / tender_doses.json → the curated tables
//
// CACHED (raw_data/health/vaccines/, gitignored) — skip-and-warn when absent, and an
// absent file never touches the rows already loaded:
//   his_monthly.json      → his_immunization_month   (re-fetchable: the source keeps history)
//   trade.json            → vaccine_trade_month
//   flu_coverage_eu.json  → flu_coverage_eu
// Write them with `pnpm run vaccines:snapshot --only infoapp,eurostat`.
//
// Shapes, per table:
//   - the monthly set, trade, coverage and the daily runs are full rebuilds of their
//     source, so they STAGE-MERGE (readers keep the previous vintage until COMMIT) and
//     refuse a shrink beyond 5% (`--allow-shrink` overrides) — an anti-join delete on a
//     half-empty build is otherwise a quiet wipe;
//   - the shortage list replaces a window's rows only for the windows the snapshot
//     holds (its latest capture of each), and never deletes a window;
//   - the НЦЗПБ weeks are UPSERT-ONLY: the source shows two weeks, our JSONL is the
//     only history, and nothing here may delete from it.
//
// Refusals that keep a wrong number off the page:
//   - an НЗИС vaccine label not classified in vaccine_dim.ts;
//   - an oblast that is not one of the 28 in place_dim (or place_dim not loaded);
//   - a closed year whose monthly cells disagree with the report page's own
//     by-vaccine totals by more than 0.1% (the report page is captured daily into
//     his_daily.jsonl, closed years included).
//
// Changelog: ONE batch, on the monthly set, keyed per (month, vaccine) — a key per
// cell would put 110k rows into ingest_first_seen on the first load.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { PoolClient } from "pg";
import { allRows, end, exec, vacuumAfterReload, withTx } from "./lib/pg";
import { copyRows } from "./lib/copy";
import { recordIngestBatch } from "./lib/ingest_changelog";
import {
  createStageTable,
  addStagePrimaryKey,
  mergeChainFromStage,
  mergeFromStage,
  stageUpsertSql,
  type StageMergeSpec,
} from "./lib/stage_merge";
import {
  CACHE_DIR,
  CACHE_FILES,
  FILES,
  SNAPSHOT_DIR,
  readJsonl,
  type DailyLine,
  type FluLine,
  type ShortageLine,
} from "../health/vaccines/snapshot";
import type { HisImmunizationRow } from "../health/vaccines/his_infoapp";
import { NCIPD_AGE_BANDS } from "../health/vaccines/sources";
import {
  HIS_OBLASTS,
  NCIPD_AREA_OVERRIDES,
  VACCINE_DIM,
  oblastCodeFor,
  oblastCodeForIso,
  vaccineByLabel,
} from "../health/vaccines/vaccine_dim";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(here, "..", "..");
const SCHEMA_DIR = path.join(here, "schema", "pg");
const snap = (f: string) => path.join(REPO, SNAPSHOT_DIR, f);
const cache = (f: string) => path.join(REPO, CACHE_DIR, f);

/** Above this fall in row count a full-rebuild merge refuses. */
export const MAX_SHRINK = 0.05;
/** Closed-year tolerance, monthly cells against the report page. */
export const RECONCILE_TOLERANCE = 0.001;

// ------------------------------------------------------------------ pure parts

export interface DailyRun {
  year: number;
  scope: "vaccine" | "oblast";
  key: string;
  valid_from: string;
  valid_to: string | null;
  n_ytd: number;
  as_of: string | null;
}

/** Each JSONL line is a value the counter took (the writer appends only on a
 *  change), so a run lasts from its capture until the next capture of the same
 *  counter. Keys are mapped to vaccine_code / place_dim code here. */
export const buildDailyRuns = (lines: DailyLine[]): DailyRun[] => {
  const groups = new Map<string, DailyRun[]>();
  for (const l of lines) {
    const scope = l.scope === "vaccine" ? "vaccine" : "oblast";
    const key =
      l.scope === "vaccine"
        ? vaccineByLabel(l.key).code
        : oblastCodeForIso(l.key);
    const g = `${l.year}|${scope}|${key}`;
    const run: DailyRun = {
      year: l.year,
      scope,
      key,
      valid_from: l.fetched_at,
      valid_to: null,
      n_ytd: l.n_ytd,
      as_of: l.updated_at || null,
    };
    const list = groups.get(g);
    if (list) list.push(run);
    else groups.set(g, [run]);
  }
  const out: DailyRun[] = [];
  for (const runs of groups.values()) {
    runs.sort((a, b) => a.valid_from.localeCompare(b.valid_from));
    runs.forEach((r, i) => {
      const next = runs[i + 1];
      out.push(next ? { ...r, valid_to: next.valid_from } : r);
    });
  }
  return out;
};

/** The latest capture of each key — the JSONLs keep every capture so a revision
 *  stays visible in git, and the table holds what the source says now. */
export const latestBy = <T extends { fetched_at: string }>(
  rows: T[],
  key: (r: T) => string,
): T[] => {
  const best = new Map<string, T>();
  for (const r of rows) {
    const k = key(r);
    const prev = best.get(k);
    if (!prev || r.fetched_at > prev.fetched_at) best.set(k, r);
  }
  return [...best.values()];
};

/** A window's rows as of its latest capture (the writer appends the whole list
 *  whenever it changed, so a dropped product is absent from the latest one). */
export const latestShortageLists = (lines: ShortageLine[]): ShortageLine[] => {
  const latestAt = new Map<string, string>();
  for (const l of lines)
    if ((latestAt.get(l.valid_from) ?? "") < l.fetched_at)
      latestAt.set(l.valid_from, l.fetched_at);
  return lines.filter((l) => latestAt.get(l.valid_from) === l.fetched_at);
};

export interface IncidenceRow {
  week_start: string;
  week_end: string;
  iso_week: number;
  oblast_code: string;
  age_band: string;
  served: number;
  cases: number;
  rate_per_10k: number;
  fetched_at: string;
}

/** One row per НЦЗПБ age band plus 'all'; the arrays carry the five bands then
 *  the all-ages total. `areaCode` maps the Bulgarian area name. */
export const expandIncidence = (
  lines: FluLine[],
  areaCode: (area: string) => string,
): IncidenceRow[] => {
  const bands = [...NCIPD_AGE_BANDS, "all"];
  const inc = lines.flatMap((l) => (l.kind === "incidence" ? [l] : []));
  return latestBy(inc, (l) => `${l.week_start}|${l.area}`).flatMap((l) => {
    for (const arr of [l.served, l.cases, l.rate])
      if (arr.length !== bands.length)
        throw new Error(
          `НЦЗПБ ${l.week_start} ${l.area}: ${arr.length} values, expected ${bands.length}`,
        );
    const code = areaCode(l.area);
    return bands.map((band, i) => ({
      week_start: l.week_start,
      week_end: l.week_end,
      iso_week: l.iso_week,
      oblast_code: code,
      age_band: band,
      served: l.served[i],
      cases: l.cases[i],
      rate_per_10k: l.rate[i],
      fetched_at: l.fetched_at,
    }));
  });
};

/** Refuse a full rebuild that would shrink a populated table beyond MAX_SHRINK. */
export const shrinkRefusal = (
  table: string,
  live: number,
  staged: number,
): string | null =>
  live > 0 && staged < live * (1 - MAX_SHRINK)
    ? `${table}: the build has ${staged} rows against ${live} live (−${(((live - staged) / live) * 100).toFixed(1)}%) — refusing; pass --allow-shrink if the source really shrank`
    : null;

export interface ReconcileResult {
  checked: number[];
  unchecked: number[];
  failures: string[];
}

/** Every closed year in the monthly set must equal the report page's own
 *  by-vaccine totals (the page is captured into his_daily.jsonl). A year with no
 *  captured page is reported as unchecked, never as passing. */
export const reconcileClosedYears = (
  monthly: Array<{ year: number; vaccine: string; n: number }>,
  daily: DailyLine[],
  currentYear: number,
): ReconcileResult => {
  const monthTotals = new Map<number, Map<string, number>>();
  for (const r of monthly) {
    if (r.year >= currentYear) continue;
    const m = monthTotals.get(r.year) ?? new Map<string, number>();
    m.set(r.vaccine, (m.get(r.vaccine) ?? 0) + r.n);
    monthTotals.set(r.year, m);
  }
  const page = new Map<number, Map<string, number>>();
  for (const l of latestBy(
    daily.filter((d) => d.scope === "vaccine"),
    (d) => `${d.year}|${d.key}`,
  )) {
    const m = page.get(l.year) ?? new Map<string, number>();
    m.set(l.key, l.n_ytd);
    page.set(l.year, m);
  }
  const res: ReconcileResult = { checked: [], unchecked: [], failures: [] };
  for (const [year, months] of [...monthTotals].sort((a, b) => a[0] - b[0])) {
    const p = page.get(year);
    if (!p) {
      res.unchecked.push(year);
      continue;
    }
    res.checked.push(year);
    for (const label of new Set([...months.keys(), ...p.keys()])) {
      // "Other" exists only in the info-app; the report page has no such row.
      if (label === "Other") continue;
      const a = p.get(label) ?? 0;
      const b = months.get(label) ?? 0;
      if (Math.abs(a - b) > Math.max(2, a * RECONCILE_TOLERANCE))
        res.failures.push(
          `${year} ${label}: report page ${a}, monthly cells ${b}`,
        );
    }
  }
  return res;
};

// ------------------------------------------------------------------ the load

const spec = (
  table: string,
  keys: string[],
  cols: string[],
): StageMergeSpec => ({
  table,
  source: `${table}_stage`,
  keys,
  cols,
});

const SPECS = {
  dim: spec(
    "his_vaccine_dim",
    ["vaccine_code"],
    ["vaccine_code", "label_en", "label_bg", "family"],
  ),
  month: spec(
    "his_immunization_month",
    ["period", "oblast_code", "age_band", "sex", "vaccine_code"],
    [
      "period",
      "oblast_code",
      "age_band",
      "age_order",
      "sex",
      "vaccine_code",
      "n",
      "unique_patients",
      "population",
    ],
  ),
  daily: spec(
    "his_immunization_daily",
    ["year", "scope", "key", "valid_from"],
    ["year", "scope", "key", "valid_from", "valid_to", "n_ytd", "as_of"],
  ),
  shortage: spec(
    "ial_shortage_week",
    ["valid_from", "ncpr_code"],
    [
      "valid_from",
      "valid_to",
      "ncpr_code",
      "name",
      "inn",
      "strength",
      "unit",
      "form",
      "pack",
      "is_vaccine",
      "fetched_at",
    ],
  ),
  incidence: spec(
    "flu_incidence_week",
    ["week_start", "oblast_code", "age_band"],
    [
      "week_start",
      "week_end",
      "iso_week",
      "oblast_code",
      "age_band",
      "served",
      "cases",
      "rate_per_10k",
      "fetched_at",
    ],
  ),
  virology: spec(
    "flu_virology_week",
    ["week_start"],
    [
      "week_start",
      "week_end",
      "iso_week",
      "tested",
      "a_h1n1",
      "a_h3n2",
      "a_h1n1pdm09",
      "b_victoria",
      "b_yamagata",
      "fetched_at",
    ],
  ),
  trade: spec(
    "vaccine_trade_month",
    ["period", "flow", "product", "partner"],
    ["period", "flow", "product", "partner", "value_eur", "quantity_100kg"],
  ),
  coverage: spec("flu_coverage_eu", ["geo", "year"], ["geo", "year", "pct"]),
  plan: spec(
    "vaccine_season_plan",
    ["id"],
    [
      "id",
      "season",
      "channel",
      "doses",
      "doses_qualifier",
      "scope",
      "basis",
      "within_channel",
      "source",
      "source_url",
      "source_date",
      "superseded_by",
    ],
  ),
  event: spec(
    "vaccine_season_event",
    ["event_date", "source_url", "kind"],
    ["season", "event_date", "kind", "text_bg", "text_en", "source_url"],
  ),
  tender: spec(
    "vaccine_tender_dose",
    ["unp", "lot_id"],
    ["unp", "lot_id", "doses", "source_url"],
  ),
} satisfies Record<string, StageMergeSpec>;

export const VACCINE_TABLES = [
  ...Object.values(SPECS).map((s) => s.table),
  "vaccine_source_asof",
];

/** Build a stage table from rows (array order = spec.cols), PK checked. */
const stage = async (
  c: PoolClient,
  s: StageMergeSpec,
  rows: unknown[][],
): Promise<number> => {
  await createStageTable(c, s);
  await copyRows(c, s.source, s.cols, rows);
  await addStagePrimaryKey(c, s);
  return rows.length;
};

const count = async (c: PoolClient, table: string): Promise<number> => {
  const { rows } = await c.query<{ n: string }>(
    `SELECT count(*)::text n FROM ${table}`,
  );
  return Number(rows[0].n);
};

const guardShrink = async (
  c: PoolClient,
  s: StageMergeSpec,
  staged: number,
  allowShrink: boolean,
): Promise<void> => {
  const refusal = shrinkRefusal(s.table, await count(c, s.table), staged);
  if (refusal && !allowShrink) throw new Error(refusal);
  if (refusal) console.warn(`⚠ ${refusal} (overridden)`);
};

const readJson = <T>(file: string): T =>
  JSON.parse(readFileSync(file, "utf8")) as T;

const maxOf = (xs: string[]): string | null =>
  xs.reduce<string | null>((m, x) => (m === null || x > m ? x : m), null);

interface Curated<T> {
  rows: T[];
}
interface PlanRow {
  id: string;
  season: number;
  channel: string;
  doses: number;
  doses_qualifier?: string;
  scope?: string;
  basis: string;
  within?: string;
  source: string;
  source_url: string;
  source_date: string;
  superseded_by: string | null;
}
interface EventRow {
  season: number;
  event_date: string;
  kind: string;
  text_bg: string;
  text_en: string;
  source_url: string;
}
interface TenderRow {
  unp: string;
  lot_id: string;
  doses: number;
  source_url: string;
}
interface MonthlyCache {
  fetched_at: string;
  rows: HisImmunizationRow[];
}
interface TradeCache {
  updated: string;
  rows: Array<{
    period: string;
    flow: string;
    product: string;
    partner: string;
    valueEur: number;
    quantity100kg: number | null;
  }>;
}
interface CoverageCache {
  updated: string;
  rows: Array<{ geo: string; year: number; pct: number }>;
}

const main = async (): Promise<void> => {
  const allowShrink = process.argv.includes("--allow-shrink");

  for (const f of ["005_ingest_tracking.sql", "206_vaccines.sql"])
    await exec(readFileSync(path.join(SCHEMA_DIR, f), "utf8"));

  const placeRows = await allRows<{ code: string; name_bg: string }>(
    `SELECT code, name_bg FROM place_dim WHERE kind = 'oblast'`,
  ).catch((e: unknown) => {
    throw new Error(
      `place_dim is not readable (${e instanceof Error ? e.message : String(e)}) — run db:load:place-dim:pg first`,
    );
  });
  const oblastCodes = new Set(placeRows.map((r) => r.code));
  const missing = HIS_OBLASTS.filter((o) => !oblastCodes.has(o.code));
  if (missing.length)
    throw new Error(
      `place_dim lacks ${missing.length} of 28 oblasts (${missing.map((o) => o.code).join(", ")}) — run db:load:place-dim:pg first`,
    );
  const byNameBg = new Map(placeRows.map((r) => [r.name_bg, r.code]));
  const areaCode = (area: string): string => {
    const code = NCIPD_AREA_OVERRIDES[area] ?? byNameBg.get(area);
    if (!code)
      throw new Error(
        `НЦЗПБ area ${JSON.stringify(area)} has no place_dim oblast`,
      );
    return code;
  };

  // ---- committed half
  const daily = readJsonl<DailyLine>(snap(FILES.daily));
  const shortage = readJsonl<ShortageLine>(snap(FILES.shortage));
  const flu = readJsonl<FluLine>(snap(FILES.flu));
  const plan = readJson<Curated<PlanRow>>(snap("season_plan.json")).rows;
  const events = readJson<Curated<EventRow>>(snap("season_events.json")).rows;
  const tenders = readJson<Curated<TenderRow>>(snap("tender_doses.json")).rows;

  const runs = buildDailyRuns(daily);
  const shortageRows = latestShortageLists(shortage);
  const incidence = expandIncidence(flu, areaCode);
  const virology = latestBy(
    flu.flatMap((l) => (l.kind === "virology" ? [l] : [])),
    (l) => l.week_start,
  );

  // ---- cached half
  const monthlyFile = cache(CACHE_FILES.infoapp);
  const tradeFile = cache(CACHE_FILES.trade);
  const coverageFile = cache(CACHE_FILES.coverage);
  const monthly = existsSync(monthlyFile)
    ? readJson<MonthlyCache>(monthlyFile)
    : null;
  const trade = existsSync(tradeFile) ? readJson<TradeCache>(tradeFile) : null;
  const coverage = existsSync(coverageFile)
    ? readJson<CoverageCache>(coverageFile)
    : null;
  for (const [f, v] of [
    [monthlyFile, monthly],
    [tradeFile, trade],
    [coverageFile, coverage],
  ] as const)
    if (!v)
      console.warn(
        `⚠ ${path.relative(REPO, f)} absent — that table keeps what it holds. ` +
          `Run \`pnpm run vaccines:snapshot --only infoapp,eurostat\` to fill it.`,
      );

  // A refusal on the monthly cache keeps that table's previous vintage but
  // does not block the committed half; the step still exits non-zero.
  let monthRows: unknown[][] = [];
  let monthlyRefusal: string | null = null;
  // The changelog counts (month, vaccine) keys, so its total must too.
  let monthKeys = 0;
  if (monthly && !monthly.rows.length)
    monthlyRefusal = "his_monthly.json has no rows";
  else if (monthly) {
    const seen = new Set<string>();
    const keys = new Set<string>();
    monthRows = monthly.rows.map((r) => {
      const oblast = oblastCodeFor(r.oblastKey, r.region);
      seen.add(oblast);
      keys.add(`${r.period}|${r.vaccine}`);
      return [
        `${r.period}-01`,
        oblast,
        r.ageBand,
        r.ageOrder,
        r.sex,
        vaccineByLabel(r.vaccine).code,
        r.n,
        r.uniquePatients,
        r.population,
      ];
    });
    monthKeys = keys.size;
    if (seen.size !== HIS_OBLASTS.length)
      monthlyRefusal = `his_monthly.json covers ${seen.size} of ${HIS_OBLASTS.length} oblasts`;
    const rec = reconcileClosedYears(
      monthly.rows.map((r) => ({
        year: Number(r.period.slice(0, 4)),
        vaccine: r.vaccine,
        n: r.n,
      })),
      daily,
      new Date().getUTCFullYear(),
    );
    if (rec.failures.length)
      monthlyRefusal ??= `closed-year reconciliation failed (tolerance ${RECONCILE_TOLERANCE * 100}%):\n  ${rec.failures.join("\n  ")}`;
    else
      console.log(
        `  reconciled against the report page: ${rec.checked.join(", ") || "none"}` +
          (rec.unchecked.length
            ? ` · no captured page (unchecked): ${rec.unchecked.join(", ")}`
            : ""),
      );
  }

  const asof: Array<[string, string | null]> = [
    ["his_daily", maxOf(daily.map((d) => d.fetched_at))],
    ["ial_shortage", maxOf(shortage.map((d) => d.fetched_at))],
    ["ncipd_flu", maxOf(flu.map((d) => d.fetched_at))],
    ["season_plan", maxOf(plan.map((d) => d.source_date))],
    ["his_monthly", monthlyRefusal ? null : (monthly?.fetched_at ?? null)],
    ["eurostat_trade", trade?.updated ?? null],
    ["eurostat_coverage", coverage?.updated ?? null],
  ];

  const planIds = new Set(plan.map((p) => p.id));
  const dangling = plan.filter(
    (p) => p.superseded_by && !planIds.has(p.superseded_by),
  );
  if (dangling.length)
    throw new Error(
      `season_plan.json: superseded_by points to no plan id: ${dangling.map((p) => p.id).join(", ")}`,
    );

  const summary: string[] = [];
  await withTx(async (c) => {
    // Dimension + monthly cells as one FK chain: upserts parent → child,
    // deletes child → parent.
    await stage(
      c,
      SPECS.dim,
      VACCINE_DIM.map((v) => [v.code, v.labelEn, v.labelBg, v.family]),
    );
    if (monthly && !monthlyRefusal) {
      await stage(c, SPECS.month, monthRows);
      await guardShrink(c, SPECS.month, monthRows.length, allowShrink);
      await mergeChainFromStage(c, [SPECS.dim, SPECS.month]);
      const ch = await recordIngestBatch(c, {
        source: "his_immunization",
        table:
          "(SELECT DISTINCT period, vaccine_code FROM his_immunization_month)",
        keyExpr: "to_char(t.period, 'YYYY-MM') || '|' || t.vaccine_code",
        rowsTotal: monthKeys,
      });
      summary.push(
        `his_immunization_month=${monthRows.length} (changelog +${ch.rowsNew} month×vaccine, ${ch.mode})`,
      );
    } else {
      // Upsert only: the monthly cells still reference every live code.
      await c.query(stageUpsertSql(SPECS.dim));
    }

    await stage(
      c,
      SPECS.daily,
      runs.map((r) => [
        r.year,
        r.scope,
        r.key,
        r.valid_from,
        r.valid_to,
        r.n_ytd,
        r.as_of,
      ]),
    );
    await guardShrink(c, SPECS.daily, runs.length, allowShrink);
    await mergeFromStage(c, SPECS.daily);
    summary.push(`his_immunization_daily=${runs.length} runs`);

    // Shortage: replace only the windows the snapshot holds.
    await stage(
      c,
      SPECS.shortage,
      shortageRows.map((r) => [
        r.valid_from,
        r.valid_to,
        r.ncpr_code,
        r.name,
        r.inn,
        r.strength,
        r.unit,
        r.form,
        r.pack,
        r.is_vaccine,
        r.fetched_at,
      ]),
    );
    await c.query(stageUpsertSql(SPECS.shortage));
    await c.query(
      `DELETE FROM ial_shortage_week t
        WHERE t.valid_from IN (SELECT DISTINCT valid_from FROM ial_shortage_week_stage)
          AND NOT EXISTS (SELECT 1 FROM ial_shortage_week_stage s
                           WHERE s.valid_from = t.valid_from
                             AND s.ncpr_code = t.ncpr_code)`,
    );
    summary.push(`ial_shortage_week=${shortageRows.length}`);

    // НЦЗПБ: upsert-only — our JSONL is the only history the source leaves.
    await stage(
      c,
      SPECS.incidence,
      incidence.map((r) => [
        r.week_start,
        r.week_end,
        r.iso_week,
        r.oblast_code,
        r.age_band,
        r.served,
        r.cases,
        r.rate_per_10k,
        r.fetched_at,
      ]),
    );
    await c.query(stageUpsertSql(SPECS.incidence));
    await stage(
      c,
      SPECS.virology,
      virology.map((r) => [
        r.week_start,
        r.week_end,
        r.iso_week,
        r.tested,
        r.a_h1n1,
        r.a_h3n2,
        r.a_h1n1pdm09,
        r.b_victoria,
        r.b_yamagata,
        r.fetched_at,
      ]),
    );
    await c.query(stageUpsertSql(SPECS.virology));
    summary.push(
      `flu_incidence_week=${incidence.length} flu_virology_week=${virology.length}`,
    );

    if (trade) {
      const rows = trade.rows.map((r) => [
        `${r.period}-01`,
        r.flow,
        r.product,
        r.partner,
        r.valueEur,
        r.quantity100kg,
      ]);
      await stage(c, SPECS.trade, rows);
      await guardShrink(c, SPECS.trade, rows.length, allowShrink);
      await mergeFromStage(c, SPECS.trade);
      summary.push(`vaccine_trade_month=${rows.length}`);
    }
    if (coverage) {
      const rows = coverage.rows.map((r) => [r.geo, r.year, r.pct]);
      await stage(c, SPECS.coverage, rows);
      await guardShrink(c, SPECS.coverage, rows.length, allowShrink);
      await mergeFromStage(c, SPECS.coverage);
      summary.push(`flu_coverage_eu=${rows.length}`);
    }

    // Curated: the committed files are authoritative, supersession lives in them.
    await stage(
      c,
      SPECS.plan,
      plan.map((r) => [
        r.id,
        r.season,
        r.channel,
        r.doses,
        r.doses_qualifier ?? null,
        r.scope ?? null,
        r.basis,
        r.within ?? null,
        r.source,
        r.source_url,
        r.source_date,
        r.superseded_by,
      ]),
    );
    await mergeFromStage(c, SPECS.plan);
    await stage(
      c,
      SPECS.event,
      events.map((r) => [
        r.season,
        r.event_date,
        r.kind,
        r.text_bg,
        r.text_en,
        r.source_url,
      ]),
    );
    await mergeFromStage(c, SPECS.event);
    await stage(
      c,
      SPECS.tender,
      tenders.map((r) => [r.unp, r.lot_id, r.doses, r.source_url]),
    );
    await mergeFromStage(c, SPECS.tender);
    summary.push(
      `season_plan=${plan.length} events=${events.length} tender_doses=${tenders.length}`,
    );

    for (const [source, value] of asof)
      if (value)
        await c.query(
          `INSERT INTO vaccine_source_asof (source, as_of, loaded_at)
           VALUES ($1, $2, now())
           ON CONFLICT (source) DO UPDATE SET as_of = EXCLUDED.as_of, loaded_at = now()`,
          [source, value],
        );

    for (const s of Object.values(SPECS))
      await c.query(`DROP TABLE IF EXISTS ${s.source}`);
  });

  await vacuumAfterReload(...VACCINE_TABLES);
  console.log(`✓ vaccines: ${summary.join(" · ")}`);
  await end();
  if (monthlyRefusal)
    throw new Error(
      `his_immunization_month kept its previous vintage: ${monthlyRefusal}`,
    );
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  main().catch(async (e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    await end().catch(() => {});
    process.exit(1);
  });
