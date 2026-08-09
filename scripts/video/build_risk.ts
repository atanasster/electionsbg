/**
 * Precomputes the election-risk explainer's data layer and every figure it
 * claims, with assertions — so a data refresh that moves the story fails the
 * BUILD rather than silently changing what the narration asserts.
 *
 *   npm run video:data-risk
 *
 * ── WHY IT RE-USES THE SITE'S OWN COMPUTATION ─────────────────────────────────
 * The composite is not stored anywhere: `/risk-analysis` computes it in the
 * browser from nine JSON artifacts. Re-deriving it here by hand would give the
 * video a second, drifting definition of its own subject — the worst possible
 * failure for a video ABOUT how the index is built. So this reads the same
 * artifacts off disk and calls the same `computeRiskComposite` the hero and the
 * AI `riskIndex` tool call, then asserts the result matches what the page shows.
 *
 * ── WHY THE COMPARISON SET IS SEVEN CYCLES AND NOT THIRTEEN ───────────────────
 * The headline is the MEAN of the AVAILABLE integrity signals, and availability
 * changes across the series: machine votes only exist from 2009, flash-memory
 * auditability only from 2021-07. Cycles scored on 3 of 5 signals are not
 * comparable with cycles scored on 5 of 5 — averaging a different subset is a
 * different statistic wearing the same number. The script therefore compares
 * only the `signals === 5` cycles and asserts the set has not changed shape.
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  computeRiskComposite,
  BAND,
  SECTION_CAP_PCT,
  MACHINE_DRIFT_CAP_PCT,
  MISSING_FLASH_CAP_PCT,
  CONCENTRATION_CAP_PCT,
  PROCEDURAL_CAP_PCT,
  POLLS_FLOOR_PP,
  POLLS_CAP_PP,
  CLUSTER_SHARE_FLOOR_PCT,
  CLUSTER_SHARE_CAP_PCT,
  type RiskCompositeComponentId,
} from "../../src/data/riskScore/computeRiskComposite";
import type { Votes, ElectionInfo } from "../../src/data/dataTypes";
import type { RiskScoreSummary } from "../../src/data/riskScore/useRiskScore";
import type { RiskClustersReport } from "../../src/data/riskScore/useRiskClusters";
import type { SuspiciousSettlementsReport } from "../../src/data/dashboard/useSuspiciousSections";
import type { BenfordReport } from "../../src/data/benford/useBenford";
import type { NationalSummary } from "../../src/data/dashboard/dashboardTypes";
import type { ProblemSectionsReport } from "../../src/data/reports/useProblemSections";
import type { PollsAccuracy } from "../../src/data/polls/pollsTypes";

const OUT = resolve("video/src/generated/risk.json");

/** The election the video is about. */
const SUBJECT = "2026_04_19";
/**
 * The comparison the concentration section makes — and the ONE place in this
 * video where a raw drop would mislead, so both sides' TURNOUT is carried out
 * with it. 592 → 145 settlements looks like a collapse in controlled voting; it
 * is also 2,12 m → 3,16 m voters, and higher turnout mechanically dilutes an
 * ≥80% share. The script states both and claims neither causes the other.
 */
const CONC_BASELINE = "2024_06_09";

const grab = <T>(p: string): T | null => {
  const f = resolve("data" + p);
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, "utf8")) as T;
  } catch {
    return null;
  }
};

/**
 * Country-aggregate the region votes PER party first (machine + flash), so the
 * machine-drift component sees net per-party disagreement rather than the larger
 * per-region sum — mirrors the hook's `countryVotes()` and `ai/tools/integrity`.
 */
const aggregateCountryVotes = (
  regions: { results?: { votes?: Votes[] } }[] | null,
): { results: { votes: Votes[] } } | null => {
  if (!regions) return null;
  const agg = new Map<number, Votes>();
  for (const r of regions) {
    for (const v of r.results?.votes ?? []) {
      const cur = agg.get(v.partyNum) ?? {
        partyNum: v.partyNum,
        totalVotes: 0,
        machineVotes: 0,
        suemgVotes: 0,
      };
      cur.totalVotes += v.totalVotes ?? 0;
      cur.machineVotes = (cur.machineVotes ?? 0) + (v.machineVotes ?? 0);
      cur.suemgVotes = (cur.suemgVotes ?? 0) + (v.suemgVotes ?? 0);
      agg.set(v.partyNum, cur);
    }
  }
  return { results: { votes: [...agg.values()] } };
};

type CycleRow = {
  election: string;
  /** Short display label, e.g. "04.2026". */
  label: string;
  score: number;
  band: string;
  contextScore: number | null;
  /** How many of the five integrity signals were available. */
  signals: number;
  components: Record<
    RiskCompositeComponentId,
    { value: number; available: boolean; detail: string | null }
  >;
};

const main = () => {
  const elections = JSON.parse(
    readFileSync(resolve("src/data/json/elections.json"), "utf8"),
  ) as ElectionInfo[];

  const problemSectionsStats = grab<ElectionInfo[]>(
    "/problem_sections_stats.json",
  );
  const pollsAccuracy = grab<PollsAccuracy>("/polls/accuracy.json");

  const rows: CycleRow[] = [];
  for (let i = 0; i < elections.length; i++) {
    const e = elections[i]!;
    const el = e.name;
    const composite = computeRiskComposite({
      selected: el,
      risk: grab<RiskScoreSummary>(
        `/${el}/reports/section/risk_score_summary.json`,
      ),
      countryVotes: aggregateCountryVotes(
        grab<{ results: { votes: Votes[] } }[]>(`/${el}/region_votes.json`),
      ),
      suspicious: grab<SuspiciousSettlementsReport>(
        `/${el}/dashboard/suspicious_settlements.json`,
      ),
      benford: grab<BenfordReport>(`/${el}/reports/benford.json`),
      national: grab<NationalSummary>(`/${el}/national_summary.json`),
      problemSections: grab<ProblemSectionsReport>(
        `/${el}/problem_sections.json`,
      ),
      problemSectionsStats,
      pollsAccuracy,
      clusters: grab<RiskClustersReport>(
        `/${el}/reports/section/risk_clusters.json`,
      ),
      electionStats: e,
      priorElections: elections[i + 1],
    });
    if (!composite) continue;
    const [y, m] = el.split("_");
    rows.push({
      election: el,
      label: `${m}.${y}`,
      score: +composite.score.toFixed(2),
      band: composite.band,
      contextScore:
        composite.contextScore == null
          ? null
          : +composite.contextScore.toFixed(2),
      signals: composite.integrityAvailableCount,
      components: Object.fromEntries(
        composite.components.map((c) => [
          c.id,
          {
            value: +c.value.toFixed(2),
            available: c.available,
            detail: c.detail ?? null,
          },
        ]),
      ) as CycleRow["components"],
    });
  }

  const fail = (m: string): never => {
    console.error(`Refusing to write — the story moved: ${m}`);
    process.exit(1);
  };

  const subject = rows.find((r) => r.election === SUBJECT);
  if (!subject) fail(`no composite for ${SUBJECT}`);

  // The comparable set: cycles scored on all five integrity signals. Chronological
  // (the elections catalogue is newest-first, so reverse it for the chart).
  const comparable = rows.filter((r) => r.signals === 5).reverse();
  const mean =
    comparable.reduce((s, r) => s + r.score, 0) / (comparable.length || 1);
  const peak = comparable.reduce((a, b) => (b.score > a.score ? b : a));

  // "Lowest since X": the most recent comparable cycle scoring BELOW the subject.
  const older = comparable.filter((r) => r.election !== SUBJECT);
  const lowerThanSubject = older.filter((r) => r.score < subject!.score);
  const lowestSince = lowerThanSubject.at(-1) ?? null;

  const c = subject!.components;
  const pctOf = (detail: string | null): number | null => {
    const m = detail?.match(/\(([\d.,]+)%\)/);
    return m ? Number(m[1]!.replace(",", ".")) : null;
  };
  const intsOf = (detail: string | null): [number, number] | null => {
    const m = detail?.match(/^([\d\s\u00A0]+)\s*\/\s*([\d\s\u00A0]+)\s*\(/);
    if (!m) return null;
    const n = (s: string) => Number(s.replace(/[\s\u00A0]/g, ""));
    return [n(m[1]!), n(m[2]!)];
  };

  const machinePair = intsOf(c.machine.detail);
  const pedersen = Number(
    c.voteSwitching.detail?.replace(/[^\d.]/g, "") ?? "NaN",
  );
  const pedersenRank =
    rows
      .filter((r) => r.components.voteSwitching.available)
      .map((r) =>
        Number(r.components.voteSwitching.detail!.replace(/[^\d.]/g, "")),
      )
      .filter((v) => v > pedersen).length + 1;

  /** Raw section-screening bands — the long-form script counts them out loud. */
  const riskSummary = grab<RiskScoreSummary>(
    `/${SUBJECT}/reports/section/risk_score_summary.json`,
  );
  const suspSubject = grab<SuspiciousSettlementsReport>(
    `/${SUBJECT}/dashboard/suspicious_settlements.json`,
  );
  const suspBaseline = grab<SuspiciousSettlementsReport>(
    `/${CONC_BASELINE}/dashboard/suspicious_settlements.json`,
  );
  const benfordSubject = grab<BenfordReport>(
    `/${SUBJECT}/reports/benford.json`,
  );

  const facts = {
    election: SUBJECT,
    /** Ten: five integrity + five context. Counted, not restated. */
    componentCount: subject!.components
      ? Object.keys(subject!.components).length
      : 0,
    score: subject!.score,
    scoreRounded: Math.round(subject!.score),
    band: subject!.band,
    contextScore: subject!.contextScore,
    integrity: {
      sections: {
        score: Math.round(c.sections.value),
        pct: pctOf(c.sections.detail),
        capPct: SECTION_CAP_PCT,
        weighted: intsOf(c.sections.detail)?.[0] ?? null,
        turnout: intsOf(c.sections.detail)?.[1] ?? null,
        totalSections: riskSummary?.totalSections ?? null,
        /** Per-section signals feeding each section's own score (not the five). */
        signalsPerSection: riskSummary?.signalsTotal ?? null,
        /** The four screening bands, counted out loud in the long-form script. */
        counts: riskSummary?.counts ?? null,
        /** Confidence weights the band votes are summed with before the share. */
        bandWeights: { critical: 1.0, high: 0.5, elevated: 0.2 },
        detail: c.sections.detail,
      },
      machine: {
        score: Math.round(c.machine.value),
        pct: pctOf(c.machine.detail),
        drift: machinePair?.[0] ?? null,
        machineVotes: machinePair?.[1] ?? null,
        /** The cap that makes 0,18% read as 90 — the whole point of the scene. */
        capPct: MACHINE_DRIFT_CAP_PCT,
        detail: c.machine.detail,
      },
      missingFlash: {
        score: Math.round(c.missingFlash.value),
        pct: pctOf(c.missingFlash.detail),
        capPct: MISSING_FLASH_CAP_PCT,
        votes: intsOf(c.missingFlash.detail)?.[0] ?? null,
        machineVotes: intsOf(c.missingFlash.detail)?.[1] ?? null,
        detail: c.missingFlash.detail,
      },
      concentration: {
        score: Math.round(c.concentration.value),
        pct: pctOf(c.concentration.detail),
        capPct: CONCENTRATION_CAP_PCT,
        votes: intsOf(c.concentration.detail)?.[0] ?? null,
        turnout: intsOf(c.concentration.detail)?.[1] ?? null,
        thresholdPct: suspSubject?.concentrated?.threshold ?? null,
        turnoutMln: +((suspSubject?.nationalActualVoters ?? 0) / 1e6).toFixed(
          1,
        ),
        /**
         * `count`, NOT the length of a settlements array — the artifact carries
         * only `top` (the top 3) alongside the count, so a `.length` here reads
         * 3 or undefined while looking exactly like the total.
         */
        settlements: suspSubject?.concentrated?.count ?? null,
        /**
         * The 06.2024 pair — carried WITH its turnout, because the settlement
         * drop and the turnout rise are the same sentence or neither is honest.
         */
        baseline: {
          election: CONC_BASELINE,
          settlements: suspBaseline?.concentrated?.count ?? null,
          turnout: suspBaseline?.nationalActualVoters ?? null,
          turnoutMln: +(
            (suspBaseline?.nationalActualVoters ?? 0) / 1e6
          ).toFixed(1),
        },
        detail: c.concentration.detail,
      },
      procedural: {
        score: Math.round(c.procedural.value),
        pct: pctOf(c.procedural.detail),
        capPct: PROCEDURAL_CAP_PCT,
        votes: intsOf(c.procedural.detail)?.[0] ?? null,
        turnout: intsOf(c.procedural.detail)?.[1] ?? null,
        detail: c.procedural.detail,
      },
    },
    context: {
      /** The context-track average — shown beside the headline, never inside it. */
      average:
        subject!.contextScore == null
          ? null
          : Math.round(subject!.contextScore),
      benford: {
        score: Math.round(c.benford.value),
        detail: c.benford.detail,
        strong: Number(c.benford.detail?.split("/")[0]?.trim() ?? "NaN"),
        qualifying: Number(c.benford.detail?.split("/")[1]?.trim() ?? "NaN"),
        /** Parties in the report before the ≥100-section qualification. */
        partiesInReport: benfordSubject?.parties.length ?? null,
      },
      neighborhoodsSwing: {
        score: Math.round(c.neighborhoodsSwing.value),
        tracked:
          grab<ProblemSectionsReport>(`/${SUBJECT}/problem_sections.json`)
            ?.neighborhoods?.length ?? null,
        detail: c.neighborhoodsSwing.detail,
        excessPp: Number(
          c.neighborhoodsSwing.detail?.match(/([\d.]+)pp/)?.[1] ?? "NaN",
        ),
      },
      polls: {
        score: Math.round(c.polls.value),
        maePp: Number(c.polls.detail?.replace(/[^\d.]/g, "") ?? "NaN"),
        floorPp: POLLS_FLOOR_PP,
        capPp: POLLS_CAP_PP,
        detail: c.polls.detail,
      },
      clusters: {
        score: Math.round(c.clusters.value),
        pct: pctOf(c.clusters.detail),
        clustered: intsOf(c.clusters.detail)?.[0] ?? null,
        flagged: intsOf(c.clusters.detail)?.[1] ?? null,
        floorPct: CLUSTER_SHARE_FLOOR_PCT,
        capPct: CLUSTER_SHARE_CAP_PCT,
        detail: c.clusters.detail,
      },
      voteSwitching: {
        score: Math.round(c.voteSwitching.value),
        pedersen,
        /** 1 = highest volatility we have ever measured. */
        rank: pedersenRank,
        /** The only cycle above it — the script names the year out loud. */
        higherLabel:
          rows
            .filter((r) => r.components.voteSwitching.available)
            .find(
              (r) =>
                Number(
                  r.components.voteSwitching.detail!.replace(/[^\d.]/g, ""),
                ) > pedersen,
            )?.label ?? null,
        measuredCycles: rows.filter((r) => r.components.voteSwitching.available)
          .length,
      },
    },
    /**
     * The one comparison the video's spine rests on, as ONE object — so the
     * scene that shows «47 < 54» can ground both halves at a single path
     * instead of two that each carry half the claim.
     */
    comparison: {
      score: Math.round(subject!.score),
      mean: Math.round(mean),
      lowestSinceLabel: lowestSince?.label ?? null,
    },
    history: {
      cycles: comparable.length,
      mean: +mean.toFixed(1),
      /** Displayed rounded, like every figure the page itself shows. */
      meanRounded: Math.round(mean),
      peakLabel: peak.label,
      peakScore: Math.round(peak.score),
      /**
       * Whether the peak cycle out-scored the subject on EVERY integrity signal
       * — a stronger and more checkable claim than "it was higher overall", and
       * the one the script actually makes.
       */
      peakHigherOnAllFive: (
        [
          "sections",
          "machine",
          "missingFlash",
          "concentration",
          "procedural",
        ] as const
      ).every((k) => peak.components[k].value > subject!.components[k].value),
      lowestSinceLabel: lowestSince?.label ?? null,
      lowestSinceScore: lowestSince ? Math.round(lowestSince.score) : null,
      /** Band boundary that makes 47 read as "Висок". */
      highBandFloor: 40,
      /** Every boundary, read off BAND() itself rather than restated here. */
      bands: [0, 20, 40, 60].map((v) => ({ floor: v, band: BAND(v) })),
      measuredCycles: rows.length,
      range: {
        first: comparable[0]?.label ?? null,
        last: comparable.at(-1)?.label ?? null,
      },
      minSignals: Math.min(...rows.map((r) => r.signals)),
      maxSignals: Math.max(...rows.map((r) => r.signals)),
    },
  };

  // ── Assertions: every one of these is spoken in the script ─────────────────
  //
  // The long-form cut walks each of the ten signals in turn, so the assertion
  // set is wider than a 90 s explainer's would be: a figure that is merely
  // MENTIONED still gets one, because the narration states it as fact.
  const eq = (got: unknown, want: unknown, what: string) => {
    if (got !== want)
      fail(`${what} is now ${String(got)}, script says ${String(want)}`);
  };

  if (facts.scoreRounded !== 47)
    fail(`headline is now ${facts.scoreRounded}, script says 47`);
  if (facts.band !== "high")
    fail(`band is now ${facts.band}, script says «Висок»`);
  if (subject!.signals !== 5)
    fail(
      `${SUBJECT} now has ${subject!.signals}/5 signals, script says all five`,
    );
  if (facts.integrity.sections.score !== 41)
    fail(`sections is now ${facts.integrity.sections.score}, script says 41`);
  if (facts.integrity.sections.pct !== 2.03)
    fail(`sections is now ${facts.integrity.sections.pct}%, script says 2,03%`);
  if (facts.integrity.machine.score !== 90)
    fail(`machine is now ${facts.integrity.machine.score}, script says 90`);
  if (facts.integrity.machine.pct !== 0.18)
    fail(
      `machine drift is now ${facts.integrity.machine.pct}%, script says 0,18%`,
    );
  if (facts.integrity.machine.drift !== 2788)
    fail(
      `machine drift is now ${facts.integrity.machine.drift} votes, script says 2 788`,
    );
  if (!(facts.integrity.machine.pct! < facts.integrity.machine.capPct))
    fail(
      `drift no longer sits UNDER the 0,2% cap — the whole scene 5 argument`,
    );
  if (facts.integrity.missingFlash.score !== 59)
    fail(
      `missingFlash is now ${facts.integrity.missingFlash.score}, script says 59`,
    );
  if (facts.integrity.concentration.score !== 29)
    fail(
      `concentration is now ${facts.integrity.concentration.score}, script says 29`,
    );
  if (facts.integrity.procedural.score !== 18)
    fail(
      `procedural is now ${facts.integrity.procedural.score}, script says 18`,
    );
  if (facts.history.cycles !== 7)
    fail(`${facts.history.cycles} comparable cycles now, script says seven`);
  if (Math.round(facts.history.mean) !== 54)
    fail(`comparable mean is now ${facts.history.mean}, script says 54`);
  if (facts.history.peakScore !== 77 || facts.history.peakLabel !== "06.2024")
    fail(
      `peak is now ${facts.history.peakScore} at ${facts.history.peakLabel}, script says 77 in 06.2024`,
    );
  if (!(facts.score < facts.history.mean))
    fail(
      `the subject is no longer BELOW the comparable mean — the spine of the video`,
    );
  if (facts.history.lowestSinceLabel !== "10.2022")
    fail(
      `last lower cycle is now ${facts.history.lowestSinceLabel}, script says 10.2022`,
    );
  if (!(facts.score > facts.history.highBandFloor))
    fail(
      `the score no longer lands in the «Висок» band — scene 9 has no subject`,
    );
  if (facts.context.voteSwitching.score !== 100)
    fail(
      `volatility is now ${facts.context.voteSwitching.score}, script says it is maxed out`,
    );
  if (facts.context.voteSwitching.rank !== 2)
    fail(
      `Pedersen is now rank ${facts.context.voteSwitching.rank}, script says second-highest`,
    );
  if (facts.context.voteSwitching.pedersen !== 49.7)
    fail(
      `Pedersen is now ${facts.context.voteSwitching.pedersen}, script says 49,7`,
    );

  // ── The long-form cut's extra claims ──────────────────────────────────────
  const sec = facts.integrity.sections;
  eq(sec.totalSections, 12705, "section count");
  eq(sec.counts?.critical, 6, "critical sections");
  eq(sec.counts?.high, 297, "high sections");
  eq(sec.counts?.elevated, 1629, "elevated sections");
  eq(sec.weighted, 65790, "band-weighted votes");
  eq(sec.turnout, 3233136, "screening denominator");
  eq(sec.capPct, 5, "section cap");

  eq(facts.integrity.machine.machineVotes, 1542553, "machine votes");
  eq(facts.integrity.missingFlash.votes, 9104, "missing-flash votes");
  eq(facts.integrity.missingFlash.pct, 0.59, "missing-flash share");
  eq(facts.integrity.missingFlash.capPct, 1, "missing-flash cap");

  const conc = facts.integrity.concentration;
  eq(conc.thresholdPct, 80, "concentration threshold");
  eq(conc.settlements, 145, "concentrated settlements");
  eq(conc.votes, 18537, "concentrated votes");
  eq(conc.baseline.settlements, 592, "06.2024 concentrated settlements");
  eq(conc.turnout, 3164049, "04.2026 turnout");
  eq(conc.baseline.turnout, 2122887, "06.2024 turnout");
  // The confound the script names out loud: turnout ROSE while the settlement
  // count fell. If that ever inverts, the honest framing changes completely.
  if (!(conc.turnout! > conc.baseline.turnout!))
    fail(
      `turnout no longer ROSE against ${CONC_BASELINE} — the confound scene inverts`,
    );
  if (!(conc.settlements! < conc.baseline.settlements!))
    fail(`concentrated settlements no longer FELL against ${CONC_BASELINE}`);

  eq(facts.integrity.procedural.votes, 11336, "procedural votes");
  eq(facts.integrity.procedural.pct, 0.36, "procedural share");

  eq(facts.context.average, 40, "context-track average");
  eq(facts.context.benford.strong, 1, "Benford strong deviations");
  eq(facts.context.benford.qualifying, 12, "Benford qualifying parties");
  eq(
    facts.context.neighborhoodsSwing.excessPp,
    5.9,
    "neighborhood excess swing",
  );
  eq(facts.context.polls.maePp, 2.51, "polling mean error");
  eq(facts.context.clusters.clustered, 108, "clustered sections");
  eq(facts.context.clusters.flagged, 1263, "flagged geolocatable sections");
  eq(facts.context.clusters.pct, 8.6, "clustered share");
  eq(facts.componentCount, 10, "component count");
  eq(
    facts.integrity.concentration.turnoutMln,
    3.2,
    "04.2026 turnout in millions",
  );
  eq(
    facts.integrity.concentration.baseline.turnoutMln,
    2.1,
    "06.2024 turnout in millions",
  );
  eq(facts.history.range.first, "07.2021", "first comparable cycle");
  eq(facts.history.range.last, "04.2026", "last comparable cycle");
  eq(facts.history.minSignals, 3, "smallest signal count in the series");
  eq(facts.history.maxSignals, 5, "largest signal count in the series");
  eq(facts.integrity.sections.signalsPerSection, 7, "per-section signals");
  eq(facts.context.neighborhoodsSwing.tracked, 8, "tracked neighbourhoods");
  eq(
    facts.context.voteSwitching.higherLabel,
    "07.2009",
    "the only higher-volatility cycle",
  );
  if (!facts.history.peakHigherOnAllFive)
    fail(
      `${facts.history.peakLabel} no longer out-scores ${SUBJECT} on all five signals`,
    );
  eq(facts.history.measuredCycles, 13, "elections measured");
  if (facts.history.bands.map((b) => b.floor).join() !== "0,20,40,60")
    fail(
      `band boundaries moved to ${facts.history.bands.map((b) => b.floor).join()}`,
    );

  mkdirSync(resolve("video/src/generated"), { recursive: true });
  writeFileSync(
    OUT,
    JSON.stringify({ facts, subject, comparable, all: rows }),
    "utf8",
  );

  console.log(
    `  headline    ${facts.scoreRounded} · ${facts.band} (context ${facts.contextScore})`,
  );
  console.log(
    `  integrity   sections ${facts.integrity.sections.score} · machine ${facts.integrity.machine.score} · flash ${facts.integrity.missingFlash.score} · conc ${facts.integrity.concentration.score} · proc ${facts.integrity.procedural.score}`,
  );
  console.log(
    `  machine     ${facts.integrity.machine.drift} / ${facts.integrity.machine.machineVotes} = ${facts.integrity.machine.pct}% (cap ${facts.integrity.machine.capPct}%)`,
  );
  console.log(
    `  history     ${facts.history.cycles} comparable cycles, mean ${facts.history.mean}, peak ${facts.history.peakScore} (${facts.history.peakLabel}), last lower ${facts.history.lowestSinceLabel}`,
  );
  console.log(
    `  volatility  Pedersen ${facts.context.voteSwitching.pedersen} — rank ${facts.context.voteSwitching.rank} of ${facts.context.voteSwitching.measuredCycles}`,
  );
  console.log(`  → ${OUT}`);
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
