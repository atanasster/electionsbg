// Build the eval page's manifest from the published artifacts.
//
//   npx tsx ai/llm/evalsIndex.ts   →  data/ai/evals/index.json
//
// WHY A MANIFEST: the eval screen used to hardcode two filenames, so adding a run meant
// editing the page and a renamed artifact broke it silently. The page now reads this
// index, and `evalsIndex.test.ts` regenerates it in memory and compares, so the index
// cannot drift from the artifacts it describes.
//
// Every `current_*.json` in the directory is included, whatever its label. A run is
// described by what it MEASURED — its case count, its groups, the budget it ran under,
// whether the budget was forced, and its headline metrics per language — so a
// narrowed run and a full-catalogue run are comparable at a glance without either
// being mistaken for the other.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const DIR = join(process.cwd(), "data/ai/evals");

type Metrics = {
  n: number;
  toolAcc: number | null;
  callAcc: number | null;
  argN: number;
  argAcc: number | null;
  jsonValidRate: number | null;
  irrelevanceAcc?: number | null;
  jevRouted?: number | null;
  jevDeclined?: number | null;
  toolAccWhenRouted?: number | null;
  degraded?: number | null;
  jevUnsure?: number | null;
  deterministicallyDerived?: number;
};
type Row = {
  id: string;
  lang: "en" | "bg";
  goldInCandidates?: boolean;
  candidatesKept?: number | null;
};
type RunArtifact = {
  label?: string;
  model?: string;
  finishedAt?: string;
  caseCount: number;
  caseGroups?: string[];
  routingBudget?: number;
  forcedBudget?: boolean;
  startedAt?: string;
  metrics: Record<"en" | "bg", Metrics>;
  groups?: Record<string, Record<"en" | "bg", Metrics>>;
  rows?: Row[];
};

const compact = (m: Metrics) => ({
  n: m.n,
  toolAcc: m.toolAcc,
  callAcc: m.callAcc,
  argN: m.argN,
  argAcc: m.argAcc,
  jsonValid: m.jsonValidRate,
  // OMITTED, never `0`. An artifact that did not record a field must not
  // publish "we measured this and it was none" — absent and zero are different
  // claims, and only one of them is a fact about the run. This applies to
  // `derived` exactly as it does to the abstention fields below; it used to
  // read `?? 0`, which fabricated the measurement it was missing.
  ...(m.deterministicallyDerived != null
    ? { derived: m.deterministicallyDerived }
    : {}),
  // Carried only when the artifact reports them. The Jev lane can DECLINE, and
  // comparing a lane that abstains against ones that always answer without
  // showing how often it abstains flatters it — so the numbers that make the
  // comparison honest must survive compaction.
  //
  // ⚠️ `jevRouted` and `jevDeclined` ANSWER DIFFERENT QUESTIONS and are both
  // needed: `jevRouted` is the share of turns the lane handled at all, while
  // `toolAccWhenRouted` is measured over exactly that subset. Dropping
  // `jevRouted` leaves a consumer able to publish the accuracy without its
  // denominator.
  ...(m.irrelevanceAcc != null ? { irrelevanceAcc: m.irrelevanceAcc } : {}),
  ...(m.jevRouted != null ? { jevRouted: m.jevRouted } : {}),
  ...(m.jevDeclined != null ? { jevDeclined: m.jevDeclined } : {}),
  ...(m.toolAccWhenRouted != null
    ? { toolAccWhenRouted: m.toolAccWhenRouted }
    : {}),
  ...(m.degraded != null ? { degraded: m.degraded } : {}),
  // Below-gate abstention, kept apart from `degraded` (an outage): the two
  // were one flag once, and an abstention rate read as an outage rate.
  ...(m.jevUnsure != null ? { jevUnsure: m.jevUnsure } : {}),
});

/** The page's metric shape, DERIVED from the producer rather than restated —
 *  a renamed key is then a type error instead of a silent `undefined → "—"`.
 *  Import it with `import type`: this module reads the filesystem, so a value
 *  import would pull `node:fs` into the browser bundle. */
export type CompactMetrics = ReturnType<typeof compact>;

/** The deterministic lane reports five figures and no more — it makes no model
 *  call, so it has no `jsonValid`, and it cannot decline, so it has none of the
 *  abstention fields. Typing it as the wider run shape is a lie `tsc` cannot
 *  catch across the page's `fetchData<EvalsIndex>` cast. */
export type DeterministicMetrics = Pick<
  CompactMetrics,
  "n" | "toolAcc" | "callAcc" | "argN" | "argAcc"
>;

const one = (m: {
  n: number;
  toolAccuracy: number;
  callAccuracy: number;
  argumentCases: number;
  argumentAccuracy: number;
}): DeterministicMetrics => ({
  n: m.n,
  toolAcc: m.toolAccuracy,
  callAcc: m.callAccuracy,
  argN: m.argumentCases,
  argAcc: m.argumentAccuracy,
});

const readRuns = () =>
  readdirSync(DIR)
    .filter((f) => /^current_.+\.json$/.test(f))
    .map((file) => {
      const a = JSON.parse(
        readFileSync(join(DIR, file), "utf8"),
      ) as RunArtifact;
      const rows = a.rows ?? [];
      const scored = rows.filter((r) => r.goldInCandidates !== undefined);
      const kept = rows
        .map((r) => r.candidatesKept)
        .filter((n): n is number => typeof n === "number");
      return {
        file,
        // The FILENAME is the identity, not the label inside the artifact: a re-scored
        // replay copies the replayed run's label, so two files can claim `baseline`.
        // `artifactLabel` keeps the original visible when it differs.
        label: file.replace(/^current_|\.json$/g, ""),
        artifactLabel: a.label ?? null,
        model: a.model ?? null,
        finishedAt: a.finishedAt ?? a.startedAt ?? null,
        caseCount: a.caseCount,
        caseGroups: a.caseGroups ?? null,
        // `null` routingBudget means the run predates the field; `forced: false` with a
        // budget means it ran under the production budget.
        routingBudget: a.routingBudget ?? null,
        forcedBudget: a.forcedBudget ?? false,
        metrics: { en: compact(a.metrics.en), bg: compact(a.metrics.bg) },
        groups: Object.fromEntries(
          Object.entries(a.groups ?? {}).map(([g, m]) => [
            g,
            { en: compact(m.en), bg: compact(m.bg) },
          ]),
        ),
        // The retrieval half, where it was recorded: whether the gold tool was even
        // offered, which separates a retrieval miss from a model miss.
        goldInCandidates:
          scored.length > 0
            ? {
                kept: scored.filter((r) => r.goldInCandidates).length,
                total: scored.length,
              }
            : null,
        meanCandidatesKept: kept.length
          ? Number((kept.reduce((a, b) => a + b, 0) / kept.length).toFixed(1))
          : null,
      };
    })
    .sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt)));

// The DETERMINISTIC lane. It costs no API calls and is a different measurement, so it
// is carried beside the routing runs rather than inside them. `legacyMetrics` is the
// pre-starter corpus, which is the denominator the published floors were registered on.
const nonAiPath = join(DIR, "non_ai.json");
const readDeterministic = () => {
  try {
    const a = JSON.parse(readFileSync(nonAiPath, "utf8")) as {
      generatedAt: string;
      caseCount: number;
      caseGroups?: string[];
      metrics: Record<
        "en" | "bg",
        {
          n: number;
          toolAccuracy: number;
          callAccuracy: number;
          argumentCases: number;
          argumentAccuracy: number;
        }
      >;
      legacyMetrics?: Record<
        "en" | "bg",
        {
          n: number;
          toolAccuracy: number;
          callAccuracy: number;
          argumentCases: number;
          argumentAccuracy: number;
        }
      >;
    };
    const shape = (
      m:
        | Record<
            "en" | "bg",
            {
              n: number;
              toolAccuracy: number;
              callAccuracy: number;
              argumentCases: number;
              argumentAccuracy: number;
            }
          >
        | undefined,
      // Named explicitly: `Object.fromEntries` widens to `{[k: string]: …}`,
      // which lets the deterministic lane be typed as if it carried the run
      // artifacts' fields. It carries FIVE, and a consumer that assumed the
      // wider shape would read `undefined` as a measurement.
    ): Record<"en" | "bg", DeterministicMetrics> | null =>
      m
        ? {
            en: one(m.en),
            bg: one(m.bg),
          }
        : null;
    return {
      generatedAt: a.generatedAt,
      caseCount: a.caseCount,
      caseGroups: a.caseGroups ?? null,
      metrics: shape(a.metrics),
      legacyMetrics: shape(a.legacyMetrics),
    };
  } catch {
    return null;
  }
};

/**
 * The manifest, built from the artifacts on disk.
 *
 * Importing this module must not WRITE, or a test that imports it would silently
 * rewrite the committed index and its staleness gate would be checking its own
 * output.
 *
 * It must not READ at import either, and that half is easy to lose: the two
 * readers used to be module-level constants, so `buildIndex()` returned the
 * directory as it stood when the module was first imported. A caller that
 * published an artifact and then called this would have got the PRE-publish
 * snapshot — and the staleness gate, which imports before it compares, could
 * not see the difference.
 */
export const buildIndex = (generatedAt = new Date().toISOString()) => ({
  generatedAt,
  runs: readRuns(),
  deterministic: readDeterministic(),
});

// Only builds when run as a script.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const index = buildIndex();
  const { runs, deterministic } = index;
  writeFileSync(join(DIR, "index.json"), JSON.stringify(index, null, 2) + "\n");
  console.log(
    `wrote data/ai/evals/index.json: ${runs.length} runs (${runs
      .map((r) => `${r.label}:${r.caseCount}`)
      .join(
        ", ",
      )})${deterministic ? ` · deterministic ${deterministic.caseCount} cases` : ""}`,
  );
}
