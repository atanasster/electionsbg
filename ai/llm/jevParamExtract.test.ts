// Stage 3 of the no-AI Jev lane: parameters read by TYPE. Every extractor must
// prefer returning nothing to returning a guess — a missing value makes the lane
// ask, a wrong one answers a different question — so most tests below are about
// what it must NOT read.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearDataCache, setFetcher } from "../tools/dataClient";
import {
  assemblyIn,
  countIn,
  editDistance,
  electionCountIn,
  resetPlaceCache,
  typedArgs,
  yearsIn,
  yearsWindowIn,
} from "./jevParamExtract";
import { completeJevPick } from "./jev";
import type { JevResult } from "./jevClient";

const argsOf = async (tool: string, q: string) =>
  (await typedArgs(tool, q)).args;

const GAZETTEER = [
  ["PDV22", "Пловдив", "Plovdiv"],
  ["VAR06", "Варна", "Varna"],
  ["RSE27", "Русе", "Ruse"],
  ["BGS04", "Бургас", "Burgas"],
  ["VRC32", "Роман", "Roman"],
  ["VRC08", "Златица", "Zlatitsa"],
  ["S2403", "Възраждане", "Vazrazhdane"],
].map(([obshtina, name, name_en]) => ({
  obshtina,
  name,
  name_en,
  ekatte: "1",
  nuts3: "BG1",
  oblast: obshtina.slice(0, 3),
}));

beforeEach(() => {
  clearDataCache();
  resetPlaceCache();
  setFetcher(async (path: string) => {
    if (path === "/municipalities.json") return GAZETTEER;
    throw new Error(`unexpected fetch ${path}`);
  });
});
afterEach(() => {
  clearDataCache();
  resetPlaceCache();
});

describe("numbers", () => {
  it("reads a year only as a year, never a count", () => {
    expect(yearsIn("Покажи 5 общини през 2023")).toEqual([2023]);
    expect(countIn("Покажи 5 общини през 2023")).toBe(5);
    expect(countIn("през 2023")).toBeUndefined();
  });

  it("reads counts written as words, in both languages and in Latin", () => {
    expect(
      countIn("Which five municipalities have the lowest unemployment?"),
    ).toBe(5);
    expect(countIn("Кои десет общини са с най-много просрочени сметки?")).toBe(
      10,
    );
    expect(countIn("pokazhi tri dogovora")).toBe(3);
    expect(countIn("Покажи 7-те най-големи доставчици")).toBe(7);
  });

  it("does not read an amount, a share, a date or an id as a count", () => {
    expect(countIn("Договори над 500 000 евро")).toBeUndefined();
    expect(countIn("ръст от 12% за година")).toBeUndefined();
    expect(countIn("Колко гласуваха на 15 юни?")).toBeUndefined();
    expect(countIn("процедура 00044-2025-0125")).toBeUndefined();
    expect(countIn("фирма с ЕИК 831646048")).toBeUndefined();
  });

  it("tells an assembly, a years window and an election count apart", () => {
    const q1 = "Which members were absent most in the 51st National Assembly?";
    expect(assemblyIn(q1)).toBe(51);
    expect(countIn(q1)).toBeUndefined();
    expect(assemblyIn("Кой отсъства в 51-вото Народно събрание?")).toBe(51);
    expect(yearsWindowIn("Резултатите за последните 5 години")).toBe(5);
    expect(
      electionCountIn("Резултатите за последните 5 години"),
    ).toBeUndefined();
    expect(electionCountIn("mashinno glasuvane v poslednite 7 izbora")).toBe(7);
    expect(
      yearsWindowIn("mashinno glasuvane v poslednite 7 izbora"),
    ).toBeUndefined();
  });
});

describe("places", () => {
  it("counts a transposition as one edit", () => {
    expect(editDistance("plovdiv", "plovidv")).toBe(1);
    expect(editDistance("plovdiv", "plovdiv")).toBe(0);
  });

  it("finds a place in either script, typed in Latin, or misspelt after a cue", async () => {
    for (const [q, want] of [
      ["Резултатите в община Пловдив", "Пловдив"],
      ["Results in Plovdiv municipality", "Plovdiv"],
      ["rezultatite v obshtina plovdiv", "Plovdiv"],
      ["Резутатите в община Плоовдив", "Пловдив"],
      ["Who ran for mayor in Plovidv?", "Plovdiv"],
    ])
      expect(await argsOf("municipalityResults", q)).toMatchObject({
        place: want,
      });
  });

  it("accepts a misspelling ONLY after a place cue", async () => {
    // „Roma" is one edit from Роман and „Zlatia Agro" one from Златица; both
    // are capitalised, and a capital is not evidence of a place.
    expect(
      (await argsOf("localTaxes", "How do the Roma neighbourhoods vote?"))
        .place,
    ).toBeUndefined();
    expect(
      (
        await argsOf(
          "localTaxes",
          "Колко агропомощи са отпуснати на Златия Агро?",
        )
      ).place,
    ).toBeUndefined();
    // …while the same edit right after „in" is a place.
    expect(
      (await argsOf("localTaxes", "What are local taxes in Zlatitca?")).place,
    ).toBe("Zlatitsa");
  });

  it("never reads a party's name as a place", async () => {
    expect(
      (await argsOf("localTaxes", "Кой гласува за Възраждане?")).place,
    ).toBeUndefined();
  });

  it("fills nothing when two places are named for one parameter", async () => {
    expect(
      (await argsOf("localTaxes", "Данъците в Пловдив и Варна")).place,
    ).toBeUndefined();
  });

  it("reads an oblast from the oblast list, not the municipalities", async () => {
    expect(await argsOf("regionResults", "Rsults in Varna reion")).toEqual({
      oblast: "Varna",
    });
  });
});

describe("the dispatcher", () => {
  it("fills a YEAR parameter — which the old extractor left empty", async () => {
    // fillMissingArgs writes a single year into `election` only; a tool whose
    // parameter is called `year` got nothing and the lane asked.
    expect(
      await argsOf(
        "municipalFiscalRanking",
        "Кои десет общини са с най-много просрочени сметки през 2024?",
      ),
    ).toEqual({ year: 2024, count: 10 });
  });

  it("puts two years into compareElections' a and b, in order", async () => {
    expect(await argsOf("compareElections", "Сравни 2022 и 2024")).toEqual({
      a: "2022",
      b: "2024",
    });
  });

  it("reads nothing for a parameter type it has no extractor for", async () => {
    expect(
      await argsOf(
        "nzokDrugMolecule",
        "Which hospitals overpay for BEVACIZUMAB?",
      ),
    ).toEqual({});
  });
});

describe("completeJevPick — stage 3 (extract)", () => {
  const deps = (result: JevResult | null = null) => ({
    ask: vi.fn(async () => result) as unknown as Parameters<
      typeof completeJevPick
    >[3]["ask"],
    credentials: undefined,
    search: async () => [],
  });

  it("runs with the typed year where stage 2 asked", async () => {
    const q = "Разпредели разходите за персонал по министерства за 2024.";
    const full = await completeJevPick(
      q,
      "budgetPersonnelByMinistry",
      null,
      deps(),
      "full",
    );
    expect(full.kind).toBe("clarify");
    const typed = await completeJevPick(
      q,
      "budgetPersonnelByMinistry",
      null,
      deps(),
      "extract",
    );
    expect(typed).toMatchObject({
      kind: "run",
      route: { tool: "budgetPersonnelByMinistry", args: { year: 2024 } },
    });
  });

  it("runs on defaults when every unset parameter is of a type it reads", async () => {
    // Nothing named, and every parameter (`year`) is one an extractor would have
    // found — so the defaults ARE the answer to „the budget of each ministry".
    const done = await completeJevPick(
      "Какъв е бюджетът на всяко министерство?",
      "budgetMinistries",
      null,
      deps(),
      "extract",
    );
    expect(done).toMatchObject({
      kind: "run",
      route: { tool: "budgetMinistries" },
    });
  });

  it("still asks when an unset parameter is free text it cannot read", async () => {
    // Running this on defaults would list the top hospitals over EVERY pathway
    // — an answer to a question nobody asked about haemodialysis.
    const done = await completeJevPick(
      "Which hospitals do the most haemodialyses?",
      "nzokPathwayHospitals",
      null,
      deps(),
      "extract",
    );
    expect(done.kind).toBe("clarify");
  });

  it("asks, rather than throwing or running on defaults, when the gazetteer is down", async () => {
    setFetcher(async () => {
      throw new Error("offline");
    });
    const found = await typedArgs(
      "chmiEvents",
      "Which partial elections were held?",
    );
    expect(found.read.has("place")).toBe(false);
    const done = await completeJevPick(
      "Which partial elections were held?",
      "chmiEvents",
      null,
      deps(),
      "extract",
    );
    expect(done.kind).toBe("clarify");
    // …and the same question with the gazetteer up runs on defaults, so the
    // clarify above is the outage and not something else about the tool.
    clearDataCache();
    resetPlaceCache();
    setFetcher(async () => GAZETTEER);
    const up = await completeJevPick(
      "Which partial elections were held?",
      "chmiEvents",
      null,
      deps(),
      "extract",
    );
    expect(up.kind).toBe("run");
  });

  it("does not read two years as „no year named“", async () => {
    const found = await typedArgs(
      "budgetMinistries",
      "Бюджетите на министерствата за 2023 и 2024",
    );
    expect(found.args.year).toBeUndefined();
    expect(found.read.has("year")).toBe(false);
    const done = await completeJevPick(
      "Бюджетите на министерствата за 2023 и 2024",
      "budgetMinistries",
      null,
      deps(),
      "extract",
    );
    expect(done.kind).toBe("clarify");
  });

  it("replaces the rules' leftover-words place with a gazetteer entry", async () => {
    const done = await completeJevPick(
      "I need decisions adopted by Ruse municipal council.",
      "councilResolutions",
      {
        tool: "localTaxes",
        args: { place: "i need decisions adopted by ruse municipal" },
      },
      deps(),
      "extract",
    );
    expect(done).toMatchObject({
      kind: "run",
      route: { tool: "councilResolutions", args: { place: "Ruse" } },
    });
  });
});
