// Gate for the ДС facet's attachment rule (scripts/person/dsJoin.ts,
// docs/plans/comdos-ds-ingest-v1.md §4 rule 2). Runs the SAME query the resolver
// runs, over the committed MP roster, so a regression in the join is caught without
// a full db:resolve:persons.
//
// Three things are worth protecting:
//   - the join still reproduces every MP the old hand-curated register attached;
//   - a name on the manual hold list never attaches, however the join resolves;
//   - the birth date DISCRIMINATES — with it shifted by one day nobody attaches,
//     so the gate cannot pass on a name-only join.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { allRows, dbReachable } from "../lib/pg";
import { reportSkip } from "../../lib/report_skip";
import { assertCommitted } from "../../lib/assert_committed";
import {
  DS_MP_JOIN_SQL,
  dsCategoryLabel,
  dsMpParams,
  type DsMpMatch,
  type RosterMp,
} from "../../person/dsJoin";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const MPS = path.join(ROOT, "data/parliament/index.json");
const HOLD = path.join(ROOT, "data/person/ds.json");
// Both inputs are COMMITTED: their absence is a broken checkout, never a skip.
assertCommitted("data/parliament/index.json", "data/person/ds.json");

// The MPs the hand-curated data/person/ds.json attached before the corpus existed
// (решение № 14 / 04.09.2007, verified there by mpId + birth date).
const CURATED_MP_IDS = [
  12, 94, 105, 594, 902, 1803, 1957, 1958, 2229, 2250, 2258, 2275,
];

const haveDb = await dbReachable();
const [{ n } = { n: "0" }] = haveDb
  ? await allRows<{ n: string }>(
      "SELECT count(*)::text n FROM ds_announcement",
    ).catch(() => [{ n: "0" }])
  : [{ n: "0" }];
const skip = !haveDb
  ? "Postgres unreachable"
  : n === "0"
    ? "ds_announcement is empty — run pnpm run db:load:ds:pg"
    : null;
const d = skip ? describe.skip : describe;
reportSkip(import.meta.url, skip);

const shiftDay = (iso: string): string => {
  const t = new Date(`${iso}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
};

d("ДС MP join (dsJoin.ts)", () => {
  const mps = skip
    ? []
    : (JSON.parse(fs.readFileSync(MPS, "utf8")) as { mps: RosterMp[] }).mps;
  const held = (
    JSON.parse(fs.readFileSync(HOLD, "utf8")) as { held: { name: string }[] }
  ).held.map((h) => h.name);
  const run = (bd: (s: string) => string, hold: string[]) => {
    const [ids, names, dates] = dsMpParams(mps, hold);
    return allRows<DsMpMatch>(DS_MP_JOIN_SQL, [
      ids,
      names,
      dates.map(bd),
      hold,
    ]);
  };

  it("reproduces every MP the hand-curated register attached", async () => {
    const ids = (await run((s) => s, held)).map((r) => r.mp_id);
    expect(ids).toEqual(expect.arrayContaining(CURATED_MP_IDS));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never attaches a name on the manual hold list", async () => {
    expect(held.length).toBeGreaterThan(0);
    const rows = await run((s) => s, held);
    expect(rows.filter((r) => held.includes(r.name))).toEqual([]);
    // …and the hold is what stops them: without it at least one would attach,
    // so the assertion above is not vacuous.
    // Every one of them, so a hold that has gone stale (the person no longer
    // matches at all) is noticed rather than kept as dead weight.
    const unheld = (await run((s) => s, [])).map((r) => r.name);
    expect(held.filter((h) => !unheld.includes(h))).toEqual([]);
  });

  it("requires the EXACT birth date (mutation: shifted by a day → nobody)", async () => {
    expect(await run(shiftDay, held)).toEqual([]);
  });

  it("labels the badge from the free-text „Качество“ cell", () => {
    expect(dsCategoryLabel("; агент")).toBe("агент");
    expect(dsCategoryLabel("Информатор; резидент;")).toBe(
      "информатор, резидент",
    );
    expect(dsCategoryLabel("Агент; агент")).toBe("агент");
    expect(dsCategoryLabel("")).toBeNull();
    expect(dsCategoryLabel(null)).toBeNull();
  });
});
