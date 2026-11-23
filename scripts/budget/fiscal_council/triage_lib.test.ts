import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  LEVERS,
  gateMeasures,
  ledgerClosed,
  listingSlugs,
  quoteInText,
  verdictOf,
  type Measure,
} from "./triage_lib";

const TEXT = `Проектът променя и КСО чрез
бюджетния закон: максималният размер на пенсиите се осъвременява по чл. 100,
вместо да е обвързан с 40% от максималния осигурителен доход. Дивидентният
данък се увеличава от 5% на 10%, което според нас носи най-много 50 млн. евро.`;

const m = (over: Partial<Measure>): Measure => ({
  summary: "s",
  quote: "Дивидентният данък се увеличава от 5% на 10%",
  lever: "scoreDividend",
  affects: true,
  reason: "r",
  ...over,
});

describe("LEVERS", () => {
  it("names every scoring function the simulator exports", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../../src/lib/bgTaxPolicy.ts"),
      "utf8",
    );
    const exported = [...src.matchAll(/^export const (score[A-Za-z]+)/gm)].map(
      (x) => x[1],
    );
    expect(exported.length).toBeGreaterThan(10);
    expect(exported.filter((id) => !(id in LEVERS))).toEqual([]);
  });
});

describe("quoteInText", () => {
  it("matches across line breaks and case", () => {
    expect(
      quoteInText(
        "КСО чрез бюджетния закон: максималният размер на пенсиите",
        TEXT,
      ),
    ).toBe(true);
  });

  it("rejects a paraphrase", () => {
    expect(
      quoteInText("Дивидентният данък се удвоява до 10 процента", TEXT),
    ).toBe(false);
  });

  it("rejects a fragment too short to carry meaning", () => {
    expect(quoteInText("5% на 10%", TEXT)).toBe(false);
  });
});

describe("gate and verdict", () => {
  it("an evidenced lever claim is a lever verdict", () => {
    const { kept, dropped } = gateMeasures([m({})], TEXT);
    expect(dropped).toEqual([]);
    expect(verdictOf(kept, dropped)).toBe("lever");
  });

  it("evidenced measures that touch no lever close it", () => {
    const { kept, dropped } = gateMeasures(
      [m({ lever: null, affects: false })],
      TEXT,
    );
    expect(verdictOf(kept, dropped)).toBe("none");
  });

  it("a lever claim with an invented quote stays open, never closes", () => {
    const { kept, dropped } = gateMeasures(
      [
        m({ quote: "ДДС върху храните се намалява на 9 процента от 2027" }),
        m({ lever: null, affects: false }),
      ],
      TEXT,
    );
    expect(dropped).toHaveLength(1);
    expect(verdictOf(kept, dropped)).toBe("unverified");
  });

  it("an unknown lever id is dropped", () => {
    const { dropped } = gateMeasures([m({ lever: "scoreVat" })], TEXT);
    expect(dropped).toHaveLength(1);
  });

  it("reading nothing is not a 'none'", () => {
    expect(verdictOf([], [])).toBe("unverified");
  });
});

describe("listingSlugs", () => {
  it("dedupes and keeps page order", () => {
    const html =
      '<a href="/bg/publikacii/b-2027"></a><a href="/bg/publikacii/b-2027"></a><a href="/bg/publikacii/a-2026"></a>';
    expect(listingSlugs(html)).toEqual(["b-2027", "a-2026"]);
  });
});

describe("ledgerClosed", () => {
  const at = "2026-11-23T00:00:00Z";
  it("needs the newest publication triaged", () => {
    expect(ledgerClosed({ a: { verdict: "none", triagedAt: at } }, "b")).toBe(
      false,
    );
  });
  it("stays open on an unresolved lever call, closes once resolved", () => {
    const l = {
      b: { verdict: "none" as const, triagedAt: at },
      a: { verdict: "lever" as const, triagedAt: at },
    };
    expect(ledgerClosed(l, "b")).toBe(false);
    expect(
      ledgerClosed(
        { ...l, a: { ...l.a, resolvedAt: at, resolution: "x" } },
        "b",
      ),
    ).toBe(true);
  });
});
