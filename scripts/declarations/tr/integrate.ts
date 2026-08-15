/**
 * Phase 5 — integrate the reconstructed TR SQLite into the public/ outputs.
 *
 * ONE output now (it had two — see (2) below):
 *
 *   1. Augment `public/parliament/companies-index.json`. For every entry whose
 *      declared name matches a row in `companies`, attach a `tr` object:
 *      { uic, legalForm, seat, status, currentOfficers[], currentOwners[] }.
 *      Officers are flagged with `matchedMpId` when their normalized name
 *      matches an MP in `public/parliament/index.json` (catches the case where
 *      a sitting MP's spouse / family member runs a company the MP declared).
 *
 *   (2) — REMOVED. This module used to also write
 *      `public/parliament/mp-management/{mpId}.json` with a hand-built high/medium confidence
 *      model over name matches. `mp_tr_roles` (migration 150) serves that from the gated
 *      `person_role` set instead, so a name the Commerce Registry says belongs to more than
 *      one human is REFUSED rather than graded. See the tombstone at the phase's old site.
 *
 * If the SQLite isn't present (i.e. the user hasn't run Phase 3+4 yet), this
 * module logs a warning and returns — `npm run prod` should still succeed.
 */

import fs from "fs";
import path from "path";
import { compactJson } from "../formats";
import { DatabaseSync } from "node:sqlite";
import type {
  CompaniesIndexFile,
  CompanyIndexEntry,
} from "../build_company_index";
import type {
  TrCompanyEnrichment,
  TrCompanyOfficer,
} from "../../../src/data/dataTypes";

// COMMON_NAME_TR_ROWS + applyNameFrequencyGuard were REMOVED with phase 2 below — the
// registry now counts people per name fold directly (tr_name_fold_people, 148), so the
// officer-row proxy they implemented is not a weaker version of that measurement, it is a
// different and wrong one. See the phase-2 tombstone.

// ---- Inputs ----------------------------------------------------------------

type MpIndexEntry = {
  id: number;
  name: string;
  normalizedName: string;
  /** Shape from public/parliament/index.json — `{ code, name }` (e.g.
   * `{ code: "03", name: "ВАРНА" }`) or null. */
  currentRegion: { code: string; name: string } | null;
  currentPartyGroup: string | null;
  isCurrent: boolean;
  /** NS terms the MP held a mandate in. Empty for non-seated candidates that
   * parliament.bg's `--all` scrape pulls in alongside actual MPs. */
  nsFolders: string[];
  /** Local photo path; empty string when parliament.bg returns the blank
   * silhouette (typically for non-seated candidate profiles). Used as one of
   * the cohort signals for distinguishing real MPs from electoral candidates. */
  photoUrl: string;
};
type ParliamentIndex = {
  scrapedAt: string;
  total: number;
  mps: MpIndexEntry[];
};

// ---- Helpers ---------------------------------------------------------------

const QUOTES = /["“”„«»‟″〞〟＂']/g;

// Bulgarian legal-form labels used in declarations (Cyrillic) vs the codes the
// TR open-data dump uses on the deed-level $.LegalForm (Latin abbreviations).
// Folding both to the same canonical token lets us join the two by equality.
const LEGAL_FORM_TO_CANONICAL: Record<string, string> = {
  // Cyrillic
  ООД: "OOD",
  ЕООД: "EOOD",
  АД: "AD",
  ЕАД: "EAD",
  КД: "KD",
  КДА: "KDA",
  СД: "SD",
  ЕТ: "ET",
  // Latin (already canonical, but include so the mapping is idempotent)
  OOD: "OOD",
  EOOD: "EOOD",
  AD: "AD",
  EAD: "EAD",
  KD: "KD",
  KDA: "KDA",
  SD: "SD",
  ET: "ET",
};

const canonicalLegalForm = (raw: string | null | undefined): string => {
  if (!raw) return "";
  const trimmed = raw.replace(QUOTES, "").trim().toUpperCase();
  return LEGAL_FORM_TO_CANONICAL[trimmed] ?? trimmed;
};

/** Strong normalization for fingerprinting:
 *   - strip all quote variants
 *   - collapse hyphen variants (`-`, ` - `, ` -`, `- `) to a single `-`
 *   - collapse whitespace
 *   - uppercase
 * Idempotent. */
const normalizeForFingerprint = (s: string): string =>
  s
    .replace(QUOTES, "")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

/** Detect a trailing legal-form suffix even when no whitespace separates it
 * from the rest of the name (e.g. `"КАФЕ СЕРВИЗ ММ"ЕООД` → `КАФЕ СЕРВИЗ ММ EOOD`).
 * Tries both space-separated tokens and string-suffix forms. */
const splitLegalFormSuffix = (
  cleaned: string,
): { name: string; lf: string | null } => {
  // 1) space-separated last token
  const tokens = cleaned.split(" ");
  const last = tokens[tokens.length - 1];
  const lfCanonical = LEGAL_FORM_TO_CANONICAL[last];
  if (lfCanonical && tokens.length > 1) {
    return { name: tokens.slice(0, -1).join(" "), lf: lfCanonical };
  }
  // 2) glued suffix: try each known form, longest first.
  const forms = Object.keys(LEGAL_FORM_TO_CANONICAL).sort(
    (a, b) => b.length - a.length,
  );
  for (const form of forms) {
    if (cleaned.endsWith(form) && cleaned.length > form.length) {
      const before = cleaned.slice(0, -form.length).replace(/\s+$/, "");
      // Reject when the character right before the suffix is a letter that
      // would extend the previous token — e.g. "АГРОБИЗНЕС" ends in "ЕС" but
      // we don't want to lop "ЕТ" off "АГРОБИЗНЕТ". Heuristic: the trimmed
      // remainder must end with whitespace, hyphen, or quote-stripped boundary.
      // Since we've already stripped quotes, accept whenever:
      //   - the remainder is non-empty and
      //   - the cleaned[len-form.length-1] character is non-letter OR
      //     there's a known whitespace/hyphen boundary in the original
      // For safety only accept when the remainder length ≥ 3.
      if (before.length >= 3) {
        return { name: before, lf: LEGAL_FORM_TO_CANONICAL[form] };
      }
    }
  }
  return { name: cleaned, lf: null };
};

/** Match-key family for a TR companies row. Returns multiple candidate
 * fingerprints — primary (with legal form) plus a name-only fallback.
 * Both sides of the join (TR and declaration) emit the same family so we can
 * try matches in priority order. */
const trFingerprints = (
  name: string | null,
  legalForm: string | null,
): { primary: string; nameOnly: string } => {
  const n = normalizeForFingerprint(name ?? "");
  const lf = canonicalLegalForm(legalForm);
  return {
    primary: lf ? `${n} ${lf}` : n,
    nameOnly: n,
  };
};

/** Build a fingerprint family for a declared company name. */
const declarationFingerprints = (
  rawCompanyName: string,
): { primary: string; nameOnly: string } => {
  const cleaned = normalizeForFingerprint(rawCompanyName);
  const { name, lf } = splitLegalFormSuffix(cleaned);
  return {
    primary: lf ? `${name} ${lf}` : cleaned,
    nameOnly: name,
  };
};

type PersonRow = {
  uic: string;
  role: string;
  name: string;
  name_norm: string;
  position_label: string | null;
  share_percent: number | null;
  added_at: string | null;
  erased_at: string | null;
};

const OFFICER_ROLES = new Set([
  "manager",
  "representative",
  "director",
  "board_of_managers",
  "controlling_board",
  "procurator",
  "branch_manager",
  "liquidator",
  // ЮЛНЦ governing-body roles — an official on an NGO board is a governance
  // link the same as a company officer (drives the conflict-of-interest signal).
  "ngo_board",
  "ngo_representative",
  "trustee",
  "verifier",
]);
const OWNER_ROLES = new Set([
  "partner",
  "sole_owner",
  "actual_owner",
  "foreign_trader",
]);

const toOfficer = (r: PersonRow, matchedMpId?: number): TrCompanyOfficer => ({
  role: r.role,
  name: r.name,
  positionLabel: r.position_label,
  sharePercent: r.share_percent,
  addedAt: r.added_at ?? "",
  ...(matchedMpId != null ? { matchedMpId } : {}),
});

// ---- Main ------------------------------------------------------------------

export type IntegrateTrArgs = {
  publicFolder: string;
  rawFolder: string;
};

export type IntegrateTrResult = {
  companiesEnriched: number;
  companiesUnmatched: number;
};

/** One row of the TR SQLite `companies` table, as the fingerprint index reads it. */
type CompanyRow = {
  uic: string;
  name: string;
  legal_form: string | null;
  seat: string | null;
  status: string | null;
  last_updated: string | null;
};

// The editorial suppression list (data/declarations/tr_match_suppressions.json) went with
// phase 2: it existed to overrule individual false-positive NAME matches one at a time, and
// the registry's own people-per-fold count refuses that whole class up front instead. The
// file is left on disk — it records what was found by hand — but nothing reads it now.

export const integrateTr = ({
  publicFolder,
  rawFolder,
}: IntegrateTrArgs): IntegrateTrResult | null => {
  const sqlitePath = path.join(rawFolder, "tr", "state.sqlite");
  if (!fs.existsSync(sqlitePath)) {
    console.warn(
      `[tr/integrate] ${sqlitePath} not found — skipping TR enrichment. ` +
        `Run \`npx tsx scripts/declarations/tr/cli.ts --bulk --reconstruct\` first.`,
    );
    return null;
  }
  const indexPath = path.join(publicFolder, "parliament", "index.json");
  const companiesIndexPath = path.join(
    publicFolder,
    "parliament",
    "companies-index.json",
  );
  if (!fs.existsSync(indexPath) || !fs.existsSync(companiesIndexPath)) {
    console.warn(
      `[tr/integrate] missing public/parliament/index.json or companies-index.json — skipping`,
    );
    return null;
  }

  const mpIndex: ParliamentIndex = JSON.parse(
    fs.readFileSync(indexPath, "utf-8"),
  );
  const companiesIndex: CompaniesIndexFile = JSON.parse(
    fs.readFileSync(companiesIndexPath, "utf-8"),
  );

  const mpByNormName = new Map<string, MpIndexEntry>();
  for (const mp of mpIndex.mps) mpByNormName.set(mp.normalizedName, mp);

  const db = new DatabaseSync(sqlitePath, { readOnly: true });
  // PERF: a few PRAGMAs trim per-query overhead for read-only batch work.
  db.exec("PRAGMA query_only = ON; PRAGMA cache_size = -64000;");

  // ---- (1) Per-company enrichment ---------------------------------------

  const companyByFingerprint = db.prepare(
    `SELECT uic, name, legal_form, seat, status, last_updated FROM companies`,
  );
  // Two indexes:
  //   `primary` — name + canonical legal form. Highest-confidence match.
  //   `nameOnly` — name without legal form. Used as a fallback only when no
  //     primary match exists, AND the name maps to exactly one row in TR
  //     (otherwise the join is ambiguous; we'd rather miss than mislabel).
  const fpPrimary = new Map<string, CompanyRow>();
  const nameOnlyRows = new Map<string, CompanyRow[]>();
  for (const row of companyByFingerprint.iterate() as IterableIterator<CompanyRow>) {
    const fps = trFingerprints(row.name, row.legal_form);
    if (fps.primary) {
      const prev = fpPrimary.get(fps.primary);
      if (!prev || (row.last_updated ?? "") > (prev.last_updated ?? "")) {
        fpPrimary.set(fps.primary, row);
      }
    }
    if (fps.nameOnly) {
      const list = nameOnlyRows.get(fps.nameOnly) ?? [];
      list.push(row);
      nameOnlyRows.set(fps.nameOnly, list);
    }
  }
  // Promote unique-by-name matches into the lookup map under the name key.
  // Multi-match name keys are intentionally left out — ambiguous, so unmatched.
  const fpNameOnly = new Map<string, CompanyRow>();
  for (const [name, rows] of nameOnlyRows.entries()) {
    if (rows.length === 1) {
      fpNameOnly.set(name, rows[0]);
    } else {
      // Ambiguous: pick the most-recently-updated active row, but only if it
      // dominates the others by being meaningfully newer (≥ 90 days). Otherwise
      // skip — too risky to claim a match.
      rows.sort((a, b) =>
        (b.last_updated ?? "").localeCompare(a.last_updated ?? ""),
      );
      const top = rows[0];
      const second = rows[1];
      if (top.last_updated && second.last_updated) {
        const tdate = Date.parse(top.last_updated);
        const sdate = Date.parse(second.last_updated);
        if (
          Number.isFinite(tdate) &&
          Number.isFinite(sdate) &&
          tdate - sdate > 90 * 86400_000
        ) {
          fpNameOnly.set(name, top);
        }
      }
    }
  }

  const personsByUic = db.prepare(
    `SELECT uic, role, name, name_norm, position_label, share_percent, added_at, erased_at
       FROM company_persons
      WHERE uic = ? AND erased_at IS NULL`,
  );

  let companiesEnriched = 0;
  let companiesEnrichedNameOnly = 0;
  let companiesUnmatched = 0;
  for (const c of companiesIndex.companies) {
    const fps = declarationFingerprints(c.displayName);
    let trCompany = fpPrimary.get(fps.primary);
    if (!trCompany && fps.nameOnly) {
      const fallback = fpNameOnly.get(fps.nameOnly);
      if (fallback) {
        trCompany = fallback;
        companiesEnrichedNameOnly++;
      }
    }
    if (!trCompany) {
      // Drop any stale `tr` from a prior run — this run's SQLite is the source
      // of truth, so an unmatched company must look unmatched in the output.
      if ("tr" in c) delete (c as CompanyIndexEntry).tr;
      companiesUnmatched++;
      continue;
    }
    const persons = personsByUic.all(trCompany.uic) as PersonRow[];
    const currentOfficers: TrCompanyOfficer[] = [];
    const currentOwners: TrCompanyOfficer[] = [];
    for (const p of persons) {
      const matchMp = mpByNormName.get(p.name_norm);
      const officer = toOfficer(p, matchMp?.id);
      if (OFFICER_ROLES.has(p.role)) currentOfficers.push(officer);
      else if (OWNER_ROLES.has(p.role)) currentOwners.push(officer);
    }
    const enrichment: TrCompanyEnrichment = {
      uic: trCompany.uic,
      legalForm: trCompany.legal_form,
      status: trCompany.status ?? "unknown",
      seat: trCompany.seat,
      lastUpdated: trCompany.last_updated,
      currentOfficers,
      currentOwners,
    };
    (c as CompanyIndexEntry).tr = enrichment;
    companiesEnriched++;
  }

  // Rewrite companies-index.json with enrichment in place.
  fs.writeFileSync(
    companiesIndexPath,
    compactJson({ ...companiesIndex, generatedAt: new Date().toISOString() }),
    "utf-8",
  );
  console.log(
    `[tr/integrate] enriched ${companiesEnriched}/${companiesIndex.companies.length} companies ` +
      `(${companiesEnrichedNameOnly} via name-only fallback, ` +
      `${companiesUnmatched} unmatched in TR)`,
  );

  // Build a uic → set of mpIds (from declarations) for the high-confidence
  // "another MP of the same party already declared a stake in this UIC" rule.
  const uicToDeclaredMpIds = new Map<string, Set<number>>();
  // Cohort backfill: any MP who filed a declaration counts as a real MP even
  // if their parliament.bg `oldnsList` is empty (e.g. pre-1997 mandates before
  // parliament.bg coverage). Self-declaration is independent evidence that
  // they held a mandate at some point.
  const mpIdsWithDeclarations = new Set<number>();
  for (const c of companiesIndex.companies) {
    for (const s of c.stakes) mpIdsWithDeclarations.add(s.mpId);
    const uic = c.tr?.uic;
    if (!uic) continue;
    const set = uicToDeclaredMpIds.get(uic) ?? new Set<number>();
    for (const s of c.stakes) set.add(s.mpId);
    uicToDeclaredMpIds.set(uic, set);
  }

  // ---- (2) Per-MP management roles — REMOVED --------------------------------
  //
  // This phase wrote `public/parliament/mp-management/{mpId}.json` for every MP whose
  // normalized name appeared in `company_persons`, graded high/medium by a hand-built
  // confidence model and filtered by a name-FREQUENCY guard (COMMON_NAME_TR_ROWS = 11).
  //
  // All of it is gone, replaced by `mp_tr_roles` (migration 150) reading the gated
  // `person_role` set. The frequency guard in particular was deleted rather than ported: it
  // counted officer ROWS as a proxy for "is this name one person", written before anything
  // could measure that. The Commerce Registry publishes a per-person key on its daily feed and
  // `tr_name_fold_people` (148) now counts distinct people per name fold directly, so the
  // proxy was wrong in both directions — it dropped a rare-name MP's whole medium set behind
  // one busy registered agent, and let a name held by two people with six companies each pass.
  //
  // See docs/plans/mp-tr-edges-pg-v1.md §4 and data-hub-lateral-edges-v1 §11.10.

  db.close();

  console.log(
    `[tr/integrate] enriched ${companiesEnriched} companies-index entr(ies), ` +
      `${companiesUnmatched} unmatched`,
  );

  return {
    companiesEnriched,
    companiesUnmatched,
  };
};
