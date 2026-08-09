// WHO MAY ACTUALLY APPLY — derived from a source's own eligibility prose.
//
// WHY THIS EXISTS AS ONE SHARED MODULE. Measured on ИСУН's register (2026-08-08): of 55 open
// procedures, most are for *конкретни бенефициенти* — `Техническа помощ` ×4, `Бюджетни линии`,
// rail and road TEN-T, `Морско наблюдение`, border-police objectives, municipal desegregation.
// Publishing those undifferentiated to a small business recreates the exact complaint from the
// Facebook group this whole module is built from („от бизнес с чушкопеци до баничарници на
// Луната"). The facet is what keeps them out of the default view.
//
// `unknown` IS A REAL ANSWER, not a fallback to be minimised. It renders „не е уточнено" and is
// excluded from the „за бизнес" view. Being honestly unhelpful beats being confidently wrong
// about who is eligible — nothing here is a legal determination, and the UI says so.
//
// TWO MATCHING TRAPS, both found in review of the first (per-parser) copy of this logic:
//   * OVER-matching: /стопан/ also matches „не-СТОПАН-ска цел", so every NGO-only row was
//     tagged `farmer`. Bulgarian compounds make bare substrings dangerous.
//   * UNDER-matching: /физически лица/ misses „физически И ЮРИДИЧЕСКИ лица", which is the
//     WIDEST eligibility statement in the ДФЗ schedule — so the one intervention open to
//     everybody resolved to `unknown`.

import type { Audience } from "./types";

/** Ordered rules. Each is (regex, facet); every match contributes, so a row open to farmers
 *  and processors gets both. Negative lookarounds carry the anti-over-match guards. */
const RULES: { re: RegExp; facet: Audience }[] = [
  // FARMER. „земеделски стопани", „фермер". Guarded against „нестопанск" — the substring
  // „стопан" alone matches it, which is how NGO rows became farms.
  {
    re: /земеделск|фермер|(?<!не)стопанств|земеделски стопан/u,
    facet: "farmer",
  },
  // BUSINESS. Enterprises of any size, incl. the МСП abbreviation and „преработватели".
  {
    re: /предприятия|мсп|микро|малки и средни|фирм|преработвател|търговск/u,
    facet: "business",
  },
  { re: /общин(?:а|и|ите)\b|кметств/u, facet: "municipality" },
  { re: /нестопанск|юлнц|сдружени|фондаци|неправителствен/u, facet: "ngo" },
  // INDIVIDUAL. „физически лица" and the wider „физически и юридически лица".
  {
    re: /физически(?:\s+и\s+юридически)?\s+лица|граждани/u,
    facet: "individual",
  },
  {
    re: /висши училищ|научни организаци|гимнази|училищ|детска градина|читалищ/u,
    facet: "school",
  },
  // INSTITUTION — the tier that was previously UNREACHABLE, and the one that matters most for
  // keeping institutional procedures out of a business's view. Named beneficiaries: ministries,
  // agencies, state bodies, and the two title patterns that are always internal.
  {
    re: /министерств|агенци|държавн(?:и|а)\s+(?:орган|структур|предприят)|бабх|дирекци|техническа помощ|бюджетни линии|конкретни бенефициенти/u,
    facet: "institution",
  },
];

/** Free-text eligibility (and, optionally, the call's title) → the facets it implies.
 *
 *  The TITLE is consulted because ИСУН's procedure page publishes no eligibility text at all —
 *  „Техническа помощ" and „Бюджетни линии" are recognisable only from the title, and they are
 *  precisely the rows a reader must not be shown as opportunities. */
export const deriveAudience = (
  beneficiaries: string | null | undefined,
  title?: string | null,
): Audience[] => {
  const hay = `${beneficiaries ?? ""} ${title ?? ""}`.toLowerCase();
  if (!hay.trim()) return ["unknown"];
  const out = new Set<Audience>();
  for (const { re, facet } of RULES) if (re.test(hay)) out.add(facet);
  // A row that is BOTH institution-titled and otherwise unmatched is institutional; a row that
  // matched something real keeps its real facets rather than being widened by a stray keyword.
  return out.size ? [...out] : ["unknown"];
};
