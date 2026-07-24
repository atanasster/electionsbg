// Comprehensive gate for the person-based header search and the /candidate URL → person
// resolution (082 person_search, 085 candidate_person_slug / candidate_person_by_name).
// These power the SINGLE "People" search surface (the CIK-JSON candidate index is retired —
// candidates are persons now) and the shared PersonDashboard behind both /person/:slug and
// /candidate/:id. Every case self-selects its fixture from the live corpus, so nothing here
// hardcodes a name that could later leave the data.
//
//   npm run test:data
//
// Requires the Postgres store + `db:resolve:persons` + `db:load:person-elections:pg`;
// auto-skips when Postgres or the person layer is absent — like the other *.data.test.ts gates.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";

type Hit = {
  slug: string;
  name: string;
  namesakeRisk: number;
  roles: number;
  party: string | null;
  partyColor: string | null;
  mpId: number | null;
  score: number;
};

// person_search returns one jsonb array; the pg lib parses it to a JS array.
const search = (q: string, limit = 6): Promise<Hit[]> =>
  allRows<{ r: Hit[] | null }>("SELECT person_search($1, $2) AS r", [
    q,
    limit,
  ]).then((x) => x[0]?.r ?? []);

const reachable = async (): Promise<boolean> => {
  try {
    await allRows("SELECT 1");
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regprocedure('person_search(text,int)') IS NOT NULL AS ok",
    );
    if (!t?.ok) return false;
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM person WHERE status = 'active' AND is_public_figure",
    );
    return Number(c.n) > 0;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb ? false : "Postgres unreachable / person layer empty";

afterAll(async () => {
  await end();
});

// ── Length gate ──────────────────────────────────────────────────────────────
// A trigram is 3 chars, so a 1-2 char query can't use the GIN index and would seq-scan
// every person. person_search gates at length >= 3 and returns [] below that (the client
// mirrors the gate). A 3-char prefix of a real name must still return something.
test.skipIf(skip)("person_search returns nothing below 3 chars", async () => {
  assert.equal((await search("и")).length, 0, "1-char query must be empty");
  assert.equal((await search("ив")).length, 0, "2-char query must be empty");
  const [pick] = await allRows<{ prefix: string }>(
    `SELECT left(display_name, 3) AS prefix FROM person
      WHERE status='active' AND is_public_figure AND length(display_name) >= 3
      ORDER BY (SELECT count(*) FROM person_role r WHERE r.person_id = person.person_id) DESC
      LIMIT 1`,
  );
  if (!pick) return;
  assert.ok(
    (await search(pick.prefix)).length > 0,
    `3-char prefix "${pick.prefix}" must return at least one person`,
  );
});

// ── Ranking: exact name #1, name prefix recalled ────────────────────────────
// Full-string similarity() alone sank a longer real surname below a shorter namesake that
// shared the leading tokens ("Мария Димитрова Бал" cut "…Балъкчиева" past the limit). The
// similarity()+word_similarity() sum fixes recall while keeping an exact name #1.
test.skipIf(skip)(
  "person_search ranks an exact name #1 and recalls a name prefix",
  async () => {
    const [row] = await allRows<{
      slug: string;
      name: string;
      prefix: string;
    }>(
      `WITH pick AS (
         SELECT p.slug, p.display_name AS name,
                split_part(p.display_name,' ',1)||' '||split_part(p.display_name,' ',2)
                  ||' '||left(split_part(p.display_name,' ',3),4) AS prefix
         FROM person p
         WHERE p.status='active' AND p.is_public_figure
           AND array_length(string_to_array(p.name_fold,' '),1) = 3
           AND length(split_part(p.name_fold,' ',3)) >= 6
           AND (SELECT count(*) FROM person p2
                 WHERE p2.status='active' AND p2.is_public_figure
                   AND p2.name_fold = p.name_fold) = 1
         ORDER BY (SELECT count(*) FROM person_role r WHERE r.person_id=p.person_id) DESC, p.slug
         LIMIT 1)
       SELECT slug, name, prefix FROM pick`,
    );
    if (!row) return;
    const exact = await search(row.name, 6);
    assert.equal(exact[0]?.slug, row.slug, `exact name not #1: ${row.name}`);
    const prefixed = await search(row.prefix, 8);
    assert.ok(
      prefixed.some((h) => h.slug === row.slug),
      `prefix "${row.prefix}" did not recall ${row.name} in the top 8`,
    );
  },
);

// A First+Last query that SKIPS the middle name ("Божидар Божанов" → "Божидар ПЛАМЕНОВ
// Божанов") must still recall the person — word_similarity alone demoted them below an
// unrelated adjacent-token match; the similarity() term rescues it.
//
// The probe deliberately skips names whose first+last pair is ALSO a common
// given+patronymic prefix. For "Татяна Георгиева" the corpus holds eight people
// literally named "Татяна Георгиева <X>", who match both query tokens exactly and
// SHOULD outrank a first+last match — that is correct ranking, not the defect
// this guards. Without the exclusion the probe silently becomes a density test
// and starts failing whenever the corpus grows.
test.skipIf(skip)(
  "person_search recalls a First+Last query that skips the middle name",
  async () => {
    const [row] = await allRows<{ slug: string; fl: string; name: string }>(
      `WITH pick AS (
         SELECT p.slug, p.display_name AS name,
                split_part(p.display_name,' ',1)||' '||split_part(p.display_name,' ',3) AS fl
         FROM person p
         WHERE p.status='active' AND p.is_public_figure
           AND array_length(string_to_array(p.name_fold,' '),1) = 3
           AND (SELECT count(*) FROM person p2
                 WHERE p2.status='active' AND p2.is_public_figure
                   AND p2.name_fold = p.name_fold) = 1
           -- Skip a fixture whose first+last pair is ALSO a crowded
           -- given+patronymic prefix: those peers match BOTH query tokens
           -- exactly and rightly outrank a first+last match, so the top-8
           -- window cannot hold the fixture no matter how good the ranking is.
           -- Counted over public figures only — anyone else can never appear in
           -- results and so cannot crowd the window.
           AND (SELECT count(*) FROM person p3
                 WHERE p3.status='active' AND p3.is_public_figure
                   AND p3.given_fold = p.given_fold
                   AND p3.patronymic_fold = p.family_fold) < 8
         ORDER BY (SELECT count(*) FROM person_role r WHERE r.person_id=p.person_id) DESC, p.slug
         LIMIT 1)
       SELECT slug, fl, name FROM pick`,
    );
    if (!row) return;
    const hits = await search(row.fl, 8);
    assert.ok(
      hits.some((h) => h.slug === row.slug),
      `First+Last "${row.fl}" did not recall ${row.name} in the top 8`,
    );
  },
);

// Results are score-descending, capped at the limit, and deterministic (same query → same
// order) — the dropdown's ordering contract.
test.skipIf(skip)(
  "person_search is score-ordered, limit-capped and deterministic",
  async () => {
    const [pick] = await allRows<{ fold: string }>(
      `SELECT family_fold AS fold FROM person
        WHERE status='active' AND is_public_figure
        GROUP BY family_fold ORDER BY count(*) DESC LIMIT 1`,
    );
    if (!pick) return;
    const a = await search(pick.fold, 5);
    assert.ok(a.length <= 5, "must not exceed the requested limit");
    assert.ok(a.length > 0, "a common surname must return people");
    for (let i = 1; i < a.length; i++) {
      assert.ok(a[i - 1].score >= a[i].score, "hits must be score-descending");
    }
    const b = await search(pick.fold, 5);
    assert.deepEqual(
      a.map((h) => h.slug),
      b.map((h) => h.slug),
      "same query must return the same order",
    );
  },
);

// ── Party badge (asks: a politician must carry their party) ──────────────────
// person_search returns the person's MOST-RECENT candidacy party (nick + colour baked into
// person_election_stats), so a politician who ran in ANY cycle shows a badge.
test.skipIf(skip)(
  "person_search carries the most-recent candidacy party + colour",
  async () => {
    const [row] = await allRows<{
      slug: string;
      name: string;
      want_party: string;
    }>(
      `WITH pick AS (
         SELECT p.slug, p.display_name AS name,
           (SELECT pes.party_nick FROM person_election_stats pes
             WHERE pes.person_id = p.person_id AND pes.party_nick IS NOT NULL
             ORDER BY pes.election_date DESC LIMIT 1) AS want_party
         FROM person p
         WHERE p.status='active' AND p.is_public_figure
           AND (SELECT count(*) FROM person p2
                 WHERE p2.status='active' AND p2.is_public_figure
                   AND p2.name_fold = p.name_fold) = 1
           AND EXISTS (SELECT 1 FROM person_election_stats e
                        WHERE e.person_id = p.person_id AND e.party_nick IS NOT NULL)
         ORDER BY (SELECT count(*) FROM person_role r WHERE r.person_id=p.person_id) DESC, p.slug
         LIMIT 1)
       SELECT slug, name, want_party FROM pick`,
    );
    if (!row) return;
    const hit = (await search(row.name, 6)).find((h) => h.slug === row.slug);
    assert.ok(hit, `expected ${row.name} in its own name search`);
    assert.equal(hit!.party, row.want_party, "party badge mismatch");
    assert.ok(hit!.partyColor, "a party badge must carry a colour");
  },
);

// ── mpId (drives the avatar photo) ───────────────────────────────────────────
test.skipIf(skip)(
  "person_search exposes the mp id for an MP and null for a non-MP",
  async () => {
    const [mp] = await allRows<{ slug: string; name: string; ref: number }>(
      `SELECT p.slug, p.display_name AS name, r.ref::bigint AS ref
         FROM person p JOIN person_role r USING (person_id)
        WHERE p.status='active' AND p.is_public_figure
          AND r.source='mp' AND r.ref ~ '^[0-9]+$'
          AND (SELECT count(*) FROM person p2
                WHERE p2.status='active' AND p2.is_public_figure
                  AND p2.name_fold = p.name_fold) = 1
        ORDER BY p.slug LIMIT 1`,
    );
    if (mp) {
      const hit = (await search(mp.name, 6)).find((h) => h.slug === mp.slug);
      assert.ok(hit, `expected ${mp.name} in search`);
      assert.equal(Number(hit!.mpId), Number(mp.ref), "mpId mismatch");
    }
    // A candidate who never sat as an MP must carry a null mpId (no avatar photo).
    const [nonMp] = await allRows<{ slug: string; name: string }>(
      `SELECT p.slug, p.display_name AS name
         FROM person p
        WHERE p.status='active' AND p.is_public_figure
          AND NOT EXISTS (SELECT 1 FROM person_role r
                           WHERE r.person_id=p.person_id AND r.source='mp')
          AND EXISTS (SELECT 1 FROM person_election_stats e WHERE e.person_id=p.person_id)
          AND (SELECT count(*) FROM person p2
                WHERE p2.status='active' AND p2.is_public_figure
                  AND p2.name_fold = p.name_fold) = 1
        ORDER BY p.slug LIMIT 1`,
    );
    if (nonMp) {
      const hit = (await search(nonMp.name, 6)).find(
        (h) => h.slug === nonMp.slug,
      );
      assert.ok(hit, `expected ${nonMp.name} in search`);
      assert.equal(hit!.mpId, null, "a non-MP must have a null mpId");
    }
  },
);

// ── /candidate URL resolution (085) ──────────────────────────────────────────
// candidate_person_slug maps a candidate slug (mp-N | c-…) to its owning person; an unknown
// slug returns null so CandidateScreen falls through to the legacy render.
test.skipIf(skip)(
  "candidate_person_slug resolves a known slug and nulls an unknown one",
  async () => {
    const [pick] = await allRows<{ candidate_slug: string; want: string }>(
      `SELECT candidate_slug, person_slug AS want FROM candidate_person LIMIT 1`,
    );
    if (!pick) return;
    const [{ got }] = await allRows<{ got: string | null }>(
      "SELECT candidate_person_slug($1) AS got",
      [pick.candidate_slug],
    );
    assert.equal(got, pick.want, "known candidate slug must resolve");
    const [{ unknown }] = await allRows<{ unknown: string | null }>(
      "SELECT candidate_person_slug('mp-999999999') AS unknown",
    );
    assert.equal(unknown, null, "unknown slug must return null");
  },
);

// candidate_person_by_name resolves a bare-name /candidate URL ONLY when the fold maps to one
// person (no namesake ambiguity); a >1-person fold returns null so the UI shows the chooser
// instead of guessing.
test.skipIf(skip)(
  "candidate_person_by_name resolves a unique name and nulls an ambiguous one",
  async () => {
    const [uniq] = await allRows<{ name: string; want: string }>(
      `WITH u AS (
         SELECT candidate_name_fold, min(person_id) AS pid, min(person_slug) AS want
         FROM candidate_person GROUP BY candidate_name_fold
         HAVING count(DISTINCT person_id) = 1 LIMIT 1)
       SELECT (SELECT display_name FROM person WHERE person_id = u.pid) AS name, want FROM u`,
    );
    if (uniq) {
      const [{ got }] = await allRows<{ got: string | null }>(
        "SELECT candidate_person_by_name($1, NULL) AS got",
        [uniq.name],
      );
      assert.equal(got, uniq.want, "a unique name must resolve to its person");
    }
    const [amb] = await allRows<{ name: string }>(
      `WITH a AS (
         SELECT candidate_name_fold, min(person_id) AS pid
         FROM candidate_person GROUP BY candidate_name_fold
         HAVING count(DISTINCT person_id) > 1 LIMIT 1)
       SELECT (SELECT display_name FROM person WHERE person_id = a.pid) AS name FROM a`,
    );
    if (amb) {
      const [{ got }] = await allRows<{ got: string | null }>(
        "SELECT candidate_person_by_name($1, NULL) AS got",
        [amb.name],
      );
      assert.equal(got, null, "an ambiguous name must fall through (null)");
    }
  },
);
