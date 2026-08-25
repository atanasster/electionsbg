// The /governance hub's figures, as ONE small committed JSON.
//
//   npx tsx scripts/db/gen_governance/hub_stats.ts
//
// WHY A BLOB (dashboard-hub skill §1 and §3.1 rule 3). /governance made ZERO page-specific
// fetches and showed ZERO numbers — measured 2026-08-22, the first figure on the page was a
// tile DESCRIPTION at 2 355 px, on a 2 789 px page fronting the whole money story. The
// alternative to this file is four client-side fetches of the sibling hubs' blobs on the one
// hub that currently makes none, which §9.4 of docs/plans/hub-hero-v1.md rules out.
//
// ===========================================================================
// THIS GENERATOR IS A FOLD, NOT AN AGGREGATE, AND THAT IS THE WHOLE DESIGN.
//
// /governance is a HUB OF HUBS: 21 of its 23 tiles point at another hub, each of which
// publishes its own headline from its own relation. So every figure here is taken from the
// DESTINATION'S OWN SOURCE rather than re-derived — because a fresh `count(*)`/`sum()` that
// is *about* the same subject is a different corpus, and two hubs one click apart would then
// disagree. Measured, that is not hypothetical:
//
//   • `sum(amount_eur) FROM contracts WHERE tag='contract'` was €93.81bn on the day the
//     committed procurement blob said €93.56bn — same table, different vintage.
//   • `funds_hub_stats().isun.contractedEur` and `fund_payloads(kind='index').totals` were
//     €44.07bn and €44.27bn — two definitions of "contracted EU funds", ~€197m apart, and
//     only the second is what a reader clicking the tile sees. ⚠️ RE-MEASURED 2026-08-25:
//     they now agree to the cent (44,015,477,336.12 vs .13), which is the reason the rule is
//     a RULE and not a one-off comparison. Two sources that happen to agree today have not
//     stopped being two sources, and nothing about this run makes the next one agree.
//
// So each figure comes from ONE of four kinds of source, in this order of preference:
//
//   (a) the destination's own serving FUNCTION   budget_hub_stats, agri_hub_stats,
//                                                council_overview
//   (b) the destination's own PAYLOAD row        fund_payloads(kind='index')
//   (c) the destination's own committed BLOB     procurement/derived/hub_stats.json,
//                                                procurement/derived/sector_stats.json,
//                                                parliament/votes/derived/hub_stats.json,
//                                                governance/declarations_hub_stats.json
//   (d) a direct count, ONLY where the destination has none of the above
//                                                declaration, graph_edge, municipal_fiscal
//
// CONSEQUENCE FOR THE CHAIN: this must run LAST — after every sibling generator, or it folds
// the previous vintage of whichever one has not run yet. See REFRESH_GENERATORS.
//
// A missing sibling is a SKIPPED FIGURE, never a failure and never a zero: the tile then
// renders descriptor-only, which is what it did before this file existed. `0` would be a
// claim („no EU funds have been contracted"); absence is an answer.
// ===========================================================================
//
// ⚠️ THE FOUR MONEY FIGURES ARE FOUR TAPS AND NEVER A TOTAL. The corpora OVERLAP — an
// ИСУН-funded contract is in `fund_projects` AND in `contracts`, and a ДФЗ payment to a
// município can reappear as that município's own procurement — so nothing here may be summed.
// The screen states that under the band rather than leaving it to be inferred.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, end } from "../lib/pg";
import {
  missingRelations,
  missingFunctions,
  warnSkip,
} from "../gen_procurement/preflight";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const OUT = path.join(ROOT, "data/governance/hub_stats.json");

/** Sibling artifacts this folds. Each absent one costs its tile a figure, nothing else. */
const SIBLINGS = {
  procurement: "data/procurement/derived/hub_stats.json",
  sectors: "data/procurement/derived/sector_stats.json",
  parliament: "data/parliament/votes/derived/hub_stats.json",
  declarations: "data/governance/declarations_hub_stats.json",
} as const;

/** One tile's figure. `basis` is an ENUM KEY, never prose: the i18n layer turns it into
 *  „договорени" / "contracted". Prose here would make the English hub the Bulgarian one
 *  with English headings (§1). */
export interface GovTileStat {
  kind: "eur" | "count";
  value: number;
  basis: string;
  /** The fiscal/calendar year the figure covers, where it is a single year. */
  year?: number;
  /** A second figure worth one short line under the caption, already a number. */
  extra?: number;
  /** A YEAR the caption names beside `year` — today the seasonal anchor a forecast was scaled
   *  through. ⚠️ Its own field rather than `extra`, because `extra` is rendered through
   *  `numFmt` and would print 2025 as „2 025". */
  basisYear?: number;
}

export interface GovernanceHubStats {
  computedAt: string;
  /** Keyed by the tile ids in src/screens/governance/governanceRegistry.ts. A tile with no
   *  entry renders descriptor-only. */
  tiles: Record<string, GovTileStat>;
  /** The tiles whose destination is scoped by `?elections` rather than `?pscope`. A link
   *  cannot clear the selected election (usePreserveParams carries it), so these quote the
   *  SELECTED parliament and the caption names it — the other half of the hub-of-hubs rule
   *  in docs/plans/hub-hero-v1.md §9.2. */
  byNs: Record<string, Record<string, GovTileStat>>;
  /** Corpus sizes for the head's ranked list — deliberately figures that are NOT on any
   *  tile, so the head and the grid say two different things (§3.1 rule 5, one component
   *  over). Same sourcing rule: each is the destination's own count. */
  coverage: { id: string; value: number; to: string }[];
  /** Which sources answered, so a reader of the file can tell a skipped figure from a zero. */
  sources: Record<string, boolean>;
}

const readSibling = <T>(rel: string): T | null => {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
  } catch {
    return null;
  }
};

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : null;
};

const run = async (): Promise<void> => {
  const tiles: Record<string, GovTileStat> = {};
  const coverage: GovernanceHubStats["coverage"] = [];
  const byNs: Record<string, Record<string, GovTileStat>> = {};
  const sources: Record<string, boolean> = {};

  const note = (key: string, ok: boolean, why?: string): void => {
    sources[key] = ok;
    if (!ok && why) console.warn(`  ⚠ governance_hub_stats: ${key} — ${why}`);
  };

  // ── (c) siblings ─────────────────────────────────────────────────────────
  const proc = readSibling<
    Record<string, { totalEur: number; contracts: number; tenders: number }>
  >(SIBLINGS.procurement);
  if (proc?.all?.totalEur) {
    tiles.procurement = {
      kind: "eur",
      value: Math.round(proc.all.totalEur),
      basis: "contracts",
    };
    note("procurement", true);
  } else note("procurement", false, `${SIBLINGS.procurement} absent or empty`);
  if (proc?.all?.contracts)
    coverage.push({
      id: "contracts",
      value: proc.all.contracts,
      to: "/procurement/contracts?pscope=all",
    });
  if (proc?.all?.tenders)
    coverage.push({
      id: "tenders",
      value: proc.all.tenders,
      to: "/procurement/tenders?pscope=all",
    });

  // The sector COUNT, not a sum: sector_stats mixes bases (budget / procurement / payout),
  // so adding them up would be one number over three different questions.
  const sect = readSibling<Record<string, Record<string, unknown>>>(
    SIBLINGS.sectors,
  );
  const sectorCount = sect?.all ? Object.keys(sect.all).length : 0;
  if (sectorCount > 0) {
    tiles.sectors = { kind: "count", value: sectorCount, basis: "sectors" };
    note("sectors", true);
  } else note("sectors", false, `${SIBLINGS.sectors} absent or empty`);

  const decl = readSibling<{ people?: number; organisations?: number }>(
    SIBLINGS.declarations,
  );
  if (decl?.people) {
    // The basis /persons itself opens on — its tier='P' public-figure floor.
    tiles.persons = {
      kind: "count",
      value: decl.people,
      basis: "public_register",
    };
    note("persons", true);
  } else note("persons", false, `${SIBLINGS.declarations} absent or empty`);

  const parl = readSibling<{
    byNs?: Record<string, { tiles?: { sessions?: number; items?: number } }>;
  }>(SIBLINGS.parliament);
  if (parl?.byNs) {
    for (const [ns, slice] of Object.entries(parl.byNs)) {
      const sessions = slice?.tiles?.sessions;
      if (!sessions) continue;
      (byNs[ns] ??= {}).parliament = {
        kind: "count",
        value: sessions,
        basis: "sessions",
        extra: slice.tiles?.items,
      };
    }
    note("parliament", Object.keys(byNs).length > 0);
  } else note("parliament", false, `${SIBLINGS.parliament} absent or empty`);

  // ── (a) the destinations' own serving functions ──────────────────────────
  const fnMissing = await missingFunctions([
    "budget_hub_stats(integer)",
    "agri_hub_stats(text)",
    "council_overview()",
  ]);

  if (!fnMissing.includes("budget_hub_stats(integer)")) {
    const [r] = await allRows<{
      p: string | null;
      j: string | null;
      y: string | null;
      b: string | null;
    }>(
      // NEVER `expenditureExecutedEur`: it is the year to date — 6 of 12 months on the day
      // this was written — so quoting it makes the state look like it spends half what it
      // does. The tile answers „how big is the budget", which is the year's ENVELOPE.
      //
      // ⚠️⚠️ AND THE ENVELOPE IS TWO DIFFERENT CLAIMS, so the basis follows the pick rather
      // than being fixed. `expenditurePlannedEur` is МФ's budget-law column — what the
      // Assembly appropriated. `expenditureProjectedEur` is OURS: this year's actuals scaled
      // through a prior year's monthly profile. This arm read the second and stamped
      // `planned_expenditure` on it, so /governance published „€29,6 млрд. · разходи · план
      // 2026" for a fiscal year that carries NO planned row at all — the same false sentence
      // the /budget head shipped, one hub up, and the reason a hub of hubs must fold the
      // destination's BASIS along with its number.
      `SELECT (budget_hub_stats()->>'expenditurePlannedEur')   AS p,
              (budget_hub_stats()->>'expenditureProjectedEur') AS j,
              (budget_hub_stats()->>'fiscalYear')              AS y,
              (budget_hub_stats()->>'projectionBasisYear')     AS b`,
    );
    // ⚠️ ONE PICK RETURNING THE FIGURE AND ITS BASIS TOGETHER, exactly as
    // `budgetHubFigures.ts` does — whose header says why: „two separate chains, one choosing
    // the number and one choosing the string, is the shape that desyncs, and it desyncs
    // silently because both halves stay individually plausible." A first cut here chose the
    // value with `??` and the label with a truthiness test, which differ at `planned === 0`.
    //
    // The law first wherever it exists — external and checkable, unlike our own forecast —
    // and it is the same pick /budget makes, so the two hubs cannot disagree.
    const pick = ((p: number | null, j: number | null) => {
      if (p != null) return { value: p, basis: "planned_expenditure" as const };
      if (j != null)
        return { value: j, basis: "projected_expenditure" as const };
      return null;
    })(num(r?.p), num(r?.j));
    if (pick) {
      tiles.budget = {
        kind: "eur",
        value: Math.round(pick.value),
        basis: pick.basis,
        year: num(r?.y) ?? undefined,
        // The seasonal anchor, so the caption is „прогноза за 2026 по профила на 2025" rather
        // than „прогноза за 2026" — which `budgetBasis.test.ts` calls a forecast from nowhere,
        // about this very number. /budget names it one click away; a hub of hubs that folds
        // the figure and drops half its basis is the softer version of the disagreement this
        // generator exists to prevent.
        basisYear:
          pick.basis === "projected_expenditure"
            ? (num(r?.b) ?? undefined)
            : undefined,
      };
      note("budget", true);
    } else note("budget", false, "budget_hub_stats() has no expenditure");
  } else note("budget", false, "budget_hub_stats() absent");

  if (!fnMissing.includes("agri_hub_stats(text)")) {
    // 'all', EXPLICITLY. The default scope is the latest FINANCIAL YEAR (€1.59bn in 2025)
    // against €11.04bn all-time, so the unscoped call would publish one year under a
    // corpus caption — the defect this whole plan exists to prevent. The tile links
    // `?pscope=all` so the destination agrees.
    const [r] = await allRows<{ v: string | null; rows: string | null }>(
      `SELECT (agri_hub_stats('all')->>'totalEur') AS v,
              (agri_hub_stats('all')->>'paymentRows') AS rows`,
    );
    const v = num(r?.v);
    if (v) {
      tiles.subsidies = { kind: "eur", value: Math.round(v), basis: "paid" };
      note("subsidies", true);
    } else note("subsidies", false, "agri_hub_stats('all') has no total");
    const rows = num(r?.rows);
    if (rows)
      coverage.push({
        id: "agriRows",
        value: rows,
        to: "/subsidies?pscope=all",
      });
  } else note("subsidies", false, "agri_hub_stats() absent");

  if (!fnMissing.includes("council_overview()")) {
    const [r] = await allRows<{ res: string | null; n: string | null }>(
      `SELECT sum((c->>'resolutions')::bigint)::text AS res,
              count(*)::text AS n
         FROM jsonb_array_elements(council_overview()->'councils') AS c`,
    );
    const v = num(r?.res);
    if (v) {
      tiles.council = {
        kind: "count",
        value: v,
        basis: "resolutions",
        extra: num(r?.n) ?? undefined,
      };
      note("council", true);
    } else note("council", false, "council_overview() has no resolutions");
  } else note("council", false, "council_overview() absent");

  // ── (b) the destination's own payload row ────────────────────────────────
  if (!(await missingRelations(["fund_payloads"])).length) {
    const [r] = await allRows<{ v: string | null; n: string | null }>(
      // What /funds RENDERS. funds_hub_stats() answers the same question differently
      // (€44.07bn against this €44.27bn) and the page uses this one.
      `SELECT (payload->'totals'->>'contractedEur') AS v,
              (payload->'totals'->>'contractCount') AS n
         FROM fund_payloads WHERE kind = 'index' LIMIT 1`,
    );
    const v = num(r?.v);
    if (v) {
      tiles.funds = { kind: "eur", value: Math.round(v), basis: "contracted" };
      note("funds", true);
    } else note("funds", false, "fund_payloads(kind='index') has no totals");
    const n = num(r?.n);
    if (n)
      coverage.push({
        id: "fundsProjects",
        value: n,
        to: "/funds/beneficiaries",
      });
  } else note("funds", false, "fund_payloads absent");

  // ── (d) direct counts, where the destination publishes no headline ───────
  const direct: [string, string, string, GovTileStat["kind"], string][] = [
    [
      "municipal-finance",
      "municipal_fiscal",
      "count(DISTINCT obshtina)",
      "count",
      "municipalities",
    ],
    ["declarations", "declaration", "count(*)", "count", "filings"],
    ["connections", "graph_edge", "count(*)", "count", "edges"],
  ];
  for (const [tile, rel, expr, kind, basis] of direct) {
    if ((await missingRelations([rel])).length) {
      note(tile, false, `${rel} absent`);
      continue;
    }
    const [r] = await allRows<{ v: string }>(
      `SELECT ${expr}::text AS v FROM ${rel}`,
    );
    const v = num(r?.v);
    if (v) {
      tiles[tile] = { kind, value: v, basis };
      note(tile, true);
    } else note(tile, false, `${rel} is empty`);
  }

  if (Object.keys(tiles).length === 0) {
    warnSkip(
      "governance_hub_stats",
      "no source answered — every figure would be absent",
      "run npm run db:refresh",
    );
    await end();
    return;
  }

  const out: GovernanceHubStats = {
    computedAt: new Date().toISOString(),
    tiles,
    byNs,
    coverage,
    sources,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");

  const ok = Object.values(sources).filter(Boolean).length;
  console.log(
    `governance_hub_stats: ${Object.keys(tiles).length} tile figures, ${coverage.length} coverage rows, from ${ok}/${
      Object.keys(sources).length
    } sources · ${Object.keys(byNs).length} ns partitions · ${
      fs.statSync(OUT).size
    } bytes`,
  );
  await end();
};

if (process.argv[1] && process.argv[1].includes("gen_governance/hub_stats")) {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
