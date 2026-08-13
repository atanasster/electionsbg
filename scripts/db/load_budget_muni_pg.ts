// Load the municipal corpus — WHAT THE STATE SENDS — into Postgres (154).
//
//   npm run db:load:budget-muni:pg
//   npm run db:load:budget-muni:pg:cloud
//
// Plan: docs/plans/budget-hub-v1.md T2 and §8.
//
// ── WHY THIS ONE IS *IN* db:refresh, UNLIKE db:load:budget:pg ─────────────
//
// Every input is COMMITTED — measured, `git ls-files` returns 47/47 for
// municipal_transfers, 112/112 for capital_programs, 265/265 for ipop and 17/17
// for municipal_execution. So this is a pure load that works on a fresh clone
// with no network and no operator action, which is exactly the shape that
// belongs in the chain. Its sibling `db:load:budget:pg` is excluded on the
// uncommitted-input axis; sorting either one onto the other's side is the
// mis-sorting `db-refresh-loader-gaps-v1` §1a records.
//
// ── THE BOUNDARY ─────────────────────────────────────────────────────────
//
// This loader NEVER touches `municipal_fiscal` (149). That corpus is what
// municipalities OWE; this one is what the state SENDS. They are adjacent and
// never combined — see 154's header for the full statement of the rule.
//
// ── SKIP-AND-WARN vs THROW ───────────────────────────────────────────────
//
// The inputs are tracked, so absence is a DEFECT rather than the fresh-clone
// state: every read here is required and throws. That is the opposite of
// db:load:budget:pg, whose admin grain is gitignored — and the difference is
// the whole reason the two loaders are separate files.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  allRows,
  exec,
  withClient,
  withTx,
  end,
  vacuumAfterReload,
} from "./lib/pg";
import { copyRows } from "./lib/copy";
import {
  addStagePrimaryKey,
  createStageTable,
  mergeFromStage,
  type StageMergeSpec,
} from "./lib/stage_merge";
import { recordIngestBatch } from "./lib/ingest_changelog";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "../..");
const DATA = resolve(REPO, "data");
const SCHEMA = resolve(__dirname, "schema/pg/154_budget_municipal.sql");

/** `--allow-shrink` — the escape hatch for a retraction that is genuinely real. */
const ALLOW_SHRINK = process.argv.includes("--allow-shrink");
const SHRINK_FLOOR = 0.95;

/**
 * Source obshtina keys that match NONE of `place_dim`'s three code columns.
 *
 * Sofia, as usual, and it is worth stating why rather than just mapping it.
 * `place_dim` knows Столична община as `SFO_CITY`, with `governance_code`
 * SOF00 and `price_code` SOF46 — three keys, and the Art. 53 corpus uses a
 * fourth, bare `SOF`. The capital-programme shards use none at all: Sofia's
 * four files carry no `municipalityCode` field, so they key off the filename.
 *
 * This is deliberately an explicit alias rather than a slacker placement floor.
 * Sofia is ONE of 265 municipalities, so an unresolved Sofia is 99.6% placed —
 * comfortably above any floor a reasonable person would set, while silently
 * dropping the largest municipality in the country from every municipal
 * surface. The floor cannot catch a single miss; naming it can.
 *
 * There is no collision: `SOF` is Столична alone, and Софийска област's 22
 * municipalities are all `SFO…`.
 */
const OBSHTINA_ALIASES: Record<string, string> = {
  // Art. 53 (municipal_transfers) and the Sofia capital-programme filename.
  SOF: "SFO_CITY",
  sofia: "SFO_CITY",
  // ИПОП uses a THIRD scheme. `SOF22` is Столична (its shard says so: oblast
  // SOF, name „Столична"), and `PDV05` is Пловдив — which place_dim knows as
  // PDV22, a different number entirely rather than a different prefix.
  //
  // These two are the largest and second-largest municipalities in the country,
  // so this is the alias table earning its place twice over: unresolved, Sofia
  // would vanish from ИПОП and Plovdiv from the capital programmes while every
  // ratio stayed comfortably above any floor.
  SOF22: "SFO_CITY",
  PDV05: "PDV22",
};

/** Every obshtina code must resolve. Art. 53 names all 265 municipalities, so
 *  this corpus is complete by construction and ANY unresolved code is a real
 *  loss rather than a residual to tolerate. */
const PLACEMENT_FLOOR = 1;

interface Money {
  amountEur: number | null;
  currency?: string;
}

const readJson = <T>(rel: string): T => {
  const file = resolve(DATA, rel);
  if (!existsSync(file)) {
    throw new Error(
      `${rel} is missing. Every input to this loader is a COMMITTED file, so this is ` +
        "not the fresh-clone case — restore it or run `npm run data -- --all`.",
    );
  }
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch (e) {
    throw new Error(
      `${rel} is present but unparseable: ${(e as Error).message}`,
    );
  }
};

const eur = (m: Money | null | undefined): number | null =>
  m?.amountEur ?? null;
const denom = (m: Money | null | undefined): string | null =>
  m?.currency ?? null;

// ── Shard shapes, narrowed to what this loader reads ──────────────────────

interface TransferMuni {
  obshtinaCode: string;
  ekatte?: string;
  nameBg?: string;
  delegated?: Money | null;
  equalization?: Money | null;
  capital?: Money | null;
  winter?: Money | null;
  otherTargeted?: Money | null;
  total?: Money | null;
}
interface TransferOblastFile {
  oblastCode: string;
  years: Array<{ fiscalYear: number; municipalities: TransferMuni[] }>;
}

interface IpopProject {
  id: string;
  obshtinaCode: string;
  description?: string;
  agreementEur?: number | null;
  submittedEur?: number | null;
  awaitingEur?: number | null;
  paidEur?: number | null;
  mrrbPaidEur?: number | null;
  bbrPaidEur?: number | null;
  paidPct?: number | null;
  stalled?: boolean;
}
interface IpopMuniFile {
  fiscalYear: number;
  obshtinaCode: string;
  projects: IpopProject[];
}

interface CapitalProject {
  id: number;
  name?: string;
  settlement?: string;
  stateSubsidy?: Money | null;
  ownFunds?: Money | null;
  debt?: Money | null;
  euFunds?: Money | null;
  other?: Money | null;
  carryOverCommunity?: Money | null;
  carryOverDelegated?: Money | null;
  total?: Money | null;
}
interface CapitalFile {
  fiscalYear: number;
  municipalityCode: string;
  currency?: string;
  projects: CapitalProject[];
}

interface ExecutionParagraph {
  code?: string;
  name?: string;
  plan?: Money | null;
  actual?: Money | null;
}
/** One side (revenue or expense): a published TOTAL plus its paragraph split. */
interface ExecutionSide {
  plan?: Money | null;
  actual?: Money | null;
  byParagraph?: ExecutionParagraph[];
}
interface ExecutionFile {
  obshtina: string;
  fiscalYear: number;
  currency?: string;
  revenue?: ExecutionSide;
  expense?: ExecutionSide;
}

// ── Stage-merge specs ─────────────────────────────────────────────────────

const TRANSFER: StageMergeSpec = {
  table: "budget_muni_transfer",
  source: "budget_muni_transfer_stage",
  keys: ["obshtina", "fiscal_year"],
  cols: [
    "obshtina",
    "fiscal_year",
    "ekatte",
    "name_bg",
    "delegated_eur",
    "equalization_eur",
    "capital_eur",
    "winter_eur",
    "other_targeted_eur",
    "total_eur",
    "source_denomination",
  ],
};

const IPOP: StageMergeSpec = {
  table: "budget_muni_ipop_project",
  source: "budget_muni_ipop_project_stage",
  keys: ["project_id", "fiscal_year"],
  cols: [
    "project_id",
    "fiscal_year",
    "obshtina",
    "description",
    "agreement_eur",
    "submitted_eur",
    "awaiting_eur",
    "paid_eur",
    "mrrb_paid_eur",
    "bbr_paid_eur",
    "paid_pct",
    "stalled",
  ],
};

const CAPITAL: StageMergeSpec = {
  table: "budget_muni_capital_project",
  source: "budget_muni_capital_project_stage",
  keys: ["obshtina", "fiscal_year", "project_ord"],
  cols: [
    "obshtina",
    "fiscal_year",
    "project_ord",
    "name_bg",
    "settlement",
    "state_subsidy_eur",
    "own_funds_eur",
    "debt_eur",
    "eu_funds_eur",
    "other_eur",
    "carry_over_eur",
    "total_eur",
    "source_denomination",
  ],
};

const EXECUTION: StageMergeSpec = {
  table: "budget_muni_execution",
  source: "budget_muni_execution_stage",
  keys: ["obshtina", "fiscal_year", "kind", "line_code"],
  cols: [
    "obshtina",
    "fiscal_year",
    "kind",
    "line_code",
    "name_bg",
    "planned_eur",
    "executed_eur",
    "source_denomination",
  ],
};

/**
 * Stage-merge one table, REFUSING a build that would shrink it materially.
 *
 * Same reasoning as `load_budget_pg.ts`: `mergeFromStage`'s delete is an
 * unscoped anti-join and its parity guard compares counts AFTER that delete, so
 * an empty stage wipes the table and passes 0 == 0. Here the exposure is
 * different in shape but not in kind — the inputs are committed, so the
 * realistic path is a partially-regenerated tree rather than a missing one.
 */
const merge = async (
  spec: StageMergeSpec,
  rows: unknown[][],
): Promise<void> => {
  const [live] = await allRows<{ n: string }>(
    `SELECT count(*)::text n FROM ${spec.table}`,
  );
  const liveRows = Number(live?.n ?? 0);
  if (!ALLOW_SHRINK && liveRows > 0 && rows.length < liveRows * SHRINK_FLOOR) {
    throw new Error(
      `${spec.table}: the build produced ${rows.length} row(s) against ${liveRows} live — ` +
        "refusing. mergeFromStage's anti-join would DELETE the difference and its parity " +
        "guard would still pass, because it compares counts AFTER the delete. Check the " +
        "shard tree; pass --allow-shrink if the retraction is real.",
    );
  }
  try {
    await withClient(async (c) => {
      await createStageTable(c, spec);
      await copyRows(c, spec.source, spec.cols, rows);
      await addStagePrimaryKey(c, spec);
    });
    await withTx(async (c) => {
      await mergeFromStage(c, spec);
    });
  } finally {
    await exec(`DROP TABLE IF EXISTS ${spec.source}`);
  }
};

// ── Builders ──────────────────────────────────────────────────────────────

const loadTransfers = (place: (raw: string) => string): unknown[][] => {
  const dir = resolve(DATA, "budget/municipal_transfers/oblasts");
  if (!existsSync(dir)) {
    throw new Error(
      "data/budget/municipal_transfers/oblasts/ is missing — it is COMMITTED, so this " +
        "is a defect rather than the fresh-clone case.",
    );
  }
  const rows: unknown[][] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const shard = readJson<TransferOblastFile>(
      `budget/municipal_transfers/oblasts/${file}`,
    );
    for (const y of shard.years ?? []) {
      for (const m of y.municipalities ?? []) {
        rows.push([
          place(m.obshtinaCode),
          y.fiscalYear,
          m.ekatte ?? null,
          m.nameBg ?? null,
          eur(m.delegated),
          eur(m.equalization),
          eur(m.capital),
          eur(m.winter),
          eur(m.otherTargeted),
          eur(m.total),
          denom(m.total),
        ]);
      }
    }
  }
  return rows;
};

const loadIpop = (place: (raw: string) => string): unknown[][] => {
  const dir = resolve(DATA, "budget/ipop/municipalities");
  if (!existsSync(dir)) {
    throw new Error(
      "data/budget/ipop/municipalities/ is missing — it is COMMITTED.",
    );
  }
  const rows: unknown[][] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const shard = readJson<IpopMuniFile>(`budget/ipop/municipalities/${file}`);
    for (const p of shard.projects ?? []) {
      rows.push([
        p.id,
        shard.fiscalYear,
        place(p.obshtinaCode ?? shard.obshtinaCode),
        p.description ?? null,
        p.agreementEur ?? null,
        p.submittedEur ?? null,
        p.awaitingEur ?? null,
        p.paidEur ?? null,
        p.mrrbPaidEur ?? null,
        p.bbrPaidEur ?? null,
        p.paidPct ?? null,
        // МРРБ's own published flag. Never derived from paid_pct: a project that
        // is merely early would then be relabelled as stopped.
        p.stalled === true,
      ]);
    }
  }
  return rows;
};

const loadCapital = (place: (raw: string) => string): unknown[][] => {
  const root = resolve(DATA, "budget/capital_programs");
  if (!existsSync(root)) {
    throw new Error(
      "data/budget/capital_programs/ is missing — it is COMMITTED.",
    );
  }
  const rows: unknown[][] = [];
  for (const year of readdirSync(root).filter((d) => /^\d{4}$/.test(d))) {
    for (const file of readdirSync(resolve(root, year)).filter(
      // `<muni>-tile.json` is a pre-rendered summary for the governance tile,
      // not a project list. Reading it would double-count every programme.
      (f) => f.endsWith(".json") && !f.endsWith("-tile.json"),
    )) {
      const shard = readJson<CapitalFile>(
        `budget/capital_programs/${year}/${file}`,
      );
      // Sofia's four shards carry NO `municipalityCode` — they are the only
      // ones — so the filename stem is the fallback key, resolved through the
      // same alias table (`sofia` → SFO_CITY). Falling back silently to a null
      // code is what made the first run fail the NOT NULL, which is the good
      // outcome: it is a key this loader must not guess at.
      const obshtina = place(
        shard.municipalityCode ?? file.replace(/\.json$/, ""),
      );
      shard.projects?.forEach((p, i) => {
        // The two carry-over lines are one concept split by the source's own
        // accounting; a consumer asking "how much is carried over" wants them
        // together, and keeping them apart here would push that sum into every
        // caller.
        // NULL when NEITHER field was published — `?? 0` would fabricate a
        // carry-over of zero on 13,537 of 13,875 projects, which is the
        // withheld-is-not-a-zero rule this corpus family has already broken
        // once (budget_personnel.nsi_headcount, T1).
        const cc = eur(p.carryOverCommunity);
        const cd = eur(p.carryOverDelegated);
        const carry = cc == null && cd == null ? null : (cc ?? 0) + (cd ?? 0);
        rows.push([
          obshtina,
          shard.fiscalYear,
          // `project_ord` is the SOURCE order, not p.id: ids restart per
          // municipality and are not unique within a year.
          i,
          p.name ?? null,
          p.settlement ?? null,
          eur(p.stateSubsidy),
          eur(p.ownFunds),
          eur(p.debt),
          eur(p.euFunds),
          eur(p.other),
          carry,
          eur(p.total),
          shard.currency ?? null,
        ]);
      });
    }
  }
  return rows;
};

const loadExecution = (place: (raw: string) => string): unknown[][] => {
  const root = resolve(DATA, "budget/municipal_execution");
  if (!existsSync(root)) {
    throw new Error(
      "data/budget/municipal_execution/ is missing — it is COMMITTED.",
    );
  }
  const rows: unknown[][] = [];
  // `withFileTypes`, because this directory holds an `index.json` beside the
  // per-município subdirectories and a plain readdir walks straight into it.
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const muni = entry.name;
    const dir = resolve(root, muni);
    for (const file of readdirSync(dir).filter((f) =>
      /^\d{4}\.json$/.test(f),
    )) {
      const shard = readJson<ExecutionFile>(
        `budget/municipal_execution/${muni}/${file}`,
      );
      for (const [kind, side] of [
        ["revenue", shard.revenue],
        ["expense", shard.expense],
      ] as const) {
        if (!side) continue;
        // The PUBLISHED total, kept as its own row rather than left to be summed
        // from the paragraphs. The source states it, and a sum would silently
        // disagree with the municipality's own figure if a paragraph is missing.
        rows.push([
          place(shard.obshtina),
          shard.fiscalYear,
          kind,
          "TOTAL",
          null,
          eur(side.plan),
          eur(side.actual),
          shard.currency ?? null,
        ]);
        (side.byParagraph ?? []).forEach((l, i) => {
          rows.push([
            place(shard.obshtina),
            shard.fiscalYear,
            kind,
            // A paragraph with no published code falls back to its ordinal, so
            // two unnamed lines cannot collide on the primary key.
            l.code ?? `ord-${i}`,
            l.name ?? null,
            eur(l.plan),
            eur(l.actual),
            shard.currency ?? null,
          ]);
        });
      }
    }
  }
  return rows;
};

/**
 * Preflight `place_dim` — on its COLUMNS, not on a row count.
 *
 * The Interreg deploy (2026-08-08) is the precedent: prod's `place_dim` had the
 * right row count (5,720, matching local) and the wrong columns, so a
 * count-based check passed it and the load then failed after writing nothing.
 */
/**
 * Build source-key → `place_dim.code`, so the stored `obshtina` is always the
 * dimension's own key and no downstream join has to know about the aliases.
 *
 * `place_dim` carries three code columns and this corpus uses a mix of them,
 * which is why the map is built from the database rather than assumed.
 */
const buildObshtinaResolver = async (): Promise<(raw: string) => string> => {
  const rows = await allRows<{
    code: string;
    governance_code: string | null;
    price_code: string | null;
  }>(
    `SELECT code, governance_code, price_code FROM place_dim WHERE kind = 'obshtina'`,
  );
  const map = new Map<string, string>();
  for (const r of rows) {
    for (const k of [r.code, r.governance_code, r.price_code]) {
      if (k) map.set(k, r.code);
    }
  }
  // Aliases last, so a real dimension key can never be shadowed by one.
  for (const [from, to] of Object.entries(OBSHTINA_ALIASES)) {
    if (!map.has(from)) map.set(from, to);
  }
  return (raw: string) => map.get(raw) ?? raw;
};

const preflightPlaceDim = async (): Promise<void> => {
  const cols = await allRows<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'place_dim'`,
  );
  if (cols.length === 0) {
    throw new Error(
      "place_dim is absent. Run `npm run db:load:place-dim:pg` (or its :cloud twin) " +
        "first — every municipal label in 154 resolves through it.",
    );
  }
  const have = new Set(cols.map((c) => c.column_name));
  const missing = ["code", "kind", "name_bg"].filter((c) => !have.has(c));
  if (missing.length) {
    throw new Error(
      `place_dim is present but missing column(s): ${missing.join(", ")}. A row count ` +
        "would have passed this — the Interreg deploy failed exactly that way.",
    );
  }
};

/**
 * Refuse a corpus that has quietly lost its places.
 *
 * Checked AFTER the merge and inside the caller's flow, so the roster measured
 * is the one that just landed rather than the previous vintage — the shape
 * `load_municipal_fiscal_pg.ts` uses for its population check.
 */
const assertPlacement = async (
  table: string,
  column = "obshtina",
): Promise<{ placed: number; total: number }> => {
  const [r] = await allRows<{ total: string; placed: string }>(
    `SELECT count(*)::text total,
            count(p.code)::text placed
       FROM (SELECT DISTINCT ${column} AS o FROM ${table}) t
       LEFT JOIN place_dim p ON p.code = t.o AND p.kind = 'obshtina'`,
  );
  const total = Number(r.total);
  const placed = Number(r.placed);
  if (total > 0 && placed < total * PLACEMENT_FLOOR) {
    const orphans = await allRows<{ o: string }>(
      `SELECT DISTINCT ${column} AS o FROM ${table} t
        WHERE NOT EXISTS (
          SELECT 1 FROM place_dim p WHERE p.code = t.${column} AND p.kind = 'obshtina')
        ORDER BY 1 LIMIT 10`,
    );
    throw new Error(
      `${table}: only ${placed} of ${total} obshtina codes resolve in place_dim ` +
        `(floor ${(PLACEMENT_FLOOR * 100).toFixed(0)}%). Unresolved: ` +
        `${orphans.map((x) => x.o).join(", ")}${orphans.length === 10 ? " …" : ""}. ` +
        "Publishing this would drop those places off every municipal surface.",
    );
  }
  return { placed, total };
};

export const loadBudgetMuniPg = async (): Promise<{
  transfers: number;
  ipop: number;
  capital: number;
  execution: number;
  placed: number;
  places: number;
}> => {
  await exec(readFileSync(SCHEMA, "utf8"));
  await preflightPlaceDim();

  const place = await buildObshtinaResolver();
  const transfers = loadTransfers(place);
  const ipop = loadIpop(place);
  const capital = loadCapital(place);
  const execution = loadExecution(place);

  await merge(TRANSFER, transfers);
  await merge(IPOP, ipop);
  await merge(CAPITAL, capital);
  await merge(EXECUTION, execution);

  // EVERY table, not just transfers. The first cut checked only the Art. 53
  // envelope — which is complete by construction and therefore the table least
  // likely to have a stray code — and so missed that ИПОП keys Sofia as SOF22
  // and the capital programmes key Plovdiv as PDV05. Both resolved to nothing,
  // and both are top-two municipalities.
  const placement = await assertPlacement("budget_muni_transfer");
  await assertPlacement("budget_muni_ipop_project");
  await assertPlacement("budget_muni_capital_project");
  await assertPlacement("budget_muni_execution");

  await withTx(async (c) => {
    await recordIngestBatch(c, {
      source: "budget_municipal",
      table: "budget_muni_transfer",
      keyExpr: "t.obshtina || '/' || t.fiscal_year",
      nameExpr: "coalesce(t.name_bg, t.obshtina)",
      detailExpr: "'Трансфери по чл. 53 за ' || t.fiscal_year",
      amountExpr: "t.total_eur::double precision",
      rowsTotal: transfers.length,
    });
  });

  // Outside the transaction — VACUUM cannot run in one. All four are
  // stage-merged and keep their visibility maps; the call is carried so a
  // future switch to TRUNCATE cannot silently give back index-only scans.
  await vacuumAfterReload(
    "budget_muni_transfer",
    "budget_muni_ipop_project",
    "budget_muni_capital_project",
    "budget_muni_execution",
  );

  return {
    transfers: transfers.length,
    ipop: ipop.length,
    capital: capital.length,
    execution: execution.length,
    placed: placement.placed,
    places: placement.total,
  };
};

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  loadBudgetMuniPg()
    .then((r) => {
      console.log(
        `[budget-muni] ${r.transfers} transfer row(s), ${r.ipop} ИПОП project(s), ` +
          `${r.capital} capital project(s), ${r.execution} execution line(s); ` +
          `${r.placed}/${r.places} obshtina codes placed`,
      );
      return end();
    })
    .catch(async (e) => {
      console.error(e);
      await end();
      process.exit(1);
    });
}
