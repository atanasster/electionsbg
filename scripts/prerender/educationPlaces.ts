// Build-time education rollups for the prerendered region bodies.
//
// The crawler-facing HTML for /governance/region/{oblast} promised matura data
// long before any tile rendered it (the old copy attributed it to the regional
// indicators tile, which is Eurostat/НСИ only). This is what makes the promise
// true in the static HTML as well as in the SPA.
//
// It reads the COMMITTED data/schools/index.json, so `npm run build` produces
// the education section on any checkout — deliberately unlike the /court family,
// where seo_courts.ts needs a local Postgres and silently emits nothing without
// one. The aggregation itself is the same `buildPlacePayloads` the Postgres
// loader uses, over the same committed index and the same shared rules
// (`oblastOfObshtina`, `dziSeriesOf`, `latestYearOf`), so the two agree as long
// as the index a build reads is the index the last load read. They CAN drift
// the day a deploy ships a rebuilt `dist/` against a database loaded from an
// older index — the same staleness every other `db:load:*:cloud` carries.
//
// The one thing it CANNOT carry is the "над очакваното" cut: the SES residuals
// are fitted in the loader, not stored in the index. The static body therefore
// states the level and the spread and leaves the context-adjusted reading to
// the page — which is the right split anyway, since a crawler wants the facts
// and the residual needs its explanation next to it.

import fs from "fs";
import path from "path";
import {
  buildPlacePayloads,
  buildSettlementIndex,
  resolveSchoolSettlement,
  dziSeriesOf,
  latestYearOf,
  oblastOfObshtina,
  type PlaceBlob,
  type PlaceInputSchool,
} from "../db/lib/school_places";
import {
  resolveEducationPlaceKey,
  type PlaceAliasReason,
} from "@/data/schools/educationPlaceKey";

type RawSchool = {
  id: string;
  name: string;
  /** "lng,lat" — the settlement centroid, joined against settlements.json. */
  loc?: string;
  /** "С.КАРАПЕЛИТ" — cross-checks the centroid, which МОН sometimes fills in
   *  with the município seat's rather than the school's own. */
  address?: string;
  scoresByYear: Record<string, Record<string, number>>;
  countsByYear?: Record<string, Record<string, number>>;
};

type SchoolsIndex = {
  latestYear?: number | null;
  schoolsByObshtina: Record<string, RawSchool[]>;
};

/** A place's blob plus the English municipality names and the disclosure the
 *  static body needs — the blob itself carries only Bulgarian names, and only
 *  the requested place knows whether it is reading a broader aggregate. */
export type EducationPlaceBody = {
  blob: PlaceBlob;
  /** obshtina code → English name, for the EN body. */
  namesEn: Map<string, string>;
  /** Set when these numbers are a broader place's — the EN/BG bodies must say
   *  so, exactly as the live tile does. */
  aliasReason: PlaceAliasReason;
  /** The place the numbers actually describe, ready to drop into a sentence.
   *  On an aliased page this is the PARENT — "Матура в Столична община" on
   *  Лозенец's page, not "Матура в община Лозенец", which names a place that
   *  does not exist and attributes the city's result to a район. Both
   *  languages, because the shared section builder serves both. */
  placePhrase?: { bg: string; en: string };
};

/** Reads the two committed files and returns one blob per place, or an empty
 *  map when either is absent or unreadable — a checkout without them still
 *  builds, minus the education section, which is the same degrade the sibling
 *  builders take rather than failing the whole prerender. */
export const readEducationPlaces = (
  projectRoot: string,
): Map<string, PlaceBlob> => {
  const indexFile = path.join(projectRoot, "data/schools/index.json");
  const muniFile = path.join(projectRoot, "data/municipalities.json");
  const settFile = path.join(projectRoot, "data/settlements.json");
  if (!fs.existsSync(indexFile) || !fs.existsSync(muniFile)) return new Map();

  let idx: SchoolsIndex;
  let munis: { obshtina: string; name: string; name_en?: string }[];
  let setts: Parameters<typeof buildSettlementIndex>[0] = [];
  try {
    idx = JSON.parse(fs.readFileSync(indexFile, "utf-8"));
    munis = JSON.parse(fs.readFileSync(muniFile, "utf-8"));
    // Optional: without it the settlement blobs are simply absent and those
    // pages fall back to their município, as they did before this grain. Say
    // so, though — a silent drop of a whole grain looks identical to a corpus
    // that legitimately has no settlements in it.
    if (fs.existsSync(settFile))
      setts = JSON.parse(fs.readFileSync(settFile, "utf-8"));
    else
      console.warn(
        "education prerender: no data/settlements.json — settlement bodies omitted",
      );
  } catch (e) {
    console.warn(
      `education prerender: unreadable source, section omitted (${e})`,
    );
    return new Map();
  }
  const muniNames = new Map(munis.map((m) => [m.obshtina, m.name]));
  const settlements = buildSettlementIndex(setts);

  const schools: PlaceInputSchool[] = [];
  const years = new Set<number>();
  for (const [obshtina, recs] of Object.entries(idx.schoolsByObshtina ?? {})) {
    for (const rec of recs) {
      const settlement = resolveSchoolSettlement(
        settlements,
        obshtina,
        rec.loc,
        rec.address,
      );
      const series = dziSeriesOf(rec.scoresByYear, rec.countsByYear);
      const last = series[series.length - 1] ?? null;
      if (last) years.add(last.year);
      schools.push({
        id: rec.id,
        name: rec.name,
        obshtina,
        obshtinaName:
          muniNames.get(obshtina) ??
          (obshtina === "SOF00" ? "Столична община" : obshtina),
        oblast: oblastOfObshtina(obshtina),
        ekatte: settlement?.ekatte ?? null,
        settlementName: settlement?.name ?? null,
        latestYear: last?.year ?? null,
        latestScore: last?.score ?? null,
        latestN: last?.n ?? null,
        series,
        // No regression fields: they are the loader's, and a static body
        // states the level and the spread, never a residual it did not fit.
      });
    }
  }

  // The national series is only needed for the tick the tiles draw; the static
  // body quotes the place's own numbers, so an empty one is correct here.
  // Município blobs come along for free and go unused here; the region bodies
  // are the only consumer today, and filtering them out would fork the builder.
  return buildPlacePayloads(schools, latestYearOf(idx.latestYear, schools), []);
};

/** Display names for the code the blob is keyed by, per language. Optional —
 *  without them the section falls back to the caller's own label, which is
 *  right for an un-aliased place and wrong for an aliased one. */
export type PlaceNames = { bg?: Map<string, string>; en?: Map<string, string> };

/** Everything a place body needs for one code, alias resolved the same way the
 *  live page resolves it — so `/governance/region/S24` and `/governance/S2309`
 *  both carry Столична община's numbers AND say so, in the static HTML as well
 *  as in the SPA. Undefined when the place has no blob (a diaspora МИР, or a
 *  checkout without the index). */
export const educationBodyFor = (
  places: Map<string, PlaceBlob>,
  names: PlaceNames,
  code: string,
): EducationPlaceBody | undefined => {
  const { key, reason } = resolveEducationPlaceKey(code);
  const blob = places.get(key);
  if (!blob) return undefined;
  return {
    blob,
    namesEn: names.en ?? new Map(),
    aliasReason: reason,
    placePhrase: placePhraseOf(key, blob.grain, names),
  };
};

/** "Столична община" / "община Доспат" / "област Смолян", and their English
 *  forms. Sofia city is a fixed phrase with the adjective first; every other
 *  place takes the noun first. Undefined when no name is known — the caller's
 *  own label is then used, which is correct for a place reading its own blob. */
const placePhraseOf = (
  code: string,
  grain: PlaceBlob["grain"],
  names?: PlaceNames,
): { bg: string; en: string } | undefined => {
  if (code === "SOF00" || code === "S23")
    return { bg: "Столична община", en: "Sofia city" };
  const bg = names?.bg?.get(code);
  const en = names?.en?.get(code) ?? bg;
  if (!bg || !en) return undefined;
  if (grain === "settlement")
    // The settlement's own marker ("гр." / "с.") comes with the name, so the
    // phrase is the name itself — "Матура в с. Баня", not "в община с. Баня".
    return { bg, en };
  return grain === "muni"
    ? { bg: `община ${bg}`, en: `${en} municipality` }
    : { bg: `област ${bg}`, en: `${en} province` };
};

/** obshtina code → name, both languages, from ONE parse of the committed file.
 *  Two separate readers meant municipalities.json was parsed twice per route
 *  builder, and three builders now call in. */
export const readMuniNames = (projectRoot: string): PlaceNames => {
  const muniFile = path.join(projectRoot, "data/municipalities.json");
  const empty = {
    bg: new Map<string, string>(),
    en: new Map<string, string>(),
  };
  if (!fs.existsSync(muniFile)) return empty;
  try {
    const munis = JSON.parse(fs.readFileSync(muniFile, "utf-8")) as {
      obshtina: string;
      name: string;
      name_en?: string;
    }[];
    return {
      bg: new Map(munis.map((m) => [m.obshtina, m.name])),
      en: new Map(munis.map((m) => [m.obshtina, m.name_en || m.name])),
    };
  } catch {
    return empty;
  }
};
