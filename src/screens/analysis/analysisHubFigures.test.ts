// The bands shared by /parliamentary/analysis and /parliamentary/reports, against a fixture
// measured verbatim from data/2026_04_19/analysis_stats.json (read 2026-08-26).
//
// ⚠️ THE CAPTIONS ARE MORE LOAD-BEARING THAN THE FIGURES HERE, and that is what these
// clauses are mostly about. Two of the four are FLAGS about electoral integrity — a risk
// signal and a Benford deviation — and the destination page's own caveat is titled „Това не
// е доказателство за фалшификация". A band cell that says „4 партии" without that is a
// stronger claim than the page it links to makes, about named parties.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AnalysisStat } from "@/data/analysis/useAnalysisStats";
import { bgCorpus, enCorpus } from "@/locales/allKeys";
import {
  ANALYSIS_BAND,
  EVIDENCE_BANDS,
  analysisHubEvidence,
  groupedInt,
  REPORTS_BAND,
  analysisHubKpis,
  analysisKpiNote,
  promotedStats,
} from "./analysisHubFigures";

const STATS: Record<string, AnalysisStat> = {
  wasted: { kind: "percent", value: 18.02, captionKey: "c" },
  turnout: { kind: "percent", value: 50.7, captionKey: "c" },
  risk: { kind: "count", value: 6, total: 12705, captionKey: "c" },
  benford: { kind: "count", value: 4, captionKey: "c" },
  persistence: { kind: "percent", value: 43.15, captionKey: "c" },
  polls: { kind: "score", value: 1.76, captionKey: "c" },
  demographics: { kind: "score", value: 1.43, captionKey: "c" },
  financing: { kind: "eur", value: 1301686, captionKey: "c" },
};

const t = (k: string, o?: Record<string, unknown>) =>
  o ? [k, ...Object.values(o).map(String)].join(":") : k;
const fmt = (s: AnalysisStat | undefined) => (s ? String(s.value) : undefined);
const int = (n: number) => n.toLocaleString("bg");
const label = (id: string) => `title:${id}`;
const href = (id: string) => `/x/${id}`;

const band = (
  spec = ANALYSIS_BAND,
  stats: Record<string, AnalysisStat> | undefined = STATS,
  hrefOf: (id: string) => string | undefined = href,
) =>
  analysisHubKpis({
    band: spec,
    stats,
    format: fmt,
    formatInt: int,
    labelOf: label,
    hrefOf,
    t,
  });

describe("the analysis band", () => {
  it("promotes the four with a caption-carryable meaning", () => {
    expect(band().map((c) => c.statId)).toEqual([
      "risk",
      "benford",
      "wasted",
      "persistence",
    ]);
  });

  it("leaves the two bare SCORES on their tiles", () => {
    // `polls` (1.76) and `demographics` (1.43) are unlabelled decimals whose unit lives only
    // in their caption. In a tile the scene and title carry that; in a band they would be two
    // naked numbers beside a percentage and a count.
    const ids = band().map((c) => c.statId);
    expect(ids).not.toContain("polls");
    expect(ids).not.toContain("demographics");
    // Non-vacuity: both really are in the payload and really are scores.
    expect(STATS.polls.kind).toBe("score");
    expect(STATS.demographics.kind).toBe("score");
  });

  it("GROUPS the interpolated denominator", () => {
    // i18next interpolates a raw number verbatim, so `{{total}}` rendered „от 12705" beside
    // a headline the tile helper had already grouped — two number formats in one cell.
    expect(band()[0].basis).toContain(int(12705));
    expect(band()[0].basis).not.toContain("12705");
  });

  it("gives a denominator ONLY where there is one", () => {
    // `risk` is 6 of 12,705; `benford` is 4 of nothing the payload states. Interpolating an
    // empty total must not leave „от " dangling in the rendered basis — the key for a
    // denominator-less stat simply does not take one.
    expect(band()[1].basis).toBe("analysis_kpi_benford_basis:");
    expect(bgCorpus.analysis_kpi_benford_basis).not.toContain("{{total}}");
  });

  it("WITHHOLDS a cell whose stat the election lacks", () => {
    // The earlier cycles carry fewer analyses, and „0 критични секции" is a claim that every
    // section was clean rather than that nobody ran the check.
    const partial = { risk: STATS.risk };
    expect(band(ANALYSIS_BAND, partial).map((c) => c.statId)).toEqual(["risk"]);
  });

  it("WITHHOLDS a cell with no destination on this hub", () => {
    // §3.1 rule 4: a KPI links to a page that can name its rows, and a hub that does not
    // front the analysis cannot. Also what keeps a capability-gated report off the band.
    const noBenford = (id: string) => (id === "benford" ? undefined : href(id));
    expect(band(ANALYSIS_BAND, STATS, noBenford).map((c) => c.statId)).toEqual([
      "risk",
      "wasted",
      "persistence",
    ]);
  });

  it("returns nothing at all when there is no payload", () => {
    // ⚠️ NOT `band(ANALYSIS_BAND, undefined)` — a default parameter fires on an EXPLICIT
    // undefined, so that form quietly re-applies the fixture and asserts nothing.
    expect(
      analysisHubKpis({
        band: ANALYSIS_BAND,
        stats: undefined,
        format: fmt,
        formatInt: int,
        labelOf: label,
        hrefOf: href,
        t,
      }),
    ).toEqual([]);
  });
});

describe("the reports band", () => {
  it("carries the two its own registry has a stat for", () => {
    expect(band(REPORTS_BAND).map((c) => c.statId)).toEqual([
      "risk",
      "turnout",
    ]);
  });

  it("captions `risk` identically on both hubs", () => {
    // It is literally the same figure. Two basis keys would be two ways to caption one
    // number, and the weaker one would eventually win.
    expect(band(REPORTS_BAND)[0].basis).toBe(band(ANALYSIS_BAND)[0].basis);
  });

  it("takes its DESTINATION from the hub, not the band spec", () => {
    // The same stat points at /risk-score here and /risk-analysis on the analysis hub, so a
    // destination baked into the shared module would be wrong for one of them.
    expect(REPORTS_BAND.map((b) => Object.keys(b))).toEqual([
      ["statId", "basisKey"],
      ["statId", "basisKey"],
    ]);
  });
});

describe("the caveats", () => {
  it("says a Benford deviation is NOT evidence of falsification", () => {
    // ⚠️ THE CLAUSE THIS WHOLE MODULE EXISTS FOR. The destination page's own caveat is
    // titled „Това не е доказателство за фалшификация" — a band cell reading „4 партии"
    // without it is a stronger claim than the page it links to makes, about named parties.
    expect(bgCorpus.analysis_kpi_benford_basis).toMatch(
      /НЕ е доказателство за фалшификация/i,
    );
    expect(enCorpus.analysis_kpi_benford_basis).toMatch(
      /NOT evidence of falsification/i,
    );
  });

  it("⚠️ does NOT narrow the composite risk score to one signal family", () => {
    // ⚠️⚠️ THE CLAUSE THAT WAS MISSING, and its absence is exactly how the first cut
    // shipped. `risk` is `counts.critical` off the COMPOSITE score
    // (scripts/reports/analysis_stats.ts → risk_score_summary.json), which spans
    // PROCEDURAL_SIGNALS ∪ DISTRIBUTION_SIGNALS — seven weighted signals in two families
    // (scripts/reports/risk_score.ts). That file warns in capitals that a composite
    // containing distribution signals cannot answer a question about vote distribution, so
    // „процедурни сигнали" is a party-blind characterisation the number cannot support —
    // and the destination page's own copy („Силно необичайно по множество сигнали") never
    // uses it. Every OTHER clause in this block asserts what a figure is NOT; this is the
    // only one asserting that what the basis says it IS matches the corpus.
    for (const basis of [
      bgCorpus.analysis_kpi_risk_basis,
      enCorpus.analysis_kpi_risk_basis,
      // ⚠️ THE RAIL'S BASIS CAPTIONS THE SAME COMPOSITE, so the rule binds there too. It was
      // outside this loop for one revision, which is how a second caption of one score would
      // have acquired the narrowing the first is guarded against.
      bgCorpus.analysis_evidence_basis,
      enCorpus.analysis_evidence_basis,
    ]) {
      expect(basis).not.toMatch(/процедурн|procedural/i);
      expect(basis).not.toMatch(/разпределени|distribution/i);
      // Non-vacuity: the string still exists, still carries its denominator and its caveat.
      expect(basis).toContain("{{total}}");
    }
    expect(bgCorpus.analysis_kpi_risk_basis).toMatch(/не установени нарушения/);
  });

  it("says a risk signal is not an established irregularity", () => {
    expect(bgCorpus.analysis_kpi_risk_basis).toMatch(/не установени нарушения/);
    expect(enCorpus.analysis_kpi_risk_basis).toMatch(
      /not established irregularities/,
    );
  });

  it("says persistence measures stability, not quality", () => {
    expect(bgCorpus.analysis_kpi_persistence_basis).toMatch(/не за качество/);
  });

  it("the note says the row is not a scale AND not a verdict", () => {
    expect(analysisKpiNote(band(), t)).toBe("analysis_kpi_note");
    expect(bgCorpus.analysis_kpi_note).toMatch(/не се четат едно спрямо друго/);
    expect(bgCorpus.analysis_kpi_note).toMatch(/сигнал/i);
    expect(enCorpus.analysis_kpi_note).toMatch(/signal/i);
  });

  it("⚠️ the note COUNTS NOTHING and NAMES NOTHING, because ONE string serves both hubs", () => {
    // ⚠️ THE DEFECT THIS REPLACED, caught on the rendered page: the first cut read „Две от
    // тях са СИГНАЛИ … рискът по секции и отклонението по Бенфорд". On /parliamentary/reports
    // the band is risk + turnout — so it counted two signals where there is one, and named
    // Бенфорд, which is nowhere on that page. The same shape has now been caught on
    // /governance/sectors, /indicators and here; the sentence must describe the KIND of thing
    // these figures are, which is true of any subset of them.
    expect(analysisKpiNote(band(REPORTS_BAND), t)).toBe("analysis_kpi_note");
    for (const note of [
      bgCorpus.analysis_kpi_note,
      enCorpus.analysis_kpi_note,
    ]) {
      expect(note).not.toMatch(/две|четири|two|four|both/i);
      // ⚠️ A NUMERAL GUARD CANNOT SEE GRAMMATICAL NUMBER. „кое от тях е сигнал" is neuter
      // SINGULAR — „which one of them is a signal" — which re-counts the signals the 4-cell
      // hub has two of, and trips no numeral. It must stay distributive („дали е сигнал").
      expect(note).not.toMatch(/\bкое от тях\b/i);
      // No analysis named by name — every one of them is absent on some election or some hub.
      expect(note).not.toMatch(/Бенфорд|Benford|активност|turnout/i);
    }
  });

  it("is withheld below two cells, where there is nothing to read across", () => {
    expect(analysisKpiNote([], t)).toBeUndefined();
    expect(analysisKpiNote(band().slice(0, 1), t)).toBeUndefined();
  });
});

describe("band ↔ tile, §3.1 rule 5", () => {
  it("promotes exactly the stats that rendered", () => {
    expect([...promotedStats(band())].sort()).toEqual(
      ANALYSIS_BAND.map((b) => b.statId).sort(),
    );
  });

  it("does not promote a stat whose cell was withheld", () => {
    const partial = { risk: STATS.risk };
    const promoted = promotedStats(band(ANALYSIS_BAND, partial));
    expect(promoted.has("risk")).toBe(true);
    expect(promoted.has("benford")).toBe(false);
  });
});

describe("the evidence rail", () => {
  const COUNTS = {
    low: 10773,
    elevated: 1629,
    high: 297,
    critical: 6,
    totalSections: 12705,
  };
  const bandLabel = (b: string) => `band:${b}`;
  // ⚠️ NO DEFAULT ON `to` — a default parameter fires on an EXPLICIT undefined, so
  // `rail(COUNTS, undefined)` would quietly re-apply it and the „no action" clause would
  // assert nothing. That trap has now cost this file two clauses; pass both, always.
  const rail = (
    to: string | undefined,
    counts: typeof COUNTS | undefined = COUNTS,
  ) => analysisHubEvidence(counts, int, bandLabel, to, t);
  const RISK = "/risk-analysis";

  it("⚠️ OMITS the critical band, which the KPI above it already shows", () => {
    // §3.1: a rail row is a figure no tile and no KPI shows. The critical count IS the band's
    // first cell on BOTH hubs, so a row for it would print „6" twice on one page — the
    // band/tile clash one column over. The basis names it in words instead.
    expect(rail(RISK)!.rows.map((r) => r.id)).toEqual([
      "high",
      "elevated",
      "low",
    ]);
    expect(EVIDENCE_BANDS).not.toContain("critical");
    for (const r of rail(RISK)!.rows)
      expect(r.value, "a rail row repeats the KPI's figure").not.toBe(
        int(COUNTS.critical),
      );
  });

  it("orders most severe first, which is not the order of the numbers", () => {
    // A rail sorted by VALUE would read low → high and bury the finding; these are ordinal
    // bands, so the severity order is the meaningful one even though it descends by count.
    const values = rail(RISK)!.rows.map((r) =>
      Number(r.value.replace(/\D/g, "")),
    );
    expect(values).toEqual([297, 1629, 10773]);
  });

  it("carries the denominator, and NOT the critical count, in its basis", () => {
    // The total is what makes three bare counts readable; the critical count is the cell
    // directly above, so the page states it once.
    expect(rail(RISK)!.basis).toContain(int(12705));
    expect(rail(RISK)!.basis).not.toContain(`:${COUNTS.critical}`);
  });

  it("says in words that a band is a SCREEN, not a verdict", () => {
    // The rail's whole job is deflationary — it answers „is six a lot?" with „10 773 of
    // 12 705 carry no significant signal". A row labelled „Висок" with no such clause reads
    // as 297 places where something happened.
    expect(bgCorpus.analysis_evidence_basis).toMatch(
      /екран за преглед, а не установени нарушения/,
    );
    expect(enCorpus.analysis_evidence_basis).toMatch(
      /a screen for review, not established irregularities/,
    );
    expect(bgCorpus.analysis_evidence_basis).toContain("{{total}}");
    // ⚠️ AND IT MUST NOT POINT IN A DIRECTION. It said „критичната лента е числото ГОРЕ" —
    // true on mobile and false at `lg`, where `HubHead` puts the aside in `lg:row-start-1`
    // and the band in `lg:row-start-2`, i.e. the figure is BELOW the rail on every desktop
    // viewport and in the share card's own capture width.
    for (const basis of [
      bgCorpus.analysis_evidence_basis,
      enCorpus.analysis_evidence_basis,
    ])
      expect(basis).not.toMatch(/горе|above|по-долу|below/i);
  });

  it("takes its DESTINATION from the hub, like the band does", () => {
    // /risk-analysis on the analyses hub, /risk-score on the reports hub — one rail, two
    // pages, so the module cannot own the href.
    expect(rail("/risk-score")!.rows.every((r) => r.to === "/risk-score")).toBe(
      true,
    );
    expect(rail("/risk-score")!.action?.to).toBe("/risk-score");
  });

  it("labels each row with the band's OWN name", () => {
    // TEST-001: nothing asserted the labels, so a screen switching to
    // `risk_band_${b}_caption` („Няколко сигнала се отличават.") would caption the rail with
    // sentences and stay green. The label is the band; the sentence is the destination's job.
    expect(rail(RISK)!.rows.map((r) => r.label)).toEqual([
      "band:high",
      "band:elevated",
      "band:low",
    ]);
    // The real keys exist in both corpora — a rail labelled with raw ids is the failure this
    // guards, and `t()` returns the key verbatim when one is missing.
    for (const b of EVIDENCE_BANDS) {
      expect(bgCorpus[`risk_band_${b}`]).toBeTruthy();
      expect(enCorpus[`risk_band_${b}`]).toBeTruthy();
    }
  });

  it("REFUSES when the summary is absent rather than rendering zeros", () => {
    // „0 секции с повишен риск" claims the corpus was screened and came back clean — the
    // exact inversion of „nobody ran the screen".
    expect(
      analysisHubEvidence(undefined, int, bandLabel, "/x", t),
    ).toBeUndefined();
    expect(rail(RISK, { ...COUNTS, totalSections: 0 })).toBeUndefined();
  });

  it("renders no ACTION when the hub has no risk page", () => {
    // A „целият скрининг" button going nowhere is worse than no button.
    const e = rail(undefined);
    expect(e!.action).toBeUndefined();
    expect(e!.rows.every((r) => r.to === undefined)).toBe(true);
  });
});

describe("the rail, at the source", () => {
  // TEST-002 + FINDING-003: the wiring — the counts mapping, the row LABEL key and the
  // destination — was 17 byte-identical lines in each screen with nothing over the copies, so
  // switching ONE hub's label key would caption one distribution two ways and leave every
  // clause green. It now lives once, in `useAnalysisHubEvidence`.
  const screens = [
    "src/screens/analysis/AnalysisHubScreen.tsx",
    "src/screens/reports/hub/ReportsHubScreen.tsx",
  ];

  it("is built in ONE place, which both hubs call", () => {
    for (const path of screens) {
      const src = readFileSync(path, "utf-8");
      expect(src, `${path} does not use the shared rail hook`).toMatch(
        /useAnalysisHubEvidence\(/,
      );
      // …and neither screen re-implements it. The pure builder is the gates test's subject
      // and must stay React-free; the WIRING must not be duplicated back into a screen.
      expect(
        src.includes("analysisHubEvidence("),
        `${path} builds the rail inline instead of through the hook`,
      ).toBe(false);
    }
  });

  it("names the label key exactly once in the tree", () => {
    const hook = readFileSync(
      "src/screens/analysis/useAnalysisHubEvidence.ts",
      "utf-8",
    );
    // ⚠️ THE CLOSING BACKTICK IS LOAD-BEARING. Without it the pattern also matches
    // `risk_band_${b}_caption` — „Няколко сигнала се отличават." — which captions the rail
    // with sentences instead of band names. Measured: that mutation passed this clause.
    expect(hook).toMatch(/risk_band_\$\{b\}`/);
    for (const path of screens)
      expect(
        readFileSync(path, "utf-8"),
        `${path} carries its own copy of the band label key`,
      ).not.toMatch(/risk_band_/);
  });
});

describe("groupedInt", () => {
  it("⚠️ groups a FOUR-digit number in bg, which the locale default does not", () => {
    // Bulgarian CLDR sets minimumGroupingDigits: 2, so `(1629).toLocaleString("bg")` is
    // „1629" — and this module prints 297 / 1 629 / 10 773 in one column, where the odd one
    // out reads as a magnitude difference rather than a formatting one.
    const bg = groupedInt("bg");
    expect(bg(1629)).not.toBe("1629");
    expect(bg(1629).replace(/\s|\u00a0|\u202f/g, "")).toBe("1629");
    expect(bg(10773).replace(/\s|\u00a0|\u202f/g, "")).toBe("10773");
    // Non-vacuity: the plain form really does fail, so this is not asserting a no-op.
    expect((1629).toLocaleString("bg")).toBe("1629");
  });

  it("still groups in en, where the default already did", () => {
    expect(groupedInt("en")(1629)).toBe("1,629");
  });
});

describe("the demotion branch, at the source", () => {
  // ⚠️ A STATIC CLAUSE BECAUSE NO RENDER CAN SEE THIS. `InfographicTile` guards
  // `metricCaption` behind `{metric ? … }` on both layouts, so a promoted tile handed a
  // LONE caption renders exactly what `{}` renders — measured, mutating either screen's
  // branch to `{ metricCaption: … }` leaves every render assertion in this repo green while
  // the tile silently loses its figure AND its basis word at a 200.
  const screens = [
    "src/screens/analysis/AnalysisHubScreen.tsx",
    "src/screens/reports/hub/ReportsHubScreen.tsx",
  ];

  it.each(screens)("%s spreads an EMPTY object when promoted", (path) => {
    const src = readFileSync(path, "utf-8");
    const branches = [
      ...src.matchAll(/promoted\.has\([^)]*\)\s*\n?\s*\?\s*([^\n]*)/g),
    ];
    // Non-vacuity: the regex must actually find the branches it is judging.
    expect(branches.length).toBeGreaterThan(0);
    for (const [, taken] of branches) expect(taken.trim()).toBe("{}");
  });

  it("⚠️ both screens take the RAIL's and the DENOMINATOR's integers from `groupedInt`", () => {
    // ⚠️ A STATIC CLAUSE FOR THE SAME REASON AS THE ONE ABOVE: no render can see it. The
    // component harness mounts EN, and `(1629).toLocaleString("en")` is „1,629" — already
    // grouped — so a screen reverting to the locale default is byte-identical in the only
    // language a component test observes. It is wrong ONLY in bg, which is the language the
    // page ships in. Measured: reverting the analyses hub left all 72 clauses green.
    for (const path of screens) {
      const src = readFileSync(path, "utf-8");
      expect(src, `${path} does not use groupedInt`).toMatch(
        /groupedInt\(i18n\.language\)/,
      );
      // …and no second, ungrouped integer formatter beside it.
      // ⚠️ SCOPED TO THE DIRECT CALL. Both screens still reach the locale default THROUGH
      // `formatAnalysisMetric(st, i18n.language)`, which is the band's own value — see
      // `groupedInt`'s docblock for why that is out of this rule's reach rather than an
      // oversight. Claiming "never toLocaleString" here would be a message asserting more
      // than the regex checks.
      expect(
        src.match(/toLocaleString\(i18n\.language\)/g) ?? [],
        `${path} formats an integer outside groupedInt`,
      ).toEqual([]);
    }
  });

  it("covers BOTH surfaces on the analyses hub", () => {
    // The grid AND the featured strip: `riskScore` carries statId `risk`, the band's own
    // figure, so before the strip was demoted „6" printed twice under two labels.
    const src = readFileSync(screens[0], "utf-8");
    expect(src.match(/promoted\.has\(/g) ?? []).toHaveLength(2);
  });
});
