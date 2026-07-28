// Unit tests for the crawler's pure surface: the tier-target SQL and arg parsing.
// The crawl loop itself hits the network + PG and is exercised operationally, not here.

import { describe, it, expect } from "vitest";
import { parseArgs, tierSql, TIERS } from "./fetch_cr_deeds";

describe("tierSql", () => {
  it("emits a query for every declared tier", () => {
    for (const t of TIERS) expect(tierSql(t).trim().length).toBeGreaterThan(0);
  });

  it("includes leading-zero EIKs (^[0-9]{9}$), not the founding crawler's ^[1-9]…", () => {
    // The old ^[1-9][0-9]{8}$ dropped 961 municipal EOODs; this must not.
    expect(tierSql("0")).toMatch(/\^\[0-9\]\{9\}\$/);
    expect(tierSql("0")).not.toMatch(/\[1-9\]/);
  });

  it("tier 0 is every contractor, newest contract first", () => {
    const sql = tierSql("0");
    expect(sql).toMatch(/FROM contracts/);
    expect(sql).toMatch(/ORDER BY max\(date\) DESC/);
  });

  it("tier 1 intersects missing-owner EOOD with contractors ∪ funds ∪ subsidy", () => {
    const sql = tierSql("1");
    expect(sql).toMatch(/fund_beneficiaries/);
    expect(sql).toMatch(/agri_subsidies/);
    expect(sql).toMatch(/sole_owner','actual_owner'/);
  });

  it("tier 2b widens to ООД and adds partner to the missing-role set", () => {
    expect(tierSql("2b")).toMatch(/'partner'/);
    expect(tierSql("2b")).toMatch(/OOD/);
  });

  it("matches the BG long-form spellings, not just the Latin codes", () => {
    expect(tierSql("2a")).toContain(
      "Еднолично дружество с ограничена отговорност",
    );
  });
});

describe("parseArgs", () => {
  it("defaults to tier 0", () => {
    expect(parseArgs([]).tier).toBe("0");
  });

  it("accepts a valid tier and rejects an unknown one", () => {
    expect(parseArgs(["--tier", "2a"]).tier).toBe("2a");
    expect(() => parseArgs(["--tier", "9z"])).toThrow(/--tier/);
  });

  it("treats a bare --probe as the default probe count", () => {
    expect(parseArgs(["--probe"]).probe).toBe(20);
  });

  it("rejects --probe combined with --limit rather than silently picking one", () => {
    expect(() => parseArgs(["--probe", "--limit", "20"])).toThrow(/only one/);
  });

  it("never yields a pace below the measured token-bucket rate", () => {
    expect(parseArgs(["--pace", "1"]).basePace).toBe(5000);
    expect(parseArgs([]).basePace).toBe(5000);
    expect(parseArgs(["--pace", "15000"]).basePace).toBe(15000);
  });

  it("parses --eiks into a trimmed, de-duplicated list", () => {
    expect(parseArgs(["--eiks", "121587769, 000022044"]).eiks).toEqual([
      "121587769",
      "000022044",
    ]);
    // A repeated EIK must not spend two rate-limited requests.
    expect(parseArgs(["--eiks", "111,111,222"]).eiks).toEqual(["111", "222"]);
  });

  it("rejects --probe combined with --eiks (which would silently write)", () => {
    expect(() => parseArgs(["--probe", "--eiks", "111"])).toThrow(/--eiks/);
  });

  it("normalizes a valid --refresh-before to a full ISO timestamp", () => {
    expect(parseArgs(["--refresh-before", "2026-01-01"]).refreshBefore).toBe(
      "2026-01-01T00:00:00.000Z",
    );
  });

  it("rejects a non-date --refresh-before rather than silently mis-comparing", () => {
    expect(() => parseArgs(["--refresh-before", "yesterday"])).toThrow(
      /refresh-before/,
    );
  });

  it("rejects an invalid --limit rather than dropping the cap", () => {
    const cases: string[][] = [
      ["--limit", "abc"],
      ["--limit", "0"],
      ["--limit"],
    ];
    for (const argv of cases) expect(() => parseArgs(argv)).toThrow(/--limit/);
  });
});
