// Unit tests for the shared Registry-Agency deed client.
//
// The subject is the INVARIANT the whole capture pipeline rests on: `ok: true`
// means the register answered (with a body, or a real empty-200 "no such
// company"), and `ok: false` means we could not reach it and MUST NOT be
// persisted. Every case is a regression guard against the permanent-poisoning
// bug that undated ~4,100 reachable firms before the discriminated result landed.
//
// No network: the curl runner is injected. No real sleeps: pace 0.

import { describe, it, expect } from "vitest";
import {
  fetchDeed,
  isDeedTree,
  minEntryDate,
  makePacer,
} from "./crDeedsClient";

// The runner returns curl's stdout: body, newline, HTTP status.
const runner = (body: string, code: number) => async () => ({
  stdout: `${body}\n${code}`,
});
const DEED = '{"uic":"121587769","fieldEntryDate":"2019-03-04T00:00:00"}';

describe("isDeedTree", () => {
  it("accepts a real deed object", () => {
    expect(isDeedTree(JSON.parse(DEED))).toBe(true);
    expect(isDeedTree({ deedStatus: 1 })).toBe(true);
    expect(isDeedTree({ sections: [] })).toBe(true);
  });

  it.each([null, [], {}, "blocked", 0, { Message: "An error has occurred." }])(
    "rejects the non-answer %j",
    (v) => {
      expect(isDeedTree(v)).toBe(false);
    },
  );
});

describe("minEntryDate", () => {
  it("returns the earliest dated field in the tree", () => {
    expect(
      minEntryDate({
        a: { fieldEntryDate: "2020-05-06T00:00:00" },
        b: [{ recordMinActionDate: "2018-01-02T09:00:00" }],
      }),
    ).toBe("2018-01-02");
  });

  it("returns null when nothing is dated", () => {
    expect(minEntryDate({ uic: "1", sections: [] })).toBeNull();
  });
});

describe("fetchDeed — which outcomes may be persisted", () => {
  it("returns the raw body AND parse on a real deed tree", async () => {
    const r = await fetchDeed("1", { run: runner(DEED, 200), pace: 0 });
    expect(r).toMatchObject({ ok: true, body: DEED, status: 200 });
    if (r.ok) expect((r.parsed as { uic: string }).uic).toBe("121587769");
  });

  it("treats a confirmed empty 200 as 'no such company' — answer, null body", async () => {
    const r = await fetchDeed("1", { run: runner("", 200), pace: 0 });
    expect(r).toMatchObject({
      ok: true,
      body: null,
      parsed: null,
      status: 200,
    });
  });

  it.each([
    "null",
    "[]",
    "{}",
    '"blocked"',
    '{"Message":"An error has occurred."}',
  ])("refuses to persist a 200 whose body is %s", async (body) => {
    const r = await fetchDeed("1", { run: runner(body, 200), pace: 0 });
    expect(r.ok).toBe(false);
  });

  it("refuses an HTML block page served as 200", async () => {
    const r = await fetchDeed("1", {
      run: runner("<html>denied</html>", 200),
      pace: 0,
    });
    expect(r).toMatchObject({ ok: false, reason: "unparseable-body" });
  });

  it("gives up after the retry budget on sustained 429", async () => {
    const r = await fetchDeed("1", { run: runner("", 429), pace: 0 });
    expect(r).toMatchObject({ ok: false, reason: "rate-limited", attempts: 6 });
  });

  it("never treats a 404 as 'no such company'", async () => {
    for (const body of ["<html>404</html>", '{"Message":"not found"}'])
      expect(
        (await fetchDeed("1", { run: runner(body, 404), pace: 0 })).ok,
      ).toBe(false);
  });

  it("does not persist a 500 or a curl failure", async () => {
    expect((await fetchDeed("1", { run: runner("", 500), pace: 0 })).ok).toBe(
      false,
    );
    const throwing = async () => {
      throw new Error("connection reset");
    };
    const r = await fetchDeed("1", { run: throwing, pace: 0 });
    expect(r).toMatchObject({ ok: false, reason: "curl-failed" });
  });

  it("recovers when a transient failure is followed by a real answer", async () => {
    let n = 0;
    const flaky = async () => ({
      stdout: n++ === 0 ? "\n429" : `${DEED}\n200`,
    });
    const r = await fetchDeed("1", { run: flaky, pace: 0 });
    expect(r).toMatchObject({ ok: true, attempts: 2 });
    if (r.ok) expect(minEntryDate(r.parsed)).toBe("2019-03-04");
  });

  it("honours a reduced retry budget", async () => {
    const r = await fetchDeed("1", {
      run: runner("", 429),
      pace: 0,
      maxRetry: 1,
    });
    expect(r).toMatchObject({ ok: false, attempts: 2 });
  });
});

describe("makePacer", () => {
  it("widens on failure up to the ceiling and decays to the base", () => {
    const p = makePacer(5000, 120_000, 1.5);
    for (let i = 0; i < 50; i++) p.onFail();
    expect(p.current).toBe(120_000);
    for (let i = 0; i < 50; i++) p.onOk();
    expect(p.current).toBe(5000);
  });

  it("never produces NaN", () => {
    const p = makePacer(5000, 120_000, 1.5);
    p.onFail();
    p.onOk();
    expect(Number.isFinite(p.current)).toBe(true);
  });
});
