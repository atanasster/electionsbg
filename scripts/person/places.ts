// Display labels for the typed place namespaces — the source of place_dim (migration 117).
//
// THESE MAPS BUILD place_dim (117). They used to be called by resolve_persons, which
// materialised the label onto person_role because every code→name hook in the app is keyed
// on the SELECTED ELECTION (src/data/municipalities/*, src/data/regions/*) and a /person
// page is not election-scoped, so there was no dictionary to join. place_dim IS that
// dictionary now: scripts/db/load_place_dim_pg.ts fills its obshtina/mir rows from exactly
// these two functions, and 082_person_api.sql joins it for the label.
//
// So the label has ONE producer again rather than two copies. Keep it that way: a caller
// that re-derives a name from data/municipalities.json instead of coming through here would
// silently turn "Пловдив-град" into "Пловдив".
//
// Both maps are built from files already in the repo — data/municipalities.json is the
// same file scripts/officials/municipality_join.ts resolves against — so a label can
// never drift from the code it names.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SYNTHETIC_OBSHTINA_LABELS } from "../../src/lib/obshtinaPlace";
import { OBLAST_NAME } from "../../src/lib/regionalOblast";
import { MIR_CODES } from "../../src/data/parliament/nsFolders";

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

// The МИР codes that are NOT simply their oblast. There are 31 МИР against 28 statistical
// oblasts, and the difference is the whole reason `place_kind` is 'mir' rather than
// 'oblast': Sofia city elects from three separate constituencies, and Пловдив splits into
// град (МИР 16) and област (МИР 17). Naming them by their oblast would merge distinct
// electorates on the page.
const MIR_ONLY_LABELS: Record<string, PlaceLabel> = {
  S23: { bg: "София 23 МИР", en: "Sofia 23rd MMC" },
  S24: { bg: "София 24 МИР", en: "Sofia 24th MMC" },
  S25: { bg: "София 25 МИР", en: "Sofia 25th MMC" },
  "PDV-00": { bg: "Пловдив-град", en: "Plovdiv (city)" },
  PDV: { bg: "Пловдив-област", en: "Plovdiv (province)" },
  SFO: { bg: "София-област", en: "Sofia (province)" },
};

/** МИР code → { bg, en } for all 31 electoral constituencies. Everything that is not in
 *  MIR_ONLY_LABELS coincides with its oblast and is named from the canonical map, so the
 *  two can never drift apart for the 25 codes they share. */
export function mirLabels(): Map<string, PlaceLabel> {
  const m = new Map<string, PlaceLabel>();
  // Driven by MIR_CODES, so the label set is exactly the constituency set by
  // construction — not "the oblast map minus a hard-coded skip", which was equal to it
  // only by coincidence and unpinned in both directions.
  for (const code of MIR_CODES) {
    const label = MIR_ONLY_LABELS[code] ?? OBLAST_NAME[code];
    if (label) m.set(code, label);
  }
  return m;
}
