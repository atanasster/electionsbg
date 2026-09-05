// The header dropdown's presidential rows: which cycles, in what order, under whose name,
// and whether they are shown at all.
//
// ⚠ THE LAST QUESTION IS THE ONE A RENDERED MENU CANNOT ANSWER. „No presidential section"
// looks identical to „the feature was never built", so the withholding is asserted here
// against the same list the hub resolves against, with a control proving it still bites.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import catalogue from "@/data/json/presidential_elections.json";
import { KINDS_WITHOUT_SURFACE } from "@/screens/elections/electionsHubCycle";
import { localDate } from "@/data/utils";
import type { PresidentialElectionEntry } from "@/data/presidentialCatalogue";
import {
  decidedLabelKey,
  pickAction,
  presidentialRows,
  surnameOf,
} from "./presidentialRows";

const rows = presidentialRows(catalogue as PresidentialElectionEntry[]);

describe("presidentialRows", () => {
  it("carries every catalogued cycle", () => {
    expect(rows).toHaveLength(catalogue.length);
    expect(new Set(rows.map((r) => r.name))).toEqual(
      new Set(catalogue.map((c) => c.name)),
    );
  });

  it("is newest first, by DATE rather than by file order", () => {
    // The catalogue is newest-first today and would go on reading correctly right up until
    // a cycle is appended rather than prepended — at which point the menu quietly opens
    // with 2001 at the top of its own section.
    const scrambled = presidentialRows(
      [...(catalogue as PresidentialElectionEntry[])].reverse(),
    );
    expect(scrambled.map((r) => r.name)).toEqual(rows.map((r) => r.name));
    expect(rows[0].name).toBe("2021_11_14_pvr");
  });

  it("labels a row with its round-1 date, formatted", () => {
    // ⚠ AN EXACT STRING, because the obvious assertions cannot fail. `localDate` splits on
    // „_" and reads the first three parts, so it IGNORES the `_pvr` suffix and returns
    // „14/11/2021" from the id as readily as from the date — measured. `not.toContain("_")`
    // and `not.toContain("pvr")` are therefore satisfied by every possible return of that
    // function, „Invalid Date" included, and the gate they looked like could never fail.
    const byName = new Map(rows.map((r) => [r.name, r]));
    expect(byName.get("2021_11_14_pvr")!.local).toBe("14/11/2021");
    expect(byName.get("2001_11_11_pvr")!.local).toBe("11/11/2001");
    for (const c of catalogue as PresidentialElectionEntry[]) {
      expect(byName.get(c.name)!.local, c.name).toBe(
        localDate(c.round1Date.replace(/-/g, "_")),
      );
    }
    // …and it is the ROUND-1 date, not the runoff's — the two are a week apart, so a
    // builder reading the wrong field renders a plausible date for the wrong day.
    expect(byName.get("2021_11_14_pvr")!.local).not.toBe("21/11/2021");
  });

  it("names the winner by family name, and records which round elected them", () => {
    const byName = new Map(rows.map((r) => [r.name, r]));
    expect(byName.get("2021_11_14_pvr")!.winnerSurname).toBe("Радев");
    expect(byName.get("2011_10_23_pvr")!.winnerSurname).toBe("Плевнелиев");
    // ⚠ 2006 publishes a TWO-part name („Георги Първанов"), so „the third token" would be
    // empty here — the row would render a date and a bare separator.
    expect(byName.get("2006_10_22_pvr")!.winnerSurname).toBe("Първанов");
    // Every cycle in this corpus went to a runoff, which is why the row says so.
    expect(rows.every((r) => r.decidedInRound === 2)).toBe(true);
  });
});

describe("surnameOf", () => {
  it("keeps a hyphenated compound whole, spaced or not", () => {
    expect(surnameOf("Мария Иванова Митева-Матеева")).toBe("Митева-Матеева");
    // ⚠ THE SPACED FORM IS THE ONE THAT ACTUALLY OCCURS. This repo has met both spellings
    // of ONE name in the ИВСС register — „… Средкова - Петрова" against
    // „…Средкова-Петрова" — and taking the last raw token returns „Матеева", half of a
    // real person's surname, on a label that names an office-holder.
    expect(surnameOf("Мария Иванова Митева - Матеева")).toBe("Митева-Матеева");
    expect(surnameOf("Мария Иванова Митева -Матеева")).toBe("Митева-Матеева");
    expect(surnameOf("Мария Иванова Митева- Матеева")).toBe("Митева-Матеева");
  });

  it("returns something for a name that does not split", () => {
    // An empty label beside a date is a row the reader cannot read at all.
    expect(surnameOf("Първанов")).toBe("Първанов");
    expect(surnameOf("  Радев  ")).toBe("Радев");
    // ⚠ WHITESPACE-ONLY IS REACHABLE FROM A CATALOGUE THAT VALIDATES:
    // `isPresidentialElectionEntry` guards `president` with a truthiness test, and „   "
    // is truthy. Returning "" there renders a bare „ · " beside a date.
    expect(surnameOf("   ")).not.toBe("");
    expect(surnameOf("")).toBe("");
  });
});

describe("decidedLabelKey", () => {
  it("names the round that actually elected them", () => {
    // ⚠ BOTH ARMS. As an inline ternary this had no gate at all — inverting it published
    // „избран на първи тур" beside five presidents who every one of them reached office in
    // a runoff, in the header of every page, with nothing red. The round-1 arm is
    // unrenderable from today's corpus, which is precisely why it needs a unit test.
    expect(decidedLabelKey(1)).toBe("presidential_decided_round1");
    expect(decidedLabelKey(2)).toBe("presidential_decided_runoff");
  });

  it("says nothing about a round it cannot describe", () => {
    // `decidedInRound` reaches the component through a cast, so an out-of-range value
    // would otherwise render „балотаж" — a specific claim — rather than nothing.
    expect(decidedLabelKey(3)).toBeNull();
    expect(decidedLabelKey(0)).toBeNull();
  });
});

describe("pickAction", () => {
  it("never sends a presidential pick to /local", () => {
    // ⚠ THE REGRESSION IN EVERY SPELLING. The `else` this replaced sent every
    // non-parliamentary row to `/local/<id>`, so a presidential row opened a page about a
    // different electoral system — and a source-text gate would miss
    // `navigate("/local/" + r.name)`.
    expect(
      pickAction({ kind: "presidential", name: "2021_11_14_pvr" }),
    ).toEqual({ navigate: "/presidential/2021_11_14_pvr" });
    expect(pickAction({ kind: "local", name: "2023_10_29_mi" })).toEqual({
      navigate: "/local/2023_10_29_mi",
    });
  });

  it("SELECTS a parliamentary cycle rather than navigating", () => {
    // The distinction is the point: a parliamentary pick re-anchors the whole site through
    // `ElectionContext` and must not move the reader off the page they are on.
    expect(pickAction({ kind: "parliamentary", name: "2026_04_19" })).toEqual({
      select: "2026_04_19",
    });
  });
});

describe("the section is WITHHELD until the route exists", () => {
  const SRC = fs.readFileSync(
    path.join(process.cwd(), "src/layout/header/ElectionsSelect.tsx"),
    "utf8",
  );

  it("gates the menu on the same list the hub resolves against", () => {
    // ⚠ ONE LIST, TWO CONSUMERS. A second boolean here would let the menu offer a kind the
    // hub refuses, or hide one it serves — and neither disagreement shows up as an error.
    // This is a source read because the fact is which MODULE the component consults, which
    // no rendered output can show; the two behavioural facts it used to assert here — where
    // a pick goes, and which label a round gets — are unit-tested above instead, so a
    // reflow or a rename can no longer redden a correct component.
    expect(SRC).toContain("KINDS_WITHOUT_SURFACE");
    expect(SRC).toContain("PRESIDENTIAL_SERVABLE");
    // …and that the decisions really are delegated rather than re-spelled inline.
    expect(SRC).toContain("pickAction(r)");
    expect(SRC).toContain("decidedLabelKey(r.decidedInRound)");
  });

  it("is genuinely withheld right now, and would not be for a servable kind", () => {
    // The control: this suite would pass vacuously against a build where nothing is
    // withheld, so pin that presidential IS on the list and that the two kinds with routes
    // are not.
    expect(KINDS_WITHOUT_SURFACE).toContain("presidential");
    expect(KINDS_WITHOUT_SURFACE).not.toContain("parliamentary");
    expect(KINDS_WITHOUT_SURFACE).not.toContain("local");
  });
});
