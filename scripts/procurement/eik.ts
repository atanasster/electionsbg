// EIK canonicalization. Bulgarian company ids come in 9-digit (parent legal
// entity) and 13-digit (branch / clone) forms. The cross-reference against
// company_politicians joins on the 9-digit canonical EIK, so
// every Contract carries that — and preserves the 13-digit form when present
// for the source link back to АОП.

export const canonicalEik = (raw: string | number | undefined): string => {
  if (raw == null) return "";
  const s = String(raw).trim();
  if (!/^\d+$/.test(s)) return "";
  // 13-digit EIK = 9-digit parent + 4-digit branch suffix. Drop the suffix.
  if (s.length === 13) return s.slice(0, 9);
  // Some sources publish 9-digit EIKs with a leading zero stripped, e.g.
  // "24695" instead of "000024695". Pad to 9 if the value is 5-8 digits.
  // Don't pad sub-5-digit values — they're noise / non-EIKs (test data, free-
  // text in the wrong field).
  if (s.length >= 5 && s.length < 9) return s.padStart(9, "0");
  if (s.length === 9) return s;
  // Some EIKs are 10 digits (rare, e.g. older BULSTAT). Keep as-is — these
  // genuinely don't deduplicate to 9 and the cross-reference will miss them.
  return s;
};

/**
 * True for an id that is a FILLER rather than an identity — what a buyer types
 * when ЦАИС demands a registration number for a supplier that has none (a foreign
 * vendor, or a natural person the form will not let them leave blank).
 *
 * ⚠ THE ONLY RULES HERE ARE ONES WITH ZERO OBSERVED FALSE POSITIVES, and the
 * temptation to add a "sensible" one has to be resisted — this is the fifth
 * discriminator this corpus has been offered and the previous four all misfired
 * (see supplier_identity.ts's header: supplierNutsCode, digit entropy,
 * many-names-per-id, and a name-shape heuristic). Measured 2026-08-18 against
 * 1,020,707 `tr_companies` rows and every `awarder_eik` in the corpus:
 *
 *   · all-same-digit (`0`, `999999999`, `9999999999`)  — 0 real matches
 *   · a consecutive ascending run (`123456789`, `1234567899`) — 0 real matches
 *
 * ⚠ WHAT IS DELIBERATELY *NOT* A RULE: "the number is small". It is the obvious
 * rule and it is WRONG. Real ids live down there — `000000210` is ДГС Гърмен, a
 * live awarder, and 29 Commerce-Registry cooperatives sit below 10000 starting at
 * `000000491` („ТПК Нов свят"). A value threshold would re-key real bodies as
 * filler. The low-number placeholders that DO exist are therefore listed
 * individually below, on evidence, not matched by shape.
 */
const PLACEHOLDER_IDS = new Set([
  // Each verified 2026-08-18: absent from all 1,020,707 `tr_companies` rows,
  // never used as an awarder anywhere in the corpus, below the lowest real id
  // observed on either side (210 as an awarder, 491 in the registry), and each
  // standing next to several mutually unrelated supplier names.
  "000000001", // 9 names: Elsevier B.V., Кларивейт, Vier Gas Transport GmbH, …
  "000000002", // 2 names, both natural persons
  "000000003", // 1 name, same shape as its two siblings
]);

/** A run of consecutive ascending digits, optionally with the last digit repeated
 *  (`1234567899`). Requires ≥8 digits so short real ids cannot reach it. */
const isAscendingRun = (s: string): boolean => {
  const core = s.replace(/(.)\1+$/, "$1");
  if (core.length < 8) return false;
  for (let i = 1; i < core.length; i++)
    if (Number(core[i]) !== Number(core[i - 1]) + 1) return false;
  return true;
};

export const isPlaceholderId = (raw: string | undefined): boolean => {
  const s = (raw ?? "").trim();
  if (!s || !/^\d+$/.test(s)) return false;
  if (PLACEHOLDER_IDS.has(s)) return true;
  // `\1*` not `\1+`: the plus form needs TWO characters, so a bare "0" escaped
  // while the doc above claimed it was covered — and `contractor_eik = '0'` was
  // pooling 5 unrelated suppliers and €693,796 in the live corpus. All 48 tests
  // passed either way, which is exactly why it survived review once.
  if (/^(\d)\1*$/.test(s)) return true;
  return isAscendingRun(s);
};

// Truthiness check that recognises empty / placeholder EIKs.
export const isValidEik = (eik: string): boolean => {
  if (!eik) return false;
  if (!/^\d+$/.test(eik)) return false;
  if (eik.length < 9 || eik.length > 13) return false;
  // Filler ids are not identities. This used to reject only the all-zero form,
  // so `000000001` (9 digits, not all zero) passed as a perfectly good EIK and
  // became a company key pooling nine unrelated suppliers — Elsevier's €32.8M and
  // Clarivate's €11.2M under one identity, rendered as a single contractor on
  // every leaderboard. `999999999` and `9999999999` passed the same way.
  //
  // Safe on the BUYER side too, which is the arm that would hurt: a rejected
  // buyer id makes normalize_eop SKIP the record outright. Measured — no
  // `awarder_eik` in the corpus matches any rule above, so this drops nothing.
  if (isPlaceholderId(eik)) return false;
  return true;
};
