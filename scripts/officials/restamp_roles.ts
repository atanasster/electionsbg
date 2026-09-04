// Re-derive the PUBLISHED role on the municipal officials index from each declarant's own
// filing, without re-scraping the register.
//
// WHY THIS EXISTS RATHER THAN AN INGEST RE-RUN. `scripts/officials/municipal.ts` applies
// ./role_reconcile.ts as it parses, so a fresh ingest needs nothing here — but that ingest is
// a 30-50 minute sequential crawl of a rate-limited public register, and the two fields the
// rule reads are ALREADY on disk in Postgres: `declaration.filed_position` /
// `filed_institution`, 61,743 filings' worth. They are not in the declaration shards — the
// shard writers never persisted them — which is why this reads the database rather than
// data/officials/municipal/declarations/.
//
// That is the same argument `scripts/db/ship_filed_position.ts` makes in the other direction:
// a filing is immutable once published, so a value derived from it is identical whichever
// process computes it, and re-crawling to recompute bytes we already hold is the one thing
// not to do. Applying the rule at parse time and never running this is also correct — this is
// the shortcut, not the specification.
//
// Join key is `declaration.subject_ref`, which for the muni tier IS the officials slug.
//
// RETAINED ROWS ARE RE-DERIVED TOO, and the consequence is accepted rather than avoided. The
// index accumulates — a row whose `descriptorYear` is behind `current.year` is an official the
// newest listing no longer names — and correcting one is still correcting a true statement
// about the year it covers. The cost is that a município whose register relabelled the same
// person between years ends up with two `mayor` rows in index.json (Раднево and Разград, each
// the same human under two slugs, because the slug's disambiguator carries the listing role).
// That is the accumulating roster's existing shape, not a new one — Полски Тръмбеш,
// Панагюрище and Копривщица were already there — and it reaches no reader: the shards are
// bench-only, so a bench-scoped mayor count still returns 1.
//
// The alternative, scoping to the current bench, was rejected because it would make this
// script and the ingest two different rules over one field. See FINDING-004's reasoning.
//
//   npx tsx scripts/officials/restamp_roles.ts            # dry run, prints every flip
//   npx tsx scripts/officials/restamp_roles.ts --apply    # rewrite index.json
//
// After --apply, re-emit the shards so the roster tree and everything derived from it follow:
//   npx tsx scripts/officials/build_municipal_shards.ts        # the by_obshtina tree
//   npm run data -- --resolve-local-canonicals                 # the officials_diff sidecars
//   npm run db:load:ngo-board-links                            # official_roster
//
// The sidecar step is the one that reaches /sverka. `reconcile_officials.ts` compares the
// shards' mayor against the CIK winner, so until it re-runs, /sverka and the two
// /local/<cycle>/<code> tiles keep publishing „Кметът X още не е подал декларация" about the
// very people this corrected — which is the claim the whole exercise exists to withdraw.
//
// ⚠️ THE MUNICIPALITY PAGE IS A DIFFERENT ROUTE AND A ROLE CORRECTION CANNOT TAKE THE CHEAP
// ONE. `useMunicipalOfficials.tsx` reads `municipal_officials_current`, refreshed only by
// `npm run db:load:official-candidate-links:pg` — and that matview takes its `role` from
// `person_role.role`, which only `db:resolve:persons` writes. A shard that gains a MAYOR (a
// new obshtina, or one carried forward) publishes after the candidate-links refresh; a row
// whose ROLE this script changed does not, until a resolve re-derives it from
// `official_roster`. Measured 2026-09-04: after the refresh alone, Разлог and Бяла served a
// mayor and Мъглиж and Макреш still served none.
//
// ⚠️ `/person` LAGS ALL OF THESE. `resolve_persons.ts` copies `person_role.role` from
// `official_roster`, so a profile keeps showing the listing role until a resolve runs — and
// that is deliberately NOT in the list above, because a resolve reassigns every `person_id`
// and owes a nine-command repair chain. See CLAUDE.md, "A LOCAL db:resolve:persons is never
// one command".

import fs from "fs";
import path from "path";
import { boolean, command, flag, run } from "cmd-ts";
import type {
  MunicipalIndexFile,
  MunicipalOfficialRole,
} from "../../src/data/dataTypes";
import { ROOT, writeJson } from "./shared";
import {
  reconcileRole,
  mapRole,
  countRoles,
  statesPlainMayoralty,
  employerIsMunicipality,
} from "./role_reconcile";
import { allRows, end } from "../db/lib/pg";

const INDEX_PATH = path.join(
  ROOT,
  "data",
  "officials",
  "municipal",
  "index.json",
);

type FiledRow = {
  subject_ref: string;
  filed_position: string | null;
  filed_institution: string | null;
};

/** Below this share of index rows joining a filing, the shard tree and Postgres are different
 *  vintages and the run cannot do its job. Same threshold and same reasoning as
 *  `scripts/db/ship_filed_position.ts`, which refuses under 95% because "a low rate means the
 *  two corpora are not the same vintage". */
const MIN_JOIN_RATE = 0.95;

/** Where the filed positions come from. Injected so the guards below can be tested without a
 *  database — the empty-join refusal and the match-rate floor are the two things most worth
 *  pinning and the two a Postgres dependency would otherwise leave untested. */
export type FiledSource = () => Promise<FiledRow[]>;

const fromPostgres: FiledSource = () =>
  allRows<FiledRow>(
    `SELECT DISTINCT ON (subject_ref)
            subject_ref, filed_position, filed_institution
       FROM declaration
      WHERE tier = 'muni' AND subject_ref IS NOT NULL
      ORDER BY subject_ref, declaration_year DESC, filed_at DESC NULLS LAST,
               declaration_id DESC`,
  );

export const restampRoles = async (
  apply: boolean,
  allowPartial = false,
  opts: { source?: FiledSource; indexPath?: string } = {},
): Promise<number> => {
  const indexPath = opts.indexPath ?? INDEX_PATH;
  const index: MunicipalIndexFile = JSON.parse(
    fs.readFileSync(indexPath, "utf-8"),
  );

  // Newest filing per subject: a person's role today is stated by their most recent filing,
  // and an older one can legitimately name a different office they have since left.
  //
  // ⚠️ THE TIE-BREAK MUST MATCH municipal.ts's. A `Person` node carries an annual, an exit and
  // a correction, so "newest" needs a stated rule within a year too — newest `filed_at`, with
  // an undated filing never displacing a dated one (`NULLS LAST`). The ingest orders on the
  // same tuple; two writers of one published field disagreeing about which filing states a
  // named person's office is the failure this pairing prevents.
  const rows = await (opts.source ?? fromPostgres)();
  const filedByRef = new Map<string, FiledRow>();
  for (const r of rows) filedByRef.set(r.subject_ref, r);

  if (filedByRef.size === 0) {
    // An empty join is not "nothing to correct" — it is a database that has not loaded the
    // declarations, and writing the index back from it would be a no-op that looks like a
    // clean run. Refuse instead.
    throw new Error(
      "no muni-tier declarations with a subject_ref in Postgres — run " +
        "`npm run db:load:declarations:pg` first (this reads filed_position/filed_institution, " +
        "which the declaration shards do not carry)",
    );
  }

  const flips: string[] = [];
  // A filing that MENTIONS a mayoralty and is corroborated by its employer, yet did not
  // satisfy the anchor. Every refusal in this rule is silent by design (fail closed), so
  // without this the population it declines is invisible and „no near misses" and „the rule
  // never looked" are indistinguishable.
  const nearMisses: string[] = [];
  let unmatched = 0;
  for (const e of index.entries) {
    const filed = filedByRef.get(e.slug);
    if (!filed) {
      unmatched++;
      continue;
    }
    const next: MunicipalOfficialRole = reconcileRole({
      // ⚠️ THE LISTING ROLE, RE-DERIVED — never the stored published one. Passing `e.role`
      // makes the script idempotent by LATCHING (a promoted row short-circuits on
      // `listingRole === "mayor"`) rather than by converging, so a later NARROWING of the rule
      // would un-promote on a re-ingest and not here, leaving the corpus carrying a withdrawn
      // claim while the console reports `0 role change(s)`. This must reproduce exactly what
      // municipal.ts computes.
      listingRole: mapRole(e.roleRaw),
      filedPosition: filed.filed_position,
      filedInstitution: filed.filed_institution,
      listingMunicipality: e.municipality,
    });
    if (next === e.role) {
      if (
        (e.role === "deputy_mayor" || e.role === "councillor") &&
        filed.filed_position &&
        /кмет/u.test(filed.filed_position.toLocaleLowerCase("bg")) &&
        !statesPlainMayoralty(filed.filed_position) &&
        employerIsMunicipality(filed.filed_institution, e.municipality)
      ) {
        nearMisses.push(
          `${e.municipality} — ${e.name}: kept ${e.role}  ` +
            `[filed "${filed.filed_position}" @ "${filed.filed_institution}"]`,
        );
      }
      continue;
    }
    flips.push(
      `${e.municipality} — ${e.name}: ${e.role} → ${next}  ` +
        `[listing "${e.roleRaw}" | filed "${filed.filed_position}" @ "${filed.filed_institution}"]`,
    );
    if (apply) e.role = next;
  }

  // Every flip is printed in full, always. This changes the published OFFICE of a named
  // individual, so the population must be small enough to read and must actually be read —
  // a count alone cannot distinguish a correction from a rule that has started over-matching.
  console.log(
    `[restamp-roles] ${index.entries.length} entries, ${filedByRef.size} filings joined, ` +
      `${unmatched} entry(ies) with no filing, ${flips.length} role change(s), ` +
      `${nearMisses.length} near miss(es)`,
  );
  for (const f of flips) console.log(`  ${apply ? "✔" : "·"} ${f}`);
  for (const n of nearMisses) console.log(`  ~ ${n}`);

  // ⚠️ A PASSING RATE STILL LEAVES ROWS UNCHECKED, so this warns unconditionally. `0 role
  // change(s)` beside 292 unjoined officials reads as "nothing to fix" rather than "292 were
  // never tested against their own filing", which is the whole failure mode this rule exists
  // to end, one level up.
  const rate =
    index.entries.length === 0
      ? 1
      : (index.entries.length - unmatched) / index.entries.length;
  if (unmatched > 0)
    console.warn(
      `[restamp-roles] ⚠ ${unmatched} entr(ies) had no filing in Postgres and were NOT ` +
        "re-derived — a mislabelled office among them is still published.",
    );
  if (rate < MIN_JOIN_RATE && !allowPartial)
    throw new Error(
      `only ${(rate * 100).toFixed(1)}% of index rows joined a muni filing ` +
        `(${unmatched}/${index.entries.length} unmatched) — the shard tree and Postgres are ` +
        "different vintages. Run `npm run db:load:declarations:pg` first, or pass " +
        "--allow-partial to accept the gap.",
    );

  if (apply && flips.length > 0) {
    // byRole is a published summary of the same column, so it must move with it or the index
    // asserts a distribution its own rows contradict.
    index.byRole = countRoles(index.entries);
    if (index.current) {
      const year = index.current.year;
      index.current.byRole = countRoles(
        index.entries.filter((e) => e.descriptorYear === year),
      );
    }
    // The content moved, so the stamp must too — every other writer of this file sets it, and
    // the shards inherit it through `emitShards`, so leaving it would have a watcher
    // fingerprint, a bucket sync and an operator diffing vintages all read a corrected corpus
    // as the 2026-08-15 ingest.
    index.generatedAt = new Date().toISOString();
    writeJson(indexPath, index);
    console.log(
      `[restamp-roles] wrote ${indexPath} — now re-emit the shards ` +
        "(`npx tsx scripts/officials/build_municipal_shards.ts`) and reload " +
        "(`npm run db:load:ngo-board-links`)",
    );
  } else if (apply) {
    console.log("[restamp-roles] nothing to change — index.json untouched");
  }
  return flips.length;
};

const cmd = command({
  name: "restamp-roles",
  description:
    "Re-derive the published role on data/officials/municipal/index.json from each declarant's own filed position, read from Postgres. Dry-run by default; idempotent.",
  args: {
    apply: flag({
      type: boolean,
      long: "apply",
      description: "Write index.json. Without it, only report.",
    }),
    allowPartial: flag({
      type: boolean,
      long: "allow-partial",
      description:
        "Proceed even when fewer than 95% of index rows join a filing. Only when the vintage gap is understood and accepted.",
    }),
  },
  handler: async ({ apply, allowPartial }) => {
    try {
      const flips = await restampRoles(apply, allowPartial);
      // A dry run's job is to report whether a correction is PENDING, so it must be
      // distinguishable from a clean one without parsing stdout — the contract
      // `opencalls:sync-enrichment` sets for the same shape of tool.
      if (!apply && flips > 0) process.exitCode = 1;
    } finally {
      await end();
    }
  },
});

const invokedDirectly = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  return (
    entry.endsWith("restamp_roles.ts") || entry.endsWith("restamp_roles.js")
  );
})();
if (invokedDirectly) run(cmd, process.argv.slice(2));
