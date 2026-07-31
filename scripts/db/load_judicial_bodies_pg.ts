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
  const geo = new Map<string, { lng: number; lat: number }>();
  // Reported per SOURCE, because "the register misspelt it" and "the dictionary does not
  // speak court_load's abbreviations" are different problems with different fixes.
  const unresolved = { magistrate: [] as string[], court_load: [] as string[] };

  const take = (
    raw: string,
    source: keyof typeof unresolved,
    opts: {
      tier?: JudicialTier;
      lng?: number | null;
      lat?: number | null;
    } = {},
  ) => {
    const body = resolveJudicialBody(raw, { vocab, tier: opts.tier });
    if (!body) {
      unresolved[source].push(raw);
      return;
    }
    if (!bodies.has(body.bodyCode)) bodies.set(body.bodyCode, body);
    aliases.set(foldJudicialName(raw, vocab), body.bodyCode);
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

  // withTx rolls back on throw; the hand-rolled BEGIN/COMMIT this replaced would have
  // left both tables truncated if the second COPY failed.
  await withTx(async (c) => {
    // One statement for both tables, so the FK is never transiently violated.
    //
    // TRUNCATE takes an AccessExclusiveLock held to COMMIT, and `judicial_body` is
    // on the /person serving path (082 joins it for a magistrate's court).
    // Acceptable ONLY because the table is ~283 rows — the reload is far under the
    // serving pool's 2 s lock_timeout — and this loader is operator-run, never in
    // a request. If it grows, switch to a stage merge (scripts/db/lib/stage_merge.ts).
    await c.query("TRUNCATE judicial_body_alias, judicial_body");
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
