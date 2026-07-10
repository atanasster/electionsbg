// Pure name-folding + fold-collision handling for the ЕЕОФ financials loader.
//
// Extracted from load_nzok_financials_pg.ts so the collision-drop logic (the most
// behaviour-changing part of the loader) can be unit-tested without a database —
// this module imports nothing DB-related. See nzok_fold.test.ts.

// Conservative name fold for the eik join: uppercase, strip everything that is
// not a letter/digit, drop legal forms + geo prefixes + the "Д-р"/title tokens,
// normalise the saint prefix (Св./Света/Свети → СВ), and collapse an immediately
// repeated token (the source appends ", гр. Трявна" → "…ТРЯВНА ТРЯВНА"). This is
// EXACT-match after normalisation — no fuzzy/substring matching, so a miss stays
// NULL rather than risking a wrong EIK.
const LEGAL = new Set([
  "ЕООД",
  "ООД",
  "АД",
  "ЕАД",
  "ЕТ",
  "АДСИЦ",
  "ДЗЗД",
  "СД",
  "КД",
]);
const GEO = new Set(["ГР", "С", "ГРАД", "ОБЛ", "ОБЩ"]);
const TITLE = new Set(["ПРОФ", "АКАД", "ДОЦ", "ИНЖ", "МР"]);
const SAINT = new Set(["СВ", "СВЕТА", "СВЕТИ", "СВЕТО", "СВЕТАТА"]);

export const fold = (s: string): string => {
  if (!s) return "";
  const raw = s
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const toks: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    let w = raw[i];
    if (w === "Д" && raw[i + 1] === "Р") {
      i++; // "Д-р" doctor title, dropped
      continue;
    }
    if (SAINT.has(w)) w = "СВ";
    if (LEGAL.has(w) || GEO.has(w) || TITLE.has(w)) continue;
    toks.push(w);
  }
  const out: string[] = [];
  for (const w of toks) if (out[out.length - 1] !== w) out.push(w);
  return out.join(" ");
};

// A header/date line that slipped into the parsed hospital list (not a facility).
export const isJunk = (name: string): boolean =>
  !fold(name) ||
  /данни към|наименование|^\s*общо|^\s*всичко|^\s*итого/i.test(name);

// The known bare-oblast era (2019Q4–2021Q3, 8 municipal blocks) drops ~116 rows
// each ≈ 928. A jump past this headroom means a NEW collision between two
// genuinely distinct hospitals in a clean quarter — the loader aborts BEFORE
// writing rather than silently erasing real rows (the failure mode the old
// whole-block skip had).
export const COLLISION_BUDGET = 1100;

/**
 * Keep only the rows whose folded name is UNIQUE within a block; drop the
 * colliding fold-groups (which lost hospital identity in parsing and can neither
 * satisfy the (quarter, ownership, name_fold) PK nor be eik-matched). Returns the
 * kept rows and the count dropped — the caller drops PER GROUP, never the whole
 * block, so it no longer discards ~120 good rows to lose 2 bad ones.
 */
export const partitionFoldCollisions = <T>(
  rows: readonly T[],
  nameOf: (row: T) => string,
): { kept: T[]; dropped: number } => {
  const count = new Map<string, number>();
  for (const r of rows) {
    const f = fold(nameOf(r));
    count.set(f, (count.get(f) ?? 0) + 1);
  }
  const kept = rows.filter((r) => count.get(fold(nameOf(r))) === 1);
  return { kept, dropped: rows.length - kept.length };
};
