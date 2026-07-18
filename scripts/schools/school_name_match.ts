// Shared school-name matching helpers. Bulgarian school / kindergarten names
// arrive in many surface forms across feeds — the МОН register ("Средно
// училище „Неофит Рилски""), the procurement awarder corpus ("СУ Неофит Рилски
// - гр. Банско"), the ДЗИ/НВО exports — for the same institution. These
// normalise a name down to a legal-form-stripped "core" so those variants join,
// and parse a settlement out of a name / address tail.
//
// Imported by:
//   - scripts/schools/match_eik.ts        (school → procurement-awarder EIK)
//   - scripts/procurement/awarder_geo_map.ts (Tier B: awarder EIK → settlement)

// Strip the legal form + quotes/punctuation/numbers so "Средно училище „Неофит
// Рилски"" and "СУ Неофит Рилски - гр. Банско" reduce to the same core.
// Long descriptive forms are safe to strip as substrings (they don't occur
// mid-word in a proper name).
const LEGAL_LONG =
  /(средно училище|основно училище|обединено училище|профилирана гимназия|професионална гимназия|начално училище|езикова гимназия|спортно училище|детска градина|гимназия|национална|профилирана|природо-математическа|природоматематическа|основно|средно)/g;
// Short abbreviations MUST be whole tokens — JS `\b` doesn't fire next to a
// Cyrillic letter, so anchor on whitespace/start/end instead. A bare global
// strip would delete "су"/"пг"/"оу"… mid-word and corrupt the name-core.
// Longer abbreviations first so "соу"/"ппмг" win over "су"/"пг".
const LEGAL_ABBR = /(^|\s)(соу|ппмг|нег|оу|су|пг|ну|ег|дг)(?=\s|$)/g;

export const nameCore = (n: string): string =>
  n
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/["„“»«'`№]/g, " ")
    .replace(/св\.?\s*св\.?/g, "свсв")
    .replace(/[.\-–,()/]/g, " ")
    .replace(/\b\d+\b/g, " ")
    .replace(LEGAL_LONG, " ")
    .replace(LEGAL_ABBR, " ")
    .replace(
      /\b(по|за|с|на|и|акад|проф|д-р|инж|с изучаване|чужди езици)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();

export const settlNorm = (a: string | undefined): string =>
  (a ?? "")
    .toUpperCase()
    // Strip a leading settlement-kind prefix. JS `\b` is ASCII-only and never
    // fires next to Cyrillic, so anchor at start and allow the no-space form
    // ("ГР.РУСЕ") — mirrors settlementName() in build_index.ts.
    .replace(/^(ГР|С|ГРАД|СЕЛО)\.?\s*/, "")
    .trim();

// Settlement parsed from an awarder-name tail: "… - гр. Русе" / "… – с. Труд".
export const nameSettl = (nm: string): string => {
  const mo = nm.match(/[-–]\s*(?:гр|с|град|село)\.?\s*([^,\-–]+)$/i);
  return mo ? settlNorm(mo[1]) : "";
};
