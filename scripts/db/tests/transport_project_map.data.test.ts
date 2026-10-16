// Gate for the /sector/transport project map (migration 076, loader
// load_transport_project_map_pg.ts, rules lib/transport_project_links.ts).
// docs/plans/transport-hub-v1.md A1, A5–A7, C3.
//
// What it holds, each a defect that shipped:
//   • €0 consortium-member rows are never counted (Видин – София read 11 contracts
//     where there were 2 — A1);
//   • no segment comes from a non-rail awarder (БУЛАТСА demolitions and МТС heating
//     gas were drawn as rail sections — A6);
//   • a contract carries at most one link, so placed € cannot double-count (C3);
//   • coverage is returned and agrees with an independent recount from contracts;
//   • the section-end REFUSAL mechanism is real (audit 2026-10-17, T4/C4): on the
//     committed register a name collision is settled by distance or refused —
//     asserted, not just logged — and the stored links obey it;
//   • a named section never falls back to a point, and non-work-site titles
//     (utilities, operating services, rolling-stock repair) stay unplaced (T4b, T5).
//
// Auto-skips only when Postgres is down; an EMPTY link table is a failure — the
// loader is unconditional in db:refresh and reads only committed inputs.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";
import {
  TRANSPORT_SECTOR_EIKS,
  TRANSPORT_ENTITIES,
} from "../../../src/lib/transportReferenceData";
import { reportSkip } from "../../lib/report_skip";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  namesAWorkSite,
  pickSectionEnds,
  placeCandidatesIndex,
  sectionPair,
} from "../lib/transport_project_links";

const haveDb = await dbReachable();
const skip = !haveDb ? "Postgres unreachable" : false;
reportSkip(import.meta.url, skip);

afterAll(async () => {
  await end();
});

const RAIL = TRANSPORT_ENTITIES.filter((e) => e.universe === "rail").map(
  (e) => e.eik,
);

interface Payload {
  segments: { aTown: string; bTown: string; contractCount: number }[];
  points: { town: string; facility: string; contractCount: number }[];
  coverage: {
    placedContracts: number;
    placedEur: number;
    totalContracts: number;
    totalEur: number;
  };
}

const mapFor = async (from: string | null): Promise<Payload> =>
  (
    await allRows<{ r: Payload }>(
      "SELECT transport_project_map($1, $2, NULL) AS r",
      [TRANSPORT_SECTOR_EIKS, from],
    )
  )[0].r;

test.skipIf(skip)("the link table is populated", async () => {
  const [{ n }] = await allRows<{ n: number }>(
    "SELECT count(*)::int AS n FROM transport_project_link",
  ).catch(() => [{ n: 0 }]);
  assert.ok(n > 0, "transport_project_link is empty — run db:load:transport-project-map:pg"); // prettier-ignore
});

test.skipIf(skip)(
  "no segment is minted for a non-rail awarder (A6)",
  async () => {
    const rows = await allRows<{ awarder_eik: string; n: number }>(
      `SELECT c.awarder_eik, count(*)::int AS n
         FROM transport_project_link l JOIN contracts c ON c.key = l.key
        WHERE l.kind = 'segment' AND NOT (c.awarder_eik = ANY($1))
        GROUP BY 1`,
      [RAIL],
    );
    assert.deepEqual(rows, [], "segments from non-rail awarders");
    // Non-vacuity: rail segments exist, so the assertion above discriminates.
    const [{ n }] = await allRows<{ n: number }>(
      "SELECT count(*)::int AS n FROM transport_project_link WHERE kind = 'segment'",
    );
    assert.ok(
      n > 0,
      "no segments at all — the rule above would pass vacuously",
    );
  },
);

test.skipIf(skip)("a contract carries at most one link (C3)", async () => {
  const rows = await allRows<{ key: string; n: number }>(
    "SELECT key, count(*)::int AS n FROM transport_project_link GROUP BY key HAVING count(*) > 1 LIMIT 5",
  );
  assert.deepEqual(
    rows,
    [],
    "a contract with two links puts its € on two features",
  );
});

test.skipIf(skip)(
  "member rows are excluded from every count (A1)",
  async () => {
    // Independent recount: features' contract counts must equal the linked
    // NON-member contracts in the window, which differs from the member-inclusive
    // count whenever a linked consortium exists (non-vacuity asserted below).
    const p = await mapFor(null);
    const shown =
      p.segments.reduce((a, s) => a + s.contractCount, 0) +
      p.points.reduce((a, s) => a + s.contractCount, 0);
    const [{ ex, all }] = await allRows<{ ex: number; all: number }>(
      `SELECT count(*) FILTER (WHERE c.consortium_role IS DISTINCT FROM 'member')::int AS ex,
              count(*)::int AS all
         FROM transport_project_link l JOIN contracts c ON c.key = l.key
        WHERE c.tag = 'contract' AND c.awarder_eik = ANY($1)
          AND l.a_lng IS NOT NULL
          AND (l.kind = 'point' OR l.b_lng IS NOT NULL)`,
      [TRANSPORT_SECTOR_EIKS],
    );
    assert.equal(shown, ex, "feature counts include consortium members");
    assert.ok(all > ex, "no linked member rows — the member check is vacuous; retire it deliberately"); // prettier-ignore
  },
);

test.skipIf(skip)(
  "coverage agrees with an independent recount and stays a share",
  async () => {
    for (const from of [null, "2026-04-19"]) {
      const { coverage: c } = await mapFor(from);
      const [r] = await allRows<{ n: number; eur: number }>(
        `SELECT count(*)::int AS n, round(coalesce(sum(amount_eur),0))::float8 AS eur
           FROM contracts
          WHERE awarder_eik = ANY($1) AND tag = 'contract'
            AND consortium_role IS DISTINCT FROM 'member'
            AND date >= coalesce($2, '')`,
        [TRANSPORT_SECTOR_EIKS, from],
      );
      assert.equal(c.totalContracts, r.n, `totalContracts (${from})`);
      assert.equal(c.totalEur, r.eur, `totalEur (${from})`);
      assert.ok(c.placedEur > 0 && c.placedEur < c.totalEur, `placed share out of (0,1) (${from})`); // prettier-ignore
    }
  },
);

// ── Section-end refusal, re-derived from the COMMITTED register (no DB needed) ──
const REGISTER = placeCandidatesIndex(
  JSON.parse(
    readFileSync(path.resolve(process.cwd(), "data/ekatte_index.json"), "utf8"),
  ) as { name: string; loc: string | null; is_village?: boolean }[],
);
const cands = (n: string) => REGISTER.get(n) ?? [];

test("the register settles a shared name by distance and refuses what distance cannot", () => {
  // Shared names on both sides: „Стражица" (a town and a village) and
  // „Славяново" (a town and two villages) — the adjacent pair wins.
  assert.ok(cands("Стражица").length > 1 && cands("Славяново").length > 1, "the collision fixture is gone from ekatte_index.json"); // prettier-ignore
  const p = pickSectionEnds(cands("Стражица"), cands("Славяново"));
  assert.ok("a" in p, "Стражица–Славяново was refused");
  if ("a" in p) assert.equal(p.b.village, true, "picked the Плевен TOWN Славяново, 100 km off"); // prettier-ignore
  // A unique pair too far apart for adjacent stations is refused, never drawn.
  assert.deepEqual(pickSectionEnds(cands("Медковец"), cands("Срацимир")), { refused: "none-within" }); // prettier-ignore
  // And a name the register does not hold is refused as unknown.
  assert.deepEqual(pickSectionEnds(cands("Несъществуващо"), cands("Медковец")), { refused: "unknown" }); // prettier-ignore
});

test.skipIf(skip)(
  "stored section ends are within reach of each other, and a named section is never a point (T4)",
  async () => {
    const segs =
      await allRows<{ a_lng: number; a_lat: number; b_lng: number; b_lat: number; scope: string }>( // prettier-ignore
        "SELECT a_lng, a_lat, b_lng, b_lat, scope FROM transport_project_link WHERE kind = 'segment' AND scope = 'section'",
      );
    assert.ok(segs.length > 0, "no section segments — the check is vacuous");
    const km = (s: (typeof segs)[number]) => {
      const r = Math.PI / 180;
      const h =
        Math.sin(((s.b_lat - s.a_lat) * r) / 2) ** 2 +
        Math.cos(s.a_lat * r) * Math.cos(s.b_lat * r) * Math.sin(((s.b_lng - s.a_lng) * r) / 2) ** 2; // prettier-ignore
      return 2 * 6371 * Math.asin(Math.sqrt(h));
    };
    const far = segs.filter((s) => km(s) > 120);
    assert.deepEqual(
      far.length,
      0,
      "a 'section' segment spans more than MAX_SECTION_KM",
    );

    const points = await allRows<{ title: string }>(
      `SELECT c.title FROM transport_project_link l JOIN contracts c ON c.key = l.key
        WHERE l.kind = 'point' AND c.awarder_eik = ANY($1)`,
      [RAIL],
    );
    const sectioned = points.filter((p) => sectionPair(p.title));
    assert.deepEqual(sectioned.map((p) => p.title).slice(0, 3), [], "a title naming its section became a point"); // prettier-ignore
  },
);

test.skipIf(skip)("non-work-site titles stay off the map (T5)", async () => {
  const rows = await allRows<{ title: string; kind: string }>(
    `SELECT c.title, l.kind FROM transport_project_link l JOIN contracts c ON c.key = l.key`,
  );
  const bad = rows.filter((r) => !namesAWorkSite(r.title, r.kind === "point"));
  assert.deepEqual(bad.map((r) => r.title).slice(0, 3), [], "a utility / operating / rolling-stock title is on the map"); // prettier-ignore
});
