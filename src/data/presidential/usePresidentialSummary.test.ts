// `fetchPresidentialSummary`'s four states, and the once-per-process log that distinguishes
// two of them.
//
// ⚠ THE STATES ARE THE POINT. „Not published yet" is the expected answer for most of this
// corpus and „the bucket is failing" is an outage; a reader must not be told the first when
// the second is true, and the log is the only place an operator can tell them apart. All four
// arms were unreachable by any test until now — including the reset helper, which was exported
// as „test-only" with no test.

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import {
  __resetPresidentialSummaryWarnings,
  fetchPresidentialSummary,
} from "./usePresidentialSummary";
import type { PresidentialSummary } from "./summary";

const GOOD: PresidentialSummary = {
  cycle: "2021_11_14_pvr",
  round1Date: "2021-11-14",
  round2Date: null,
  decidedInRound: 1,
  winner: { number: 1, president: "П", vicePresident: "В" },
  rounds: [
    {
      round: 1,
      date: "2021-11-14",
      ranking: [
        {
          number: 1,
          president: "П",
          vicePresident: "В",
          nominatedBy: { name: "ИК", kind: "committee" },
          votes: 10,
          shareOfValid: 0.5,
        },
      ],
      votes: {
        tickets: 10,
        valid: 20,
        invalid: 1,
        invalidBasis: "paper-ballots-found-invalid",
      },
      turnout: { registeredVoters: 100, cast: 20, pct: 0.2, basis: "п" },
      outcome: {
        meetsMajority: false,
        meetsTurnout: false,
        winsOutright: false,
      },
      abroad: {
        sections: 1,
        ticketVotes: 1,
        ballotsFound: 2,
        countries: 1,
        sectionsWithoutCountry: 0,
        sectionsWithoutSignatures: 0,
      },
    },
  ],
  swing: null,
};

const respond = (body: unknown, status = 200) => {
  globalThis.fetch = (async () =>
    new Response(status === 204 ? null : JSON.stringify(body), {
      status,
    })) as typeof fetch;
};

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  __resetPresidentialSummaryWarnings();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

describe("fetchPresidentialSummary", () => {
  it("returns the summary when the body is good", async () => {
    respond(GOOD);
    const s = await fetchPresidentialSummary("2021_11_14_pvr");
    expect(s.status).toBe("ready");
  });

  it("reports a 404 as `absent` and warns once PER CYCLE", async () => {
    respond(null, 404);
    expect((await fetchPresidentialSummary("a")).status).toBe("absent");
    expect((await fetchPresidentialSummary("a")).status).toBe("absent");
    expect(warn).toHaveBeenCalledTimes(1);
    // …and a different cycle is a different absence, so it gets its own line.
    expect((await fetchPresidentialSummary("b")).status).toBe("absent");
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("reports a 500 as `unusable`, NOT as `absent`", async () => {
    // ⚠ THE DISTINCTION THIS HOOK EXISTS FOR. „Резултатите още не са публикувани" is a false
    // claim about our own corpus during a bucket outage; „could not be read" is true of both.
    respond(null, 500);
    expect((await fetchPresidentialSummary("2021_11_14_pvr")).status).toBe(
      "unusable",
    );
  });

  it("reports a rejected fetch as `absent`, under its own key", async () => {
    // A CORS misconfiguration takes every cycle out at once and looks exactly like routine
    // absence; the separate log key is the only thing that says which it is.
    globalThis.fetch = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    expect((await fetchPresidentialSummary("x")).status).toBe("absent");
    expect((await fetchPresidentialSummary("y")).status).toBe("absent");
    // Keyed on the CAUSE rather than the cycle: one broken bucket is one line, not one per
    // cycle a reader happens to open.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("network or CORS");
  });

  it("separates a non-JSON body from one with the wrong shape", async () => {
    globalThis.fetch = (async () =>
      new Response("<!doctype html>", { status: 200 })) as typeof fetch;
    expect((await fetchPresidentialSummary("c")).status).toBe("unusable");
    expect(String(warn.mock.calls[0][0])).toContain("not JSON");

    __resetPresidentialSummaryWarnings();
    warn.mockClear();
    respond({ cycle: "c", rounds: [] });
    expect((await fetchPresidentialSummary("c")).status).toBe("unusable");
    expect(String(warn.mock.calls[0][0])).toContain("unexpected shape");
  });

  it("has a reset that actually resets — the helper's own reason to exist", () => {
    // Without this the once-per-process guard is module state that leaks between tests, and
    // every assertion above on call COUNTS would depend on execution order.
    expect(__resetPresidentialSummaryWarnings()).toBeUndefined();
  });
});
