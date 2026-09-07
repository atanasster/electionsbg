// The cleavages hook's four states, and the guard that keeps a truncated artifact off the page.
//
// ⚠⚠ THE GUARD'S TICKET ARM IS THE POINT OF THIS FILE. `DemographicCleavagesPlot` reads
// `p.pctNational.toFixed(1)` unguarded and uses `partyNum` as its React key, so a payload whose
// tickets are merely objects passed a length-only check and then threw during render — and with
// no error boundary anywhere in `src/`, a render throw unmounts the React ROOT rather than
// degrading one tile. Every arm below is asserted in the REJECTING direction, because „a good
// payload is accepted" is satisfied by a guard that accepts everything.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetPresidentialCleavagesWarnings,
  fetchPresidentialCleavages,
  isPresidentialCleavages,
  presidentialCleavagesPath,
} from "./usePresidentialCleavages";

const payload = (over: Record<string, unknown> = {}) => ({
  cycle: "2021_11_14_pvr",
  round: 1,
  basis: "Свързаност между места, не между хора.",
  basisEn: "A relationship between places, not between people.",
  municipalities: 265,
  votes: 2394489,
  abroadVotes: 220660,
  unmappedVotes: 0,
  tickets: [
    { number: 6, president: "Радев", color: "#111", pctNational: 49.42 },
    { number: 15, president: "Герджиков", color: "#222", pctNational: 22.83 },
  ],
  rows: [
    { metric: "ethnicBulgarian", rs: [0.86, 0.619], spread: 0.241 },
    { metric: "religionMuslim", rs: [-0.842, -0.617], spread: 0.225 },
  ],
  ...over,
});

afterEach(() => {
  __resetPresidentialCleavagesWarnings();
  vi.restoreAllMocks();
});

const respond = (init: { status: number; body?: unknown }) => {
  globalThis.fetch = vi.fn(async () =>
    init.status === 200
      ? new Response(JSON.stringify(init.body), { status: 200 })
      : new Response("", { status: init.status }),
  ) as unknown as typeof fetch;
};

describe("isPresidentialCleavages", () => {
  it("accepts a complete payload", () => {
    expect(isPresidentialCleavages(payload())).toBe(true);
  });

  it.each([
    ["basis", { basis: "" }],
    ["basisEn", { basisEn: "" }],
  ])("refuses a payload that lost its %s", (_name, over) => {
    // ⚠ A DOT ON A −1…+1 TRACK IS EXACTLY THE SHAPE that invites a reader to turn a claim about
    // PLACES into a claim about people. The sentence lives in the artifact so a surface cannot
    // supply its own, which only works if a file without it is refused.
    expect(isPresidentialCleavages(payload(over))).toBe(false);
  });

  it.each([
    ["a ticket with no fields at all", [{}, {}]],
    ["a ticket with no pctNational", [{ number: 6, president: "Р" }, {}]],
    [
      "a ticket whose pctNational is a string",
      [
        { number: 6, president: "Р", pctNational: "49.42" },
        { number: 15, president: "Г", pctNational: 22.8 },
      ],
    ],
    [
      "a ticket whose pctNational is NaN",
      [
        { number: 6, president: "Р", pctNational: Number.NaN },
        { number: 15, president: "Г", pctNational: 22.8 },
      ],
    ],
    [
      "a ticket with no number",
      [
        { president: "Р", pctNational: 49.4 },
        { number: 15, president: "Г", pctNational: 22.8 },
      ],
    ],
    [
      "a null ticket",
      [null, { number: 15, president: "Г", pctNational: 22.8 }],
    ],
  ])("refuses %s", (_name, tickets) => {
    // ⚠⚠ THE CRASH PATH. Each of these once passed the guard and then threw
    // `TypeError: Cannot read properties of undefined (reading 'toFixed')` in the plot's legend.
    expect(isPresidentialCleavages(payload({ tickets }))).toBe(false);
  });

  it("refuses a single-ticket payload", () => {
    // With one dot every row's spread is 0, the sort is arbitrary, and the plot claims a
    // cleavage nobody can see — which is why the producer refuses to write one.
    expect(
      isPresidentialCleavages(
        payload({
          tickets: [{ number: 6, president: "Р", pctNational: 100 }],
          rows: [{ metric: "ethnicBulgarian", rs: [0.5], spread: 0 }],
        }),
      ),
    ).toBe(false);
  });

  it.each([
    ["no rows at all", []],
    ["a row with no metric", [{ rs: [0.1, 0.2], spread: 0.1 }]],
    [
      "a row whose rs are not numbers",
      [{ metric: "m", rs: ["a", "b"], spread: 0.1 }],
    ],
    [
      "a row with FEWER rs than tickets",
      [{ metric: "m", rs: [0.1], spread: 0 }],
    ],
  ])("refuses %s", (_name, rows) => {
    // ⚠ THE LENGTH PAIRING IS LOAD-BEARING. The plot indexes `payload.parties[i]` by the row's
    // own `rs` index, so a short row draws a dot for a ticket that is not there.
    expect(isPresidentialCleavages(payload({ rows }))).toBe(false);
  });
});

describe("fetchPresidentialCleavages", () => {
  it("reads a 404 as ABSENT — the ordinary answer", async () => {
    // `data/*_pvr` is gitignored and reaches the bucket only through `bucket:gz`, and the
    // producer writes nothing for a round in which fewer than two tickets clear its cut.
    respond({ status: 404 });
    expect(await fetchPresidentialCleavages("2021_11_14_pvr", 1)).toEqual({
      status: "absent",
    });
  });

  it("reads a 500 as UNUSABLE, and warns ONCE per reason", async () => {
    respond({ status: 500 });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await fetchPresidentialCleavages("2021_11_14_pvr", 1)).toEqual({
      status: "unusable",
    });
    expect(warn).toHaveBeenCalledTimes(1);
    await fetchPresidentialCleavages("2021_11_14_pvr", 1);
    expect(warn).toHaveBeenCalledTimes(1);
    // ⚠ A DIFFERENT ROUND IS A DIFFERENT KEY. The guard is per (cycle, round, reason), so a
    // second round's failure is not swallowed by the first's.
    await fetchPresidentialCleavages("2021_11_14_pvr", 2);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("refuses a 200 that lost the caveat", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    respond({ status: 200, body: payload({ basisEn: "" }) });
    expect(await fetchPresidentialCleavages("2021_11_14_pvr", 1)).toEqual({
      status: "unusable",
    });
  });

  it("reads a 200 carrying the SPA shell as unusable, not as a missing analysis", async () => {
    // ⚠ THE CI SHAPE. With no data base the fetch goes same-origin, reaches the SPA catch-all
    // and comes back 200 with `index.html`, which `firebase.json` stamps `application/json`.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    globalThis.fetch = vi.fn(
      async () => new Response("<!doctype html><html></html>", { status: 200 }),
    ) as unknown as typeof fetch;
    expect(await fetchPresidentialCleavages("2021_11_14_pvr", 1)).toEqual({
      status: "unusable",
    });
  });

  it("reads a rejected fetch as unusable rather than as routine absence", async () => {
    // A CORS misconfiguration on the bucket takes every cycle out at once; uncaught it reaches
    // the reader as „no such analysis".
    vi.spyOn(console, "warn").mockImplementation(() => {});
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    expect(await fetchPresidentialCleavages("2021_11_14_pvr", 1)).toEqual({
      status: "unusable",
    });
  });

  it("returns the payload when it is whole", async () => {
    respond({ status: 200, body: payload() });
    const got = await fetchPresidentialCleavages("2021_11_14_pvr", 1);
    expect(got.status).toBe("ready");
    expect(got.status === "ready" && got.cleavages.municipalities).toBe(265);
  });
});

describe("presidentialCleavagesPath", () => {
  it("names the file the builder writes, per round", () => {
    // ⚠ THE PRODUCER SIDE IS PINNED IN `scripts/parsers_presidential/demographics.data.test.ts`,
    // which is the one place allowed to import both halves. This pins the browser's own
    // spelling so a rename here fails on its own file rather than only over there.
    expect(presidentialCleavagesPath("2021_11_14_pvr", 1)).toBe(
      "2021_11_14_pvr/tur1/demographic_cleavages.json",
    );
    expect(presidentialCleavagesPath("2021_11_14_pvr", 2)).toBe(
      "2021_11_14_pvr/tur2/demographic_cleavages.json",
    );
  });
});
