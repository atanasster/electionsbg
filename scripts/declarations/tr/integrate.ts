/**
 * Phase 5 — integrate the reconstructed TR SQLite into the public/ outputs.
 *
 * Two outputs:
 *
 *   1. Augment `public/parliament/companies-index.json`. For every entry whose
 *      declared name matches a row in `companies`, attach a `tr` object:
 *      { uic, legalForm, seat, status, currentOfficers[], currentOwners[] }.
 *      Officers are flagged with `matchedMpId` when their normalized name
 *      matches an MP in `public/parliament/index.json` (catches the case where
 *      a sitting MP's spouse / family member runs a company the MP declared).
 *
 *   2. Write `public/parliament/mp-management/{mpId}.json` for every MP whose
 *      normalized name appears in `company_persons`. Each role gets a
 *      `confidence` field per the slice-3 design:
 *
 *        high   = exact full-name match AND (TR seat contains MP region
 *                 OR another MP from the same party already declared a stake
 *                 in this UIC)
 *        medium = exact full-name match only
 *        (low / surname-only — suppressed entirely; too noisy for Bulgarian
 *         common names like Иван Иванов / Мария Петрова)
 *
 * If the SQLite isn't present (i.e. the user hasn't run Phase 3+4 yet), this
 * module logs a warning and returns — `npm run prod` should still succeed.
 */

import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import type {
  CompaniesIndexFile,
  CompanyIndexEntry,
} from "../build_company_index";
import type {
  MpManagementFile,
  MpManagementRole,
  TrCompanyEnrichment,
  TrCompanyOfficer,
} from "../../../src/data/dataTypes";

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

const normalizeName = (s: string) =>
  s.toUpperCase().replace(/\s+/g, " ").trim();

// ---- DB row shapes (raw from sqlite; TS lacks decltype) --------------------

type CompanyRow = {
  uic: string;
  name: string | null;
  legal_form: string | null;
  seat: string | null;
  status: string | null;
  last_updated: string | null;
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
  stringify: (o: object) => string;
};

export type IntegrateTrResult = {
  companiesEnriched: number;
  companiesUnmatched: number;
  mpFilesWritten: number;
  mpHighConfidence: number;
  mpMediumConfidence: number;
};

export const integrateTr = ({
  publicFolder,
  rawFolder,
  stringify,
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
    stringify({ ...companiesIndex, generatedAt: new Date().toISOString() }),
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
  for (const c of companiesIndex.companies) {
    const uic = c.tr?.uic;
    if (!uic) continue;
    const set = uicToDeclaredMpIds.get(uic) ?? new Set<number>();
    for (const s of c.stakes) set.add(s.mpId);
    uicToDeclaredMpIds.set(uic, set);
  }

  // ---- (2) Per-MP management roles --------------------------------------

  const allRolesByName = db.prepare(
    `SELECT cp.uic, cp.role, cp.name, cp.name_norm, cp.position_label,
            cp.share_percent, cp.added_at, cp.erased_at,
            c.name AS company_name, c.legal_form, c.seat, c.status
       FROM company_persons cp
       JOIN companies c ON c.uic = cp.uic
      WHERE cp.name_norm = ?`,
  );

  type RoleRow = PersonRow & {
    company_name: string | null;
    legal_form: string | null;
    seat: string | null;
    status: string | null;
  };

  const mpManagementDir = path.join(
    publicFolder,
    "parliament",
    "mp-management",
  );
  fs.mkdirSync(mpManagementDir, { recursive: true });

  let mpFilesWritten = 0;
  let mpHighConfidence = 0;
  let mpMediumConfidence = 0;

  // Index MP party-group → set of mpIds. Used for the "same-party already
  // declared this UIC" arm of the high-confidence rule.
  const partyGroupToMpIds = new Map<string, Set<number>>();
  for (const mp of mpIndex.mps) {
    if (!mp.currentPartyGroup) continue;
    const set =
      partyGroupToMpIds.get(mp.currentPartyGroup) ?? new Set<number>();
    set.add(mp.id);
    partyGroupToMpIds.set(mp.currentPartyGroup, set);
  }

  for (const mp of mpIndex.mps) {
    const rows = allRolesByName.all(mp.normalizedName) as RoleRow[];
    if (rows.length === 0) continue;

    const regionName = mp.currentRegion?.name ?? null;
    const region = regionName ? normalizeName(regionName) : null;
    const partyMpIds = mp.currentPartyGroup
      ? partyGroupToMpIds.get(mp.currentPartyGroup)
      : null;

    const roles: MpManagementRole[] = [];
    for (const r of rows) {
      const seatNorm = r.seat ? normalizeName(r.seat) : "";
      const seatMatch = !!region && seatNorm.includes(region);
      const declaredMps = uicToDeclaredMpIds.get(r.uic);
      const partyMatch =
        !!declaredMps &&
        !!partyMpIds &&
        Array.from(declaredMps).some(
          (id) => id !== mp.id && partyMpIds.has(id),
        );

      let confidence: "high" | "medium" = "medium";
      const reasons: string[] = ["full-name match"];
      if (seatMatch) {
        confidence = "high";
        reasons.push(`seat contains MP region "${regionName}"`);
      }
      if (partyMatch) {
        confidence = "high";
        reasons.push(`same-party MP also declared this UIC`);
      }

      if (confidence === "high") mpHighConfidence++;
      else mpMediumConfidence++;

      roles.push({
        uic: r.uic,
        companyName: r.company_name,
        legalForm: r.legal_form,
        seat: r.seat,
        status: r.status ?? "unknown",
        role: r.role,
        positionLabel: r.position_label,
        sharePercent: r.share_percent,
        addedAt: r.added_at ?? "",
        erasedAt: r.erased_at,
        confidence,
        confidenceReason: reasons.join("; "),
      });
    }

    // Currently-active first, then most-recent erasures.
    roles.sort((a, b) => {
      if ((a.erasedAt === null) !== (b.erasedAt === null)) {
        return a.erasedAt === null ? -1 : 1;
      }
      return (b.addedAt || "").localeCompare(a.addedAt || "");
    });

    const file: MpManagementFile = {
      mpId: mp.id,
      mpName: mp.name,
      generatedAt: new Date().toISOString(),
      total: roles.length,
      roles,
    };
    fs.writeFileSync(
      path.join(mpManagementDir, `${mp.id}.json`),
      stringify(file),
      "utf-8",
    );
    mpFilesWritten++;
  }

  db.close();

  console.log(
    `[tr/integrate] wrote ${mpFilesWritten} mp-management file(s) — ` +
      `${mpHighConfidence} high-confidence roles, ${mpMediumConfidence} medium`,
  );

  return {
    companiesEnriched,
    companiesUnmatched,
    mpFilesWritten,
    mpHighConfidence,
    mpMediumConfidence,
  };
};
