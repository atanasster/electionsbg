// The shard hook's four states, and the TWO refusals that are the point of it.
//
// ⚠ A REGION PAGE FETCHES ONE SHARD AND NOTHING ELSE, so both caveats have to be in the file.
// `basis` says the matrix is an estimate rather than counted people; `coverage.basis` says
// which votes are outside it — and on 2011 that second sentence is the larger of the two,
// because the ingest refused to place 1,355 sections / 422,726 runoff votes, all Sofia,
// against 32,024 inside Sofia's three shards. A payload missing either renders a
// complete-looking Sankey at a 200 with nothing qualifying it.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetOblastTransferWarnings,
  fetchOblastTransfer,
  isOblastTransfer,
  oblastTransferPath,
} from "./useOblastTransfer";

const MATRIX = {
  fromNodes: [{ id: "t6", label: "Р", labelEn: "R", color: "#000", votes: 10 }],
  toNodes: [{ id: "t6", label: "Р", labelEn: "R", color: "#000", votes: 12 }],
  flows: [{ from: "t6", to: "t6", votes: 10 }],
};

const payload = (over: Record<string, unknown> = {}) => ({
  cycle: "2021_11_14_pvr",
  oblast: "BGS",
  basis: "Оценка, не наблюдение.",
  basisEn: "An estimate, not an observation.",
  finalists: [
    { number: 6, president: "Р", votes: 12 },
    { number: 15, president: "Г", votes: 6 },
  ],
  sections: 760,
  coverage: {
    basis: "Само секции в страната.",
    basisEn: "Domestic sections only.",
    unplacedSectionsInCycle: 0,
    unplacedVotesInCycle: 0,
    abroadVotesInCycle: 127572,
  },
  matrix: MATRIX,
  droppedVotes: 76,
  marginGap: 0.107,
  rasResidual: 9.718e-9,
  ...over,
});

afterEach(() => {
  __resetOblastTransferWarnings();
  vi.restoreAllMocks();
});

const respond = (init: { status: number; body?: unknown }) => {
  globalThis.fetch = vi.fn(async () =>
    init.status === 200
      ? new Response(JSON.stringify(init.body), { status: 200 })
      : new Response("", { status: init.status }),
  ) as unknown as typeof fetch;
};

describe("isOblastTransfer", () => {
  it("accepts a complete shard", () => {
    expect(isOblastTransfer(payload())).toBe(true);
  });

  it.each([
    ["basis", { basis: "" }],
    ["basisEn", { basisEn: "" }],
  ])("refuses a shard that lost its %s", (_name, over) => {
    expect(isOblastTransfer(payload(over))).toBe(false);
  });

  it.each([
    ["a coverage basis", { basis: "", basisEn: "en" }],
    ["a coverage basisEn", { basis: "bg", basisEn: "" }],
    ["a coverage object at all", undefined],
  ])("refuses a shard with no %s", (_name, cov) => {
    // ⚠⚠ THE SECOND REFUSAL, and the one the country hook does not need as badly. There is no
    // cycle file in a region page's document to fall back on, so a shard with an estimate
    // caveat and no coverage sentence publishes a matrix over an undeclared fraction of its
    // own geography.
    expect(isOblastTransfer(payload({ coverage: cov }))).toBe(false);
  });

  it("refuses a shard with no matrix, and one whose finalists are not a pair", () => {
    expect(isOblastTransfer(payload({ matrix: { fromNodes: [] } }))).toBe(
      false,
    );
    expect(
      isOblastTransfer(payload({ finalists: [{ number: 6, president: "Р" }] })),
    ).toBe(false);
  });
});

describe("fetchOblastTransfer", () => {
  it("reads a 404 as ABSENT — the ordinary answer for an unpublished tree", async () => {
    // ⚠ NOT AN ERROR. `data/*_pvr` is gitignored and reaches the bucket only through
    // `bucket:gz`, and a cycle decided in round 1 has no shards at all.
    respond({ status: 404 });
    expect(await fetchOblastTransfer("2021_11_14_pvr", "BGS")).toEqual({
      status: "absent",
    });
  });

  it("reads a 500 as UNUSABLE, which is a different instruction to the screen", async () => {
    respond({ status: 500 });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await fetchOblastTransfer("2021_11_14_pvr", "BGS")).toEqual({
      status: "unusable",
    });
    expect(warn).toHaveBeenCalledTimes(1);
    // ⚠ ONCE PER PROCESS PER REASON — a per-render warning is a log nobody reads.
    await fetchOblastTransfer("2021_11_14_pvr", "BGS");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("refuses a 200 that lost either caveat", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    respond({ status: 200, body: payload({ basis: "" }) });
    expect(await fetchOblastTransfer("2021_11_14_pvr", "BGS")).toEqual({
      status: "unusable",
    });
    respond({
      status: 200,
      body: payload({ coverage: { basis: "", basisEn: "" } }),
    });
    expect(await fetchOblastTransfer("2021_11_14_pvr", "PDV-00")).toEqual({
      status: "unusable",
    });
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("reads a 200 carrying the SPA shell as unusable, not as an oblast with no runoff", async () => {
    // ⚠ THE CI SHAPE. With no data base the fetch goes same-origin, reaches the SPA catch-all
    // and comes back 200 with `index.html` — which `firebase.json` stamps `application/json`.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    globalThis.fetch = vi.fn(
      async () => new Response("<!doctype html><html></html>", { status: 200 }),
    ) as unknown as typeof fetch;
    expect(await fetchOblastTransfer("2021_11_14_pvr", "BGS")).toEqual({
      status: "unusable",
    });
  });

  it("reads a rejected fetch as unusable rather than as routine absence", async () => {
    // A CORS misconfiguration on the bucket takes every oblast out at once; uncaught it would
    // reach the reader as „this oblast has no runoff estimate".
    vi.spyOn(console, "warn").mockImplementation(() => {});
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    expect(await fetchOblastTransfer("2021_11_14_pvr", "BGS")).toEqual({
      status: "unusable",
    });
  });

  it("returns the shard when it is whole", async () => {
    respond({ status: 200, body: payload() });
    const got = await fetchOblastTransfer("2021_11_14_pvr", "BGS");
    expect(got.status).toBe("ready");
    expect(got.status === "ready" && got.transfer.oblast).toBe("BGS");
  });
});

describe("oblastTransferPath", () => {
  it("names the file the builder writes", () => {
    // ⚠ THE PRODUCER SIDE IS PINNED IN `scripts/parsers_presidential/runoff_transfer.test.ts`,
    // which is the one place allowed to import both halves. This pins the browser's own
    // spelling so a rename here fails on its own file rather than only over there.
    expect(oblastTransferPath("2021_11_14_pvr", "BGS")).toBe(
      "2021_11_14_pvr/runoff_transfer/BGS.json",
    );
  });
});
