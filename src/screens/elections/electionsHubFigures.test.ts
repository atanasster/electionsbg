// The head band's cells 3 and 4: whose cycle they describe, and whether the caption says so.
//
// ⚠ THE FAILURE THIS FILE EXISTS FOR RENDERS PERFECTLY. A band that attributes one
// election's turnout to another's date is four correct numbers under a wrong heading — no
// error, no empty state, nothing to notice. So every assertion here is about WHOSE figure
// it is, not about whether a figure appeared.

import { describe, expect, it } from "vitest";
import catalogue from "@/data/json/presidential_elections.json";
import allElections from "@/data/json/elections.json";
import { bgCorpus, enCorpus } from "@/locales/allKeys";
import {
  electionsHubKpis,
  parliamentaryBasisCycle,
  presidentialCells,
  presidentialCellsFor,
} from "./electionsHubFigures";
import type { ElectionsHubCycle } from "./electionsHubCycle";
import type { PresidentialElectionEntry } from "@/data/presidentialCatalogue";

/** A bare translator: returns the key plus its interpolations, so a test can see both. */
const t = (k: string, o?: Record<string, unknown>): string =>
  o ? `${k}|${Object.values(o).join(",")}` : k;
const args = {
  lang: "bg",
  t,
  formatInt: (n: number) => String(n),
  formatPct: (n: number) => `${n.toFixed(1)}%`,
};
const at = (
  kind: ElectionsHubCycle["kind"],
  id: string,
  date: string,
): ElectionsHubCycle => ({ kind, id, date, fellBack: false });

const PRES_2021 = at("presidential", "2021_11_14_pvr", "2021-11-14");
const PRES_2006 = at("presidential", "2006_10_22_pvr", "2006-10-22");

describe("presidentialCells", () => {
  it("fills both cells from the cycle's OWN round 1", () => {
    const cells = presidentialCells({ ...args, cycle: PRES_2021 })!;
    expect(cells).toHaveLength(2);
    // ⚠ ROUND 1's rate, not round 2's. The two are a different electorate — 40.30% against
    // 34.63% in 2021 — so a band reading the wrong round is a plausible wrong number.
    expect(cells[0].value).toBe("40.3%");
    expect(cells[0].value).not.toBe("34.6%");
    expect(cells[1].value).toBe("23");
  });

  it("counts TICKETS, never parties", () => {
    // ⚠ A category error, not a wording preference: a ballot line is a president plus a
    // vice-president, and 2021's 23 of them are not 23 parties.
    const cells = presidentialCells({ ...args, cycle: PRES_2021 })!;
    expect(cells[1].label).toBe("elections_kpi_tickets");
    expect(cells.map((c) => c.label)).not.toContain("elections_kpi_parties");
  });

  it("does not caption the ticket count with the TURNOUT's basis", () => {
    // ⚠ 2006's rate is domestic-only because its 144 abroad sections report neither a roll
    // nor a signature count. Its 7 ballot lines were national all the same — one shared
    // basis string put „само в страната" under a national count, and the gate that was
    // supposed to catch it only ever read `cells[0]`.
    const y2006 = presidentialCells({ ...args, cycle: PRES_2006 })!;
    expect(y2006[1].label).toBe("elections_kpi_tickets");
    expect(y2006[1].basis).not.toContain("domestic");
    // The control: the two really differ, and the turnout still says it.
    expect(y2006[1].basis).not.toBe(y2006[0].basis);
    expect(y2006[0].basis).toContain("domestic");
  });

  it("withholds a turnout it has no rate for, and refuses one it was never given", () => {
    // ⚠ SYNTHETIC, because no catalogued cycle has a null rate — and until this branch is
    // taken, `typeof … === "number"` is indistinguishable from a bare truthiness check.
    // Through the screen's own formatter `null` renders „0%", i.e. „nobody voted", and
    // `undefined` — which a null check lets through — renders „NaN%".
    const real = catalogue.find(
      (c) => c.name === "2021_11_14_pvr",
    )! as unknown as PresidentialElectionEntry;
    const withRate = (turnoutPct: number | null | undefined) =>
      presidentialCellsFor(
        {
          ...real,
          rounds: { ...real.rounds, 1: { ...real.rounds[1]!, turnoutPct } },
        } as PresidentialElectionEntry,
        args,
      );
    const nulled = withRate(null)!;
    expect(nulled).toHaveLength(1);
    expect(nulled[0].label).toBe("elections_kpi_tickets");
    expect(withRate(undefined)!.map((c) => c.value)).not.toContain("NaN%");
    // The control: a real rate still renders, so the guard is not simply refusing
    // everything.
    expect(withRate(40.3)!).toHaveLength(2);
  });

  it("names the round in the basis, and the population when it is narrower", () => {
    // ⚠ 2006's 144 abroad sections report neither a roll nor a signature count while casting
    // 46,113 valid votes, so its rate covers the country only. Captioned as national it
    // describes a different population from every other cycle's.
    const y2021 = presidentialCells({ ...args, cycle: PRES_2021 })!;
    const y2006 = presidentialCells({ ...args, cycle: PRES_2006 })!;
    expect(y2021[0].basis).toContain("elections_kpi_basis_presidential_r1|");
    expect(y2021[0].basis).not.toContain("domestic");
    expect(y2006[0].basis).toContain(
      "elections_kpi_basis_presidential_r1_domestic|",
    );
    // The control: the two cycles really do differ in the corpus, so the assertion above is
    // not passing on one branch used twice.
    const byName = new Map(catalogue.map((c) => [c.name, c]));
    expect(byName.get("2006_10_22_pvr")!.rounds[1]!.turnoutBasis).toBe(
      "domestic-only",
    );
    expect(byName.get("2021_11_14_pvr")!.rounds[1]!.turnoutBasis).toBe(
      "all-sections",
    );
  });

  it("returns null for a cycle it cannot answer for, rather than the latest", () => {
    // ⚠ THE WORST AVAILABLE ANSWER IS „the newest presidential cycle": it puts one
    // election's turnout under another's date, which is exactly the disagreement this band's
    // basis exists to prevent.
    expect(
      presidentialCells({
        ...args,
        cycle: at("presidential", "nope_pvr", "2031-11-09"),
      }),
    ).toBeNull();
  });
});

describe("electionsHubKpis", () => {
  it("gives a presidential cycle its own cells, AND ONLY THOSE", () => {
    const kpis = electionsHubKpis({ ...args, cycle: PRES_2021 });
    // ⚠ THE LENGTH IS THE ASSERTION. The rule this module turns on is an EARLY RETURN that
    // suppresses the parliamentary fallback; append instead of returning and the band
    // becomes six cells — two of them another cycle's turnout — with every index-based
    // check still green.
    expect(kpis).toHaveLength(4);
    expect(kpis[2].value).toBe("40.3%");
    expect(kpis[3].label).toBe("elections_kpi_tickets");
    const labels = kpis.map((k) => k.label);
    expect(labels).not.toContain("elections_kpi_parties");
    for (const k of kpis)
      expect(k.basis ?? "").not.toContain(
        "elections_kpi_basis_latest_parliamentary",
      );
    // The first two cells are the corpus coverage and do not move with the selection.
    expect(kpis[0].label).toBe("elections_kpi_parliamentary");
    expect(kpis[1].label).toBe("elections_kpi_local");
  });

  it("still falls back to the latest parliamentary cycle for a LOCAL selection", () => {
    // ⚠ The rule that must NOT have changed. `local_elections.json` holds two dates and a
    // kind — nothing to count — so these cells describe somebody else's cycle and the basis
    // has to say which.
    const kpis = electionsHubKpis({
      ...args,
      cycle: at("local", "2023_10_29_mi", "2023-10-29"),
    });
    const basis = kpis[2].basis!;
    expect(basis).toContain("elections_kpi_basis_latest_parliamentary");
    expect(basis).not.toContain("presidential");
    expect(
      parliamentaryBasisCycle(at("local", "2023_10_29_mi", "2023-10-29")),
    ).toMatchObject({ id: allElections[0].name, isResolved: false });
  });

  it("keeps a parliamentary cycle on its own protocol", () => {
    const kpis = electionsHubKpis({
      ...args,
      cycle: at("parliamentary", "2013_05_12", "2013-05-12"),
    });
    expect(kpis[2].basis).toContain("elections_kpi_basis_cycle");
    expect(kpis.map((k) => k.label)).not.toContain("elections_kpi_tickets");
  });

  it("uses keys that exist in BOTH corpora", () => {
    // ⚠ A key present in bg and missing in en renders as its own identifier on the English
    // page, at a 200 — and nothing else here loads en.
    for (const k of [
      "elections_kpi_tickets",
      "elections_kpi_basis_presidential_r1",
      "elections_kpi_basis_presidential_r1_domestic",
      "elections_kpi_basis_presidential_round1",
    ]) {
      expect(bgCorpus[k], `bg is missing ${k}`).toBeTruthy();
      expect(enCorpus[k], `en is missing ${k}`).toBeTruthy();
    }
  });
});
