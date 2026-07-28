// Display labels for the typed `person_role.place_*` columns (migration 115).
//
// The resolver materialises the label at write time rather than leaving consumers to
// join a dictionary: every code→name hook in the app is keyed on the SELECTED ELECTION
// (src/data/municipalities/*, src/data/regions/*) and a /person page is not
// election-scoped, so there is no cheap client-side lookup to reach for.
//
// Both maps are built from files already in the repo — data/municipalities.json is the
// same file scripts/officials/municipality_join.ts resolves against — so a label can
// never drift from the code it names.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SYNTHETIC_OBSHTINA_LABELS } from "../../src/lib/obshtinaPlace";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

export type PlaceLabel = { bg: string; en: string };

type MunicipalityRow = {
  obshtina: string;
  name: string;
  name_en: string | null;
};

/** obshtina code → { bg, en }. Covers every real EKATTE obshtina from
 *  data/municipalities.json plus the synthetic city-wide codes that file cannot
 *  carry (see SYNTHETIC_OBSHTINA_LABELS). Empty when the file is absent, so a fresh
 *  clone degrades to unlabelled places rather than throwing. */
export function obshtinaLabels(): Map<string, PlaceLabel> {
  const m = new Map<string, PlaceLabel>();
  const p = path.join(REPO_ROOT, "data/municipalities.json");
  // Degrading to an unlabelled map is deliberate (a fresh clone must still resolve), but
  // it must not be SILENT: the typed places would still satisfy their CHECK with NULL
  // labels, and the only symptom would be a blank badge on /person.
  if (!fs.existsSync(p))
    console.warn(
      `places: ${p} missing — typed places will be written without display labels`,
    );
  if (fs.existsSync(p)) {
    const rows = JSON.parse(fs.readFileSync(p, "utf8")) as MunicipalityRow[];
    for (const r of rows)
      if (r.obshtina && r.name)
        m.set(r.obshtina, { bg: r.name, en: r.name_en || r.name });
  }
  for (const [code, label] of Object.entries(SYNTHETIC_OBSHTINA_LABELS))
    m.set(code, label);
  return m;
}
