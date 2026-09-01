// The global home dashboard's figures, as ONE small committed JSON.
//
//   npx tsx scripts/db/gen_home/hub_stats.ts
//
// ===========================================================================
// THIS IS A FOLD, NOT AN AGGREGATE — the same rule, and the same reason, as
// gen_governance/hub_stats.ts. Every tile figure is the DESTINATION'S OWN number, taken
// from the artifact that destination publishes, never re-derived. A fresh count that is
// *about* the same subject is a different corpus, and two pages one click apart would then
// disagree about it.
//
// ⚠️ AND IT READS NO POSTGRES. Its inputs are `data/macro.json` and three committed blobs,
// so it runs on a fresh clone. That is deliberate: `/` is the site's entry page, and every
// figure on it has to be servable from a static object with no database behind it. The
// runtime contract is GCS fetches only — and zero `/api/db` calls before the finder is
// armed. See the plan's §9.3a.
//
// ⚠️ THE FOUR MONEY-ISH FIGURES ARE FOUR TAPS AND NEVER A TOTAL, exactly as on /governance:
// the corpora overlap (an ИСУН-funded contract is in fund_projects AND in contracts), so
// nothing here may be summed.
// ===========================================================================
//
// Plan: docs/plans/home-dashboard-implementation-v1.md §5.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { periodToIsoDay } from "./period";
import {
  HOME_FIGURE_IDS,
  homeFigureIdIsHonest,
  isHomeBasisKey,
  findNowRelativeFields,
  type HomeFigure,
  type HomeHubStatsV1,
  type HomeMode,
  type HomeSource,
  type HomeTileMetric,
} from "../../../src/data/home/homeTypes";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const OUT = path.join(ROOT, "data/home/hub_stats.json");

/** Sibling artifacts this folds. Each absent one costs its tile a figure, nothing else. */
const SIBLINGS = {
  macro: "data/macro.json",
  governance: "data/governance/hub_stats.json",
  procurement: "data/procurement/derived/hub_stats.json",
  elections: "src/data/json/elections.json",
} as const;

const readJson = <T>(rel: string): T | null => {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// The four head figures
// ---------------------------------------------------------------------------

type MacroObs = { period: string; value: number };
type MacroMonthly = MacroObs & {
  seasonallyAdjusted?: boolean;
  datasetCode?: string;
  sourceUrl?: string;
};
type MacroIndicator = { datasetCode?: string; sourceUrl?: string };
type Macro = {
  series: Record<string, MacroObs[]>;
  latestMonthly: Record<string, MacroMonthly | undefined>;
  indicators: Record<string, MacroIndicator | undefined>;
};

/**
 * ⚠️ EVERY FIGURE NAMES ITS OWN METADATA ROW, AND THE OBVIOUS LOOKUP IS WRONG FOR TWO.
 *
 * `series.*` observations carry only `{period, value}`, so the dataset code and source URL
 * have to come from somewhere else — and `macro.indicators[id]` is NOT that somewhere for
 * half the band:
 *
 *   · `indicators.unemployment` is the QUARTERLY series (`une_rt_q`), a different dataset
 *     from the `latestMonthly.unemployment` (`une_rt_m`) this figure selects. The monthly
 *     metadata is `indicators.unemploymentMonthly`.
 *   · `indicators.inflation` is captioned "% YoY (HICP, quarterly avg)". There is no
 *     monthly indicators entry, so a naive lookup would label a monthly observation a
 *     quarterly average. The `latestMonthly.inflation` OBSERVATION carries both fields.
 *
 * `home_hub_stats.data.test.ts` asserts, per figure, that the emitted `datasetCode` equals
 * the one on the object the VALUE came from — an assertion against the figure's own
 * metadata would pass on a cross-wired pair.
 */
const FIGURE_SPECS = [
  {
    id: "gdp_growth" as const,
    from: { kind: "series" as const, key: "gdpGrowth" },
    meta: { kind: "indicator" as const, key: "gdpGrowth" },
    basis: {
      frequency: "quarterly" as const,
      unit: "pct" as const,
      adjustment: "seasonally_adjusted" as const,
      comparison: "yoy" as const,
    },
    to: "/indicators/economy",
  },
  {
    id: "inflation_hicp" as const,
    from: { kind: "monthly" as const, key: "inflation" },
    // The observation itself — see the note above.
    meta: { kind: "observation" as const, key: "inflation" },
    basis: {
      frequency: "monthly" as const,
      unit: "pct" as const,
      adjustment: "unadjusted" as const,
      comparison: "yoy" as const,
    },
    to: "/indicators/economy",
  },
  {
    id: "unemployment_sa" as const,
    from: { kind: "monthly" as const, key: "unemployment" },
    // `unemploymentMonthly`, NOT `unemployment` — see the note above.
    meta: { kind: "indicator" as const, key: "unemploymentMonthly" },
    basis: {
      frequency: "monthly" as const,
      unit: "pct" as const,
      adjustment: "seasonally_adjusted" as const,
      comparison: "level" as const,
    },
    to: "/indicators/economy",
  },
  {
    id: "government_debt_gdp" as const,
    from: { kind: "series" as const, key: "govDebt" },
    meta: { kind: "indicator" as const, key: "govDebt" },
    basis: {
      frequency: "quarterly" as const,
      unit: "pct_gdp" as const,
      comparison: "snapshot" as const,
    },
    to: "/indicators/fiscal",
  },
];

/** The last observation that actually carries a finite value.
 *
 *  ⚠️ Not `at(-1)`: a series whose newest row is a placeholder would silently publish it,
 *  and a NaN reaching the artifact renders as a blank cell rather than as an absence. */
const lastValid = (rows: MacroObs[] | undefined): MacroObs | null => {
  if (!Array.isArray(rows)) return null;
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (
      r &&
      typeof r.value === "number" &&
      Number.isFinite(r.value) &&
      r.period
    )
      return r;
  }
  return null;
};

const buildFigures = (
  macro: Macro | null,
): { figures: HomeFigure[]; sources: Record<string, HomeSource> } => {
  const figures: HomeFigure[] = [];
  const sources: Record<string, HomeSource> = {};
  if (!macro) return { figures, sources };

  for (const spec of FIGURE_SPECS) {
    const obs =
      spec.from.kind === "series"
        ? lastValid(macro.series?.[spec.from.key])
        : (macro.latestMonthly?.[spec.from.key] ?? null);
    const metaRow: MacroIndicator | undefined =
      spec.meta.kind === "indicator"
        ? macro.indicators?.[spec.meta.key]
        : (macro.latestMonthly?.[spec.meta.key] as MacroIndicator | undefined);

    const sourceId = metaRow?.datasetCode
      ? `eurostat_${metaRow.datasetCode}`
      : `macro_${spec.id}`;

    if (!obs || !Number.isFinite(obs.value)) {
      // ABSENT, never zero. A zero here is a claim — „inflation is 0%" — and the head
      // renders three cells plus a disclosed partial state instead.
      sources[sourceId] = { available: false };
      continue;
    }
    // ⚠️ `sourceId` is derived from the DATASET, so two figures drawn from the same Eurostat
    // dataset would share a key and the second would clobber the first — leaving one
    // figure's `available` and `asOf` describing the other. The four codes are distinct
    // today; this refuses rather than waiting for the day they are not.
    if (sources[sourceId] && sources[sourceId].asOf !== obs.period)
      throw new Error(
        `sourceId collision: ${sourceId} claimed by two figures with different vintages`,
      );
    sources[sourceId] = {
      available: true,
      asOf: obs.period,
      ...(metaRow?.sourceUrl ? { sourceUrl: metaRow.sourceUrl } : {}),
      ...(metaRow?.datasetCode ? { datasetCode: metaRow.datasetCode } : {}),
    };
    // ⚠️ THE ADJUSTMENT COMES FROM THE OBSERVATION WHERE THE OBSERVATION STATES IT.
    // `spec.basis.adjustment` is a declaration ABOUT the series, and it is rendered straight
    // into the reader-facing basis line — so if the macro ingest ever switches to the other
    // variant of a series (the SA form of HICP, say), a hardcoded spec would go on asserting
    // „несезонно изгладено" beside a number that is adjusted. On the page whose whole design
    // premise is that every figure declares its basis, that is the worst kind of wrong.
    // `series.*` rows carry no such field, so the spec stays the fallback for those.
    const declared =
      typeof (obs as MacroMonthly).seasonallyAdjusted === "boolean"
        ? (obs as MacroMonthly).seasonallyAdjusted
          ? ("seasonally_adjusted" as const)
          : ("unadjusted" as const)
        : spec.basis.adjustment;
    figures.push({
      id: spec.id,
      value: obs.value,
      basis: {
        period: obs.period,
        ...spec.basis,
        ...(declared ? { adjustment: declared } : {}),
      },
      to: spec.to,
      sourceId,
    });
  }
  return { figures, sources };
};

// ---------------------------------------------------------------------------
// homeMode
// ---------------------------------------------------------------------------

/**
 * ⚠️ ONLY TWO OF THE FOUR MODES ARE DERIVABLE, and that is a fact about the corpus rather
 * than an omission. `src/data/json/elections.json` carries `name` (the polling day) and
 * results — there is NO status field and no scheduled future event, so:
 *
 *   · `election_live`     needs a projection/counting status. Nothing publishes one here.
 *   · `election_upcoming` needs a SCHEDULED election. The registry holds only completed ones.
 *
 * Both therefore fall back to `standard`, which is the plan's own rule for an unknown
 * status (§4.3) — inventing either from the calendar alone would put an election banner on
 * the home page on the strength of arithmetic.
 *
 * The window is measured from `computedAt` (the max source vintage), never from `now`, or
 * the artifact would change daily with no source change and could not be byte-stable.
 */
const RECENT_DAYS = 14;

const deriveMode = (
  latestElection: string | null,
  computedAt: string,
): HomeMode => {
  if (!latestElection) return "standard";
  const day = latestElection.replace(/_/g, "-");
  const t = Date.parse(`${day}T00:00:00Z`);
  const at = Date.parse(computedAt);
  if (!Number.isFinite(t) || !Number.isFinite(at)) return "standard";
  const days = (at - t) / 86_400_000;
  return days >= 0 && days <= RECENT_DAYS ? "election_recent" : "standard";
};

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------

type GovBlob = {
  computedAt?: string;
  tiles?: Record<string, { kind: string; value: number; basis: string }>;
};
type ProcBlob = { all?: { totalEur?: number; contracts?: number } };
type ElectionRow = { name: string };

const run = async (): Promise<void> => {
  const macro = readJson<Macro>(SIBLINGS.macro);
  const gov = readJson<GovBlob>(SIBLINGS.governance);
  const proc = readJson<ProcBlob>(SIBLINGS.procurement);
  const elections = readJson<ElectionRow[]>(SIBLINGS.elections);

  const { figures, sources } = buildFigures(macro);

  // Every figure id must survive the CPI check — the generator refuses rather than leaving
  // it to the gate, so a bad id cannot reach the artifact at all.
  for (const f of figures) {
    if (!homeFigureIdIsHonest(f.id))
      throw new Error(`figure id claims to be a CPI: ${f.id}`);
  }

  const latestElection =
    Array.isArray(elections) && elections.length > 0
      ? ([...elections.map((e) => e.name)].sort().at(-1) ?? null)
      : null;

  // `computedAt` is the MAXIMUM SOURCE VINTAGE, never `new Date()`. Two rebuilds of the same
  // corpus must be byte-identical (§12.3), and a run-time stamp makes that impossible — it
  // also lets a stalled pipeline look fresh.
  //
  // ⚠️ EVERY VINTAGE IS NORMALISED TO AN ISO DAY FIRST. The sources speak three dialects —
  // "2026-Q2", "2026-07" and "2026_04_19" — and a lexical max over the mixed set is
  // meaningless ("2026-Q2" sorts after "2026-07" because "Q" > "0"). It also has to be a
  // real date for `deriveMode` to compare against, and `Date.parse("2026-Q2")` is NaN, which
  // would make the mode silently fall back to `standard` for ever.
  //
  // ⚠️ THE SIBLING BLOB'S `computedAt` IS DELIBERATELY NOT IN THIS LIST, and leaving it in
  // silently defeated the whole design. `gen_governance/hub_stats.ts` stamps
  // `new Date().toISOString()`, so it is a RUN TIME rather than a vintage — always later
  // than every real source period, so it always won the max and `computedAt` became the
  // build date. That reintroduces every failure this field exists to prevent: the artifact
  // changes daily with no source change, `db:check-generated` reports permanent drift, a
  // stalled pipeline looks fresh, and `homeMode` — whose `election_recent` window is
  // measured from here — becomes clock-dependent. `findNowRelativeFields` cannot see it,
  // because `computedAt` is not a banned NAME.
  //
  // Only real observation periods count.
  const vintages = [
    ...figures.map((f) => f.basis.period),
    ...(latestElection ? [latestElection.replace(/_/g, "-")] : []),
  ]
    .map(periodToIsoDay)
    .filter((d): d is string => Boolean(d));
  const computedAt = vintages.length
    ? [...vintages].sort().at(-1)!
    : // No source answered at all; the artifact is not worth writing (guarded below).
      "";

  const tiles: Record<string, HomeTileMetric> = {};
  const addTile = (t: HomeTileMetric): void => {
    if (!isHomeBasisKey(t.basisKey))
      throw new Error(
        `tile ${t.tileId}: basisKey is not an i18n key: ${t.basisKey}`,
      );
    tiles[t.tileId] = t;
  };

  // procurement — the destination's OWN all-scope total, with `?pscope=all` preserved so the
  // tile's number and the page it opens describe the same window.
  if (typeof proc?.all?.totalEur === "number") {
    addTile({
      tileId: "procurement",
      value: proc.all.totalEur,
      unit: "eur",
      basisKey: "home_basis_procurement_contracted_all",
      to: "/procurement?pscope=all",
      sourceId: "procurement_hub_stats",
      scope: "all",
    });
    sources.procurement_hub_stats = { available: true };
  } else sources.procurement_hub_stats = { available: false };

  // budget + funds + governance — folded from /governance's blob, which is itself a fold of
  // each destination's own source. Folding the fold is correct here and re-deriving would
  // not be: /governance is the page a reader reaches from these tiles.
  const govTile = (
    id: string,
    tileId: string,
    basisKey: string,
    to: string,
    unit: "eur" | "count",
  ): void => {
    const row = gov?.tiles?.[id];
    if (row && Number.isFinite(row.value)) {
      addTile({
        tileId,
        value: row.value,
        unit,
        basisKey,
        to,
        sourceId: "governance_hub_stats",
      });
    }
  };
  // ⚠️ THE BUDGET BASIS KEY ENDS `_kfp` FOR A MECHANICAL REASON, not a semantic one. The
  // deferred budget.json bundle already owns a key whose name is the obvious ending for
  // this one, and `bundle_reachability.test.ts` matches a key as a SUBSTRING — so a home
  // key ending that way makes the bundled key look named from this generator, i.e.
  // reachable from outside its own routes, which is what the bundle split forbids. The
  // scan reads comments too, so this note deliberately does not spell the collision out.
  govTile("budget", "budget", "home_basis_budget_kfp", "/budget", "eur");
  govTile("funds", "funds", "home_basis_funds_contracted", "/funds", "eur");
  govTile(
    "persons",
    "governance",
    "home_basis_governance_people",
    "/governance",
    "count",
  );
  // From what was actually FOLDED, not from the container's presence: a `gov.tiles` missing
  // all three keys yields three absent tiles and a source claiming it answered — the
  // inverse of the „a missing source is absent, never a claim" rule this artifact rests on.
  sources.governance_hub_stats = {
    available: ["budget", "funds", "governance"].some((id) => id in tiles),
  };

  // elections — the DATE of the latest event, not another result percentage. Stored as a
  // plain day; the renderer formats it and the copy says „последни избори" rather than
  // asserting anything about a cycle the reader may have selected (§4.2).
  if (latestElection) {
    addTile({
      tileId: "elections",
      value: Number(latestElection.slice(0, 4)),
      unit: "date",
      basisKey: "home_basis_elections_latest",
      period: latestElection.replace(/_/g, "-"),
      to: "/parliamentary",
      sourceId: "elections_registry",
    });
    sources.elections_registry = { available: true, asOf: latestElection };
  } else sources.elections_registry = { available: false };

  // prices, my-area and sectors are DESCRIPTOR-ONLY in v1.
  //
  // Not an oversight: §5.3 rejects adding a home-only query merely to fill a tile, and none
  // of the three has a destination-owned figure this generator can reach without one.
  // Prices are Postgres-served (`data/prices/**` is excluded from the bucket precisely
  // because of that); the place catalog publishes no stable coverage count; and a sector
  // COUNT would be a figure about the registry rather than about the money, which the
  // sectors hub itself does not headline.

  if (figures.length === 0 && Object.keys(tiles).length === 0) {
    console.warn(
      "home_hub_stats: no source answered — refusing to overwrite a good artifact with an empty one",
    );
    return;
  }
  if (!computedAt) {
    // Reachable: figures can exist while every period fails normalisation. An artifact that
    // cannot date itself would pass the guard above, fail its own schema gate, and render a
    // head with a blank vintage.
    console.warn(
      "home_hub_stats: no source vintage could be normalised — refusing to write an " +
        "artifact that cannot date itself",
    );
    return;
  }

  const out: HomeHubStatsV1 = {
    schemaVersion: 1,
    computedAt,
    homeMode: deriveMode(latestElection, computedAt),
    figures,
    // Sorted so the serialisation is stable regardless of insertion order.
    tiles: Object.fromEntries(
      Object.keys(tiles)
        .sort()
        .map((k) => [k, tiles[k]]),
    ),
    sources: Object.fromEntries(
      Object.keys(sources)
        .sort()
        .map((k) => [k, sources[k]]),
    ),
  };

  const stray = findNowRelativeFields(out);
  if (stray.length > 0)
    throw new Error(
      `home_hub_stats: stored a now-relative field (${stray.join(", ")}) — see NOW_RELATIVE_FIELD_NAMES`,
    );

  // Build → validate → temp sibling → rename, so a crash mid-write cannot leave a truncated
  // artifact where a good one was.
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const body = JSON.stringify(out, null, 2) + "\n";
  const tmp = `${OUT}.tmp`;
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, OUT);

  const ok = Object.values(sources).filter((s) => s.available).length;
  console.log(
    `home_hub_stats: ${figures.length}/${HOME_FIGURE_IDS.length} figures, ` +
      `${Object.keys(out.tiles).length} tile figures, ${ok}/${Object.keys(sources).length} sources ` +
      `· mode=${out.homeMode} · computedAt=${computedAt} · ${Buffer.byteLength(body)} bytes`,
  );
};

if (process.argv[1] && process.argv[1].includes("gen_home/hub_stats")) {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

export { buildFigures, deriveMode, lastValid, FIGURE_SPECS, run };
