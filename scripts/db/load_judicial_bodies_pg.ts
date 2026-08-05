// Build the canonical judicial-institution dimension (schema: 116_judicial_body.sql)
// from the two name sources already in Postgres, and record every surface form that
// folds onto each body.
//
// INPUTS (both already loaded — this reads the DB, it fetches nothing):
//   magistrate.court  — 975 free-text strings from the ИВСС declarations, the reason
//                       this dimension exists.
//   court_load.name   — the courts' own tier + seat + geo, the only place those live.
//
// ORDER. Must run AFTER db:load:magistrates:pg and db:load:court-load:pg, and BEFORE
// db:resolve:persons, which reads judicial_body_alias to give every magistrate role its
// typed place. db:refresh sequences it; the cloud side needs
// `npm run db:load:judicial-bodies:pg:cloud` run by hand, like every other loader.
//
// NEVER GUESSES. A string the parser cannot classify is REPORTED and left without a
// body. A wrong court on a named magistrate's public profile is a misstatement about a
// real person, so an absent badge is the correct failure.
//
// It DOES correct hand-typed spelling slips, within a closed lexicon and only when the
// intended word is unambiguous (scripts/judiciary/judicialBodies.ts, "Typo tolerance").
// Every correction is printed below alongside the name it produced, because a correction
// the operator cannot see is indistinguishable from a guess.
//
// Run: `npm run db:load:judicial-bodies:pg` (local) / `:cloud` (Cloud SQL proxy).

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec, allRows, withTx, end } from "./lib/pg";
import { copyRows } from "./lib/copy";
import {
  resolveJudicialBody,
  foldJudicialName,
  placeVocabulary,
  type JudicialBody,
  type JudicialTier,
  type PlaceVocabulary,
} from "../judiciary/judicialBodies";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const SCHEMA = path.join(ROOT, "scripts/db/schema/pg/116_judicial_body.sql");
const MUNICIPALITIES = path.join(ROOT, "data/municipalities.json");

type MunicipalityRow = { obshtina: string; name: string };

/** Settlement name → app obshtina code, for the body's seat. Court seats are municipal
 *  centres, so a plain name match covers them; anything unmatched keeps a NULL code and
 *  still carries its `place` name. */
const seatCodes = (): {
  codes: Map<string, string>;
  vocab: PlaceVocabulary;
} => {
  const m = new Map<string, string>();
  if (!existsSync(MUNICIPALITIES))
    throw new Error(
      `${MUNICIPALITIES} is missing — it is the settlement vocabulary the parser ` +
        `validates every seat against, so without it every misspelt court would mint ` +
        `a body of its own`,
    );
  const rows = JSON.parse(
    readFileSync(MUNICIPALITIES, "utf8"),
  ) as MunicipalityRow[];
  // First code wins: data/municipalities.json carries one row per obshtina, and the few
  // repeated settlement names (two Бяла) are a genuine ambiguity we do not resolve here.
  for (const r of rows) if (!m.has(r.name)) m.set(r.name, r.obshtina);
  // The capital is not in that file — it is the SYNTHETIC city-wide code (see
  // src/lib/obshtinaPlace.ts), and it seats every national body plus the СГС/СРС/СГП
  // family, so leaving it unmapped would strand a quarter of the dimension.
  // София-област has no obshtina of its own — its administrative court sits in the
  // capital, like every other body seated in "София".
  for (const name of ["София", "София-град", "София-област"])
    m.set(name, "SFO_CITY");
  // The vocabulary is the settlement names ONLY — the synthetic Sofia aliases above are
  // for the code lookup, not for validating that a seat is a real place.
  return {
    codes: m,
    vocab: placeVocabulary([...rows.map((r) => r.name), "София"]),
  };
};

// court_load's folder tiers, in the parser's vocabulary. Only the two that disambiguate
// an abbreviation matter (`АС` is appellate there, administrative in the ИВСС register).
const COURT_LOAD_TIER: Record<string, JudicialTier | undefined> = {
  apelativni: "апелативен",
  administrativni: "административен",
  okrazhni: "окръжен",
  rs_oblast: "районен",
  rs_izvan: "районен",
  voenni: "военен",
};

const main = async (): Promise<void> => {
  await exec(readFileSync(SCHEMA, "utf8"));

  const [magistrates, courts] = await Promise.all([
    allRows<{ court: string }>(
      `SELECT DISTINCT court FROM magistrate WHERE court IS NOT NULL AND court <> ''`,
    ),
    allRows<{
      name: string;
      tier: string;
      place: string | null;
      lng: number | null;
      lat: number | null;
    }>(
      `SELECT DISTINCT ON (name) name, tier, place, lng, lat FROM court_load
        ORDER BY name, year DESC`,
    ).catch(() => []),
  ]);

  const { codes, vocab } = seatCodes();

  const bodies = new Map<string, JudicialBody>();
  const aliases = new Map<string, string>();
  // The RAW strings, un-folded — see judicial_body_source_name in 116. SQL has
  // no access to foldJudicialName, so this is how the serving function joins
  // court_load.name (and magistrate.court) to a body.
  const sourceNames = new Map<string, string>();
  const geo = new Map<string, { lng: number; lat: number }>();
  // Reported per SOURCE, because "the register misspelt it" and "the dictionary does not
  // speak court_load's abbreviations" are different problems with different fixes.
  const unresolved = { magistrate: [] as string[], court_load: [] as string[] };
  // Every name that only resolved because a spelling slip was corrected, with the slip.
  const corrected: { raw: string; name: string; fixes: string[] }[] = [];

  const take = (
    raw: string,
    source: keyof typeof unresolved,
    opts: {
      tier?: JudicialTier;
      lng?: number | null;
      lat?: number | null;
    } = {},
  ) => {
    const fixes: string[] = [];
    const body = resolveJudicialBody(raw, {
      vocab,
      tier: opts.tier,
      onFix: (f) => fixes.push(`${f.from} → ${f.to}`),
    });
    if (!body) {
      // Carry the corrections into the unresolved line rather than dropping them. "Did
      // the typo layer mangle this before it failed?" is the first question an unresolved
      // name raises, and without this the answer is unavailable: a string that was
      // corrected and still failed looks identical to one nothing touched.
      unresolved[source].push(
        fixes.length ? `${raw}   [corrected: ${fixes.join(", ")}]` : raw,
      );
      return;
    }
    if (fixes.length) corrected.push({ raw, name: body.name, fixes });
    if (!bodies.has(body.bodyCode)) bodies.set(body.bodyCode, body);
    aliases.set(foldJudicialName(raw, vocab), body.bodyCode);
    sourceNames.set(raw, body.bodyCode);
    // Geo only ever comes from court_load, and only for courts. BOTH coordinates or
    // neither — half a pair puts a court in the Gulf of Guinea.
    if (opts.lat != null && opts.lng != null && !geo.has(body.bodyCode))
      geo.set(body.bodyCode, { lng: opts.lng, lat: opts.lat });
  };

  for (const r of magistrates) take(r.court, "magistrate");
  for (const c of courts)
    take(c.name, "court_load", {
      tier: COURT_LOAD_TIER[c.tier],
      lng: c.lng,
      lat: c.lat,
    });

  const bodyRows = [...bodies.values()].map((b) => {
    const g = geo.get(b.bodyCode);
    return [
      b.bodyCode,
      b.name,
      b.kind,
      b.tier,
      b.place,
      b.place ? (codes.get(b.place) ?? null) : null,
      g?.lng ?? null,
      g?.lat ?? null,
    ];
  });
  const aliasRows = [...aliases].map(([norm, code]) => [norm, code]);
  const sourceRows = [...sourceNames].map(([name, code]) => [name, code]);

  // withTx rolls back on throw; the hand-rolled BEGIN/COMMIT this replaced would have
  // left both tables truncated if the second COPY failed.
  await withTx(async (c) => {
    // One statement for both tables, so the FK is never transiently violated.
    //
    // TRUNCATE takes an AccessExclusiveLock held to COMMIT, and `judicial_body` is
    // on the /person serving path (082 joins it for a magistrate's court).
    // Acceptable ONLY because the table is ~284 rows — the reload is far under the
    // serving pool's 2 s lock_timeout — and this loader is operator-run, never in
    // a request. If it grows, switch to a stage merge (scripts/db/lib/stage_merge.ts).
    await c.query(
      "TRUNCATE judicial_body_source_name, judicial_body_alias, judicial_body",
    );
    await copyRows(
      c,
      "judicial_body",
      [
        "body_code",
        "name",
        "kind",
        "tier",
        "place",
        "place_code",
        "lng",
        "lat",
      ],
      bodyRows,
    );
    await copyRows(
      c,
      "judicial_body_alias",
      ["alias_norm", "body_code"],
      aliasRows,
    );
    await copyRows(
      c,
      "judicial_body_source_name",
      ["source_name", "body_code"],
      sourceRows,
    );
  });

  const byKind = [...bodies.values()].reduce<Record<string, number>>(
    (a, b) => ({ ...a, [b.kind]: (a[b.kind] ?? 0) + 1 }),
    {},
  );
  const seated = bodyRows.filter((r) => r[5] != null).length;
  console.log(
    `judicial bodies: ${bodies.size} (${Object.entries(byKind)
      .map(([k, n]) => `${k} ${n}`)
      .join(", ")}); ${seated}/${bodies.size} seats resolved to an obshtina; ` +
      `${aliases.size} alias(es)`,
  );
  if (corrected.length) {
    // The audit trail for the typo layer. Printed in full and BEFORE the unresolved
    // block, because this is the list where a wrong answer hides — an unresolved name is
    // merely absent, a mis-corrected one is a named person put in the wrong institution.
    const uniq = [...new Map(corrected.map((c) => [c.raw, c])).values()].sort(
      (a, b) => a.raw.localeCompare(b.raw, "bg"),
    );
    console.log(
      `  ${uniq.length} name(s) resolved through a spelling correction — check them:`,
    );
    for (const c of uniq)
      console.log(`    ${c.raw}  →  ${c.name}   [${c.fixes.join(", ")}]`);
  }
  for (const [source, names] of Object.entries(unresolved)) {
    if (!names.length) continue;
    const uniq = [...new Set(names)].sort();
    console.log(
      `  ${uniq.length} ${source} institution name(s) left unresolved — no body ` +
        `assigned, so those roles keep a NULL place rather than a guessed court:`,
    );
    // Printed in FULL rather than truncated: this list IS the work-list for extending
    // the dictionary, and a truncated one quietly normalises its own tail.
    for (const n of uniq) console.log(`    ${n}`);
  }
};

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(end);
