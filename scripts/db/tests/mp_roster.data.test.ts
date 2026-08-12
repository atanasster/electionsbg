// The mp-roster serving surface (mp_profile + mp_roster_meta, loaded by load_mp_roster_pg.ts)
// that replaces the ~950 KB data/parliament/index.json.
// Plan: docs/plans/persons-pg-retirement-v1.md (Tier 2, T2.4).
//
// Pins that /api/db/mp-roster rebuilds the IndexFile useMps + the partyMps AI tool read:
// the header scalars (currentNs label, total) and every MpIndexEntry-contract field of every
// MP, order-independent. The raw index.json also carries an undeclared per-MP `scrapedAt`
// that MpIndexEntry omits and no consumer reads — it is stripped before comparing, so the
// gate tracks the CONTRACT, not the byte stream.
//
// Auto-skips when Postgres is down or the roster meta is missing — like the other gates.
//   npm run test:data

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";

const require = createRequire(import.meta.url);
const { DB_ROUTES } = require("../../../functions/db_routes.js") as {
  DB_ROUTES: Record<
    string,
    (
      dbRows: (sql: string, params: unknown[]) => Promise<unknown[]>,
      q: Record<string, string>,
    ) => Promise<{ status?: number; body: unknown }>
  >;
};

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const SRC = path.join(ROOT, "data/parliament/index.json");

const reachable = async (): Promise<boolean> => {
  try {
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.mp_roster_meta') IS NOT NULL AS ok",
    );
    if (!t?.ok) return false;
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM mp_roster_meta",
    );
    return Number(c.n) > 0;
  } catch {
    return false;
  }
};

const haveDb = (await reachable()) && existsSync(SRC);
const skip = haveDb ? false : "Postgres unreachable / mp_roster_meta empty";

afterAll(async () => {
  await end();
});

type Json = unknown;
const norm = (x: Json): Json => {
  if (Array.isArray(x)) return x.map(norm);
  if (x && typeof x === "object")
    return Object.keys(x as Record<string, Json>)
      .sort()
      .reduce<Record<string, Json>>((o, k) => {
        o[k] = norm((x as Record<string, Json>)[k]);
        return o;
      }, {});
  return x;
};

// The MpIndexEntry contract (useMps.tsx) — the fields a consumer may read. `scrapedAt` is in
// the raw shard but NOT the contract, so it is excluded from the comparison.
const CONTRACT_KEYS = [
  "id",
  "name",
  "name_en",
  "normalizedName",
  "normalizedName_en",
  "photoUrl",
  "currentRegion",
  "currentPartyGroup",
  "currentPartyGroupShort",
  "position",
  "birthDate",
  "nsFolders",
  "isCurrent",
];
// The loader deliberately maps parliament.bg's MySQL zero-date "0000-00-00" (and anything not
// a real YYYY-MM-DD) to NULL — see load_mp_roster_pg.ts birthDate(). The raw index.json keeps
// the zero date, so normalise the disk side the same way: the route is CORRECT to serve null,
// and the gate tracks the loader's contract, not the un-cleaned artifact (one MP today, id 766).
const cleanBirth = (raw: Json): Json =>
  typeof raw === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(raw) &&
  !raw.startsWith("0000")
    ? raw
    : null;
const project = (m: Record<string, Json>): Record<string, Json> => {
  const out: Record<string, Json> = Object.fromEntries(
    CONTRACT_KEYS.map((k) => [k, m[k] ?? null]),
  );
  out.birthDate = cleanBirth(out.birthDate);
  return out;
};

interface IndexFile {
  currentNs: string;
  total: number;
  mps: Record<string, Json>[];
}

test.skipIf(skip)(
  "mp-roster rebuilds the index.json IndexFile, contract-field-identical",
  async () => {
    const disk = JSON.parse(readFileSync(SRC, "utf8")) as IndexFile;
    const { body } = await DB_ROUTES["mp-roster"](allRows, {});
    const served = body as IndexFile | null;
    assert.ok(
      served,
      "route returned null — loader/migration 111 not applied?",
    );

    // Header scalars: the label must be verbatim (consumers read it AND slice /^\d+/).
    assert.equal(served.currentNs, disk.currentNs);
    assert.equal(served.total, disk.total);
    assert.equal(served.mps.length, disk.mps.length);

    // Every MP, matched by id, contract-projected + order-independent.
    const servedById = new Map(served.mps.map((m) => [m.id, m]));
    for (const d of disk.mps) {
      const s = servedById.get(d.id);
      assert.ok(s, `mp ${String(d.id)} missing from the route`);
      assert.deepEqual(
        norm(project(s)),
        norm(project(d)),
        `mp ${String(d.id)} differs`,
      );
    }
  },
);

// `elected_with` has no other backstop, unlike its sibling `seated_region_*` — that one is
// held to the by-id shard by mp_serving.data.test.ts, while this column is deliberately NOT
// in the /api/db/mp-roster contract above (the route does not serve it). So a scraper
// regression emitting null for all 2,122 would load green and blank 1,443 party badges with
// nothing red anywhere.
test.skipIf(skip)(
  "elected_with keeps its coverage and its contract",
  async () => {
    const [cov] = await allRows<{ total: number; filled: number }>(
      "SELECT count(*)::int AS total, count(elected_with)::int AS filled FROM mp_profile",
    );
    assert.ok(cov, "mp_profile is empty — run db:load:mp-roster:pg");
    // 1,683 of 2,122 measured 2026-08-12. A FLOOR, not an equality: the roster grows, and
    // parliament.bg can start publishing the field for MPs that lack it today.
    assert.ok(
      cov.filled > 1_600,
      `only ${cov.filled}/${cov.total} MPs carry elected_with`,
    );

    // The quoting parliament.bg wraps most of these in must not survive into the column —
    // it is rendered verbatim on the person page when the canonical fold does not know it.
    const [quoted] = await allRows<{ n: number }>(
      `SELECT count(*)::int AS n FROM mp_profile WHERE elected_with ~ '["„“”«»]'`,
    );
    assert.equal(quoted.n, 0, "elected_with retains parliament.bg's quoting");

    // THE invariant the whole of §0b is built around, enforced mechanically for the first
    // time. `elected_with` is ONE value per career; `person_role.party` is the group ENTERED
    // per parliament, derived from the roll-call seat. Measured against the 72 MPs who
    // changed group, the two agree on neither endpoint 27 times — so writing one from the
    // other would publish a per-term claim the data cannot support.
    const [leak] = await allRows<{ n: number }>(
      `SELECT count(*)::int AS n
       FROM person_role r
       JOIN mp_profile m ON m.mp_id::text = split_part(r.ref, ':', 1)
      WHERE r.source = 'mp' AND r.party IS NOT NULL AND r.party = m.elected_with`,
    );
    assert.equal(leak.n, 0, "person_role.party was written from elected_with");
  },
);
