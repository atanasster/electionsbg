import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { nationalResults } from "../../../ai/tools/national";
import { clearDataCache, setFetcher } from "../../../ai/tools/dataClient";
import { presidentialResults } from "../../../ai/tools/presidential";
import type { ToolContext } from "../../../ai/tools/types";
import { dbReachable, end, getPool, pinLocalDatabase } from "../lib/pg";

pinLocalDatabase();
const reachable = await dbReachable();
const DATA_ROOT = path.join(process.cwd(), "data");
const local = async (source: string): Promise<unknown> =>
  JSON.parse(
    readFileSync(path.join(DATA_ROOT, source.replace(/^\//, "")), "utf8"),
  );
const ctx = { lang: "bg" } as ToolContext;

afterEach(() => clearDataCache());
afterAll(async () => {
  await end();
});

describe.skipIf(!reachable)("normalized national election results", () => {
  it("loads every contest with choices, explicit grain and source versions", async () => {
    const result = await getPool().query<{
      election_type: string;
      n: string;
      hashes: string;
    }>(
      `SELECT election_type, count(*) AS n,
              count(DISTINCT source_sha256) AS hashes
         FROM election_contest
        GROUP BY election_type ORDER BY election_type`,
    );
    expect(result.rows).toEqual([
      { election_type: "parliamentary", n: "13", hashes: "13" },
      { election_type: "presidential", n: "10", hashes: "5" },
    ]);
    const incomplete = await getPool().query(
      `SELECT c.contest_id FROM election_contest c
       LEFT JOIN election_national_result r USING (contest_id)
       GROUP BY c.contest_id HAVING count(r.choice_key) = 0`,
    );
    expect(incomplete.rows).toEqual([]);
  });

  it("serves the exact parliamentary contest with reconciled semantics", async () => {
    const result = await getPool().query(
      `SELECT *, sum(votes) OVER () AS total_votes
         FROM election_national_results('parliamentary', '2026_04_19', NULL)`,
    );
    expect(result.rows).toHaveLength(25);
    expect(result.rows[0]).toMatchObject({
      election_id: "2026_04_19",
      contest_key: "2026_04_19",
      result_grain: "national",
      registered_voters: "6627747",
      actual_voters: "3360330",
      pct_denominator_votes: "3240156",
      percentage_basis: "party_votes_excluding_none_of_above",
      choice_key: "party:p_20",
      canonical_party_id: "p_20",
      choice_short: "ПрБ",
      votes: "1444920",
      seats: 131,
      total_votes: "3240156",
      source_path: "2026_04_19/national_summary.json",
    });
    expect(result.rows[0].source_sha256).toBe(
      createHash("sha256")
        .update(readFileSync(path.join(DATA_ROOT, result.rows[0].source_path)))
        .digest("hex"),
    );
  });

  it("selects one presidential contest and round without fallback", async () => {
    const result = await getPool().query(
      "SELECT * FROM election_national_results('presidential', '2021_11_14_pvr', 2)",
    );
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      election_id: "2021_11_14_pvr:r2",
      contest_key: "2021_11_14_pvr",
      round: 2,
      choice_key: "ticket:2021_11_14_pvr:6",
      president_name: "Румен Георгиев Радев",
      vice_president_name: "Илияна Малинова Йотова",
      votes: "1539650",
      pct_denominator_votes: "2307610",
      none_of_above_votes: "34169",
      percentage_basis: "valid_votes_including_none_of_above",
    });
    expect(
      (
        await getPool().query(
          "SELECT * FROM election_national_results('presidential', '2021_11_14_pvr', 3)",
        )
      ).rows,
    ).toEqual([]);
    expect(
      (
        await getPool().query(
          "SELECT * FROM election_national_results('presidential', '2011_10_23_pvr', 2)",
        )
      ).rows,
    ).toEqual([]);
  });

  it("returns the same party and ticket facts through chat and SQL", async () => {
    setFetcher(local);
    const [chatParliament, chatPresident, sqlParliament, sqlPresident] =
      await Promise.all([
        nationalResults({ election: "2026_04_19" }, ctx),
        presidentialResults({ cycle: "2021_11_14_pvr", round: 2 }, ctx),
        getPool().query(
          "SELECT * FROM election_national_results('parliamentary', '2026_04_19', NULL) LIMIT 12",
        ),
        getPool().query(
          "SELECT * FROM election_national_results('presidential', '2021_11_14_pvr', 2)",
        ),
      ]);
    expect(chatParliament.rows).toEqual(
      sqlParliament.rows.map((row) => ({
        party: row.choice_short,
        votes: Number(row.votes),
        pct: row.pct,
        seats: row.seats ?? 0,
      })),
    );
    expect(chatPresident.rows).toEqual(
      sqlPresident.rows.map((row) => ({
        pair: `${row.president_name} / ${row.vice_president_name}`,
        nominatedBy: expect.any(String),
        votes: Number(row.votes),
        pct: Number(row.pct.toFixed(2)),
      })),
    );
    expect(chatParliament.provenance).toContain(
      sqlParliament.rows[0].source_path,
    );
    expect(chatPresident.provenance).toContain(
      sqlPresident.rows[0].source_path,
    );
  });
});
