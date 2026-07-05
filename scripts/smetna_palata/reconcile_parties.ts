// Reconcile ЕРИК participant names → CIK party names.
//
// ЕРИК lists each participant under its own `registeredName` (e.g. "КП ГЕРБ-СДС",
// "МОРАЛ ЕДИНСТВО ЧЕСТ", "Съпротива"). The financing parser keys everything on
// the CIK party name (data/<election>/cik_parties.json — e.g. "ГЕРБ-СДС",
// "ПП МЕЧ", "Съпротива") and throws if a raw folder doesn't match one exactly.
// This module maps between the two so that every euro of campaign financing is
// attributed to a real party — i.e. "all campaign financing accounted for".
//
// Strategy (in order):
//   1. Curated override (PARTY_OVERRIDES) — for underivable acronyms/rebrands.
//   2. Exact match on the normalised "core" name (case-folded, en-dash→hyphen,
//      whitespace collapsed, a leading ПП/КП/КОАЛИЦИЯ/ПОЛИТИЧЕСКА ПАРТИЯ/ИК
//      prefix stripped from BOTH sides).
//   3. Unique prefix match — one core name is a word-boundary prefix of the
//      other (handles dropped suffixes: CIK "АЛИАНС ЗА ПРАВА И СВОБОДИ – АПС" vs
//      ЕРИК "АЛИАНС ЗА ПРАВА И СВОБОДИ"; CIK "Движение за права и свободи - ДПС"
//      vs ЕРИК "ДВИЖЕНИЕ ЗА ПРАВА И СВОБОДИ").
// If none resolve (or a prefix match is ambiguous), returns null — the caller
// surfaces the name so a human adds a PARTY_OVERRIDES entry.

import type { PartyInfo } from "@/data/dataTypes";
import { PARTY_OVERRIDES } from "./erik_config";

// Leading prefixes that decorate a legal name without changing identity.
// Longest-first so "ПОЛИТИЧЕСКА ПАРТИЯ" is tried before nothing shorter shadows.
const STRIP_PREFIXES = ["ПОЛИТИЧЕСКА ПАРТИЯ", "КОАЛИЦИЯ", "КП", "ПП", "ИК"];

const normalize = (s: string): string =>
  s
    .toUpperCase()
    .replace(/[‒–—―]/g, "-") // various dashes → hyphen
    .replace(/\s+/g, " ")
    .trim();

// normalize + strip one leading prefix token (at a word boundary).
export const coreName = (s: string): string => {
  const n = normalize(s);
  for (const p of STRIP_PREFIXES) {
    if (n === p) return n; // the whole name IS the prefix — don't blank it
    if (n.startsWith(p + " ")) return n.slice(p.length + 1).trim();
  }
  return n;
};

export type ReconcileResult = {
  registeredName: string;
  cikName: string | null;
  method: "override" | "exact" | "prefix" | null;
};

export const reconcileErikToCik = (
  registeredName: string,
  cikParties: PartyInfo[],
): ReconcileResult => {
  // 1. Curated override.
  const override = PARTY_OVERRIDES[registeredName.trim()];
  if (override) {
    const exists = cikParties.some((p) => p.name === override);
    return {
      registeredName,
      cikName: exists ? override : null,
      method: exists ? "override" : null,
    };
  }

  const eCore = coreName(registeredName);

  // 2. Exact core match (unambiguous).
  const exact = cikParties.filter((p) => coreName(p.name) === eCore);
  if (exact.length === 1) {
    return { registeredName, cikName: exact[0].name, method: "exact" };
  }
  if (exact.length > 1) {
    return { registeredName, cikName: null, method: null };
  }

  // 3. Unique word-boundary prefix match (one is a prefix of the other).
  const prefix = cikParties.filter((p) => {
    const c = coreName(p.name);
    return (
      c === eCore || c.startsWith(eCore + " ") || eCore.startsWith(c + " ")
    );
  });
  if (prefix.length === 1) {
    return { registeredName, cikName: prefix[0].name, method: "prefix" };
  }

  return { registeredName, cikName: null, method: null };
};
