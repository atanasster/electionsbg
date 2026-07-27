// The judiciary-declarations serving surface (109_judiciary_payloads.sql, loaded by
// load_judiciary_payloads_pg.ts) that replaces data/judiciary/declarations.json.
// Plan: docs/plans/persons-pg-retirement-v1.md (Tier 2, T2.6).
//
// Pins the one thing that could silently rot: the /api/db/judiciary-declarations route
// must serve a blob SEMANTICALLY IDENTICAL to the on-disk artifact the loader read — same
// yearly counts, same filing calendar, and (the part that carries named people) the ИВСС
// integrity lists intact. jsonb reorders object keys, so the comparison is order-independent
// by construction; array order (years desc, integrity lists) IS preserved by jsonb and the
// consumers depend on it (years[0] = latest), so that is asserted directly.
//
// Auto-skips when Postgres is down or the payload table is empty — like the other
// *.data.test.ts gates.  npm run test:data

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
const SRC = path.join(ROOT, "data/judiciary/declarations.json");

const reachable = async (): Promise<boolean> => {
  try {
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.judiciary_payloads') IS NOT NULL AS ok",
    );
    if (!t?.ok) return false;
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM judiciary_payloads WHERE kind = 'declarations'",
    );
    return Number(c.n) > 0;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb ? false : "Postgres unreachable / judiciary_payloads empty";

afterAll(async () => {
  await end();
});

// Order-independent deep normaliser (sorts object keys, keeps array order).
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

interface IntegrityList {
  id: string;
  people: { name: string }[];
}
interface DeclarationsBlob {
  years: { year: number }[];
  integrity: IntegrityList[];
  totals: { declarations: number };
}

test.skipIf(skip)(
  "judiciary-declarations serves the register blob, semantically identical to the artifact",
  async () => {
    assert.ok(existsSync(SRC), `missing load source ${SRC}`);
    const disk = JSON.parse(readFileSync(SRC, "utf8")) as DeclarationsBlob;

    const { body } = await DB_ROUTES["judiciary-declarations"](allRows, {});
    const served = body as DeclarationsBlob | null;
    assert.ok(
      served,
      "route returned a null body — loader/migration not applied?",
    );

    // Whole-blob semantic parity (key order aside).
    assert.deepEqual(norm(served), norm(disk));

    // Array order the consumers rely on: years are descending, so years[0] is the latest.
    assert.equal(
      served.years[0].year,
      Math.max(...disk.years.map((y) => y.year)),
    );

    // The person-bearing integrity lists survive with their names — the whole point of
    // keeping this on a person-data migration.
    for (const dl of disk.integrity) {
      const sl: IntegrityList | undefined = served.integrity.find(
        (l) => l.id === dl.id,
      );
      assert.ok(sl, `integrity list ${dl.id} dropped`);
      assert.deepEqual(
        sl.people.map((p: { name: string }) => p.name).sort(),
        dl.people.map((p: { name: string }) => p.name).sort(),
      );
    }
  },
);
