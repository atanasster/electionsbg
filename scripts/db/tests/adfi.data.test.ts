// Gates for the АДФИ inspection register (migration 173, plan P7).
//
// This is the dataset where a wrong row is an ACCUSATION: it says a named public
// body was financially inspected. Every gate here is about not making one.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";
import { adfiNameFold } from "../../procurement/adfi/parse";

const haveDb = await dbReachable();
const [{ n } = { n: "0" }] = haveDb
  ? await allRows<{ n: string }>(
      "SELECT count(*)::text n FROM adfi_inspection",
    ).catch(() => [{ n: "0" }])
  : [{ n: "0" }];
const skip = !haveDb
  ? "Postgres unreachable"
  : n === "0"
    ? "adfi_inspection is empty — run npm run db:load:adfi:pg"
    : false;

afterAll(async () => {
  await end();
});

test.skipIf(skip)("the register is whole and dated", async () => {
  const [r] = await allRows<Record<string, string>>(
    `SELECT count(*)::text n,
            count(*) FILTER (WHERE published_at IS NULL)::text undated,
            count(DISTINCT subject)::text bodies
       FROM adfi_inspection`,
  );
  assert.ok(
    Number(r.n) > 1500,
    `only ${r.n} inspections — АДФИ does not withdraw reports, so this is a ` +
      `page-shape change`,
  );
  assert.equal(
    Number(r.undated),
    0,
    `${r.undated} inspections have no date. The date is what makes „was this ` +
      `buyer inspected BEFORE that award" answerable.`,
  );
  assert.ok(Number(r.bodies) > 800, `only ${r.bodies} distinct bodies`);
});

test.skipIf(skip)(
  "every resolved ЕИК matches a real spelling of that buyer",
  async () => {
    // ⚠️ THE ACCUSATION GATE. `subject_eik` is a NAME match, and attaching a
    // financial inspection to the wrong municipality is the most damaging error
    // this repo can make.
    //
    // It uses `adfiNameFold` — the LOADER'S OWN fold, imported, never a second
    // copy. A SQL reimplementation was tried first and immediately disagreed
    // with the loader on „«Топлофикация София» ЕАД" vs „ТОПЛОФИКАЦИЯ СОФИЯ
    // ЕАД", flagging nine CORRECT matches as false accusations. A gate that
    // cannot reproduce the decision it is checking is checking something else.
    const rows = await allRows<{ subject: string; subject_eik: string }>(
      "SELECT subject, subject_eik FROM adfi_inspection WHERE subject_eik IS NOT NULL",
    );
    const names = await allRows<{ eik: string; name: string }>(
      `SELECT DISTINCT awarder_eik AS eik, awarder_name AS name FROM contracts
        WHERE awarder_eik IS NOT NULL AND awarder_name IS NOT NULL`,
    );
    const byEik = new Map<string, string[]>();
    for (const n of names) {
      const k = String(n.eik);
      byEik.set(k, [...(byEik.get(k) ?? []), adfiNameFold(n.name)]);
    }
    const bad = rows.filter((r) => {
      const want = adfiNameFold(r.subject);
      return !(byEik.get(r.subject_eik) ?? []).some((n) => n === want);
    });
    assert.deepEqual(
      bad.map((b) => `${b.subject_eik} ${b.subject}`),
      [],
      "these inspections are attributed to an EIK that appears under no " +
        "matching name in the corpus — a misattributed inspection is a false " +
        "accusation",
    );
  },
);

test.skipIf(skip)(
  "an unresolvable name is left NULL, never guessed",
  async () => {
    // Coverage is deliberately partial: 44.7% resolve. The rest are bodies that
    // never appear as an awarder in our corpus (schools, hospitals, state firms).
    // A high resolution rate would mean the fold had become permissive.
    const [r] = await allRows<{ total: string; resolved: string }>(
      `SELECT count(*)::text total,
            count(*) FILTER (WHERE subject_eik IS NOT NULL)::text resolved
       FROM adfi_inspection`,
    );
    const share = Number(r.resolved) / Number(r.total);
    assert.ok(
      share > 0.2 && share < 0.75,
      `${(share * 100).toFixed(1)}% of inspections resolved to an ЕИК. Far above ` +
        `the measured 44.7% means the name fold has become permissive — which on ` +
        `this dataset means attributing inspections to bodies that were not ` +
        `inspected.`,
    );
  },
);

test.skipIf(skip)("the coverage floor is stored and reachable", async () => {
  // „No inspection found" must be readable as „none since Feb 2024", never as
  // „never inspected" — АДФИ publishes earlier reports without a subject column.
  const [c] = await allRows<{ covered_from: string }>(
    "SELECT covered_from::text FROM adfi_coverage",
  );
  assert.ok(c?.covered_from, "no coverage floor stored");
  const [any] = await allRows<{ subject_eik: string }>(
    "SELECT subject_eik FROM adfi_inspection WHERE subject_eik IS NOT NULL LIMIT 1",
  );
  const rows = await allRows<{ covered_from: string }>(
    "SELECT covered_from::text FROM adfi_for_buyer($1)",
    [any.subject_eik],
  );
  assert.ok(
    rows.every((r) => r.covered_from === c.covered_from),
    "adfi_for_buyer does not return the coverage floor with its rows, so a " +
      "caller cannot tell „none since Feb 2024“ from „never inspected“",
  );
});
