// party_pair_break (183) — the /votes/between/:pair drill-down.
//
// Plan: docs/plans/json-retirement-v2.md Tier 3c.
//
// The failure this file exists to catch is a page that renders EMPTY rather than one that
// renders wrong: the pair key is a folded label the client reconstructs from a different
// artifact, so a spelling disagreement is a lookup that finds nothing.

import { afterAll, describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, end, dbReachable } from "../lib/pg";

const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const ARTIFACT = path.join(
  REPO,
  "data/parliament/votes/derived/party_pair_breaks.json",
);

const haveDb = await dbReachable();
const populated =
  haveDb &&
  Number(
    (
      await allRows<{ n: string }>(
        `SELECT count(*)::text AS n FROM party_pair_break`,
      ).catch(() => [{ n: "0" }])
    )[0].n,
  ) > 0;
const skip = !haveDb
  ? "Postgres unreachable"
  : !populated
    ? "party_pair_break is absent or WITH NO DATA — run db:load:rollcall-derived:pg"
    : false;

afterAll(async () => {
  if (haveDb) await end();
});

describe("party_pair_break", () => {
  test.skipIf(skip)("is capped at 20 per pair and ranked densely", async () => {
    const bad = await allRows<{ ns: number; party_a: string; party_b: string }>(
      `SELECT ns, party_a, party_b FROM party_pair_break
        GROUP BY ns, party_a, party_b
       HAVING max(rn) > 20 OR max(rn) <> count(*) OR min(rn) <> 1`,
    );
    expect(bad, "a pair is over-capped or its ranks have holes").toEqual([]);
  });

  // THE ORDERING. partyA must sort before partyB, or half the drill-down links are dead —
  // the client normalises the same way and would look up a key that is not stored.
  test.skipIf(skip)(
    "stores each unordered pair once, partyA first",
    async () => {
      const bad = await allRows<{
        ns: number;
        party_a: string;
        party_b: string;
      }>(
        `SELECT ns, party_a, party_b FROM party_pair_break WHERE party_a >= party_b LIMIT 5`,
      );
      expect(bad, "a row stores the pair in the wrong order").toEqual([]);
      const both = await allRows<{ ns: number; a: string; b: string }>(
        `SELECT DISTINCT x.ns, x.party_a AS a, x.party_b AS b
         FROM party_pair_break x
         JOIN party_pair_break y
           ON y.ns = x.ns AND y.party_a = x.party_b AND y.party_b = x.party_a`,
      );
      expect(both, "a pair is stored in both orders").toEqual([]);
    },
  );

  // ⚠️ COMPARED AGAINST party_correlation.json, NOT against party_cohesion_summary. The
  // client builds `/votes/between/:pair` from THAT artifact's row labels, so it is the only
  // side worth agreeing with — and 181 shares a character-identical fold with 183, so
  // checking them against each other can never catch the divergence that empties the page.
  test.skipIf(skip)(
    "labels agree with the artifact the URL is built from",
    async () => {
      const corr = path.join(
        REPO,
        "data/parliament/votes/derived/party_correlation.json",
      );
      if (!existsSync(corr)) {
        console.warn(
          "party_pair_break: party_correlation.json absent — label arm skipped",
        );
        return;
      }
      const file = JSON.parse(readFileSync(corr, "utf8")) as {
        byNs: Record<string, { parties: string[] }>;
      };
      const rows = await allRows<{ ns: number; label: string }>(
        `SELECT DISTINCT b.ns, l.label
         FROM party_pair_break b
         CROSS JOIN LATERAL (VALUES (b.party_a), (b.party_b)) AS l(label)`,
      );
      expect(rows.length, "no labels to check").toBeGreaterThan(20);
      const orphans = rows.filter(
        (r) => !(file.byNs[String(r.ns)]?.parties ?? []).includes(r.label),
      );
      expect(
        orphans.map((o) => `${o.ns}/${o.label}`),
        "a pair label is spelled differently from party_correlation's — the drill-down URL " +
          "built from that artifact will find nothing",
      ).toEqual([]);
    },
  );

  test.skipIf(skip)("every stored row is a genuine disagreement", async () => {
    const bad = await allRows<{ ns: number; item_no: number }>(
      `SELECT ns, item_no FROM party_pair_break
        WHERE vote_a = vote_b
           OR vote_a NOT IN ('y', 'n', 'a')
           OR vote_b NOT IN ('y', 'n', 'a')
           OR contest_score NOT BETWEEN 0 AND 0.5
        LIMIT 5`,
    );
    expect(bad, "a row is not an opposite-vote pair").toEqual([]);
  });

  // PARITY, while the artifact is still on disk.
  test.skipIf(skip)(
    "carries the same pairs and items as the artifact",
    async () => {
      if (!existsSync(ARTIFACT)) {
        console.warn("party_pair_break: artifact absent — parity arm skipped");
        return;
      }
      const file = JSON.parse(readFileSync(ARTIFACT, "utf8")) as {
        byNs: Record<
          string,
          { pairs: Record<string, Array<{ date: string; item: number }>> }
        >;
      };
      const rows = await allRows<{
        ns: number;
        key: string;
        date: string;
        item_no: number;
      }>(
        `SELECT ns, party_a || '__' || party_b AS key, date::text AS date, item_no
         FROM party_pair_break`,
      );
      const pgSets = new Map<string, Set<string>>();
      for (const r of rows) {
        const k = `${r.ns}/${r.key}`;
        if (!pgSets.has(k)) pgSets.set(k, new Set());
        pgSets.get(k)!.add(`${r.date}#${r.item_no}`);
      }

      const missingKeys: string[] = [];
      let pairs = 0;
      let sameSet = 0;
      for (const [ns, slice] of Object.entries(file.byNs))
        for (const [key, items] of Object.entries(slice.pairs)) {
          pairs++;
          const got = pgSets.get(`${ns}/${key}`);
          if (!got) {
            missingKeys.push(`${ns}/${key}`);
            continue;
          }
          const want = new Set(items.map((i) => `${i.date}#${i.item}`));
          if (want.size === got.size && [...want].every((x) => got.has(x)))
            sameSet++;
        }
      // A pair key the artifact has and this does not is a DEAD LINK, which is categorically
      // worse than a reordering — the drill-down renders "no breaks between these groups".
      expect(
        missingKeys,
        "pair keys the artifact has and the matview does not",
      ).toEqual([]);
      expect(pairs, "compared nothing").toBeGreaterThan(200);
      // ⚠️ NOT an equality. Measured 2026-08-22: 224 of 240 pairs carry the identical item set,
      // and 4,070 of 4,508 rows sit at the identical rank. The residue is a contest-score TIE
      // — the artifact rounds to 3 decimals then sorts by score and date with no further
      // tiebreak, so which of two equally-contested items on one day came first fell out of
      // ingest order. 183 rounds identically and breaks the rest on item_no, deterministically.
      expect(
        sameSet / pairs,
        `only ${sameSet}/${pairs} pairs carry the artifact's item set — more than the tie class`,
      ).toBeGreaterThan(0.85);
    },
  );
});
