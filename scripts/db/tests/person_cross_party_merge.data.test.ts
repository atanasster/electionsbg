// Target regression for the audited Велислава Иванова Петрова ref merges. The generic
// override tests prove the mechanism; this gate proves the committed refs still produce the
// intended public identity, electoral history, review-queue removal and URL continuity.

import assert from "node:assert/strict";
import { afterAll, test } from "vitest";
import { reportSkip } from "../../lib/report_skip";
import { allRows, end } from "../lib/pg";

const REFS = [
  ["2021_11_14", "c-24-velislava-ivanova-petrova"],
  ["2022_10_02", "c-9-velislava-ivanova-petrova"],
  ["2023_04_02", "c-12-velislava-ivanova-petrova"],
] as const;

const HISTORICAL_SLUGS = [
  "velislava-petrova-1flnl9",
  "velislava-petrova-1sr78o",
  "velislava-petrova-c65qon",
];

let skip: string | false = false;
try {
  const [row] = await allRows<{ ok: boolean }>(
    `SELECT bool_and(to_regclass(rel) IS NOT NULL) AS ok
         FROM unnest(ARRAY[
           'public.candidate_person', 'public.person_election_stats',
           'public.person_slug_retired', 'public.person', 'public.person_role',
           'public.person_review_candidate', 'public.person_browse_table'
         ]) rel`,
  );
  if (!row?.ok) skip = "person electoral tables absent";
} catch {
  skip = "Postgres unreachable";
}
reportSkip(import.meta.url, skip);

afterAll(async () => {
  await end();
});

type Mapping = {
  election_date: string;
  candidate_slug: string;
  person_id: string;
  person_slug: string;
};

const mappings = async (): Promise<Mapping[]> =>
  allRows<Mapping>(
    `SELECT election_date::text, candidate_slug, person_id::text, person_slug
       FROM candidate_person
      WHERE (election_date::text, candidate_slug) IN (
        ('2021_11_14', 'c-24-velislava-ivanova-petrova'),
        ('2022_10_02', 'c-9-velislava-ivanova-petrova'),
        ('2023_04_02', 'c-12-velislava-ivanova-petrova'))
      ORDER BY election_date`,
  );

test.skipIf(skip)(
  "the three exact candidacies resolve to one live person",
  async () => {
    const rows = await mappings();
    assert.deepEqual(
      rows.map((row) => [row.election_date, row.candidate_slug]),
      REFS,
    );
    assert.equal(new Set(rows.map((row) => row.person_id)).size, 1);
    assert.equal(new Set(rows.map((row) => row.person_slug)).size, 1);
    assert.ok(
      HISTORICAL_SLUGS.includes(rows[0].person_slug),
      "the live slug is not one of the three historical profile slugs",
    );
    const [live] = await allRows<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM person
        WHERE slug = $1 AND status = 'active'`,
      [rows[0].person_slug],
    );
    assert.equal(
      Number(live.n),
      1,
      "the merged target is not one active person",
    );
  },
);

test.skipIf(skip)(
  "the exact candidate roles retain their party, place and manual confidence",
  async () => {
    const rows = await allRows<{
      ref: string;
      party: string;
      place_kind: string;
      place_code: string;
      confidence: string;
    }>(
      `SELECT ref, party, place_kind, place_code, confidence
         FROM person_role
        WHERE source = 'candidate'
          AND ref IN (
            '2021_11_14:c-24-velislava-ivanova-petrova',
            '2022_10_02:c-9-velislava-ivanova-petrova',
            '2023_04_02:c-12-velislava-ivanova-petrova')
        ORDER BY ref`,
    );
    assert.deepEqual(rows, [
      {
        ref: "2021_11_14:c-24-velislava-ivanova-petrova",
        party: "p_0",
        place_kind: "mir",
        place_code: "S24",
        confidence: "manual",
      },
      {
        ref: "2022_10_02:c-9-velislava-ivanova-petrova",
        party: "p_67",
        place_kind: "mir",
        place_code: "S25",
        confidence: "manual",
      },
      {
        ref: "2023_04_02:c-12-velislava-ivanova-petrova",
        party: "p_6",
        place_kind: "mir",
        place_code: "S25",
        confidence: "manual",
      },
    ]);
  },
);

test.skipIf(skip)(
  "the merged electoral history keeps all three parties and totals",
  async () => {
    const [mapping] = await mappings();
    assert.ok(mapping, "target candidacy mappings are absent");
    const rows = await allRows<{
      election_date: string;
      party_num: number;
      party_nick: string;
      total_votes: number;
    }>(
      `SELECT election_date::text, party_num, party_nick, total_votes
       FROM person_election_stats
      WHERE person_id = $1
        AND election_date IN ('2021_11_14', '2022_10_02', '2023_04_02')
      ORDER BY election_date`,
      [mapping.person_id],
    );
    assert.deepEqual(rows, [
      {
        election_date: "2021_11_14",
        party_num: 24,
        party_nick: "ИТН",
        total_votes: 48,
      },
      {
        election_date: "2022_10_02",
        party_num: 9,
        party_nick: "ПП",
        total_votes: 120,
      },
      {
        election_date: "2023_04_02",
        party_num: 12,
        party_nick: "ПП-ДБ",
        total_votes: 104,
      },
    ]);
  },
);

test.skipIf(skip)("the namesake review group is resolved", async () => {
  const [mapping] = await mappings();
  assert.ok(mapping, "target candidacy mappings are absent");
  const [row] = await allRows<{ n: string }>(
    `SELECT count(*)::text AS n
       FROM person_review_candidate
      WHERE person_id = $1
        AND reason = 'identical_fullname'`,
    [mapping.person_id],
  );
  assert.equal(Number(row.n), 0);
});

test.skipIf(skip)(
  "the persons browser exposes all three canonical parties",
  async () => {
    const [mapping] = await mappings();
    assert.ok(mapping, "target candidacy mappings are absent");
    const [row] = await allRows<{
      party_primary: string;
      parties_n: number;
      party_codes: string;
    }>(
      `SELECT party_primary, parties_n, party_codes
         FROM person_browse_table
        WHERE slug = $1`,
      [mapping.person_slug],
    );
    assert.ok(row, "merged person is absent from person_browse_table");
    assert.equal(row.party_primary, "p_6", "latest affiliation must be ПП-ДБ");
    assert.equal(row.parties_n, 3);
    assert.deepEqual(btrimCodes(row.party_codes), ["p_0", "p_6", "p_67"]);
  },
);

test.skipIf(skip)(
  "both retired profile slugs redirect to the one live target",
  async () => {
    const [mapping] = await mappings();
    assert.ok(mapping, "target candidacy mappings are absent");
    const retired = HISTORICAL_SLUGS.filter(
      (slug) => slug !== mapping.person_slug,
    );
    assert.equal(retired.length, 2);
    const rows = await allRows<{ slug: string; target_slug: string }>(
      `SELECT slug, target_slug
       FROM person_slug_retired
      WHERE slug = ANY($1::text[])
      ORDER BY slug`,
      [retired],
    );
    assert.deepEqual(
      rows.map((row) => row.slug),
      retired.slice().sort(),
    );
    assert.ok(rows.every((row) => row.target_slug === mapping.person_slug));
    assert.ok(rows.every((row) => row.slug !== row.target_slug));
    const [liveRetired] = await allRows<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM person_slug_retired
        WHERE slug = $1`,
      [mapping.person_slug],
    );
    assert.equal(Number(liveRetired.n), 0, "the live slug is also retired");
  },
);

const btrimCodes = (value: string): string[] =>
  value.trim().split(/\s+/).sort();
