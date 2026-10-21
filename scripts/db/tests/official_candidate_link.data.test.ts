// The candidateLink decoration (108_official_candidate_link.sql + load_official_candidate_
// links_pg.ts) that municipal_officials_table LEFT JOINs so the PG municipal roster carries
// the party / ballot / MP-photo enrichment the by_obshtina JSON shards used to.
// Plan: docs/plans/persons-pg-retirement-v1.md (Tier 1.5).
//
// These pin the invariants the loader's synthetic MP-only fallback and the matview join rely
// on — a regression in either would quietly strip party colours / avatars off the My-Area
// council tiles, the exact symptom the JSON path already suffered once.
//
// Auto-skips when Postgres is down or unloaded — like the other *.data.test.ts gates.
//
//   npm run test:data

import fs from "node:fs";
import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";
import { reportSkip } from "../../lib/report_skip";
import {
  loadMiBundle,
  normalise,
  officialsToMi,
} from "../../officials/candidate_link_join";
import { editDistance } from "../../judiciary/judicialBodies";
import {
  normaliseMpName,
  PARLIAMENT_INDEX,
} from "../../parsers_local/mpNameMatch";

// Gated on the table EXISTING, not on rows (a silently-empty load must FAIL, not skip green).
const reachable = async (): Promise<boolean> => {
  try {
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.official_candidate_link') IS NOT NULL AS ok",
    );
    return Boolean(t?.ok);
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb ? false : "Postgres unreachable / table absent";
reportSkip(import.meta.url, skip);

afterAll(async () => {
  await end();
});

// An empty link table means the loader silently produced nothing — assert, never skip.
test.skipIf(skip)("the link table is populated", async () => {
  const [c] = await allRows<{ n: string }>(
    "SELECT count(*) n FROM official_candidate_link",
  );
  assert.ok(
    Number(c.n) > 5_000,
    `official_candidate_link has ${c.n} rows — the loader produced (almost) nothing`,
  );
});

// The synthetic MP-only fallback: a row with no slate party carries no ballot data (listPos
// 0) but MUST carry an mp_id — that is the only reason it exists. A party-less, mp-less row
// would be a link that decorates nothing.
test.skipIf(skip)(
  "party-less links are MP-only: empty party ⇒ list_pos 0 AND an mp_id",
  async () => {
    const [bad] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM official_candidate_link
        WHERE party_name = ''
          AND (list_pos <> 0 OR party_canonical_id IS NOT NULL OR mp_id IS NULL)`,
    );
    assert.equal(
      Number(bad.n),
      0,
      `${bad.n} party-less link(s) are not clean MP-only fallbacks`,
    );
  },
);

// Every photo comes from the parliament join, which also sets the id — a photo without an
// mp_id is impossible in resolveCandidateLink and would break the avatar's link target.
test.skipIf(skip)("every photo_url has an mp_id", async () => {
  const [bad] = await allRows<{ n: string }>(
    "SELECT count(*) n FROM official_candidate_link WHERE photo_url IS NOT NULL AND mp_id IS NULL",
  );
  assert.equal(Number(bad.n), 0, `${bad.n} photo(s) lack an mp_id`);
});

// The matview must surface the decoration: every link whose listing survives the roster's
// §6 gate shows a non-NULL candidate_cycle, and the decorated count is substantial. A join
// that silently dropped the columns is the failure this guards.
test.skipIf(skip)("the matview surfaces the links it joins", async () => {
  const [c] = await allRows<{ n: string }>(
    "SELECT count(*) n FROM municipal_officials_table WHERE candidate_cycle IS NOT NULL",
  );
  assert.ok(
    Number(c.n) > 5_000,
    `only ${c.n} roster listings carry a candidateLink — the LEFT JOIN may be broken`,
  );
  // No link ever attaches to a role the loader does not decorate (chief_architect / other).
  const [leak] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM municipal_officials_table
        WHERE candidate_cycle IS NOT NULL
          AND role NOT IN ('mayor','deputy_mayor','council_chair','councillor')`,
  );
  assert.equal(
    Number(leak.n),
    0,
    `${leak.n} candidateLink(s) attached to a non-decorated role`,
  );
});

// official_slug is the PK, so it is unique by construction — assert it survives a reload
// (a duplicate would mean the LEFT JOIN fans out the roster and double-counts councillors).
test.skipIf(skip)("official_slug is unique (no roster fan-out)", async () => {
  const [dupe] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM (
       SELECT official_slug FROM official_candidate_link
        GROUP BY official_slug HAVING count(*) > 1) x`,
  );
  assert.equal(Number(dupe.n), 0, `${dupe.n} duplicate official_slug(s)`);
});

// docs/plans/local-mp-photo-links-v1.md Part B. Each link joined back to the roster name it
// was resolved from — the same membership the loader reads.
type NamedLink = {
  official_slug: string;
  name: string;
  obshtina: string;
  party_name: string;
  list_pos: number;
  mp_id: number | null;
};
const namedLinks = (): Promise<NamedLink[]> =>
  allRows<NamedLink>(
    `SELECT DISTINCT ON (l.official_slug)
            l.official_slug, p.display_name AS name, r.place_code AS obshtina,
            l.party_name, l.list_pos, l.mp_id
       FROM official_candidate_link l
       JOIN person_role r ON r.ref = l.official_slug AND r.source = 'official_muni'
       JOIN person p ON p.person_id = r.person_id
      ORDER BY l.official_slug`,
  );

// The MP photo is exact-full-name only: a first+last match against the national MP index
// is a namesake far more often than the same person.
const mpSkip =
  skip ||
  (fs.existsSync(PARLIAMENT_INDEX)
    ? false
    : "data/parliament/index.json absent");
test.skipIf(mpSkip)(
  "every mp_id names an MP with an identical full name",
  async () => {
    const mps = (
      JSON.parse(fs.readFileSync(PARLIAMENT_INDEX, "utf8")) as {
        mps: Array<{ id: number; normalizedName?: string }>;
      }
    ).mps;
    const nameById = new Map(
      mps.map((m) => [m.id, normaliseMpName(m.normalizedName ?? "")]),
    );
    const linked = (await namedLinks()).filter((l) => l.mp_id !== null);
    assert.ok(
      linked.length > 0,
      "no link carries an mp_id — the MP join produced nothing",
    );
    const bad = linked.filter(
      (l) => nameById.get(l.mp_id as number) !== normaliseMpName(l.name),
    );
    assert.deepEqual(
      bad.slice(0, 10).map((l) => `${l.name} → MP #${l.mp_id}`),
      [],
      `${bad.length} mp_id(s) name a different person`,
    );
  },
);

// A slate row reached through the first+last fallback must agree on the patronymic (or one
// side has none): a different patronymic is a different father, i.e. a different person.
// Restated here rather than imported from the module, so a regression in the loader's own
// helper cannot pass by judging its output with itself.
const patronymic = (name: string): string => {
  const parts = name.split(/\s+/).filter(Boolean);
  return parts.length >= 3 ? normalise(parts[1]) : "";
};
const patronymicsClose = (a: string, b: string): boolean => {
  const pa = patronymic(a);
  const pb = patronymic(b);
  return !pa || !pb || editDistance(pa, pb, 2) <= 2;
};
const slateSkip =
  skip ||
  (loadMiBundle("SOF") ? false : "data/2023_10_29_mi/municipalities absent");
test.skipIf(slateSkip)(
  "every first+last slate match agrees on the patronymic",
  async () => {
    const slateName = new Map<string, Map<string, string>>();
    const nameAt = (obshtina: string, party: string, pos: number) => {
      const mi = officialsToMi(obshtina);
      if (!slateName.has(mi)) {
        const m = new Map<string, string>();
        for (const slate of Object.values(loadMiBundle(mi)?.council ?? {}))
          for (const c of slate.candidates)
            m.set(`${slate.localPartyName}\u0000${c.listPos}`, c.name);
        slateName.set(mi, m);
      }
      return slateName.get(mi)?.get(`${party}\u0000${pos}`);
    };
    const slated = (await namedLinks()).filter((l) => l.party_name !== "");
    let fallback = 0;
    const bad: string[] = [];
    for (const l of slated) {
      const cand = nameAt(l.obshtina, l.party_name, l.list_pos);
      if (cand === undefined || normalise(cand) === normalise(l.name)) continue;
      fallback++;
      if (!patronymicsClose(l.name, cand)) bad.push(`${l.name} → ${cand}`);
    }
    // Non-vacuity: the fallback still fires (19 measured 2026-10-21: 15 roster typos + 4
    // rows where one side has no patronymic).
    assert.ok(
      fallback > 0,
      "no first+last slate match found — the arm checks nothing",
    );
    assert.deepEqual(
      bad.slice(0, 10),
      [],
      `${bad.length} slate link(s) matched a different patronymic`,
    );
  },
);
