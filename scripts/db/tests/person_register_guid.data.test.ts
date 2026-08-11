// The Сметна палата person-GUID, expressed TWICE — as a JS regex
// (`personGuidFromSourceUrl`, scripts/officials/slug_identity.ts) and as a Postgres POSIX
// pattern (`PERSON_GUID_SQL_PATTERN`, same file) that `registerIdByRef()` in
// scripts/person/resolve_persons.ts binds. A SQL string cannot import a JS regex, so the
// rule exists in two dialects and this file is what stops them drifting.
//
// Drift here is silent in the worst way. The resolver's guard is
// `HAVING count(DISTINCT guid) = 1`, so a pattern that over-matches does NOT mis-merge —
// it mints no key at all, the ref falls back to the name tiers, and nothing is logged.
// That is exactly what the naive pattern (a bare guid matched anywhere in the URL) did:
// 70 refs skipped as "two register persons", 2 of them real. See the header of
// `PERSON_GUID_SQL_PATTERN` for the full account.
//
// Every query below runs over `REGISTER_GUID_SOURCE_SQL` — the resolver's own
// declaration ∪ alias input — rather than `declaration` alone. The two agree on today's
// corpus, but an alias contributing a guid its own declaration row does not would leave
// this gate asserting over a population the resolver never reads.
//
// Pure-JS coverage of the same constant (the shapes this corpus does not contain, and
// every environment that has no corpus at all) lives in
// scripts/officials/slug_identity.test.ts.
//
//   npm run test:data
import { describe, it, expect, afterAll } from "vitest";
import { allRows, end } from "../lib/pg";
import {
  LEGACY_ANY_GUID_SQL_PATTERN,
  PERSON_GUID_SQL_PATTERN,
  personGuidFromSourceUrl,
} from "../../officials/slug_identity";
import { REGISTER_GUID_SOURCE_SQL } from "../../person/resolve_persons";

type Row = { source_url: string; sql_guid: string | null };

// Top-level await, like the sibling data gates — so an unreachable Postgres produces a
// SKIP with a reason rather than a green tick. This file exists to stop a vacuous
// assertion; its own skip path must not be one.
const load = async (): Promise<Row[]> => {
  try {
    const present = await allRows<{ reg: string | null }>(
      `SELECT to_regclass('public.declaration')::text AS reg`,
    );
    if (!present[0]?.reg) return [];
    return await allRows<Row>(
      `SELECT source_url, upper(substring(source_url from $1)) AS sql_guid
         FROM (${REGISTER_GUID_SOURCE_SQL}) u`,
      [PERSON_GUID_SQL_PATTERN],
    );
  } catch {
    return [];
  }
};

const rows = await load();
// "Postgres down" and "corpus not loaded" are one skip but must not be one silence: an
// empty table would otherwise sail through every assertion below as a pass.
const skip =
  rows.length > 0 ? false : "Postgres unreachable / declarations not loaded";

afterAll(async () => {
  await end();
});

describe("register person-GUID: SQL and TS agree", () => {
  it.skipIf(skip)(
    "extracts the same id from every declaration source_url",
    () => {
      const disagree = rows
        .filter((r) => personGuidFromSourceUrl(r.source_url) !== r.sql_guid)
        .slice(0, 20);
      expect(
        disagree,
        `PERSON_GUID_SQL_PATTERN and personGuidFromSourceUrl disagree on ` +
          `${disagree.length}+ URL(s), e.g. ${disagree
            .map(
              (d) =>
                `${d.source_url} → sql=${d.sql_guid} ts=${personGuidFromSourceUrl(d.source_url)}`,
            )
            .slice(0, 3)
            .join("; ")}`,
      ).toEqual([]);
    },
  );

  // Non-vacuity. If every filing in the corpus carried a person id, the assertion above
  // would pass for a pattern that matches ANY guid — which is the bug it exists to catch.
  // The 2019-2023 bare-guid filings are what make it discriminate, so their presence is
  // itself an assertion rather than an incidental fact.
  it.skipIf(skip)(
    "still meets the bare per-document guids that make the rule non-trivial",
    () => {
      const bare = rows.filter(
        (r) => r.sql_guid === null && /[0-9a-f-]{36}/i.test(r.source_url),
      );
      expect(
        bare.length,
        "no bare per-document guids left in the corpus — the drift gate above is now " +
          "vacuous, since any guid pattern would satisfy it. This is a DATA event, not a " +
          "code defect: the register re-emitted the 2019-2023 folders with sequence " +
          "suffixes. Re-check whether PERSON_GUID_SQL_PATTERN still needs to require one.",
      ).toBeGreaterThan(0);
      // A guard, not a pin: ~141 of 47,983 rows today, and it only ever shrinks as those
      // folders are re-harvested. A large jump means the register changed its filenames and
      // the person id has stopped being recoverable, which must not be a silent condition.
      expect(
        bare.length,
        `${bare.length} of ${rows.length} filings carry no recoverable person id — the ` +
          `register's filename shape has changed and the gold key is degrading`,
      ).toBeLessThan(rows.length * 0.02);
    },
  );
});

describe("registerIdByRef: a document guid never costs a ref its gold key", () => {
  it.skipIf(skip)(
    "skips only refs carrying two genuine person ids",
    async () => {
      const [{ naive, person }] = await allRows<{
        naive: string;
        person: string;
      }>(
        `WITH x AS (
           SELECT subject_ref,
                  upper(substring(source_url from $2)) AS naive_guid,
                  upper(substring(source_url from $1)) AS person_guid
             FROM (${REGISTER_GUID_SOURCE_SQL}) u)
         SELECT (SELECT count(*) FROM (SELECT subject_ref FROM x
                   GROUP BY 1 HAVING count(DISTINCT naive_guid) > 1) a)::text AS naive,
                (SELECT count(*) FROM (SELECT subject_ref FROM x
                   GROUP BY 1 HAVING count(DISTINCT person_guid) > 1) b)::text AS person`,
        [PERSON_GUID_SQL_PATTERN, LEGACY_ANY_GUID_SQL_PATTERN],
      );
      // The two must not be equal, or the narrowing is doing nothing and this whole file
      // is testing a no-op. Measured 2026-08-11: naive 70, person 2.
      expect(
        Number(person),
        `the narrowed pattern skips as many refs as the legacy one (${person}) — it has ` +
          `stopped discriminating between a person id and a per-document guid`,
      ).toBeLessThan(Number(naive));
      // A genuine same-name collision is rare and hand-curated
      // (scripts/officials/_slug_collisions.json). If this climbs, the register has started
      // re-issuing person ids in bulk and the gold key needs re-thinking — it must not
      // creep back toward the legacy count unnoticed.
      expect(
        Number(person),
        `${person} refs carry two genuine person ids; each one is a gold key the resolver ` +
          `refuses to mint. Curate them in scripts/officials/_slug_collisions.json`,
      ).toBeLessThan(25);
    },
    60_000,
  );

  // The premise that makes "narrowing drops nothing" true. A document guid is unique per
  // document, hence per ref — EXCEPT through the alias UNION (migration 101), which
  // attaches one source_url to two subject_refs by design. A bare-guid filing reached that
  // way WOULD have unioned them, and narrowing the pattern drops that union. 0 today.
  it.skipIf(skip)(
    "no bare document guid is shared by two subject_refs",
    async () => {
      const shared = await allRows<{ source_url: string; refs: string }>(
        `SELECT source_url, string_agg(DISTINCT subject_ref, ' | ') AS refs
           FROM (${REGISTER_GUID_SOURCE_SQL}) u
          WHERE substring(source_url from $1) IS NULL
          GROUP BY source_url HAVING count(DISTINCT subject_ref) > 1
          LIMIT 5`,
        [PERSON_GUID_SQL_PATTERN],
      );
      expect(
        shared,
        `a bare-guid filing is shared by two subject_refs, so narrowing the pattern DOES ` +
          `drop a union the legacy one made — the migration-101 case. registerIdByRef ` +
          `needs a bare-guid fallback for these refs: ${JSON.stringify(shared)}`,
      ).toEqual([]);
    },
    60_000,
  );
});
