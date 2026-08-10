// English place name for a `person_role` place code, for the /en prerendered person pages.
//
// The /en person mirrors used to print the BULGARIAN place name inside an English sentence
// — "Chief architect in Ивайловград" — because the prerender card carries only the Bulgarian
// label (localOfficePhrase.ts documented exactly this hole). That is not merely ugly: the /en
// title then carried the SAME Cyrillic strings as its /bg twin, so the two mirrors competed
// for one Bulgarian query and Google returned the English one for „Иван Георгиев Такучев".
//
// Both place files already carry a curated `name_en`, and the curation is worth preferring
// over a mechanical transliteration: it title-cases multi-word names the way a place name is
// written ("Beli breg", not "Beli Breg"), and it keeps the two real exonyms ("Европа" →
// "Europe", "Океания" → "Oceania"). Transliteration is the FALLBACK, not the rule — it agrees
// with `name_en` on the large majority of rows, so a code missing from the dictionary degrades
// to the same spelling the curated file would have given, rather than dropping back to
// Cyrillic. Every coverage figure that used to be quoted here is now ASSERTED in
// placeNameEn.test.ts ("pins the coverage this module's fallback assumes"), so a stale number
// fails a test instead of misleading the next reader.
//
// THIS IS A SECOND PRODUCER of a label `place_dim` also owns, against the explicit "keep it
// that way" in scripts/person/places.ts. It exists because the prerender is a Node build step
// with no database, while the runtime reads `place_dim.name_en` through 082_person_api.sql —
// so the SAME page resolves the English place name twice, once per side of hydration. The
// cross-check in placeNameEn.test.ts fails if the two dictionaries ever disagree; the real fix
// is `pd.name_en` on the prerender card (emit_prerender_slugs.ts already LEFT JOINs place_dim),
// which takes effect only at the next `person:slugs:cloud` mint.

import fs from "fs";
import path from "path";
import { transliterateName } from "@/data/candidates/transliterateName";
import { SYNTHETIC_OBSHTINA_LABELS } from "@/lib/obshtinaPlace";
import { stripSettlementMarker } from "./localOfficePhrase";

// A settlement place code is usually the bare EKATTE ("53727") and an obshtina code usually is
// not ("HKV11", the 24 Sofia `S2***` районa, the synthetic "SFO_CITY") — but the namespaces DO
// overlap, so "all digits vs never digits" is not a safe justification for one flat map. Both
// files carry the abroad-voting pseudo-places: `SA` is Южна Америка as an obshtina and
// Саудитска Арабия as a settlement, and `AF` is Африка vs Афганистан. Settlements are loaded
// SECOND and win, which is the right precedence for this consumer — a `person_role` place code
// is an obshtina, an EKATTE or an S2*** район, never a continent — and no person card reaches
// either code today. A future consumer over a broader place set must key on kind, not code.
type MuniRow = { obshtina: string; name: string; name_en?: string };
type SettlementRow = { ekatte: string; name: string; name_en?: string };

/** `(placeCode, bulgarianLabel) → English name`, or null when there is no place at all. */
export type PlaceNameEn = (
  code: string | null | undefined,
  bgLabel: string | null,
) => string | null;

// Unlike load_place_dim_pg.ts — which reads the same two files and THROWS, on the grounds that
// both are tracked in git so an absent one is a broken checkout — this degrades, because a
// prerender that fails outright ships no pages at all. But it degrades LOUDLY: the fallback is
// valid Latin and passes every "no Cyrillic" gate, so an unread file would silently re-spell
// hundreds of places in indexed titles with nothing red anywhere.
const readJson = <T>(file: string): T[] => {
  if (!fs.existsSync(file)) {
    console.warn(
      `placeNameEn: ${file} missing — English place names fall back to transliteration`,
    );
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as T[];
  } catch (e) {
    console.warn(
      `placeNameEn: ${file} unparseable (${(e as Error).message}) — falling back to transliteration`,
    );
    return [];
  }
};

/** Builds the code→English-name dictionary once per prerender run. */
export const buildPlaceNameEn = (projectRoot: string): PlaceNameEn => {
  const byCode = new Map<string, string>();
  for (const m of readJson<MuniRow>(
    path.join(projectRoot, "data/municipalities.json"),
  ))
    if (m.name_en) byCode.set(m.obshtina, m.name_en);
  for (const s of readJson<SettlementRow>(
    path.join(projectRoot, "data/settlements.json"),
  ))
    if (s.name_en) byCode.set(s.ekatte, s.name_en);
  for (const [code, label] of Object.entries(SYNTHETIC_OBSHTINA_LABELS))
    byCode.set(code, label.en);

  return (code, bgLabel) => {
    if (!bgLabel) return null;
    const hit = code ? byCode.get(code) : undefined;
    return hit ?? transliterateName(stripSettlementMarker(bgLabel));
  };
};
