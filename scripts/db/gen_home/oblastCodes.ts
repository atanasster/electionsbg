// The ONE place the oblast fold may live — `docs/plans/home-flyover-v1.md` §3 and §14.
//
// The flyover artifact keys every money layer by a 28-member OBLAST CODE. Its inputs do not
// agree on how an oblast is named, and the disagreements are not cosmetic:
//
//   | input                     | Sofia city              | Sofia province   | Plovdiv province |
//   | ------------------------- | ----------------------- | ---------------- | ---------------- |
//   | `awarder_seats.oblast`    | `София (столица)`       | `София`          | `Пловдив`        |
//   | `tr_company_place.oblast` | `София (столица)`       | `София`          | `Пловдив`        |
//   | `agri_subsidies.oblast`   | `София (столица)`       | `София (област)` | `Пловдив`        |
//   | `fund_projects.oblast`    | `S22`/`S23`/`S24`/`S25` | `SFO`            | `PDV`            |
//   | `data/regions_map.json`   | `S23`/`S24`/`S25`       | `SFO`            | `PDV` + `PDV-00` |
//   | `canon_oblast()` (143)    | `SOFIA_CITY`            | `SFO`            | `PDV`            |
//   | this module (the output)  | `SOF`                   | `SFO`            | `PDV`            |
//
// ⚠️ THE TWO SOFIAS ARE THE WHOLE REASON THIS FILE EXISTS. `София` and `София (столица)`
// differ by one parenthesis and are two different places with a 5.5× population gap; folding
// them together, or reading the province's name as the capital's, moves €50bn+ of
// procurement between two columns that stand 40 km apart on the map. Nothing here may guess:
// a name this module has never been told about resolves to `null` and the generator refuses
// to write, rather than dropping the money into a bucket nobody chose.
//
// The 28 codes and their canonical Bulgarian/English names are DERIVED from the committed
// `data/census_2021.json`, whose `nameBg` values are exactly the spellings `awarder_seats`
// and `tr_company_place` use — so the map is a seed plus a short, measured alias list rather
// than a hand-typed table that can drift from the corpus.
//
// ⚠️ THREE OTHER FOLDS OVER THE SAME PLACES ALREADY EXIST, AND NONE OF THEM IS THE SEED.
// They are listed here so a future DRY pass has the argument in front of it rather than
// three overlapping maps and no reason:
//
//   - `src/data/json/regions.json` is МИР-keyed: it has no `SOF` at all and spells the two
//     provinces `обл. Пловдив` / `София област`, neither of which any input uses. (The plan
//     named it as the seed; it cannot be one.)
//   - `canon_oblast()` in `scripts/db/schema/pg/143_funds_fit.sql` applies these SAME two
//     code rules to this SAME `fund_projects.oblast` column and emits `SOFIA_CITY` for the
//     capital, because the /funds key space is its own. FOLD ONCE: a funds query feeding
//     this module must select the RAW `oblast`, never `canon_oblast(oblast)` — the double
//     fold yields `SOFIA_CITY`, which resolves to null here, and the capital's whole funds
//     layer would then be reported as a missing `SOF` column rather than as a double fold.
//   - `scripts/lib/oblast_names.ts` invites new consumers to import from it, and must not be
//     one here. Its `OBLAST_CODES_BY_BG_NAME` deliberately collapses a bare `София` onto
//     BOTH `SFO` and `SOF`/`S23`/`S24`/`S25` — right for a postcode join that cannot
//     disambiguate, and exactly the one-name-two-codes state this module refuses (140
//     `awarder_seats` rows spell the PROVINCE bare `София`). It also has no `S22`, which is
//     15,235 `fund_projects` rows.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

export interface OblastRec {
  /** The 3-letter code every money layer in the artifact is keyed by. */
  code: string;
  nameBg: string;
  nameEn: string;
  population: number;
}

interface CensusFile {
  oblasts: {
    code: string;
    nameBg: string;
    nameEn: string;
    population: number;
  }[];
}

const CENSUS_REL = "data/census_2021.json";

// Throwing is the right direction — this module cannot function without the file, and
// degrading to an empty `OBLASTS` would export a fold that resolves nothing and a coverage
// assertion satisfied by an empty universe. What the raw ENOENT/SyntaxError does not say is
// WHICH module failed and what to do, so it is restated. „Absent" and „unparseable" are
// different fixes: absent means a broken checkout, unparseable means a bad regeneration.
let census: CensusFile;
try {
  census = JSON.parse(fs.readFileSync(path.join(ROOT, CENSUS_REL), "utf8"));
} catch (e) {
  throw new Error(
    `oblastCodes: cannot read ${CENSUS_REL} (${(e as Error).message}). It is committed; ` +
      `restore it with \`git checkout -- ${CENSUS_REL}\`.`,
  );
}

/** The 28 oblasts, code-sorted so every derived structure is deterministic. */
export const OBLASTS: readonly OblastRec[] = census.oblasts
  .map((o) => ({
    code: o.code,
    nameBg: o.nameBg,
    nameEn: o.nameEn,
    population: o.population,
  }))
  .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));

export const OBLAST_CODES: readonly string[] = OBLASTS.map((o) => o.code);

const CODE_SET = new Set(OBLAST_CODES);

if (OBLASTS.length !== 28) {
  throw new Error(
    `oblastCodes: ${CENSUS_REL} holds ${OBLASTS.length} oblasts, expected 28`,
  );
}
// ⚠️ The COUNT is not the check. A repeated code leaves `OBLAST_CODES` at 28 while
// `CODE_SET` and `BY_CODE` hold 27, so `assertLayerCoverage` is satisfied by the duplicate
// and one oblast never has to appear at all.
if (CODE_SET.size !== OBLASTS.length) {
  throw new Error(`oblastCodes: ${CENSUS_REL} repeats an oblast code`);
}
// ⚠️ And a repeated NAME is the two-Sofias case in its most dangerous form: `NAME_TO_CODE`
// is last-wins over a code-sorted list, so if a census regeneration ever normalised
// `София (столица)` down to `София`, `SOF` would overwrite `SFO` and the capital would
// swallow the province — silently, in the direction of the larger number.
const dupName = OBLASTS.map((o) => o.nameBg).find(
  (n, i, all) => all.indexOf(n) !== i,
);
if (dupName) {
  throw new Error(
    `oblastCodes: ${CENSUS_REL} spells two oblasts ${JSON.stringify(dupName)} — ` +
      `one name, one oblast`,
  );
}

/**
 * Spellings a Postgres input uses that the census does not.
 *
 * Deliberately SHORT and measured — every entry here was found by grouping the real column,
 * not anticipated. A speculative alias is worse than a missing one: a missing alias makes the
 * generator refuse and name the string, while a wrong guess silently books somebody's money
 * into the wrong oblast.
 */
const NAME_ALIASES: ReadonlyMap<string, string> = new Map([
  // `agri_subsidies` alone disambiguates the province this way; every other seat table
  // spells it bare `София`, which the census also uses.
  ["София (област)", "SFO"],
]);

const NAME_TO_CODE = new Map<string, string>();
for (const o of OBLASTS) NAME_TO_CODE.set(o.nameBg, o.code);
for (const [name, code] of NAME_ALIASES) {
  if (!CODE_SET.has(code)) {
    throw new Error(
      `oblastCodes: alias ${name} → ${code}, which is not an oblast code`,
    );
  }
  const existing = NAME_TO_CODE.get(name);
  if (existing && existing !== code) {
    // "maps to two codes" (§3): the alias list contradicting the census seed.
    throw new Error(
      `oblastCodes: ${name} maps to both ${existing} and ${code} — one name, one oblast`,
    );
  }
  NAME_TO_CODE.set(name, code);
}

/**
 * The МИР / election / funds CODE fold.
 *
 * `data/regions_map.json`, `data/<date>/region_votes.json` and the price index are keyed by
 * the 31 МИР polygons; `fund_projects.oblast` uses `S22` for the capital. All of those fold
 * onto the 28 money oblasts here and nowhere else.
 *
 * ⚠️ A `Map`, not an object literal, and for the same reason `NAME_TO_CODE` is one: a bare
 * `CODE_FOLD[k]` walks the prototype chain, so `oblastFromCode("constructor")` would return
 * a FUNCTION where the signature promises `string | null` — `??` does not catch it, and
 * TypeScript cannot see it through an index signature. Unreachable with today's corpus and
 * one line to remove entirely, on a lookup fed by an arbitrary-text database column.
 */
const CODE_FOLD: ReadonlyMap<string, string> = new Map([
  // Sofia city is three МИР (23, 24, 25) and one more code again in the funds corpus.
  ["S22", "SOF"],
  ["S23", "SOF"],
  ["S24", "SOF"],
  ["S25", "SOF"],
  // Plovdiv city is its own МИР; the money grain is the province.
  ["PDV-00", "PDV"],
]);

/**
 * A Postgres oblast NAME → code, or `null` when this module has never seen the string.
 * Blank and NULL (an unresolved seat) return `null` too — that is "unplaced", which every
 * caller counts rather than assigns. Padding is trimmed: these are `text` columns, and a
 * trailing space is the classic way a name stops resolving and a column silently empties.
 */
export const oblastFromName = (
  name: string | null | undefined,
): string | null => {
  if (!name) return null;
  return NAME_TO_CODE.get(name.trim()) ?? null;
};

/** A МИР / funds / election CODE → oblast code, or `null` when it is not one. */
export const oblastFromCode = (
  code: string | null | undefined,
): string | null => {
  if (!code) return null;
  const k = code.trim();
  return CODE_FOLD.get(k) ?? (CODE_SET.has(k) ? k : null);
};

/**
 * Is this one of the 28 money oblasts? `S23` and `PDV-00` FOLD to one but are not one — the
 * distinction every money layer is keyed on. Fold first with `oblastFromCode`.
 */
export const isOblastCode = (code: string): boolean => CODE_SET.has(code);

const BY_CODE = new Map(OBLASTS.map((o) => [o.code, o]));

/**
 * The census record for an oblast code, or `null` when the code is not one of the 28. Takes
 * a FOLDED code: `oblastRec("S23")` is `null`, `oblastRec(oblastFromCode("S23")!)` is the
 * capital.
 */
export const oblastRec = (code: string): OblastRec | null =>
  BY_CODE.get(code) ?? null;

/** Census 2021 population per oblast — the artifact's `pop` block and the per-capita mode. */
export const oblastPopulation = (): Record<string, number> =>
  Object.fromEntries(OBLASTS.map((o) => [o.code, o.population]));

/** Which table takes the fix when a value does not resolve — see `assertLayerCoverage`. */
export type OblastFixTable = "NAME_ALIASES" | "CODE_FOLD";

/**
 * ⚠️ TWO DIFFERENT QUESTIONS, DELIBERATELY SEPARATE — „did every value this input produced
 * resolve?" and „did all 28 oblasts receive one?".
 *
 * The first is always a fold defect and is always refused. The second is only a defect over a
 * corpus wide enough to have covered the country: over a window a few days old — which the
 * SITTING-parliament scope is, every time an election lands — an oblast with no contracts yet
 * is a measurement, and refusing there would abort `db:refresh` for being right.
 * `assertLayerCoverage` asks both; a caller with a narrow window asks only the first.
 *
 * `fixIn` is the caller's, because only the caller knows which resolver it used. Three of the
 * four inputs are name-keyed and take `NAME_ALIASES`; `fund_projects.oblast` is code-keyed
 * and takes `CODE_FOLD`. Naming the wrong one sends an operator to add `"S26": "SOF"` to a
 * table `oblastFromCode` never reads, after which the refusal repeats with the fix apparently
 * already applied.
 */
export const assertNamesResolved = (
  layer: string,
  unresolved: readonly string[],
  fixIn: OblastFixTable = "NAME_ALIASES",
): void => {
  if (!unresolved.length) return;
  const names = [...new Set(unresolved)].sort();
  throw new Error(
    `oblastCodes: ${layer} carries ${names.length} oblast value(s) this module cannot ` +
      `place: ${names.map((n) => JSON.stringify(n)).join(", ")}. Add each to ` +
      `${fixIn} in scripts/db/gen_home/oblastCodes.ts after checking which oblast it ` +
      `is — never let it fall through.`,
  );
};

/**
 * The generator's refusal (§3): every distinct value an input produced must have resolved,
 * and all 28 codes must have received a value. Throws with the offending strings rather than
 * writing a layer with a hole in it — a missing oblast renders as a zero column, and a zero
 * column is a claim.
 *
 * MEMBERSHIP is the test, never the value: an explicit `0` is a measurement and passes, an
 * absent key is „never computed" and does not. That is why `seen` may be any keyed shape.
 */
export const assertLayerCoverage = (
  layer: string,
  seen:
    | ReadonlyMap<string, unknown>
    | ReadonlySet<string>
    | Readonly<Record<string, unknown>>,
  unresolved: readonly string[],
  fixIn: OblastFixTable = "NAME_ALIASES",
): void => {
  assertNamesResolved(layer, unresolved, fixIn);
  const has = (c: string) =>
    seen instanceof Map || seen instanceof Set
      ? seen.has(c)
      : Object.prototype.hasOwnProperty.call(seen, c);
  const missing = OBLAST_CODES.filter((c) => !has(c));
  if (missing.length) {
    throw new Error(
      `oblastCodes: ${layer} produced no value for ${missing.length} of 28 oblasts ` +
        `(${missing.join(", ")}) — a hole here draws as a zero column, which is a claim ` +
        `about that oblast rather than an absence of data`,
    );
  }
};
