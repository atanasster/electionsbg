// Unit tests for the Registry-Agency founding-date crawler.
//
// The subject under test is an INVARIANT, not a feature: a row in
// company_founded means "the register answered", and a NULL founded_date means
// "it answered and had no dated deed" — never "we could not reach it". Because
// the resume query skips every EIK already present, a row written on a failed
// fetch is permanent and no later run revisits it. The 2026-07 backfill wrote
// ~4,100 such rows before this was fixed, so every case below is a regression
// guard against re-opening that door.
//
// No network: the curl runner is injected. No real sleeps: pace 0.

import { describe, it, expect } from "vitest";
import {
  fetchFounded,
  parseArgs,
  makePacer,
  requeueSql,
  isDeedTree,
  minEntryDate,
  BASE_PACE_MS,
} from "./fetch_company_founded";

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

  // Every one of these parses as valid JSON and walks to a null date, so a
  // parse-succeeded check would persist them as real "undated" rows.
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

describe("fetchFounded — which outcomes may be persisted", () => {
  it("persists a real deed tree as a dated answer", async () => {
    const r = await fetchFounded("1", { run: runner(DEED, 200), pace: 0 });
    expect(r).toMatchObject({ ok: true, date: "2019-03-04", status: 200 });
  });

  it("treats a confirmed empty 200 as the register's 'no such company'", async () => {
    // Measured: an unknown EIK answers 200 with an empty body, not 404.
    const r = await fetchFounded("1", { run: runner("", 200), pace: 0 });
    expect(r).toMatchObject({ ok: true, date: null, status: 200 });
  });

  it.each([
    "null",
    "[]",
    "{}",
    '"blocked"',
    '{"Message":"An error has occurred."}',
  ])("refuses to persist a 200 whose body is %s", async (body) => {
    const r = await fetchFounded("1", { run: runner(body, 200), pace: 0 });
    expect(r.ok).toBe(false);
  });

  it("refuses an HTML block page served as 200", async () => {
    const r = await fetchFounded("1", {
      run: runner("<html>denied</html>", 200),
      pace: 0,
    });
    expect(r).toMatchObject({ ok: false, reason: "unparseable-body" });
  });

  it("gives up after the retry budget on sustained 429", async () => {
    const r = await fetchFounded("1", { run: runner("", 429), pace: 0 });
    expect(r).toMatchObject({ ok: false, reason: "rate-limited", attempts: 6 });
  });

  it("never treats a 404 as 'no such company'", async () => {
    // 404 does not occur against this API; one would mean a WAF/edge layer,
    // and persisting it would look legitimate in http_status.
    for (const body of ["<html>404</html>", '{"Message":"not found"}'])
      expect(
        (await fetchFounded("1", { run: runner(body, 404), pace: 0 })).ok,
      ).toBe(false);
  });

  it("does not persist a 500 or a curl failure", async () => {
    expect(
      (await fetchFounded("1", { run: runner("", 500), pace: 0 })).ok,
    ).toBe(false);
    const throwing = async () => {
      throw new Error("connection reset");
    };
    const r = await fetchFounded("1", { run: throwing, pace: 0 });
    expect(r).toMatchObject({ ok: false, reason: "curl-failed" });
  });

  it("recovers when a transient failure is followed by a real answer", async () => {
    let n = 0;
    const flaky = async () => ({
      stdout: n++ === 0 ? "\n429" : `${DEED}\n200`,
    });
    const r = await fetchFounded("1", { run: flaky, pace: 0 });
    expect(r).toMatchObject({ ok: true, date: "2019-03-04", attempts: 2 });
  });

  it("honours a reduced retry budget", async () => {
    const r = await fetchFounded("1", {
      run: runner("", 429),
      pace: 0,
      maxRetry: 1,
    });
    expect(r).toMatchObject({ ok: false, attempts: 2 });
  });
});

describe("parseArgs", () => {
  it("treats a bare --probe as a probe, never as the writing backfill", () => {
    expect(parseArgs(["--probe"]).probe).toBe(20);
  });

  it("rejects --probe combined with --limit rather than silently picking one", () => {
    expect(() => parseArgs(["--probe", "--limit", "20"])).toThrow(/only one/);
  });

  it.each([["--limit", "abc"], ["--limit", "0"], ["--limit"]])(
    "rejects an invalid cap instead of dropping the LIMIT (%j)",
    (...argv) => {
      expect(() => parseArgs(argv)).toThrow(/--limit/);
    },
  );

  it("rejects a non-numeric pace instead of producing sleep(NaN)", () => {
    expect(() => parseArgs(["--pace", "abc"])).toThrow(/--pace/);
  });

  it("never yields a pace below the measured token-bucket rate", () => {
    expect(parseArgs(["--pace", "1"]).basePace).toBe(BASE_PACE_MS);
    expect(parseArgs([]).basePace).toBe(BASE_PACE_MS);
    expect(parseArgs(["--pace", "15000"]).basePace).toBe(15000);
  });

  it("parses the selection and repair flags", () => {
    const a = parseArgs(["--eiks", "200859512, 121587769", "--requeue-nulls"]);
    expect(a.eiks).toEqual(["200859512", "121587769"]);
    expect(a.requeueNulls).toBe(true);
    expect(a.requeueAll).toBe(false);
    expect(parseArgs(["--requeue-nulls", "--dry-run"]).dryRun).toBe(true);
  });
});

describe("requeueSql — the data-loss guard", () => {
  it("spares rows whose provenance proves they are real answers", () => {
    expect(requeueSql({}).sql).toMatch(/http_status IS DISTINCT FROM 200/);
  });

  it("drops that guard only when the blanket form is asked for by name", () => {
    expect(requeueSql({ all: true }).sql).not.toMatch(/http_status/);
  });

  it("honours --eiks so the DELETE cannot exceed the fetch scope", () => {
    const { sql, params } = requeueSql({ eiks: ["200859512"] });
    expect(sql).toMatch(/eik = ANY\(\$1\)/);
    expect(params).toEqual([["200859512"]]);
  });

  it("numbers placeholders correctly when both filters are present", () => {
    const { sql, params } = requeueSql({
      nullSince: "2026-07-01",
      eiks: ["1"],
    });
    expect(sql).toMatch(/fetched_at >= \$1/);
    expect(sql).toMatch(/eik = ANY\(\$2\)/);
    expect(params).toEqual(["2026-07-01", ["1"]]);
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
