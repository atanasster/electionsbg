// The ownership map must not call a hospital PRIVATE when the МЗ ЕЕОФ register —
// filed only by state and municipal hospitals — lists it.
//
// WHY THIS EXISTS. The classifier (scripts/nzok/lib/ownership.ts) links the
// name-keyed register to the Рег.№-keyed payments exact-first, and anything it
// cannot link is "private" by construction. On 2026-11-21 that residual held 33
// register-listed facilities and €98m of 2025 НЗОК money — Кюстендил (ЕЕОФ spells
// „Василев"), Ямбол („Панталеймон"), СБАЛОЗ Варна, Св. Мина Благоевград, every
// СБР-НК filial — enough to make private hospitals look as if they had overtaken
// state ones, and to publish Кюстендил and Ямбол as ~100% private. Every count
// reconciled throughout; only reading the names found it.
//
// The check is a second, deliberately fuzzier reading of the register
// (./../../nzok/lib/ownership_gap.ts). A hit is a candidate for a hand-verified
// override, never an automatic relabel.
//
//   pnpm run test:data
//
// Needs the local Postgres for the 2025 € floor; skips when it is unreachable.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, end } from "../lib/pg";
import { reportSkip } from "../../lib/report_skip";
import {
  findRegisterGaps,
  type GapFacility,
} from "../../nzok/lib/ownership_gap";

const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const NZOK = path.join(REPO, "data/budget/nzok");
const FLOOR_EUR = 1_000_000;

// Reviewed hits that are NOT register hospitals. Empty today; an entry needs the
// reason it is genuinely private.
const REVIEWED_PRIVATE = new Set<string>([]);

interface OwnershipEntry {
  regNo: string;
  name: string;
  ownership: string;
  method: string;
}

const loadInputs = async () => {
  const fin = JSON.parse(
    fs.readFileSync(path.join(NZOK, "hospital_financials.json"), "utf8"),
  ) as {
    quarters: {
      quarter: string;
      ownership: string;
      hospitals: { name: string }[];
    }[];
  };
  const latest = fin.quarters
    .map((q) => q.quarter)
    .sort()
    .at(-1);
  const register = fin.quarters
    .filter((q) => q.quarter === latest)
    .flatMap((q) =>
      q.hospitals.map((h) => ({ name: h.name, ownership: q.ownership })),
    );
  const entries = (
    JSON.parse(
      fs.readFileSync(path.join(NZOK, "hospital_ownership.json"), "utf8"),
    ) as { entries: OwnershipEntry[] }
  ).entries;
  const year = await allRows<{ y: number }>(
    `SELECT max(extract(year FROM period))::int - 1 AS y FROM nzok_hospital_payments`,
  );
  // The last COMPLETE year (the current one is partial and would starve the floor).
  const y = year[0]?.y;
  const eurRows = await allRows<{ reg_no: string; e: number }>(
    `SELECT reg_no, sum(month_eur)::float8 AS e FROM nzok_hospital_payments
     WHERE extract(year FROM period) = $1 GROUP BY reg_no`,
    [y],
  );
  const eur = new Map(eurRows.map((r) => [r.reg_no, r.e]));
  const facilities = (flip: (e: OwnershipEntry) => boolean): GapFacility[] =>
    entries.map((e) => ({
      regNo: e.regNo,
      name: e.name,
      ownership: flip(e) ? "private" : e.ownership,
      eur: eur.get(e.regNo) ?? 0,
    }));
  return { register, facilities, latest };
};

const reachable = async (): Promise<boolean> => {
  try {
    const [t] = await allRows<{ n: number }>(
      `SELECT CASE WHEN to_regclass('public.nzok_hospital_payments') IS NULL THEN 0
              ELSE (SELECT count(*)::int FROM nzok_hospital_payments) END AS n`,
    );
    return (t?.n ?? 0) > 0;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb
  ? false
  : "Postgres unreachable / nzok_hospital_payments empty";
reportSkip(import.meta.url, skip);

afterAll(async () => {
  await end();
});

test.skipIf(skip)(
  "no facility above €1m is private while it looks like an ЕЕОФ register hospital",
  async () => {
    const { register, facilities, latest } = await loadInputs();
    assert.ok(
      register.length > 100,
      `ЕЕОФ ${latest} roster is implausibly small`,
    );
    const gaps = findRegisterGaps(
      register,
      facilities(() => false),
      FLOOR_EUR,
    ).filter((g) => !REVIEWED_PRIVATE.has(g.regNo));
    assert.deepEqual(
      gaps.map(
        (g) =>
          `${g.regNo} ${g.name} ≈ ЕЕОФ ${g.registerOwnership} „${g.register}" €${(g.eur / 1e6).toFixed(2)}m`,
      ),
      [],
      "verify each against the register and add an override in scripts/nzok/lib/ownership.ts " +
        "(MANUAL_OWNERSHIP_BY_EIK / _BY_REGNO), then `pnpm run data:nzok --ownership` — " +
        "or list it in REVIEWED_PRIVATE with the reason it is private",
    );
  },
);

test.skipIf(skip)(
  "the check still discriminates: undoing the 2026-11-21 overrides is caught",
  async () => {
    // Mutation check — an assertion that only ever sees an empty list cannot tell
    // a working detector from one that matches nothing.
    const { register, facilities } = await loadInputs();
    const gaps = findRegisterGaps(
      register,
      facilities((e) => e.method === "override"),
      FLOOR_EUR,
    );
    assert.ok(
      gaps.length >= 6,
      `relabelling the overrides private should surface ≥6 register hospitals, got ${gaps.length}`,
    );
  },
);
