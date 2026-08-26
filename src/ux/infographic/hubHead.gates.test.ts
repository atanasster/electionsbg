// Static gates for the hub head (SKILL.md §9). Each exists because its absence shipped a
// defect in the commit that introduced the head, and each defect rendered fine:
//
//   • a basis line naming „2007–2026" against a corpus whose first contract is 2011-01-03;
//   • four KPI figures that were byte-identical to four tile metrics on the same page;
//   • the rule "a screen using HubHead must not also render <Title>" living only in a comment;
//   • ten screens left with a left-aligned <h1> over a centred deck by the H1 alignment flip.
//
// Some clauses scan SOURCE and some call the REGISTRY or the rendered figures, and which one a
// clause uses is decided by where the fact lives — not by preference. A text scan is the only
// way to see a property of the TREE (does any screen render two headings?) or of what a page
// CLAIMS in a string literal. It is the wrong tool the moment a value is computed: /governance
// builds each cell's `to` from a map and /funds from a pure function, so the scan read zero
// destinations on both and passed. That is the failure mode to watch for here — a green clause
// that can no longer see its subject — which is why every clause below asserts non-vacuity
// before it asserts anything else.
//
// The height budget is the one property none of this can reach; it is gated in tests/ui.spec.ts,
// where there is a layout engine.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { SCOPE_FIRST_YEAR } from "@/data/scope/constants";
import { stripJsxComments } from "./stripJsxComments";
import {
  PROCUREMENT_TILES,
  METRIC_FIELD,
} from "@/screens/procurement/procurementRegistry";
import {
  BAND_TILES as GOV_BAND_TILES,
  BAND_TO as GOV_BAND_TO,
} from "@/screens/governance/governanceRegistry";
import { kpisFor, tileMetric } from "@/screens/funds/fundsHubFigures";
import { FUNDS_BANDS } from "@/screens/funds/fundsRegistry";

const read = (p: string) => readFileSync(p, "utf8");

/** Shared with the contracts band gate. `stripJsxComments.ts` records why the repo-wide
 *  `stripComments` cannot do this job, and why its line-comment rule is not start-anchored. */
const stripJsx = stripJsxComments;

/** i18n stand-in: the key IS the string, so a clash below is a clash of FIGURES rather than of
 *  translated captions. */
const id = (k: string): string => k;

import {
  FUNDS_STATS_FIXTURE,
  FUNDS_INDEX_FIXTURE,
} from "@/screens/funds/fundsHubStats.fixture";
import { budgetHubKpis } from "@/screens/budget/budgetHubFigures";
import {
  consumptionHubKpis,
  promotedTiles,
} from "@/screens/consumption/consumptionHubFigures";
import { CONSUMPTION_STATS_FIXTURE } from "@/screens/consumption/consumptionHubStats.fixture";
import {
  subsidiesHubKpis,
  promotedTiles as subsidiesPromotedTiles,
} from "@/screens/subsidies/subsidiesHubFigures";
import {
  DECLARATIONS_BAND_TILES,
  declarationsHubEvidence,
  declarationsHubKpis,
  promotedTiles as declarationsPromotedTiles,
} from "@/screens/governance/declarationsHubFigures";
import type { DeclarationsHubStats } from "@/data/governance/useDeclarationsHubStats";
import {
  CULTURE_BAND_TILES,
  cultureHubKpis,
  promotedTiles as culturePromotedTiles,
} from "@/screens/culture/cultureHubFigures";
import type { CultureHubStats } from "@/data/culture/hubStats";
import { AGRI_STATS_FIXTURE } from "@/screens/subsidies/subsidiesHubStats.fixture";
import { AGRI_FINANCIAL_YEARS } from "@/data/agri/constants";
import { BUDGET_STATS_FIXTURE } from "@/screens/budget/budgetHubStats.fixture";

const HUB_SCREENS = [
  "src/screens/ProcurementScreen.tsx",
  "src/screens/GovernanceScreen.tsx",
  "src/screens/FundsScreen.tsx",
  // A REGISTRY BROWSER, not a tile hub. The head pattern splits for one: it takes the
  // identity, the deck, the scope control and the KPI band, and takes NEITHER a search slot
  // (the table owns its own, correctly placed above the rows it filters) NOR an evidence list
  // (the table IS the ranked list).
  //
  // ⚠ THIS LIST HAS ONE CONSUMER — the basis-year scan below — so that is all the entry buys.
  // The one-h1 clause globs `grep -rl 'HubHead' src/screens` and already covered this file;
  // the RENDERED one-h1 check iterates `HUB_HEAD_BUDGETS` in tests/ui.spec.ts. Listing three
  // clauses here would have been the „a gate that cannot see its subject" claim inverted:
  // crediting this entry with work two other clauses were already doing.
  "src/screens/dev/ContractsBrowserDbScreen.tsx",
  "src/screens/ParliamentHubScreen.tsx",
  // Its band lives in `budgetHubFigures.ts` — extracted for the /funds reason, so the
  // plan-vs-forecast rule could be asserted rather than commented. Both files are listed:
  // the screen still carries the head's own copy, and a basis window can be typed in either.
  "src/screens/budget/BudgetHubScreen.tsx",
  "src/screens/budget/budgetHubFigures.ts",
  "src/screens/ConsumptionScreen.tsx",
  "src/screens/consumption/consumptionHubFigures.ts",
  "src/screens/SubsidiesDashboardScreen.tsx",
  "src/screens/subsidies/subsidiesHubFigures.ts",
  "src/screens/governance/declarationsHubFigures.ts",
  "src/screens/culture/cultureHubFigures.ts",
];

/** The subset whose KPI cells are an ARRAY LITERAL with `to: "…"` written out, so a source
 *  slice can read the destinations. It is ONE screen, and the other two are covered by
 *  registry/rendered clauses below — /governance builds `to` from `BAND_TO[id]` and /funds from
 *  the exported pure `kpisFor`, neither of which a text scan can see.
 *
 *  Splitting the list is what keeps this from going quiet, and it is not hypothetical: adding
 *  the non-vacuity assert below immediately failed /governance, which had been iterated by this
 *  clause for its whole life and checked exactly zero destinations. `indexOf("const kpi")` does
 *  the same on /funds, matching `kpisFor` and slicing an empty block. A gate green because it
 *  can no longer see its subject is the failure this file has already shipped once. */
const SOURCE_KPI_SCREENS = ["src/screens/ProcurementScreen.tsx"];

describe("hub head — the basis line", () => {
  // The band's whole thesis is that a figure without its denominator is a false sentence, so
  // a window naming years the corpus does not hold is the one defect it must not ship.
  it("names no year before the corpus starts", () => {
    const offenders: string[] = [];
    for (const f of HUB_SCREENS) {
      read(f)
        .split("\n")
        .forEach((line, i) => {
          if (line.trimStart().startsWith("//")) return; // prose may quote the old value
          for (const [, y] of line.matchAll(/\b(\d{4})\s*[–-]\s*\d{4}\b/g))
            if (Number(y) < SCOPE_FIRST_YEAR)
              offenders.push(`${f}:${i + 1} names ${y}`);
        });
    }
    expect(
      offenders,
      `a basis window starts before the corpus (${SCOPE_FIRST_YEAR}): ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});

describe("hub head — the band and the tiles are disjoint", () => {
  // §3.1 rule 5. Both read the same hub_stats blob at the same scope, so an overlap renders
  // the identical string twice on one page — which reads as two different facts.
  it("no /procurement KPI figure is also a tile metric", () => {
    const src = read("src/screens/ProcurementScreen.tsx");

    // `metric: "x"` ids on the SUBPAGES entries → the HubStat field each resolves to.
    // The mapping lives in the registry — it was duplicated here, and the other copy was
    // an identity ternary that skipped `total` → `totalEur` entirely.
    const FIELD_OF = METRIC_FIELD;
    // From the REGISTRY, not a scan of the screen: the tiles moved into
    // procurementRegistry.ts and this clause silently found zero metrics the moment they did
    // — a gate that passes because it can no longer see its subject.
    const tileMetrics = PROCUREMENT_TILES.map((t) => t.metric).filter(
      (m): m is string => !!m,
    );
    expect(tileMetrics.length).toBeGreaterThan(0);
    for (const m of tileMetrics)
      expect(
        FIELD_OF,
        `unknown tile metric "${m}" — extend this table`,
      ).toHaveProperty(m);

    const kpiBlock = src.slice(
      src.indexOf("const kpis"),
      src.indexOf("const evidenceRows"),
    );
    expect(kpiBlock.length).toBeGreaterThan(0);
    const kpiFields = new Set(
      [...kpiBlock.matchAll(/stat\.([A-Za-z]+)/g)].map((m) => m[1]),
    );
    expect(kpiFields.size).toBeGreaterThan(0);

    const clash = tileMetrics.filter(
      (m) => FIELD_OF[m] && kpiFields.has(FIELD_OF[m]),
    );
    expect(
      clash,
      `tile metric(s) also in the KPI band: ${clash.join(", ")}`,
    ).toEqual([]);
  });

  it("no two /governance KPI cells share a destination", () => {
    // Over the REGISTRY, because these cells build `to` from the map rather than from literals.
    const tos = GOV_BAND_TILES.map((id) => GOV_BAND_TO[id]);
    expect(tos.filter(Boolean).length, "no governance destinations").toBe(
      tos.length,
    );
    expect(tos.length).toBeGreaterThan(0);
    expect(
      new Set(tos).size,
      `duplicate governance KPI destination in ${tos.join(", ")}`,
    ).toBe(tos.length);
  });

  it("no /funds KPI figure is also a tile metric", () => {
    // Over the RENDERED STRINGS, which is stronger than comparing field names: the defect this
    // catches shipped as two DIFFERENT fields that format identically — `totals.beneficiaries`
    // in the band and `tiles.registerBeneficiaries` on the tile, both „53 122".
    const kpis = kpisFor(FUNDS_INDEX_FIXTURE, FUNDS_STATS_FIXTURE, "bg", id);
    expect(kpis.length, "the funds fixture produced no KPI cells").toBe(4);

    const values = new Set(kpis.map((k) => k.value));
    const tileMetrics = FUNDS_BANDS.flatMap((b) => b.tiles)
      .map((t) => tileMetric(t.id, FUNDS_STATS_FIXTURE, "bg", id)?.metric)
      .filter((m): m is string => !!m);
    expect(
      tileMetrics.length,
      "the funds fixture produced no tile metrics",
    ).toBeGreaterThan(0);

    const clash = tileMetrics.filter((m) => values.has(m));
    expect(
      clash,
      `tile metric(s) also in the /funds KPI band: ${clash.join(", ")}`,
    ).toEqual([]);
  });

  it("no /budget KPI field is also a tile metric field", () => {
    // FIELD-level, unlike the /funds arm above, and the difference is forced rather than
    // chosen: /budget's tile metrics are built inline in a `useMemo` in the screen, so there
    // is no pure builder to call. Both sides are read out of SOURCE the way the /procurement
    // arm is — the band from its extracted module, the tiles from the one contiguous block
    // that builds them.
    //
    // The rendered-string half of this rule lives in `budgetHubFigures.test.ts`, which
    // compares the band against the executed figures the tiles carry. Neither is redundant:
    // this one sees every tile, that one sees formatting collisions between different fields.
    const band = read("src/screens/budget/budgetHubFigures.ts");
    const screen = read("src/screens/budget/BudgetHubScreen.tsx");

    const tileBlock = screen.slice(
      screen.indexOf("const metrics = useMemo"),
      screen.indexOf("const searchSources"),
    );
    expect(
      tileBlock.length,
      "the /budget tile-metric block moved — this clause is reading nothing",
    ).toBeGreaterThan(500);

    const fieldsOf = (src: string) =>
      new Set(
        [...stripJsx(src).matchAll(/stats\.([A-Za-z]+)/g)].map((m) => m[1]),
      );

    const bandFields = fieldsOf(band);
    const tileFields = fieldsOf(tileBlock);
    expect(
      bandFields.size,
      "the /budget band reads no stats field",
    ).toBeGreaterThan(3);
    expect(
      tileFields.size,
      "the /budget tiles read no stats field",
    ).toBeGreaterThan(3);

    // `fiscalYear` is the WINDOW both sides label with, not a figure either publishes, and
    // `complete` is a guard. A shared label is the point of a basis line; a shared FIGURE is
    // the defect.
    const LABELS = new Set([
      "fiscalYear",
      "complete",
      "latestKfpPeriod",
      "asOf",
    ]);
    const clash = [...bandFields].filter(
      (f) => tileFields.has(f) && !LABELS.has(f),
    );
    expect(
      clash,
      `field(s) in both the /budget band and its tiles: ${clash.join(", ")}`,
    ).toEqual([]);
  });

  it("no /consumption KPI figure is also a tile metric", () => {
    // Over the RENDERED STRINGS, like the /funds arm — and here that is the only form that
    // works, because the band and the tiles read the SAME blob fields. A field-level check
    // would report every cell as a clash by construction; what must not happen is the same
    // STRING appearing twice on the page.
    const kpis = consumptionHubKpis(
      CONSUMPTION_STATS_FIXTURE,
      "bg-BG",
      "bg",
      new Intl.NumberFormat("bg-BG"),
      id,
    );
    expect(kpis.length, "the consumption fixture produced no KPI cells").toBe(
      4,
    );

    // The tiles the screen will still render a metric on — i.e. all of them minus the ones
    // the band displaced. `promotedTiles` is derived from the cells that rendered, so this
    // mirrors exactly what the screen does.
    const promoted = promotedTiles(kpis);
    const values = new Set(kpis.map((k) => k.value));
    expect(promoted.size, "the band displaced no tile").toBeGreaterThan(0);

    // Every band figure must belong to a DISPLACED tile — otherwise the same string is
    // rendered twice on one page, which reads as two different facts.
    for (const c of kpis)
      expect(
        promotedTiles([c]).size,
        `${c.to} (${c.value}) displaces no tile`,
      ).toBeGreaterThan(0);
    expect(
      values.size,
      "two /consumption KPI cells render the same string",
    ).toBe(kpis.length);
  });

  it("no two /consumption KPI cells share a destination", () => {
    const tos = consumptionHubKpis(
      CONSUMPTION_STATS_FIXTURE,
      "bg-BG",
      "bg",
      new Intl.NumberFormat("bg-BG"),
      id,
    ).map((k) => k.to);
    expect(tos.length).toBe(4);
    expect(
      new Set(tos).size,
      `duplicate /consumption KPI destination in ${tos.join(", ")}`,
    ).toBe(tos.length);
  });

  it("no /subsidies KPI figure is also a tile metric", () => {
    // Like the /consumption arm, this compares over the DISPLACED SET rather than the
    // rendered strings: the band and the tiles read the same blob fields, so a field-level
    // clash is the design. What must not happen is the same figure rendering twice.
    const kpis = subsidiesHubKpis(
      AGRI_STATS_FIXTURE,
      AGRI_FINANCIAL_YEARS,
      "bg",
      true,
      id,
    );
    expect(kpis.length, "the subsidies fixture produced no KPI cells").toBe(4);

    // Three of the four displace a tile; „изплатени" displaces none because `totalEur` is
    // on no tile at all — it was the module's headline with nowhere prominent to live.
    const promoted = subsidiesPromotedTiles(kpis);
    expect(promoted.size).toBe(3);
    for (const c of kpis)
      if (String(c.to) !== "/subsidies/browse")
        expect(
          subsidiesPromotedTiles([c]).size,
          `${c.to} (${c.value}) displaces no tile`,
        ).toBe(1);

    expect(
      new Set(kpis.map((k) => k.value)).size,
      "two /subsidies KPI cells render the same string",
    ).toBe(kpis.length);
  });

  it("no two /subsidies KPI cells share a destination", () => {
    const tos = subsidiesHubKpis(
      AGRI_STATS_FIXTURE,
      AGRI_FINANCIAL_YEARS,
      "bg",
      true,
      id,
    ).map((k) => k.to);
    expect(tos.length).toBe(4);
    expect(
      new Set(tos).size,
      `duplicate /subsidies KPI destination in ${tos.join(", ")}`,
    ).toBe(tos.length);
  });

  // Measured verbatim from the committed data/governance/declarations_hub_stats.json,
  // 2026-08-26. Kept here rather than imported so the gate fails on a fixture that drifts
  // from the blob rather than moving with it.
  const DECLARATIONS_STATS_FIXTURE: DeclarationsHubStats = {
    computedAt: "2026-08-26T02:16:08.175Z",
    people: 63816,
    peopleWithDeclaration: 21170,
    officials: 14583,
    organisations: 17675,
    organisationPeople: 14855,
    byNs: {
      "52": { mpsWithAssets: 240, cars: 42, carOwners: 23 },
      all: { mpsWithAssets: 2122, cars: 643, carOwners: 360 },
    },
    topNetWorth: [
      {
        slug: "kiril-ivanov-boshov-863c15",
        name: "Кирил Иванов Бошов",
        netWorthEur: 13373236,
        year: 2025,
      },
      {
        slug: "mp-5100",
        name: "Делян Славчев Пеевски",
        netWorthEur: 9849697,
        year: 2025,
      },
      {
        slug: "mp-3727",
        name: "НИКОЛАЙ ЙОРДАНОВ СЪБЕВ",
        netWorthEur: 9532733,
        year: 2021,
      },
      {
        slug: "mp-3056",
        name: "Станислав Тодоров Трифонов",
        netWorthEur: 8247384,
        year: 2026,
      },
      {
        slug: "nadya-vasileva-ivanova-dbb775",
        name: "Надя Василева Иванова",
        netWorthEur: 7401386,
        year: 2025,
      },
    ],
    topNetWorthYears: { first: 2021, last: 2026 },
  };
  const declarationsBand = () =>
    declarationsHubKpis(
      DECLARATIONS_STATS_FIXTURE,
      DECLARATIONS_STATS_FIXTURE.byNs["52"],
      "52",
      (n) => new Intl.NumberFormat("bg-BG").format(n),
      id,
    );

  it("no /governance/declarations KPI figure is also a tile metric", () => {
    const kpis = declarationsBand();
    expect(kpis.length, "the declarations fixture produced no KPI cells").toBe(
      4,
    );

    // ALL FOUR displace a tile here — unlike /subsidies, every destination on this band
    // is also a tile on the grid below it.
    const promoted = declarationsPromotedTiles(kpis);
    expect([...promoted].sort()).toEqual([...DECLARATIONS_BAND_TILES].sort());
    for (const c of kpis)
      expect(
        declarationsPromotedTiles([c]).size,
        `${c.to} (${c.value}) displaces no tile`,
      ).toBe(1);

    expect(
      new Set(kpis.map((k) => k.value)).size,
      "two /governance/declarations KPI cells render the same string",
    ).toBe(kpis.length);
  });

  it("no two /governance/declarations KPI cells share a destination", () => {
    const tos = declarationsBand().map((k) => k.to);
    expect(tos.length).toBe(4);
    expect(
      new Set(tos).size,
      `duplicate /governance/declarations KPI destination in ${tos.join(", ")}`,
    ).toBe(tos.length);
  });

  it("/governance/declarations' aside links somewhere its rows can be named", () => {
    // §3.1 rule 4 applied to the rail: every row goes to that person's own profile, and the
    // action to the page the rail claims to be the first rows of. A rail whose rows link
    // nowhere is a leaderboard the reader cannot check.
    const e = declarationsHubEvidence(DECLARATIONS_STATS_FIXTURE, "bg", id);
    expect(e?.rows.length).toBeGreaterThan(0);
    for (const r of e!.rows) expect(String(r.to)).toMatch(/^\/person\//);
    expect(String(e?.action?.to)).toBe("/officials/assets");
    // The rail's values must not double the band's: they answer a different question, and
    // a row repeating a KPI cell is the band/tile clash one column over.
    const bandValues = new Set(declarationsBand().map((k) => k.value));
    for (const r of e!.rows)
      expect(bandValues.has(r.value), `${r.label} repeats a KPI value`).toBe(
        false,
      );
  });

  // Measured verbatim from the committed data/culture/derived/hub_stats.json, 2026-08-26.
  const CULTURE_STATS_FIXTURE = {
    generatedAt: "2026-08-26",
    procurement: {
      contracts: 972,
      eur: 166898550,
      buyers: 59,
      suppliers: 408,
      singleBid: 0,
      bidKnown: 0,
      nationalSingleBid: 0,
      nationalBidKnown: 0,
      firstDate: "2011-01-19",
    },
    risk: { grades: {} },
    funds: {
      eikExactEur: 105920570,
      eikExactProjects: 47,
      byNameEur: 147024687,
      byNameProjects: 1365,
      chitalishtaEur: 0,
    },
    agri: { chitalishtaEur: 18341814, chitalishtaRows: 264 },
    interreg: { thematicEur: 0, partnerRows: 0, partners: 0, rowsWithEik: 0 },
    people: { culturalInstituteRoles: 0 },
    budget: { eur: 269051700, fiscalYear: 2026, basis: "projected" },
    films: { eur: 94944781, films: 944, firstYear: 2014, lastYear: 2025 },
  } as CultureHubStats;
  const cultureBand = () => cultureHubKpis(CULTURE_STATS_FIXTURE, "bg", true);

  it("no /culture KPI figure is also a tile metric", () => {
    const kpis = cultureBand();
    expect(kpis.length, "the culture fixture produced no KPI cells").toBe(4);

    // All four displace a tile — every destination on this band is also a tile below it.
    expect([...culturePromotedTiles(kpis)].sort()).toEqual(
      [...CULTURE_BAND_TILES].sort(),
    );
    for (const c of kpis)
      expect(
        culturePromotedTiles([c]).size,
        `${c.to} (${c.value}) displaces no tile`,
      ).toBe(1);

    expect(
      new Set(kpis.map((k) => k.value)).size,
      "two /culture KPI cells render the same string",
    ).toBe(kpis.length);
  });

  it("no two /culture KPI cells share a destination", () => {
    const tos = cultureBand().map((k) => k.to);
    expect(tos.length).toBe(4);
    expect(
      new Set(tos).size,
      `duplicate /culture KPI destination in ${tos.join(", ")}`,
    ).toBe(tos.length);
  });

  it("no two /budget KPI cells share a destination", () => {
    const tos = budgetHubKpis(
      BUDGET_STATS_FIXTURE,
      "bg-BG",
      new Intl.NumberFormat("bg-BG"),
      new Intl.NumberFormat("bg-BG", {
        style: "percent",
        maximumFractionDigits: 1,
      }),
      id,
    ).map((k) => k.to);
    expect(tos.length).toBe(4);
    expect(
      new Set(tos).size,
      `duplicate /budget KPI destination in ${tos.join(", ")}`,
    ).toBe(tos.length);
  });

  it("no two /funds KPI cells share a destination", () => {
    const tos = kpisFor(FUNDS_INDEX_FIXTURE, FUNDS_STATS_FIXTURE, "bg", id).map(
      (k) => k.to,
    );
    expect(tos.length).toBe(4);
    expect(
      new Set(tos).size,
      `duplicate /funds KPI destination in ${tos.join(", ")}`,
    ).toBe(tos.length);
  });

  it("no two KPI cells share a destination", () => {
    for (const f of SOURCE_KPI_SCREENS) {
      const src = read(f);
      // Bounded to the KPI array literal itself — the next top-level `const` in the
      // component. A wider slice swallows the evidence rows, whose `to:` values are a
      // different set and legitimately repeat a destination.
      const start = src.indexOf("const kpi");
      const end = src.indexOf("\n  const ", start + 1);
      const block = src.slice(start, end === -1 ? undefined : end);
      const tos = [...block.matchAll(/^\s+to: "([^"]+)"/gm)].map((m) => m[1]);
      // Non-vacuity, per screen. An empty `tos` satisfies the uniqueness assert trivially.
      expect(
        tos.length,
        `${f}: found no KPI destinations to check`,
      ).toBeGreaterThan(0);
      expect(
        new Set(tos).size,
        `${f}: duplicate KPI destination in ${tos.join(", ")}`,
      ).toBe(tos.length);
    }
  });
});

describe("hub head — one h1 per page", () => {
  it("no screen renders both HubHead and Title", () => {
    const files = execSync("grep -rl 'HubHead' src/screens --include=*.tsx", {
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .filter(Boolean);
    expect(files.length).toBeGreaterThan(0);
    const both = files.filter((f) => /<Title\b/.test(stripJsx(read(f))));
    expect(
      both,
      `HubHead renders the page's h1, so these would emit two: ${both.join(", ")}`,
    ).toEqual([]);
  });
});

describe("H1 alignment — no left heading over a centred sibling", () => {
  // The H1 base is `text-left` now. A deck that kept `mx-auto text-center` (or a block that
  // kept `flex-col items-center` / `justify-center`) was centred BECAUSE the h1 used to be,
  // so it now reads as a broken axis. A heading that opts into centring in its OWN className
  // is deliberate and exempt — ErrorSection is the sanctioned case.
  const CENTRED =
    /\btext-center\b|flex-col\s+items-center|items-center\s+flex-col|\bjustify-center\b/;

  it("no header block pairs a default-aligned heading with a centred sibling", () => {
    const files = execSync("grep -rl '<H1\\|<Title' src --include=*.tsx", {
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .filter(Boolean);
    expect(files.length).toBeGreaterThan(20);

    const offenders: string[] = [];
    for (const f of files) {
      const lines = read(f).split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (!/<(H1|Title)\b/.test(lines[i])) continue;
        // The heading's own opening tag may span lines; read to its `>`.
        let end = i;
        let own = lines[i];
        while (!/>/.test(own.slice(own.indexOf("<"))) && end < lines.length - 1)
          own += " " + lines[++end];
        if (CENTRED.test(own)) continue; // deliberate — the heading centres itself

        for (let j = end + 1; j < Math.min(end + 9, lines.length); j++) {
          const l = lines[j];
          if (/<\/div>|<\/section>|<\/header>|<\/>|\{\s*$|\? \(|&& \(/.test(l))
            break;
          if (!/className=/.test(l)) continue;
          if (CENTRED.test(l)) {
            offenders.push(`${f}:${j + 1}`);
            break;
          }
        }
      }
    }
    expect(
      offenders,
      `left-aligned heading over a centred sibling: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});

describe("the /governance blob", () => {
  const BLOB = "data/governance/hub_stats.json";
  const blob = JSON.parse(read(BLOB)) as {
    tiles: Record<string, { basis: string; value: number }>;
    byNs: Record<string, Record<string, { basis: string }>>;
    coverage: { id: string; to: string }[];
  };

  // Every key is a tile the hub actually renders. A figure keyed to an id no registry
  // carries is invisible — it costs bytes on every visitor and shows nobody anything.
  it("keys only tiles the registry renders", () => {
    const reg = read("src/screens/governance/governanceRegistry.ts");
    const ids = new Set(
      [...reg.matchAll(/^\s+id: "([^"]+)"/gm)].map((m) => m[1]),
    );
    expect(ids.size).toBeGreaterThan(10);
    const orphans = [
      ...Object.keys(blob.tiles),
      ...Object.values(blob.byNs).flatMap((slice) => Object.keys(slice)),
    ].filter((k) => !ids.has(k));
    expect(orphans, `blob keys no tile renders: ${orphans.join(", ")}`).toEqual(
      [],
    );
  });

  // §1: budget it, and gate the budget. Without a ceiling it regrows to the full artifact
  // the first time someone adds a field carrying detail.
  it("stays under its byte budget", () => {
    const bytes = Buffer.byteLength(read(BLOB), "utf8");
    expect(bytes, `${BLOB} is ${bytes} B`).toBeLessThanOrEqual(6_000);
  });

  // Every `basis` is an ENUM KEY with a translation on BOTH sides — prose in the blob would
  // make the English hub the Bulgarian one with English headings (§1).
  it("uses basis keys that both corpora translate", () => {
    const bases = new Set([
      ...Object.values(blob.tiles).map((v) => v.basis),
      ...Object.values(blob.byNs).flatMap((s) =>
        Object.values(s).map((v) => v.basis),
      ),
    ]);
    const covIds = blob.coverage.map((c) => c.id);
    for (const corpus of ["bg", "en"]) {
      const keys = JSON.parse(read(`src/locales/${corpus}/translation.json`));
      for (const b of bases)
        expect(keys, `${corpus}: gov_stat_${b} missing`).toHaveProperty(
          `gov_stat_${b}`,
        );
      for (const c of covIds)
        expect(keys, `${corpus}: gov_cov_${c} missing`).toHaveProperty(
          `gov_cov_${c}`,
        );
    }
  });

  // ⚠️⚠️ A FORECAST CAPTION MUST SAY SO, AND A PLAN CAPTION MUST NOT. This hub FOLDS
  // /budget's expenditure figure, and `budget_fiscal_year_figure.basis` carries three values
  // of which two are not the law: `planned` is МФ's budget-law column, `projected` is OUR
  // seasonal extrapolation. The generator read the second and stamped `planned_expenditure`
  // on it, so /governance published „€29,6 млрд. · разходи · план 2026" for a fiscal year
  // that carries no planned row at all — a claim about what the National Assembly
  // appropriated, made out of arithmetic we did ourselves.
  //
  // The clause above could not see it: it asserts only that `gov_stat_${basis}` EXISTS, which
  // is true of both keys, so it stayed green throughout. This is the /budget twin's §2.3 rule
  // (`budgetBasis.test.ts`) applied to the hub that folds the same number.
  it("says it is a forecast on a forecast basis, and never on the budget law", () => {
    const FORECAST = /прогноз|project(ed|ion)|forecast/i;
    const PLAN = /план|plan(ned)?|budget act|appropriation|закона за бюджета/i;
    for (const corpus of ["bg", "en"]) {
      const keys = JSON.parse(read(`src/locales/${corpus}/translation.json`));
      expect(
        keys.gov_stat_projected_expenditure,
        `${corpus}: the forecast caption does not say it is one`,
      ).toMatch(FORECAST);
      expect(
        keys.gov_stat_projected_expenditure,
        `${corpus}: the forecast caption calls itself the budget law`,
      ).not.toMatch(PLAN);
      expect(
        keys.gov_stat_planned_expenditure,
        `${corpus}: the budget-law caption calls itself a forecast`,
      ).not.toMatch(FORECAST);
    }
    // And the anchor, for the reason `budgetBasis.test.ts` gives about this exact number:
    // „прогноза за 2026" alone is a forecast from nowhere, and /budget names the profile
    // one click away.
    expect(
      JSON.parse(read("src/locales/bg/translation.json"))
        .gov_stat_projected_expenditure,
    ).toContain("{{basisYear}}");
  });

  it("stamps the budget basis the committed figure actually came from", () => {
    // The blob is COMMITTED, so this needs no Postgres: the generator writes `basisYear` only
    // on the forecast arm, which is the discriminator a caption cannot fake. Reverting the
    // generator's pick puts a `planned_expenditure` basis on a row that still carries an
    // anchor year, or a forecast with none.
    const b = blob.tiles.budget as
      | { basis: string; value: number; basisYear?: number }
      | undefined;
    if (!b) return; // a database with no budget corpus writes no tile — see note("budget", …)
    expect(["planned_expenditure", "projected_expenditure"]).toContain(b.basis);
    if (b.basis === "projected_expenditure")
      expect(
        b.basisYear,
        "a forecast with no seasonal anchor — the caption interpolates an empty year",
      ).toBeTypeOf("number");
    else
      expect(
        b.basisYear,
        "the budget law carries a seasonal anchor — it was not scaled through anything",
      ).toBeUndefined();
  });

  // The band publishes the four money taps above the fold; those tiles must therefore carry
  // no metric, or the same string renders twice on one page (§3.1 rule 5).
  it("excludes the band's own tiles from the tile metrics", () => {
    const src = read("src/screens/GovernanceScreen.tsx");
    // The IDS come from the imported REGISTRY, not from a scan of the screen. They used to be
    // a literal in GovernanceScreen and the scan read them from there — so moving them into
    // governanceRegistry.ts (which react-refresh/only-export-components asks for) took this
    // clause to zero ids, and only its own non-vacuity assert caught it. The SUPPRESSION is
    // still a source match, because it is a property of the screen's code rather than of data.
    const ids: readonly string[] = GOV_BAND_TILES;
    expect(ids.length, "BAND_TILES is empty").toBeGreaterThan(0);
    // tileMetric() must return {} for every one of them.
    expect(src).toMatch(
      /if \(\(BAND_TILES as readonly string\[\]\)\.includes\(id\)\) return \{\};/,
    );
    for (const id of ids)
      expect(
        blob.tiles,
        `blob has no figure for band tile ${id}`,
      ).toHaveProperty(id);
  });
});
