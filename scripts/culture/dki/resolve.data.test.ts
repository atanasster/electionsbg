// The LEAVE-ONE-OUT sweep — the single check that finds this resolver's whole
// defect class, and the one that would have caught both criticals at once.
//
// The perturbation is ordinary rather than hypothetical: a buyer gets renamed
// between corpus reloads, or an institute simply has no procurement at all — the
// state 19 of the 70 register entries are already in. So for every institute
// that resolves, drop its own EIK from the candidate set and assert the resolver
// REFUSES instead of reaching for the next-best body.
//
// Measured 2026-08-19 BEFORE the fix: 3 of 49 captured a different institution —
// Електроенергиен системен оператор ЕАД as the Burgas opera, КОМДОС as Театър
// „Българска армия", and a Lovech primary school as НУИ „Панайот Пипков". After
// restricting `abbrevOf` to real abbreviation stems and adding the OTHER_KIND
// guard: 0 captures, with resolved coverage unchanged at 49/70.
//
// Needs Postgres (the candidate set is the live corpus), so it skips when the
// database is down — the repo convention for `.data.test.ts`.

import { afterAll, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { dbReachable, end } from "../../db/lib/pg";
import { DKI_PAGES } from "./sources";
import { parseDkiPage, type DkiEntry } from "./parse";
import { loadBuyerCandidates, resolveEntry } from "./resolve";

const RAW = path.resolve(__dirname, "../../../raw_data/culture/dki");

const haveDb = await dbReachable();
const haveCache = DKI_PAGES.every((p) =>
  fs.existsSync(path.join(RAW, `${p.id}.html`)),
);
const skip = !haveDb
  ? "Postgres unreachable"
  : !haveCache
    ? "no raw_data/culture/dki cache — run `npm run culture:dki` once"
    : false;

afterAll(async () => {
  await end();
});

const entries = (): DkiEntry[] =>
  haveCache
    ? DKI_PAGES.flatMap((p) =>
        parseDkiPage(
          fs.readFileSync(path.join(RAW, `${p.id}.html`), "utf8"),
          p,
        ),
      )
    : [];

test.skipIf(skip)(
  "refuses rather than capturing a different body when the true EIK is absent",
  async () => {
    const candidates = await loadBuyerCandidates();
    const captured: string[] = [];
    for (const e of entries()) {
      const r0 = resolveEntry(e, candidates);
      if (r0.status !== "resolved") continue;
      const r1 = resolveEntry(
        e,
        candidates.filter((c) => c.eik !== r0.eik),
      );
      if (r1.status === "resolved")
        captured.push(`${e.name} -> ${r1.eik} ${r1.corpusName}`);
    }
    expect(
      captured,
      "resolved to a DIFFERENT body once its own corpus rows were removed. " +
        "That is what happens on an ordinary rename, so these are live false " +
        "attributions, not a hypothetical.",
    ).toEqual([]);
  },
);

test.skipIf(skip)("the sweep is not vacuous", async () => {
  // A positive control. If the register parsed to nothing, or nothing resolved,
  // the sweep above passes while checking zero rows.
  const candidates = await loadBuyerCandidates();
  const rows = entries();
  expect(rows.length).toBeGreaterThanOrEqual(65);
  const resolved = rows.filter(
    (e) => resolveEntry(e, candidates).status === "resolved",
  );
  expect(resolved.length).toBeGreaterThanOrEqual(40);
});

test.skipIf(skip)("the committed artifact is current", async () => {
  // The artifact is COMMITTED and its EIKs are derived from a corpus that moves
  // underneath it. Same failure shape as every other committed-derived file
  // here: the register keeps serving the previous vintage at a 200.
  const file = path.resolve(
    __dirname,
    "../../../data/culture/dki_register.json",
  );
  const stored = JSON.parse(fs.readFileSync(file, "utf8")) as {
    institutes: { name: string; eik: string | null }[];
  };
  const candidates = await loadBuyerCandidates();
  const live = new Map(
    entries().map((e) => {
      const r = resolveEntry(e, candidates);
      return [e.name, r.status === "resolved" ? r.eik : null];
    }),
  );
  const drifted = stored.institutes
    .filter((i) => live.has(i.name) && live.get(i.name) !== i.eik)
    .map((i) => `${i.name}: stored ${i.eik}, corpus now ${live.get(i.name)}`);
  expect(
    drifted,
    "re-run `npm run culture:dki -- --apply` and commit the artifact",
  ).toEqual([]);
});
