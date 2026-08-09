// Gates for the per-município status rule.
//
// This is the most consequential decision in the ingest and it had no test
// at all, because it lived inside a ~300-line CLI handler that also parses
// arguments, races the dispatcher, writes the index and prints the report
// — so covering it meant running the binary against live council websites.

import { describe, expect, it } from "vitest";
import { classify, STATUS_LABEL, type RunStatus } from "./status";

describe("classify", () => {
  it("is UNVERIFIED, not no-new, when nothing was touched and a lookup failed", () => {
    // The whole point. "0 new protocols" is a claim about the council; it
    // is only available when we managed to look.
    expect(classify({ protocolsTouched: 0, lookupFailures: 1 })).toBe(
      "unverified",
    );
  });

  it("is no-new when nothing was touched and every lookup succeeded", () => {
    expect(classify({ protocolsTouched: 0, lookupFailures: 0 })).toBe("no-new");
  });

  it("is ok as soon as anything was ingested, failures or not", () => {
    // A partial run still moved the corpus forward, and the watermark —
    // not the status — is what protects the protocols that failed.
    expect(classify({ protocolsTouched: 3, lookupFailures: 2 })).toBe("ok");
  });

  it("prefers abandoned over timed-out", () => {
    // An abandoned dispatcher is a budget expiry PLUS a stall the fetch
    // layer could not abort. Reporting the milder of the two sends the
    // operator to look at HTTP timeouts for a wedged pdftotext.
    expect(
      classify({
        threw: true,
        abandoned: true,
        budgetExpired: true,
        protocolsTouched: 0,
        lookupFailures: 0,
      }),
    ).toBe("abandoned");
  });

  it("distinguishes a budget expiry from an ordinary throw", () => {
    const base = { threw: true, protocolsTouched: 0, lookupFailures: 0 };
    expect(classify({ ...base, budgetExpired: true })).toBe("timed-out");
    expect(classify({ ...base, budgetExpired: false })).toBe("failed");
  });

  it("never returns not-reached — that is the zero value, never assigned", () => {
    // A município the loop got to always has a verdict; only one it never
    // reached keeps the initial value, which is what makes a truncated run
    // distinguishable from a quiet one.
    const outcomes = [
      { protocolsTouched: 0, lookupFailures: 0 },
      { protocolsTouched: 0, lookupFailures: 3 },
      { protocolsTouched: 5, lookupFailures: 0 },
      { protocolsTouched: 0, lookupFailures: 0, dry: true },
      { threw: true, protocolsTouched: 0, lookupFailures: 0 },
      {
        threw: true,
        abandoned: true,
        protocolsTouched: 0,
        lookupFailures: 0,
      },
    ];
    for (const o of outcomes) expect(classify(o)).not.toBe("not-reached");
  });

  it("reports dry ahead of any success verdict", () => {
    // --dry writes nothing, so calling it "ok" would imply a merge and a
    // stamp that never happened.
    expect(
      classify({ protocolsTouched: 4, lookupFailures: 0, dry: true }),
    ).toBe("dry");
  });

  it("labels every status", () => {
    const all: RunStatus[] = [
      "not-reached",
      "ok",
      "no-new",
      "unverified",
      "dry",
      "failed",
      "timed-out",
      "abandoned",
      "skipped",
    ];
    for (const s of all) expect(STATUS_LABEL[s]).toBeTruthy();
    // The three that mean "this município's data did not move as intended"
    // shout, because the table is skimmed.
    for (const s of ["not-reached", "unverified", "failed"] as RunStatus[])
      expect(STATUS_LABEL[s]).toBe(STATUS_LABEL[s].toUpperCase());
  });
});
