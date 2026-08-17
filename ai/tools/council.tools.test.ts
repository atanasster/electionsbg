// The `councilResolutions` and `governanceProfile` council arm. Hermetic — the
// db fetcher is swapped for an in-memory fixture.
//
// Every assertion here is about a sentence the assistant must not be able to
// produce. This tool answers „какво реши общинският съвет", and the failures it
// is capable of are all confident ones:
//
//   1. A FAILED LOOKUP IS NOT "NO COUNCIL HERE". The route returns null for the
//      249 municipalities with no council; a throw means the lookup broke.
//      Collapsing them prints „още не са индексирани" plus „Покритие: 16
//      общини" during an outage — a false claim about our own coverage.
//   2. THE PLACEHOLDER IS NOT A DECISION. 47% of the corpus stores the literal
//      "(no title parsed)"; reading it back states a parser's internal
//      condition as the subject of a public decision.
//   3. THE COUNCIL IS NOT THE PLACE. A reader in район Красно село is served
//      Столична община's decisions — titling those „Общински съвет — Красно
//      село" names a council that does not exist.
//   4. THE COUNT IS THE COUNCIL'S HISTORY, not the page size.
//
// The `governanceProfile` case deliberately uses a município whose council code
// DIFFERS from its obshtina code. Every existing regression case uses Габрово
// (GAB05 -> GAB05), one of the eight where the codes match — so the suite
// passed both before and after the bug this tier fixed, and would again.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { councilResolutions } from "./placeData";
import { setDbFetcher, setFetcher, clearDataCache } from "./dataClient";
import type { ToolContext } from "./types";

const ctxBg = { lang: "bg" } as ToolContext;
const ctxEn = { lang: "en" } as ToolContext;

const resolution = (over: Record<string, unknown> = {}) => ({
  id: "BGS01-2025-prot23-r16891",
  decidedOn: "2025-04-29",
  number: "16891",
  title: "Приемане на бюджет",
  tallyFor: 40,
  tallyAgainst: 1,
  tallyAbstain: 2,
  ...over,
});

const detail = (over: Record<string, unknown> = {}) => ({
  name: "Община Бургас",
  resolutionCount: 374,
  resolutions: [resolution()],
  ...over,
});

/** Minimal municipalities.json so resolveMunicipality() can answer. */
const MUNIS = [
  {
    obshtina: "BGS04",
    name: "Бургас",
    nameEn: "Burgas",
    oblast: "BGS",
    oblastName: { bg: "Бургас", en: "Burgas" },
    ekatte: "07079",
  },
];

let dbCalls: { route: string; params: Record<string, unknown> }[] = [];

const install = (
  handler: (route: string, params: Record<string, unknown>) => unknown,
): void => {
  setFetcher(async (path: string) => {
    if (path.includes("municipalities")) return MUNIS;
    return [];
  });
  setDbFetcher(async (route: string, params: Record<string, unknown>) => {
    dbCalls.push({ route, params });
    return handler(route, params);
  });
};

beforeEach(() => {
  dbCalls = [];
  clearDataCache();
});
afterEach(() => clearDataCache());

describe("councilResolutions", () => {
  it("asks the route for the FRONTEND code and lets it resolve", async () => {
    install(() => detail());
    await councilResolutions({ place: "Бургас" }, ctxBg);
    const call = dbCalls.find((c) => c.route === "council-muni");
    expect(call).toBeTruthy();
    // BGS04, the obshtina code — never BGS01, the council's own key. The code
    // spaces differ for 8 of 16 councils and resolution belongs server-side;
    // the deleted client-side version fell back to a fuzzy name substring.
    expect(call!.params.code).toBe("BGS04");
  });

  it("reports the council's WHOLE history, not the page size", async () => {
    install(() => detail({ resolutions: [resolution()] }));
    const r = (await councilResolutions({ place: "Бургас" }, ctxBg)) as {
      facts: Record<string, unknown>;
      rows: unknown[];
    };
    expect(r.rows).toHaveLength(1);
    expect(String(r.facts.total)).toContain("374");
  });

  it("names the COUNCIL, not the place", async () => {
    install(() => detail({ name: "Столична община" }));
    const r = (await councilResolutions({ place: "Бургас" }, ctxBg)) as {
      title: string;
    };
    expect(r.title).toContain("Столична община");
  });

  it("never reads the (no title parsed) placeholder back", async () => {
    install(() =>
      detail({ resolutions: [resolution({ title: "(no title parsed)" })] }),
    );
    const bg = (await councilResolutions({ place: "Бургас" }, ctxBg)) as {
      rows: { title: string }[];
    };
    expect(bg.rows[0].title).not.toContain("no title parsed");
    expect(bg.rows[0].title).toContain("16891");
    clearDataCache();
    const en = (await councilResolutions({ place: "Бургас" }, ctxEn)) as {
      rows: { title: string }[];
    };
    // Bilingual — Русе is 211 of 211 placeholders, so an English reader would
    // otherwise get every row in Bulgarian under an English title.
    expect(en.rows[0].title).toMatch(/Decision no\./);
  });

  it("says 'not indexed' for a place with no council", async () => {
    install(() => null);
    const r = (await councilResolutions({ place: "Бургас" }, ctxBg)) as {
      title: string;
      facts: Record<string, unknown>;
    };
    expect(r.title).toContain("още не са индексирани");
    expect(String(r.facts.note)).toContain("16");
  });

  it("does NOT claim 'not indexed' when the lookup FAILS", async () => {
    // The critical one. A 500, a timeout or an unloaded corpus must not be
    // rendered as a fact about our coverage — the tool speaks in sentences and
    // „Покритие: 16 общини" is a claim, not a status line.
    install(() => {
      throw new Error("db unreachable");
    });
    await expect(
      councilResolutions({ place: "Бургас" }, ctxBg),
    ).rejects.toThrow();
  });

  it("renders a missing tally as a dash, never as zeros", async () => {
    install(() =>
      detail({
        resolutions: [
          resolution({
            tallyFor: null,
            tallyAgainst: null,
            tallyAbstain: null,
          }),
        ],
      }),
    );
    const r = (await councilResolutions({ place: "Бургас" }, ctxBg)) as {
      rows: { vote: string }[];
    };
    // 11 of 16 councils publish no named vote and three publish no tally at
    // all; "0/0/0" would assert a unanimity nothing recorded.
    expect(r.rows[0].vote).toBe("—");
  });

  it("cites the route it actually read", async () => {
    install(() => detail());
    const r = (await councilResolutions({ place: "Бургас" }, ctxBg)) as {
      provenance: string[];
    };
    expect(r.provenance).toContain("db:council-muni");
    expect(r.provenance.join()).not.toContain("index.json");
  });
});
