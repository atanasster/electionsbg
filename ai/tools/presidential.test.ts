// run() tests for `presidentialResults`.
//
// ⚠ THE THREE THINGS A TABLE CANNOT SHOW ON ITS OWN. A leader's share beside a name reads as a
// win — 2006's Първанов took 64.05% of the valid vote in round 1 and was NOT elected, because
// turnout was 43.88% — so the art. 93 (3) verdict must be in `facts` every time; the ROUND must
// be in the title, because a runoff is a different electorate a week later with two ballot lines
// instead of 23; and „не подкрепям никого" must be ABSENT rather than 0 before 2016.

import { describe, it, expect, afterEach } from "vitest";
import {
  presidentialResults,
  resolvePresidentialCycle,
  resolvePresidentialRound,
} from "./presidential";
import { setFetcher, clearDataCache } from "./dataClient";
import { PRESIDENTIAL_CATALOGUE } from "../../src/data/presidentialCatalogue";
import type { ToolContext } from "./types";

const ctx = { lang: "bg" } as ToolContext;

const ticket = (
  number: number,
  president: string,
  kind = "committee",
  color?: string,
) => ({
  number,
  president,
  vicePresident: `${president} — вице`,
  nominatedBy: { name: `ИК за ${president}`, kind },
  color,
});

const summary = (over: Record<string, unknown> = {}) => ({
  cycle: "2021_11_14_pvr",
  decidedInRound: 2,
  winner: { president: "Румен Радев", vicePresident: "Илияна Йотова" },
  rounds: [
    {
      round: 1,
      date: "2021-11-14",
      ranking: [
        { ...ticket(6, "Румен Радев"), votes: 1000, shareOfValid: 0.5 },
        { ...ticket(15, "Анастас Герджиков"), votes: 600, shareOfValid: 0.3 },
      ],
      votes: { tickets: 1600, noneOfTheAbove: 40, valid: 1640 },
      turnout: { registeredVoters: 5000, cast: 1700, pct: 0.34 },
      outcome: {
        meetsMajority: false,
        meetsTurnout: false,
        winsOutright: false,
      },
    },
    {
      round: 2,
      date: "2021-11-21",
      ranking: [
        { ...ticket(6, "Румен Радев"), votes: 1400, shareOfValid: 0.66 },
        { ...ticket(15, "Анастас Герджиков"), votes: 700, shareOfValid: 0.33 },
      ],
      votes: { tickets: 2100, noneOfTheAbove: 30, valid: 2130 },
      turnout: { registeredVoters: 5000, cast: 2150, pct: 0.43 },
      outcome: {
        meetsMajority: true,
        meetsTurnout: false,
        winsOutright: false,
      },
    },
  ],
  ...over,
});

const regionEntry = (
  key: string,
  a: number,
  b: number,
  reg = 400,
  sig = 140,
) => ({
  key,
  results: {
    votes: [
      { partyNum: 6, totalVotes: a },
      { partyNum: 15, totalVotes: b },
    ],
    protocol: { registeredVoters: reg, signatures: sig },
  },
});

const regionVotes = {
  entries: [
    regionEntry("BLG", 90, 40),
    // Sofia city is THREE МИР in every pvr tree — `SOF` is a resolver alias and a key in no
    // vote file, which is what made the capital answer „няма данни".
    regionEntry("S23", 300, 100, 1000, 400),
    regionEntry("S24", 200, 90, 900, 300),
    regionEntry("S25", 150, 80, 800, 260),
  ],
};

const muniVotes = {
  entries: [
    {
      key: "BLG01",
      results: {
        votes: [
          { partyNum: 6, totalVotes: 20 },
          { partyNum: 15, totalVotes: 30 },
        ],
        protocol: { registeredVoters: 100, signatures: 55 },
      },
    },
  ],
};

const serve = (over: Record<string, unknown> = {}) => {
  const body = summary(over.summary as Record<string, unknown> | undefined);
  setFetcher(async (p: string) => {
    if (p.includes("national_summary.json")) return body;
    if (p.includes("tickets.json"))
      return {
        tickets: [
          ticket(6, "Румен Радев", "committee", "#111111"),
          ticket(15, "Анастас Герджиков", "committee", "#222222"),
        ],
      };
    if (p.includes("municipality_votes.json")) return muniVotes;
    if (p.includes("region_votes.json")) return regionVotes;
    // ⚠ `resolveMunicipality` READS THE PLACE CATALOGUE, so a fixture that answers only the
    // election files makes the place arm throw rather than resolve. One row is enough.
    if (p.includes("/municipalities.json"))
      return [
        {
          ekatte: "04279",
          name: "Благоевград",
          name_en: "Blagoevgrad",
          obshtina: "BLG01",
          nuts3: "BG413",
          oblast: "BLG",
        },
      ];
    throw new Error(`unexpected fetch ${p}`);
  });
};

afterEach(() => clearDataCache());

describe("resolvePresidentialCycle", () => {
  it("defaults to the latest, and resolves a bare year", () => {
    expect(resolvePresidentialCycle().name).toBe("2021_11_14_pvr");
    expect(resolvePresidentialCycle("2016").name).toBe("2016_11_06_pvr");
    expect(resolvePresidentialCycle("2016_11_06_pvr").name).toBe(
      "2016_11_06_pvr",
    );
  });

  it("falls back to the latest for a year this build does not catalogue", () => {
    // ⚠ THE CATALOGUE, NOT A SHAPE. Matching `\\d{4}_\\d{2}_\\d{2}_pvr` would let
    // „2019_11_14_pvr" through to a 404 the chat renders as „no data" — a statement about a
    // cycle that never happened.
    expect(resolvePresidentialCycle("2019").name).toBe("2021_11_14_pvr");
    expect(resolvePresidentialCycle("nonsense").name).toBe("2021_11_14_pvr");
  });
});

describe("resolvePresidentialRound", () => {
  const entry = PRESIDENTIAL_CATALOGUE.find(
    (e) => e.name === "2021_11_14_pvr",
  )!;

  it("defaults to the round that ELECTED the president, not round 1", () => {
    // „The results of the 2021 presidential election" means the runoff. All five cycles went
    // to one, so a round-1 default would have answered a different question every time.
    expect(resolvePresidentialRound(entry)).toBe(entry.decidedInRound);
  });

  it("takes an explicit round, and clamps a runoff nobody held", () => {
    expect(resolvePresidentialRound(entry, 1)).toBe(1);
    expect(resolvePresidentialRound(entry, "2")).toBe(2);
    const oneRound = { ...entry, round2Date: null, decidedInRound: 1 as const };
    // ⚠ A CYCLE DECIDED IN ROUND 1 HAS NO `tur2` TREE. Asking for one would 404 into „no
    // data" rather than saying the round did not happen.
    expect(resolvePresidentialRound(oneRound, 2)).toBe(1);
  });
});

describe("presidentialResults", () => {
  it("carries the art. 93 (3) verdict on ROUND 1 — the round the rule tests", async () => {
    // ⚠ THE 2006 SHAPE: 64.05% of the valid vote and NOT elected, because turnout was 43.88%.
    // Both conditions have to reach `facts`, because the share alone reads as a win.
    const s = summary();
    s.rounds[0].outcome = {
      meetsMajority: true,
      meetsTurnout: false,
      winsOutright: false,
    };
    setFetcher(async (p: string) => {
      if (p.includes("national_summary.json")) return s;
      if (p.includes("tickets.json")) return { tickets: [] };
      if (p.includes("region_votes.json")) return regionVotes;
      throw new Error(`unexpected ${p}`);
    });
    const facts = JSON.stringify(
      (await presidentialResults({ round: 1 }, ctx)).facts,
    );
    expect(facts).toMatch(/няма избран в първи тур/);
    // ⚠ ONE BRANCH, NOT AN ALTERNATION. `/няма мнозинство|мнозинството е налице/` is true for
    // both values of the same boolean and therefore tests nothing.
    expect(facts).toMatch(/мнозинството е налице/);
    expect(facts).toMatch(/активността е недостатъчна/);
  });

  it("does NOT apply art. 93 (3) to the runoff", async () => {
    // ⚠⚠ ART. 93 (4): THE RUNOFF IS A PLURALITY. `winnerRule.ts` computes `winsOutright` for
    // both rounds and consumes only the round-1 value, so reading it on round 2 says nobody was
    // elected in the round that elected the president — true of 2021 (34.63% turnout), 2011
    // (48.24%) and 2006 (41.69%), i.e. three of five cycles and the DEFAULT query.
    serve();
    const facts = JSON.stringify((await presidentialResults({}, ctx)).facts);
    expect(facts).not.toMatch(/няма избран/);
    expect(facts).toMatch(/избран в този тур: Румен Радев/);
    // …and the two conditions are absent here: they describe a test that does not govern it.
    expect(facts).not.toMatch(/активността е недостатъчна/);
  });

  it("says a president WAS elected in round 1 where that happened", async () => {
    // The branch no fixture reached before, which is why the runoff defect survived: the
    // „elected in this round" arm never fired in a test.
    const s = summary({ decidedInRound: 1 });
    s.rounds[0].outcome = {
      meetsMajority: true,
      meetsTurnout: true,
      winsOutright: true,
    };
    setFetcher(async (p: string) => {
      if (p.includes("national_summary.json")) return s;
      if (p.includes("tickets.json")) return { tickets: [] };
      if (p.includes("region_votes.json")) return regionVotes;
      throw new Error(`unexpected ${p}`);
    });
    const env = await presidentialResults({ round: 1 }, ctx);
    expect(JSON.stringify(env.facts)).toMatch(/избран в този тур: Румен Радев/);
    expect(env.title).toMatch(/първи тур/);
  });

  it("names the round in the title, both times", async () => {
    serve();
    const runoff = await presidentialResults({}, ctx);
    expect(runoff.title).toMatch(/балотаж/);
    clearDataCache();
    serve();
    const first = await presidentialResults({ round: 1 }, ctx);
    expect(first.title).toMatch(/първи тур/);
  });

  it("reports „не подкрепям никого“ only when the ballot carried it", async () => {
    // ⚠ ABSENT, NOT ZERO. Three of the five cycles predate the line; a 0 would report that
    // nobody chose an option nobody was offered.
    serve();
    const withIt = await presidentialResults({}, ctx);
    expect(JSON.stringify(withIt.facts)).toMatch(/не подкрепям никого/);
    clearDataCache();
    const s = summary();
    (
      s.rounds[1] as { votes: { noneOfTheAbove: number | null } }
    ).votes.noneOfTheAbove = null;
    setFetcher(async (p: string) => {
      if (p.includes("national_summary.json")) return s;
      if (p.includes("tickets.json")) return { tickets: [] };
      if (p.includes("region_votes.json")) return regionVotes;
      throw new Error(`unexpected ${p}`);
    });
    const without = await presidentialResults({}, ctx);
    expect(JSON.stringify(without.facts)).not.toMatch(/не подкрепям никого/);
  });

  it("colours the winner map from the TICKET's own colour", async () => {
    // The ingest resolved each pair's colour once; the map, the page and this tool must not
    // each pick a different one for the same person.
    serve();
    const env = await presidentialResults({}, ctx);
    expect(env.geo?.areas?.[0]).toMatchObject({
      code: "BLG",
      color: "#111111",
      display: "Румен Радев",
    });
  });

  it("answers for one município, and says whose share the % is", async () => {
    serve();
    const env = await presidentialResults({ place: "Благоевград" }, ctx);
    expect(env.kind).toBe("table");
    // ⚠ THE PLACE'S OWN ORDER, not the national one — Герджиков leads this fixture's
    // município while Радев leads nationally, and a table that kept the national order would
    // put the loser first with no indication.
    expect(env.rows?.[0]?.pair).toMatch(/Герджиков/);
    expect(env.provenance.some((p) => p.includes("municipality_votes"))).toBe(
      true,
    );
  });

  it("answers for София rather than declaring no data for the capital", async () => {
    // ⚠ `SOF` IS A RESOLVER ALIAS AND A KEY IN NO VOTE FILE — Sofia city is three МИР in every
    // pvr tree, so a plain municipality lookup answers „no data" about the largest município in
    // the country, with the numbers one file away.
    serve();
    const env = await presidentialResults({ place: "София" }, ctx);
    expect(JSON.stringify(env.facts)).not.toMatch(/няма данни/);
    expect(env.kind).toBe("table");
    expect(env.title).toMatch(/София \(столична община — 3 МИР\)/);
    // …and the three МИР are SUMMED rather than one of them picked: 300+200+150.
    expect(env.rows?.[0]?.votes).toBe(650);
    expect(env.provenance.some((p) => p.includes("region_votes"))).toBe(true);
  });

  it("answers an OBLAST question with oblast numbers, and names the scope", async () => {
    // ⚠ `resolveMunicipality` SUBSTRING-MATCHES and every oblast centre is also a município, so
    // a municipality-first single argument answered „област Пловдив" with the city's numbers —
    // about half the votes, under a title naming neither scope.
    serve();
    const env = await presidentialResults({ place: "област Благоевград" }, ctx);
    expect(env.provenance.some((p) => p.includes("region_votes"))).toBe(true);
    expect(env.provenance.some((p) => p.includes("municipality_votes"))).toBe(
      false,
    );
    expect(env.title).toMatch(/област/);
    const viaArg = await presidentialResults({ oblast: "Благоевград" }, ctx);
    expect(viaArg.title).toMatch(/област/);
  });

  it("cites only the files it read", async () => {
    // `tickets.json` exists for the winner map's colours and the place arms never touch it;
    // `provenance` is the citation surface, so listing it there is a small untruth.
    serve();
    const env = await presidentialResults({ place: "Благоевград" }, ctx);
    expect(env.provenance.some((p) => p.includes("tickets.json"))).toBe(false);
    expect(env.provenance.some((p) => p.includes("region_votes"))).toBe(false);
  });

  it("records a substituted cycle instead of answering as if it existed", async () => {
    // The fallback is right — better the latest than a 404 — but the LLM narrates `facts`, so
    // „резултатите през 2019" would otherwise come back as a confident 2021 answer.
    serve();
    const env = await presidentialResults({ cycle: "2019" }, ctx);
    expect(JSON.stringify(env.facts)).toMatch(/няма президентски избор през/);
  });

  it("answers in English without leaking Bulgarian label keys", async () => {
    serve();
    const env = await presidentialResults({}, { lang: "en" } as ToolContext);
    expect(env.title).toBe("Presidential election — 2021, runoff");
    expect(Object.keys(env.facts)).toEqual(
      expect.arrayContaining(["election", "outcome", "president elected"]),
    );
    // Candidate NAMES stay Cyrillic — a person's name is not translated; the label KEYS must
    // not be.
    expect(
      Object.keys(env.facts)
        .filter((k) => /[а-яА-Я]/.test(k))
        .sort(),
    ).toEqual(["Анастас Герджиков", "Румен Радев"]);
    expect(env.columns?.map((c) => c.label)).toEqual([
      "Pair",
      "Nominated by",
      "Votes",
      "% of valid",
    ]);
  });

  it("keeps the table when the decorative winner map cannot be fetched", async () => {
    // ⚠ `fetchData` REJECTS ON A NON-OK RESPONSE. The map is additive; the table is the answer,
    // and five publication eras make an absent per-round roll-up a realistic state.
    setFetcher(async (p: string) => {
      if (p.includes("national_summary.json")) return summary();
      if (p.includes("tickets.json")) return { tickets: [] };
      throw new Error("404");
    });
    const env = await presidentialResults({}, ctx);
    expect(env.kind).toBe("table");
    expect(env.rows?.length).toBeGreaterThan(0);
    expect(env.geo?.areas).toEqual([]);
  });

  it("says the place is unknown rather than answering nationally", async () => {
    // ⚠ THE SILENT FALLBACK IS THE DEFECT. A national table under the title „Резултати за
    // Мордор" is a working answer to a question nobody asked.
    serve();
    const env = await presidentialResults({ place: "Мордор" }, ctx);
    expect(env.kind).toBe("scalar");
    expect(JSON.stringify(env.facts)).toMatch(/непознато място/);
  });
});
