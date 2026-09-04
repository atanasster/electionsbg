// THE parity gate for docs/plans/person-candidate-display-unification-v1.md Tier 0.
//
// `/candidate/:id` and `/person/:slug` describe the same human's candidacy from two
// different feeds — the name-folder shards and person_election_stats. They diverged once
// already (the person page grew a cycle heading and a highlighted trajectory, the candidate
// page kept a summary line the person page lacked), and nothing failed: both pages rendered,
// each withholding something the other showed. This asserts the properties that make such a
// drift impossible to ship silently:
//
//   1. the BODY's content is a function of its DATA props alone — the section IA a caller
//      declares cannot change a single figure on screen;
//   2. the cycle-selector affordance is all-or-nothing: heading, bar highlight and
//      `?elections=` on the drill-downs travel together, because one prop carries them.
//
// Note what this deliberately does NOT assert:
//   • that the two section id lists are EQUAL. They are not, and should not be — each page
//     owns its own IA (`votes`/`geography` carry the candidate page's article topics;
//     `person-electoral`/`person-geography` are the person dashboard's anchors).
//   • the trajectory CHART's bars. Recharts needs a measured layout jsdom does not provide,
//     so the highlight rule is unit-tested over the pure function that decides it —
//     `barCellStyle`, in `CandidateHistoryChart.test.tsx`. What is assertable here is whether
//     the tile mounts at all, which is what the `history` cases below cover.
//   • WHICH bars the chart draws. Both surfaces now plot `summary.history` and nothing else
//     — Tier 2 retired the `history` prop by deriving the person's arc in
//     `person_elections()` — so the arrays are equal here by construction, and what decides
//     them is the SQL, gated in person_elections.data.test.ts.
//   • the reducer. `computeCandidateSummary` is covered by its own unit test — this file's
//     first draft asserted `build()` equalled `build()`, which is true of ANY pure
//     implementation, including one returning `{}`.

import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeAll, vi } from "vitest";
import { stripComments } from "@/../scripts/lib/strip_comments";
import { SRC_DIR } from "@/../scripts/lib/module_graph";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { initTestI18n } from "./testI18n";
import { CandidateElectoralBody } from "./CandidateElectoralBody";
import { computeCandidateSummary } from "@/data/dashboard/computeCandidateSummary";
import type { PreferencesInfo, CandidateStatsYearly } from "@/data/dataTypes";

// The settlements tile resolves EKATTE → name through a react-query hook. Stubbed so the
// geography arm can be exercised without a QueryClientProvider and a fetch mock for a
// lookup this gate does not care about (the sibling tile tests do the same).
vi.mock("@/data/settlements/useSettlements", () => ({
  useSettlementsInfo: () => ({
    findSettlement: (ekatte?: string) => ({ long_name: `Село ${ekatte}` }),
  }),
}));

beforeAll(() => initTestI18n());

const NAME = "Боян Иванов Бойчев";
const CYCLE = "2024_10_27";

// One raw candidacy, in the shape BOTH feeds deliver: `regions` is regions.json (shards) and
// the `regions` jsonb (PG), field for field — that identity is what makes the single reducer
// legitimate, so the fixture is deliberately not two shapes normalised into one.
const REGION_ROWS: PreferencesInfo[] = [
  {
    partyNum: 28,
    oblast: "S24",
    pref: "116",
    totalVotes: 18,
    paperVotes: 13,
    machineVotes: 5,
    partyVotes: 8564,
    partyPrefs: 2779,
    allVotes: 127436,
  },
];

const HISTORY: CandidateStatsYearly[] = [
  {
    elections_date: "2022_10_02",
    party: { nickName: "БСП", color: "rgb(237, 28, 36)" },
    preferences: [{ oblast: "S24", pref: "111", preferences: 76 }],
  },
  {
    elections_date: CYCLE,
    party: { nickName: "БСП", color: "rgb(237, 28, 36)" },
    preferences: [{ oblast: "S24", pref: "116", preferences: 18 }],
  },
];

const findParty = (n: number) =>
  n === 28
    ? {
        nickName: "БСП",
        name: "БСП – ОБЕДИНЕНА ЛЕВИЦА",
        color: "rgb(237,28,36)",
      }
    : undefined;
const findRegion = (oblast?: string) =>
  oblast === "S24"
    ? { name: "София 24", name_en: "Sofia 24", long_name: "София 24 МИР" }
    : undefined;

const build = () =>
  computeCandidateSummary({
    name: NAME,
    selected: CYCLE,
    priorElectionName: "2024_06_09",
    regionRows: REGION_ROWS,
    stats: { stats: HISTORY, top_settlements: [], top_sections: [] },
    findParty,
    findRegion,
  });

// The figures a reader compares between the two URLs. Read out of the DOM rather than out of
// the summary object, so a tile that stopped rendering one of them fails here.
const renderedFigures = (container: HTMLElement): string[] =>
  [...container.querySelectorAll(".tabular-nums")]
    .map((el) => el.textContent?.trim() ?? "")
    .filter(Boolean);

const sectionIds = (container: HTMLElement): string[] =>
  [...container.querySelectorAll("[data-dashboard-section]")].map(
    (el) => el.getAttribute("data-dashboard-section") ?? "",
  );

const hrefs = (container: HTMLElement): string[] =>
  [...container.querySelectorAll("a[href]")].map(
    (el) => el.getAttribute("href") ?? "",
  );

const CANDIDATE_IA = {
  electoralSection: { id: "votes", title: "Гласове" },
  geographySection: { id: "geography", title: "География" },
} as const;
const PERSON_IA = {
  electoralSection: { id: "person-electoral", title: "Кандидатури" },
  geographySection: { id: "person-geography", title: "География" },
} as const;

const TRAJECTORY_LABEL = "История на преференциите";

describe("the electoral body is one component fed by two surfaces", () => {
  it("renders the same figures under either surface's section IA", () => {
    const summary = build();

    // Both renders get the SAME data props — the whole point is that a caller's IA cannot
    // move a figure. The cycle-selector affordance is the subject of its own test below.
    const candidate = render(
      <MemoryRouter>
        <TooltipProvider>
          <CandidateElectoralBody
            summary={summary}
            linkSlug="c-28-boyan-ivanov-boychev"
            {...CANDIDATE_IA}
          />
        </TooltipProvider>
      </MemoryRouter>,
    );
    const candidateFigures = renderedFigures(candidate.container);
    expect(sectionIds(candidate.container)).toEqual(["votes"]);
    candidate.unmount();

    const person = render(
      <MemoryRouter>
        <TooltipProvider>
          <CandidateElectoralBody
            summary={summary}
            linkSlug="c-28-boyan-ivanov-boychev"
            {...PERSON_IA}
          />
        </TooltipProvider>
      </MemoryRouter>,
    );
    expect(sectionIds(person.container)).toEqual(["person-electoral"]);
    expect(renderedFigures(person.container)).toEqual(candidateFigures);

    // ANTI-VACUITY, pinned to the fixture's real shape rather than to a loose floor: these
    // are the preferences card, the paper/machine card, the ballot card, the top-region card
    // and the regions tile. A body that silently dropped one of them must fail — a
    // `length > 3` floor would have let three of the five go missing.
    expect(candidateFigures).toMatchInlineSnapshot(`
      [
        "18",
        "0.65% от преф. на партията",
        "72.2%",
        "13 хартиени · 5 машинни",
        "#116",
        "#116",
        "18 преференции · 0.7% от преф. на партията",
        "#116 в листата · 0.01% от вота в областта",
        "18",
        "#116",
        "0.01%",
      ]
    `);
  });

  it("keeps the summary line on both surfaces", () => {
    // The §1.2 difference this tier settled: the recap used to be candidate-only. Rendered
    // here under the PERSON props — the surface that lacked it — so a regression that puts
    // it back behind a prop fails.
    const { container } = render(
      <MemoryRouter>
        <TooltipProvider>
          <CandidateElectoralBody
            summary={build()}
            selector={{ cycle: CYCLE }}
            {...PERSON_IA}
          />
        </TooltipProvider>
      </MemoryRouter>,
    );
    const recap = container.querySelector("p")?.textContent ?? "";
    expect(recap).toContain("18");
    // ONE date format inside this block: the heading, the selector pills and this recap all
    // render the dotted Bulgarian form. It used to be `localDate`'s `27/10/2024`, ~8px from
    // the heading's `27.10.2024`, on both surfaces once the two were unified.
    expect(recap).toContain("27.10.2024");
  });

  it("ties the cycle heading, the bar highlight and the deep-link cycle to ONE prop", () => {
    // Three consequences of "this page has a selector". Splitting them into independent
    // props is what allowed the §1.2 divergence (a selector with every bar at full weight),
    // so the gate checks they arrive and leave together.
    const withSelector = render(
      <MemoryRouter>
        <TooltipProvider>
          <CandidateElectoralBody
            summary={build()}
            selector={{ cycle: CYCLE, control: <span>chips</span> }}
            {...PERSON_IA}
          />
        </TooltipProvider>
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent(
      "27.10.2024",
    );
    expect(screen.getByText("chips")).toBeInTheDocument();
    expect(
      hrefs(withSelector.container).some((h) =>
        h.includes(`elections=${CYCLE}`),
      ),
    ).toBe(true);
    withSelector.unmount();

    const withoutSelector = render(
      <MemoryRouter>
        <TooltipProvider>
          <CandidateElectoralBody summary={build()} {...CANDIDATE_IA} />
        </TooltipProvider>
      </MemoryRouter>,
    );
    expect(screen.queryByRole("heading", { level: 3 })).toBeNull();
    // The candidate page's header already prints the ballot; its drill-downs follow the
    // global `?elections=` selector rather than pinning a cycle of their own.
    expect(
      hrefs(withoutSelector.container).some((h) => h.includes("elections=")),
    ).toBe(false);
    // ANTI-VACUITY: the links themselves must exist, or "no ?elections=" is trivially true.
    expect(hrefs(withoutSelector.container).length).toBeGreaterThan(0);
  });

  it("draws the trajectory from summary.history alone", () => {
    // There is no second array to pass. The tile needs ≥2 entries, and the ONLY thing that
    // decides whether it draws is the summary the surface's own hook produced — which is
    // what makes the two pages' charts the same chart.
    const drawable = render(
      <MemoryRouter>
        <TooltipProvider>
          <CandidateElectoralBody summary={build()} {...PERSON_IA} />
        </TooltipProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText(TRAJECTORY_LABEL)).toBeInTheDocument();
    drawable.unmount();

    // One cycle is not a trajectory — the tile stays away rather than drawing a single bar
    // under a „history" heading. 1,906 people are in exactly this state once the arc stops
    // carrying their namesakes' cycles.
    render(
      <MemoryRouter>
        <TooltipProvider>
          <CandidateElectoralBody
            summary={{ ...build(), history: [HISTORY[1]] }}
            {...PERSON_IA}
          />
        </TooltipProvider>
      </MemoryRouter>,
    );
    expect(screen.queryByText(TRAJECTORY_LABEL)).toBeNull();
  });

  it("takes NO history array beside `summary`", () => {
    // The file header carries this as a rule; nothing else enforces it. Adding
    // `history?: CandidateStatsYearly[]` back and preferring it would pass every other test
    // here, because each render site passes `summary` and the IA spread and nothing else —
    // and a second array beside `summary` is exactly what let the two pages draw different
    // charts before Tier 2 derived the arc in `person_elections()`.
    //
    // Comments are stripped first: this file's own header discusses the retired prop, and
    // prose that MENTIONS a pattern is not an occurrence of it.
    // Resolved from SRC_DIR rather than `import.meta.url`: this file runs in the jsdom
    // project, where `import.meta.url` is an http URL and readFileSync refuses it.
    const src = stripComments(
      readFileSync(
        path.join(SRC_DIR, "screens/dashboard/CandidateElectoralBody.tsx"),
        "utf8",
      ),
    );
    expect(src).not.toMatch(/history\??\s*:\s*CandidateStatsYearly\[\]/);
    // ANTI-VACUITY: the file must still be the one we think it is.
    expect(src).toMatch(/export const CandidateElectoralBody/);
  });

  it("omits the geography section when there is nothing to put in it", () => {
    // DashboardSection cannot see through a component boundary, so the body must gate this
    // section on the ARRAYS or a reader gets a „География" heading above nothing.
    const { container } = render(
      <MemoryRouter>
        <TooltipProvider>
          <CandidateElectoralBody summary={build()} {...CANDIDATE_IA} />
        </TooltipProvider>
      </MemoryRouter>,
    );
    expect(sectionIds(container)).not.toContain("geography");
  });

  it("renders the geography section once its tiles have rows", () => {
    const withGeo = {
      ...build(),
      topSections: [
        { partyNum: 28, section: "244601011", pref: "116", totalVotes: 1 },
      ] as PreferencesInfo[],
    };
    const { container } = render(
      <MemoryRouter>
        <TooltipProvider>
          <CandidateElectoralBody summary={withGeo} {...CANDIDATE_IA} />
        </TooltipProvider>
      </MemoryRouter>,
    );
    expect(sectionIds(container)).toEqual(["votes", "geography"]);
  });
});
