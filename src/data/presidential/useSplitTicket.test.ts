// The split-ticket hook's four states, and the refusal that keeps a FLOOR from being read as a
// measurement.
//
// ⚠ A PAYLOAD THAT LOST `basis` IS `unusable`. The sentence is the derivation — two sets from
// one section's voters, so the difference in their sizes is a minimum — and without it
// „41,235" beside a party's name reads as a count of people who changed their minds.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetSplitTicketWarnings,
  fetchSplitTicket,
  isSplitTicket,
  splitTicketPath,
} from "./useSplitTicket";

const payload = (over: Record<string, unknown> = {}) => ({
  cycle: "2021_11_14_pvr",
  sameDayElection: "2021_11_14",
  basis: "Долна граница, не оценка.",
  basisEn: "A lower bound, not an estimate.",
  pairs: [],
  refused: [],
  coverage: {
    basis: "b",
    basisEn: "b",
    sectionsMatched: 12488,
    sectionsPvrOnly: 0,
    sectionsNsOnly: 750,
  },
  ...over,
});

afterEach(() => {
  __resetSplitTicketWarnings();
  vi.restoreAllMocks();
});

const respond = (init: { status: number; body?: unknown }) => {
  globalThis.fetch = vi.fn(async () =>
    init.status === 200
      ? new Response(JSON.stringify(init.body), { status: 200 })
      : new Response("", { status: init.status }),
  ) as unknown as typeof fetch;
};

describe("isSplitTicket", () => {
  it("accepts a complete payload", () => {
    expect(isSplitTicket(payload())).toBe(true);
  });

  it.each([
    ["basis", { basis: "" }],
    ["basisEn", { basisEn: undefined }],
    ["coverage.basis", { coverage: { basisEn: "b" } }],
    ["coverage.basisEn", { coverage: { basis: "b" } }],
  ])("refuses a payload that lost %s", (_name, over) => {
    expect(isSplitTicket(payload(over))).toBe(false);
  });

  it("refuses a payload with no `refused` list", () => {
    // ⚠ NOT AN OPTIONAL FIELD. Nine of 2021's tickets have no list and two of them reached the
    // runoff; a payload without that array renders a table of fourteen candidates as if it were
    // the ballot.
    expect(isSplitTicket(payload({ refused: undefined }))).toBe(false);
  });
});

describe("fetchSplitTicket", () => {
  it("reads a 404 as ABSENT — four of the five cycles have no same-day list", async () => {
    respond({ status: 404 });
    await expect(fetchSplitTicket("2001_11_11_pvr")).resolves.toEqual({
      status: "absent",
    });
  });

  it("reads a 200 carrying the SPA shell as unusable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    globalThis.fetch = vi.fn(
      async () =>
        new Response("<!doctype html><html>…", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;
    await expect(fetchSplitTicket("2021_11_14_pvr")).resolves.toEqual({
      status: "unusable",
    });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("refuses a 200 that lost the derivation, and says so once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    respond({ status: 200, body: payload({ basis: "" }) });
    await expect(fetchSplitTicket("2021_11_14_pvr")).resolves.toEqual({
      status: "unusable",
    });
    await fetchSplitTicket("2021_11_14_pvr");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("returns the payload when it is whole", async () => {
    respond({ status: 200, body: payload() });
    expect((await fetchSplitTicket("2021_11_14_pvr")).status).toBe("ready");
  });
});

describe("splitTicketPath", () => {
  it("names the file the builder writes", () => {
    expect(splitTicketPath("2021_11_14_pvr")).toBe(
      "2021_11_14_pvr/split_ticket.json",
    );
  });
});
