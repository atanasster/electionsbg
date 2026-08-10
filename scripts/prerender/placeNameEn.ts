// English place name for a `person_role` place code, for the /en prerendered person pages.
//
// The /en person mirrors used to print the BULGARIAN place name inside an English sentence
// — "Chief architect in Ивайловград" — because the prerender card carries only the Bulgarian
// label (localOfficePhrase.ts documented exactly this hole). That is not merely ugly: the /en
// title then carried the SAME Cyrillic strings as its /bg twin, so the two mirrors competed
// for one Bulgarian query and Google returned the English one for „Иван Георгиев Такучев".
//
// Both place files already carry a curated `name_en` (294/294 municipalities, 5,364/5,364
// settlements), and the curation is worth preferring over a mechanical transliteration: it
// title-cases multi-word names the way a place name is written ("Beli breg", not "Beli
// Breg"), and it keeps the two real exonyms ("Европа" → "Europe", "Океания" → "Oceania").
// 437 settlement names and 19 municipality names differ from the transliterated form.
//
// Transliteration is the FALLBACK, not the rule — it agrees with `name_en` on the other
// 4,927 settlements, so a code missing from the dictionary (one today: ekatte 63183,
// "с. Рудник") degrades to the same spelling the curated file would have given, rather than
// dropping back to Cyrillic.

import fs from "fs";
import path from "path";
import { transliterateName } from "@/data/candidates/transliterateName";
import { SYNTHETIC_OBSHTINA_LABELS } from "@/lib/obshtinaPlace";
import { stripSettlementMarker } from "./localOfficePhrase";

// A settlement place code is the bare EKATTE ("53727"); everything else is an obshtina code
// ("HKV11", the 24 Sofia `S2***` районa) or the synthetic "SFO_CITY". The two namespaces
// cannot collide — one is all digits, the other never is — so one flat map serves both.
type MuniRow = { obshtina: string; name: string; name_en?: string };
type SettlementRow = { ekatte: string; name: string; name_en?: string };

const readJson = <T>(file: string): T[] => {
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as T[];
  } catch {
    return [];
  }
};

/** Builds the code→English-name dictionary once per prerender run. Missing files yield an
 *  empty map rather than throwing: every lookup then falls through to transliteration, which
 *  is a worse spelling but never a Cyrillic one. */
export const buildPlaceNameEn = (
  projectRoot: string,
): ((
  code: string | null | undefined,
  bgLabel: string | null,
) => string | null) => {
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
