// The /budget hub's figure ledger — every number a hub tile may display, each
// with the denominator it is over and the other defensible answers to the same
// question. Plan: docs/plans/budget-hub-v1.md §2 and T0.2.
//
// WHY THIS EXISTS, and why it reads the shard files rather than Postgres.
//
// The dashboard-hub skill (§8) requires that a figure gate assert against
// something the GENERATOR DOES NOT USE: a gate that re-runs the hub matview's
// own SQL and compares it to the matview's own output proves only that the
// view was freshly refreshed, and inherits every misunderstanding it was meant
// to catch. So this module derives each figure INDEPENDENTLY, from the JSON in
// data/, and `budget_hub_stats.data.test.ts` compares the matview against it.
// If the two ever disagree, one of them is wrong and the disagreement is the
// finding.
//
// That independence is the whole value, so three rules bind anything added here:
//
//   1. NEVER import from scripts/db/ or query Postgres. The moment this file
//      shares a code path with the generator it stops being a check.
//   2. Every figure carries a `basis` — one clause naming the denominator or
//      the population. A figure whose basis cannot be stated in one clause is
//      not ready to ship (skill §0), and `rejected` records the answers that
//      were also true so the next reader can see the fork rather than
//      rediscovering it.
//   3. TWO OF THE INPUTS ARE GITIGNORED — `data/budget/reconciliation/` and
//      `data/budget/ministries/` (.gitignore, beside `facts/`: bulky
//      regenerable shards, shipped to the bucket only). A fresh clone and CI
//      have neither, so on those machines every admin/program figure is "not
//      derivable". Such a figure is emitted with `value: null` and a basis
//      that SAYS so — it must NEVER be omitted. An omitted key is invisible to
//      a gate pairing ledger keys against matview fields, so the gate would
//      quietly stop checking exactly the §2.3 figures it exists for, and pass.
//      `notDerivable()` below is how that rule is kept mechanical.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type {
  BudgetIndex,
  BudgetDocumentsFile,
  BudgetDocKind,
  InvestmentProgramFile,
  KfpFile,
  PersonnelFile,
  ReconciliationRow,
} from "../../src/data/budget/types";

const __filename = fileURLToPath(import.meta.url);
const DATA = path.resolve(path.dirname(__filename), "../../data");

/** Every `BudgetDocKind`, enumerated rather than observed — a kind that drops
 *  to zero must still report 0 rather than losing its key (rule 3). */
const DOC_KINDS: readonly BudgetDocKind[] = [
  "law",
  "interim-law",
  "fund-law",
  "amendment",
  "execution-report",
  "audit-report",
  "kfp-feed",
];

/** One measured figure. `value` is null when the corpus cannot answer — which
 *  is an ANSWER ("not derivable"), never a zero. */
export interface LedgerFigure {
  /** Stable key. Where the hub stat call has a matching field, the names agree
   *  on purpose, so a gate can pair them without a lookup table. */
  key: string;
  value: number | string | boolean | null;
  /** The denominator / population, in ONE clause. Never omitted. */
  basis: string;
  /** Other defensible answers to the same question. Present whenever the
   *  question has more than one true answer — §2.1's whole point. */
  rejected?: Array<{ value: number | string | null; why: string }>;
  /** A trap a consumer of this figure has to know about. */
  caution?: string;
}

/** Build a figure, dropping any `rejected` entry that equals the value itself.
 *
 *  `rejected` means "another defensible answer to the same question". An entry
 *  equal to the value is not another answer — it prints the same number twice
 *  and its `why` then teaches a distinction the data does not have at this
 *  year. That happens for real: on a year with no executed rows,
 *  `deviationsExecutedRows` and its distinct-unit alternative are both 0.
 *  Doing it here rather than at each call site means a new figure cannot
 *  reintroduce it. */
const figure = (f: LedgerFigure): LedgerFigure => {
  const rejected = (f.rejected ?? []).filter((alt) => alt.value !== f.value);
  return rejected.length ? { ...f, rejected } : omitRejected(f);
};

const omitRejected = (f: LedgerFigure): LedgerFigure => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { rejected, ...rest } = f;
  return rest;
};

/** A figure this corpus cannot answer for this year. NEVER a zero: the value is
 *  null and the basis names why. Keeping rule 3 in one helper is what stops the
 *  next figure added here from silently reintroducing a vanishing key. */
const notDerivable = (
  key: string,
  why: string,
  caution?: string,
): LedgerFigure => ({
  key,
  value: null,
  basis: `${why} — not derivable, not zero`,
  ...(caution ? { caution } : {}),
});

const readJson = <T>(rel: string): T | null => {
  const file = path.join(DATA, rel);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch (e) {
    // Absent is a normal state and returns null above; PRESENT-but-malformed is
    // a real fault, and a bare SyntaxError from a reader of eight paths says
    // nothing about which one.
    throw new Error(
      `${rel} is present but unparseable: ${(e as Error).message}`,
    );
  }
};

// data/cofog.json is Eurostat gov_10a_exp. Its producer is
// scripts/macro/fetch_cofog.ts; src/data/macro/useCofog.tsx carries the same
// shape with a CofogCode union, but that is a .tsx and not importable here.
interface CofogFileShape {
  latestYear: number;
  cofogTopLevel: string[];
  series: Record<string, Array<{ year: number; valueEur: number }>>;
}

/** Every corpus input the ledger reads. A missing file is null rather than a
 *  throw: a fresh clone without the gitignored inputs must still run and report
 *  WHICH figures it cannot derive.
 *
 *  The three PER-YEAR inputs are reader FUNCTIONS rather than loaded values,
 *  for two reasons that both matter. They are per-fiscal-year, so eagerly
 *  loading them would mean loading nine years to print one. And they are the
 *  gitignored ones (rule 3) — as direct `fs` calls they would be unreachable
 *  from a test, so the "key set does not depend on which shards are present"
 *  invariant could not be pinned on a machine that HAS the shards, which is
 *  every developer machine and none of CI. Injecting them is what makes the
 *  fresh-clone path testable here rather than only in production. */
export interface BudgetCorpus {
  index: BudgetIndex | null;
  kfp: KfpFile | null;
  documents: BudgetDocumentsFile | null;
  cofog: CofogFileShape | null;
  personnel: PersonnelFile | null;
  /** null — not 0 — when data/budget/ministries/ is absent (gitignored). A 0
   *  here would be published as a defensible alternative answer, which is worse
   *  than a missing one. */
  ministryFileCount: number | null;
  readAdminRows: (fy: number) => ReconciliationRow[] | null;
  readProgramRows: (fy: number) => ReconciliationRow[] | null;
  readInvestmentProgram: (fy: number) => InvestmentProgramFile | null;
}

export const loadBudgetCorpus = (): BudgetCorpus => {
  const ministriesDir = path.join(DATA, "budget/ministries");
  return {
    index: readJson<BudgetIndex>("budget/index.json"),
    kfp: readJson<KfpFile>("budget/kfp.json"),
    documents: readJson<BudgetDocumentsFile>("budget/documents.json"),
    cofog: readJson<CofogFileShape>("cofog.json"),
    personnel: readJson<PersonnelFile>("budget/personnel.json"),
    ministryFileCount: fs.existsSync(ministriesDir)
      ? fs.readdirSync(ministriesDir).filter((f) => f.endsWith(".json")).length
      : null,
    readAdminRows: (fy) =>
      readJson<ReconciliationRow[]>(
        `budget/reconciliation/${fy}/by-admin.json`,
      ),
    readProgramRows: (fy) =>
      readJson<ReconciliationRow[]>(
        `budget/reconciliation/${fy}/by-program.json`,
      ),
    readInvestmentProgram: (fy) =>
      readJson<InvestmentProgramFile>(`budget/investment_program/${fy}.json`),
  };
};

/** A corpus with nothing readable — a fresh clone, or CI. Exported so the gates
 *  can assert the key set is the same one this machine produces. */
export const emptyBudgetCorpus = (): BudgetCorpus => ({
  index: null,
  kfp: null,
  documents: null,
  cofog: null,
  personnel: null,
  ministryFileCount: null,
  readAdminRows: () => null,
  readProgramRows: () => null,
  readInvestmentProgram: () => null,
});

/** Why an admin/program figure is missing. Named once so all five say the same
 *  thing, and so the reason points at the fix rather than at the symptom. */
const RECONCILIATION_ABSENT = (fy: number) =>
  `data/budget/reconciliation/${fy}/ is absent — that tree is GITIGNORED ` +
  `(bucket-shipped only), so a fresh clone or CI cannot see it`;

/** The fiscal year the hub defaults to: the newest the KFP summary covers.
 *  NOT max() over the document index, which reaches further BACK (2018 vs
 *  2021) — both end at the same year, so "further forward" would be wrong. */
export const defaultFiscalYear = (corpus: BudgetCorpus): number | null => {
  const years = corpus.index?.fiscalYears ?? [];
  if (!years.length) return null;
  return Math.max(...years.map((y) => y.fiscalYear));
};

/**
 * Measure every candidate hub figure for one fiscal year.
 *
 * The KEY SET IS INVARIANT — it does not depend on which shards happen to be on
 * the machine (rule 3). Ordered as the hub renders them: headline cards, then
 * the counts each band's tiles would show, then the wire, then the traps.
 */
export const measureHubLedger = (
  fy: number,
  corpus: BudgetCorpus = loadBudgetCorpus(),
): LedgerFigure[] => {
  const out: LedgerFigure[] = [];
  const summary =
    corpus.index?.fiscalYears.find((y) => y.fiscalYear === fy) ?? null;

  out.push({
    key: "fiscalYear",
    value: fy,
    basis: "the ?fy= selection; every figure below is scoped to it",
  });

  // ── Headline cards ──────────────────────────────────────────────────────
  //
  // Executed and projected are DIFFERENT FIGURES and both are true. A key
  // called `revenueEur` would let a consumer pick one by accident, so each
  // names its basis (plan §6.3).
  const series = [
    "revenue",
    "expenditure",
    "euContribution",
    "balance",
  ] as const;

  for (const name of series) {
    const actual = summary?.actual?.[name]?.amountEur ?? null;
    const projected = summary?.projected?.[name]?.amountEur ?? null;
    const planned = summary?.planned?.[name]?.amountEur ?? null;
    const key = `${name}ExecutedEur`;

    if (!summary) {
      out.push(notDerivable(key, `no KFP summary for FY${fy}`));
      continue;
    }
    out.push({
      key,
      value: actual,
      basis: summary.complete
        ? `КФП cumulative at ${summary.asOf} — a complete year, so this IS the full year`
        : `КФП cumulative at ${summary.asOf} — year in progress, this is actual-so-far`,
      rejected: [
        {
          value: projected,
          why: "seasonal full-year projection for this year",
        },
        { value: planned, why: "the State Budget Law's plan, not execution" },
      ],
    });
  }

  out.push(
    summary?.gdpEur != null
      ? {
          key: "gdpEur",
          value: summary.gdpEur,
          basis:
            "nominal BG GDP for the fiscal year, EUR — ANNUAL, so a share of it is only " +
            "honest against a complete year or a projection, never against actual-so-far",
        }
      : notDerivable("gdpEur", `no GDP sourced or projected for FY${fy}`),
  );

  // ── Band 2: who spends ──────────────────────────────────────────────────
  const adminRows = corpus.readAdminRows(fy);
  if (adminRows) {
    const nodes = new Set(adminRows.map((r) => r.nodeId));
    const executedRows = adminRows.filter((r) => r.executed != null);
    const executedNodes = new Set(executedRows.map((r) => r.nodeId));

    out.push(
      figure({
        key: "spendingUnitCount",
        value: nodes.size,
        basis: `distinct nodeId (първостепенни разпоредители) in reconciliation/${fy}/by-admin.json`,
        rejected: [
          {
            value: adminRows.length,
            why: "ROW count — rows are (nodeId × kind: revenue|expenditure|balance), 1.8×–2.9× the units",
          },
          {
            value: corpus.ministryFileCount,
            why: "files in data/budget/ministries/ — the UNION across all years, not this one",
          },
        ],
        caution:
          "NOT 'ministries', and the key is named accordingly. On FY2024, 28 of the 48 " +
          "units are not ministries — Администрация на президента, ДФ „Земеделие“, ДАНС, " +
          "КЕВР, КФН and other first-level spending units are all in this count.",
      }),
    );

    // The deviations coverage pair. Both numbers travel together or the
    // ranking asserts something the corpus cannot support (plan §2.3).
    out.push({
      key: "deviationsCoveredNodes",
      value: executedNodes.size,
      basis: `distinct nodeId with a non-null executed figure in FY${fy}`,
      caution:
        "NEVER render a deviations ranking without this beside it. On the best year " +
        "measured (2024) it is 8 of 48 spending units, and it is ZERO in six of the " +
        "nine years the reconciliation covers (2018-2021, 2025, 2026). The ROW pairing " +
        "for 2024 is 14 of 97 — that lives on deviationsExecutedRows, and quoting it " +
        "as a number of ministries is the §2.1 error this ledger exists to catch.",
    });
    out.push({
      key: "deviationsTotalNodes",
      value: nodes.size,
      basis: `distinct nodeId in FY${fy}, the denominator for the line above`,
    });
    out.push(
      figure({
        key: "deviationsExecutedRows",
        value: executedRows.length,
        basis: `rows (nodeId × kind) carrying an executed figure in FY${fy}`,
        rejected: [
          {
            value: executedNodes.size,
            why: "distinct spending units — the number a sentence about ministries needs",
          },
        ],
      }),
    );
  } else {
    const why = RECONCILIATION_ABSENT(fy);
    out.push(notDerivable("spendingUnitCount", why));
    out.push(
      notDerivable(
        "deviationsCoveredNodes",
        why,
        "A gate pairing this ledger against the matview MUST fail (or skip loudly) " +
          "here rather than iterate the keys that happen to have values — on CI this " +
          "is every admin figure, which is exactly what §2.3 is about.",
      ),
    );
    out.push(notDerivable("deviationsTotalNodes", why));
    out.push(notDerivable("deviationsExecutedRows", why));
  }

  const programRows = corpus.readProgramRows(fy);
  out.push(
    programRows
      ? {
          key: "programCount",
          value: new Set(programRows.map((r) => r.nodeId)).size,
          basis: `distinct nodeId in reconciliation/${fy}/by-program.json`,
          caution:
            "Unlike by-admin, the program grain carries ONE kind (expenditure) in all " +
            "nine years, so rows === distinct nodeId here. Do not copy by-admin's " +
            "(nodeId × kind) model onto it — migration 153 keys budget_program_fact on " +
            "(fiscal_year, node_id, program_code), without kind, for this reason.",
        }
      : notDerivable("programCount", RECONCILIATION_ABSENT(fy)),
  );

  // ── COFOG — a DIFFERENT CORPUS, and this is the trap on that tile ───────
  const cofogCaution =
    "This is NOT a breakdown of expenditureExecutedEur above, which is the МФ КФП " +
    "STATE budget (constituentBudget: 'state'). Different perimeter, different " +
    "publisher, and a different latest year. A caption calling the functional split " +
    "'where the budget goes' silently swaps one aggregate for the other.";

  if (corpus.cofog) {
    const functions = corpus.cofog.cofogTopLevel.filter((c) => c !== "TOTAL");
    const point =
      (corpus.cofog.series["TOTAL"] ?? []).find((p) => p.year === fy) ?? null;
    out.push({
      key: "cofogFunctionCount",
      value: functions.length,
      basis: "COFOG top-level divisions GF01..GF10, excluding the TOTAL row",
    });
    out.push(
      point
        ? {
            key: "cofogTotalEur",
            value: point.valueEur,
            basis:
              "Eurostat gov_10a_exp, sector S13 — GENERAL GOVERNMENT: the state budget " +
              "PLUS municipalities and the social funds",
            caution: cofogCaution,
          }
        : notDerivable(
            "cofogTotalEur",
            `COFOG reaches ${corpus.cofog.latestYear}; there is no FY${fy} point`,
            cofogCaution,
          ),
    );
  } else {
    out.push(notDerivable("cofogFunctionCount", "data/cofog.json is absent"));
    out.push(
      notDerivable("cofogTotalEur", "data/cofog.json is absent", cofogCaution),
    );
  }

  // ── Personnel — three bases, and they are far apart ─────────────────────
  const pers = corpus.personnel?.national?.[String(fy)];
  const personnelCaution =
    "A position is not a person, and these three are FAR apart: measured on FY2024 " +
    "they are 145,802 budgeted / 132,392 filled / 98,975 NSI — a 47% spread between " +
    "the widest and the narrowest. 'How many public employees' has no single true " +
    "answer here, so a tile must name which one it shows.";
  out.push(
    pers?.positions?.total != null
      ? {
          key: "personnelPositions",
          value: pers.positions.total,
          basis: `budgeted POSITIONS (щатни бройки) in the annual Доклад for ${fy}`,
          rejected: [
            {
              value: pers.positions.filled ?? null,
              why: "positions actually FILLED — present 2018-2025, null only for 2017",
            },
            {
              value: pers.nsiHeadcount?.total ?? null,
              why: "NSI list-headcount — a different publisher and a narrower perimeter (it excludes МВР and МО)",
            },
          ],
          caution: personnelCaution,
        }
      : notDerivable(
          "personnelPositions",
          `no annual Доклад ingested for ${fy}`,
          personnelCaution,
        ),
  );

  // ── Investments ─────────────────────────────────────────────────────────
  const inv = corpus.readInvestmentProgram(fy);
  out.push(
    inv
      ? {
          key: "investmentProjectCount",
          value: inv.projectCount,
          basis: `projects in Приложение III of the ${fy} State Budget Law`,
        }
      : notDerivable(
          "investmentProjectCount",
          `no Приложение III ingested for ${fy}`,
        ),
  );
  out.push(
    inv
      ? {
          key: "investmentGrandTotalEur",
          value: inv.grandTotal.amountEur,
          basis: `sum of every Приложение III project for ${fy}, EUR`,
        }
      : notDerivable(
          "investmentGrandTotalEur",
          `no Приложение III ingested for ${fy}`,
        ),
  );

  // ── The legislative path, and the OGP frame's input ─────────────────────
  if (corpus.documents) {
    const docs = corpus.documents.documents;
    const byKind = docs.reduce<Partial<Record<BudgetDocKind, number>>>(
      (m, d) => {
        m[d.kind] = (m[d.kind] ?? 0) + 1;
        return m;
      },
      {},
    );
    // Iterate the UNION, not the observed keys: a kind that drops to zero must
    // report 0 rather than losing its key.
    for (const kind of DOC_KINDS) {
      out.push({
        key: `documentCount:${kind}`,
        value: byKind[kind] ?? 0,
        basis: `documents of kind '${kind}', every record regardless of fiscal year (one — the kfp-feed — carries none)`,
      });
    }
    out.push(
      figure({
        key: "documentCountTotal",
        value: docs.length,
        basis: "every record in documents.json, all years",
        rejected: [
          {
            value: docs.filter((d) => d.fiscalYear === fy).length,
            why: `only FY${fy} — the scoped answer, which is what a scoped page needs`,
          },
        ],
      }),
    );
  } else {
    for (const kind of DOC_KINDS) {
      out.push(
        notDerivable(
          `documentCount:${kind}`,
          "data/budget/documents.json is absent",
        ),
      );
    }
    out.push(
      notDerivable(
        "documentCountTotal",
        "data/budget/documents.json is absent",
      ),
    );
  }

  // ── The wire ────────────────────────────────────────────────────────────
  const kfpCumulativeCaution =
    "КФП lines are CUMULATIVE year-to-date. Summing periods double-counts by " +
    "roughly n(n+1)/2; take the December (or latest) cumulative per fiscal year.";
  if (corpus.kfp) {
    const periods = corpus.kfp.observations.map((o) => o.period).sort();
    out.push({
      key: "latestKfpPeriod",
      value: periods[periods.length - 1] ?? null,
      basis: "newest КФП observation period across all series",
    });
    out.push({
      key: "kfpFirstPeriod",
      value: periods[0] ?? null,
      basis: "oldest КФП observation period",
      caution:
        "The КФП feed and the LAW index do not start in the same year. A hub sentence " +
        "saying 'since N' must say which of the two it means.",
    });
    out.push({
      key: "kfpObservationCount",
      value: corpus.kfp.observations.length,
      basis: "observation rows = periods × series (5 series), not months",
      caution: kfpCumulativeCaution,
    });
  } else {
    out.push(notDerivable("latestKfpPeriod", "data/budget/kfp.json is absent"));
    out.push(notDerivable("kfpFirstPeriod", "data/budget/kfp.json is absent"));
    out.push(
      notDerivable(
        "kfpObservationCount",
        "data/budget/kfp.json is absent",
        kfpCumulativeCaution,
      ),
    );
  }

  // ── The traps that are figures in their own right ───────────────────────
  const monthsCaution =
    "NOT the months of the year the figure covers. FY2021 carries 6 with " +
    "complete:true, because the December cumulative is the whole year. Rendering " +
    "this as coverage states something false about a complete year.";
  if (summary) {
    out.push({
      key: "monthsAvailable",
      value: summary.monthsAvailable,
      basis: `monthly КФП observations CAPTURED for FY${fy}`,
      caution: monthsCaution,
    });
    out.push({
      key: "complete",
      value: summary.complete,
      basis: "the fiscal year has its December cumulative",
    });
    out.push({
      key: "asOf",
      value: summary.asOf,
      basis:
        "the date the cumulative is measured at — a CALENDAR day, so format it in UTC " +
        "or it renders a day early west of UTC and disagrees with the ?fy= it links to",
    });
  } else {
    const why = `no KFP summary for FY${fy}`;
    out.push(notDerivable("monthsAvailable", why, monthsCaution));
    out.push(notDerivable("complete", why));
    out.push(notDerivable("asOf", why));
  }

  return out;
};

/** Every fiscal year the ledger can measure, oldest first — the UNION of the
 *  KFP summary set and the document/coverage year list, which reaches further
 *  back (2018 vs 2021). `defaultFiscalYear()` still picks from the KFP set
 *  only: the widest year the ledger can SAY something about is not the year the
 *  hub should OPEN on. */
export const ledgerYears = (corpus: BudgetCorpus): number[] => {
  const years = new Set<number>(
    (corpus.index?.years ?? []).map((y) => y.fiscalYear),
  );
  for (const y of corpus.index?.fiscalYears ?? []) years.add(y.fiscalYear);
  return [...years].sort((a, b) => a - b);
};
