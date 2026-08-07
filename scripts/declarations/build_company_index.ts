/**
 * Aggregate per-MP declaration JSON into a companies-index.json — one entry per
 * company, listing all MPs who declared stakes in it across years.
 *
 * Without EIKs (declarations rarely include them), companies are keyed by a
 * normalized form of their declared name. The normalizer folds whitespace,
 * quote variants, and a trailing legal-form suffix (ООД/ЕАД/ЕТ/…) — declarants
 * write the same company inconsistently ("Отзвук" vs "Отзвук ЕООД" vs
 * «Отзвук»ЕООД), and not folding the suffix splits one company across 2-3
 * index entries, scattering its stakes and breaking the TR/procurement join.
 */

import fs from "fs";
import path from "path";
import { normaliseOrgName } from "../lib/normalize_name";
import {
  buildSettlementIndex,
  resolveOffice,
  type OfficeMatchQuality,
  type PostcodeIndex,
  type Settlement,
} from "./parse_registered_office";
import type {
  MpDeclaration,
  MpOwnershipStake,
  TrCompanyEnrichment,
} from "../../src/data/dataTypes";

/** Trimmed projection of MpOwnershipStake stored in companies-index.json.
 * Only the fields the /mp/company page actually renders. The per-MP
 * declarations under public/parliament/declarations/ keep the full record.
 *
 * `stakeKind` is NOT droppable, however small: without it the page cannot
 * tell a shareholding from a directorship, and it rendered every интереси
 * role under a "declared stakes" heading — the exact false statement about a
 * named person the MpOwnershipStake doc warns against. It also fixes the
 * `table: "11"` label, which reads "transferred" for a share but means "held
 * before taking office, not since" for a role. */
export type CompanyIndexStake = Pick<
  MpOwnershipStake,
  | "table"
  | "stakeKind"
  | "shareSize"
  | "valueEur"
  | "legalBasis"
  | "fundsOrigin"
>;

export type CompanyIndexEntryStake = {
  mpId: number;
  declarantName: string;
  declarationYear: number;
  fiscalYear: number | null;
  institution: string;
  sourceUrl: string;
  stake: CompanyIndexStake;
};

/** TR-only relationship between an MP and a company (manager, partner,
 * historical role, …). Populated for index entries with a TR role by
 * augment_mp_roles.ts (augmentCompaniesIndexWithMpRoles) so the All Companies
 * page can show MPs connected via the Commerce Registry even when no stake was
 * declared. */
export type CompanyIndexEntryMpRole = {
  mpId: number;
  mpName: string;
  /** TR role string — `manager`, `partner`, `tr_owner`, `procurator`, etc.
   * (the mp-management `role` vocabulary). */
  role: string;
  isCurrent: boolean;
  confidence: "high" | "medium";
};

export type CompanyIndexEntry = {
  slug: string;
  displayName: string; // canonical (most-frequent) raw form
  registeredOffices: string[]; // distinct values across stakes
  /** EKATTE code(s) resolved from `registeredOffices` via the BG Post
   * postcode table + settlements name index. Usually one entry; a second is
   * emitted only when a company has independently declared offices in
   * different settlements across years. Sofia city collapses to the
   * synthetic EKATTE 68134 (no rayon split). Filled in by
   * `enrichWithEkatteHQ()`. */
  ekatteHQ?: string[];
  /** Best (highest-confidence) match quality across the entry's resolved
   * offices. "foreign" or "unresolved" companies still appear in the index
   * but won't be linked from any settlement page. */
  hqMatchQuality?: OfficeMatchQuality;
  stakes: CompanyIndexEntryStake[];
  /** MP↔company TR relationships (beyond any declared stake). Populated by
   * augment_mp_roles.ts (from the mp-management files) so MPs whose link to
   * this company is purely via the Commerce Registry are still visible in the
   * All Companies page. */
  mpRoles?: CompanyIndexEntryMpRole[];
  /** Filled in by Phase 5 TR integration when the declared company name
   * matches a row in raw_data/tr/state.sqlite. */
  tr?: TrCompanyEnrichment;
  /** The declared entity is a registered POLITICAL PARTY — not a company and
   * not a COALITION, which is a different kind of thing with no filing
   * obligation of its own. Decided from the raw declared names by
   * `looksLikeParty`. Set independently of `financing` below, which
   * additionally requires a register match: a party we cannot find in gfopp
   * is still a party. Build-side only — nothing in `src/` reads it. */
  isParty?: true;
  /** Set only on entries that ARE a registered political party and that match
   * one in the Court-of-Audit annual-report register (gfopp). Resolved here,
   * at build time, so the page does no name matching at runtime: the join is
   * by NAME (parties carry no EIK in any registry we ingest), and a name join
   * that can attach a party's financing record to a same-named private
   * company is exactly the claim that must be settled deterministically and
   * covered by a test. See `looksLikeParty`. */
  financing?: { slug: string; name: string };
};

export type CompaniesIndexFile = {
  generatedAt: string;
  total: number;
  companies: CompanyIndexEntry[];
};

// Normalize for grouping. Lowercases, folds whitespace, strips wrapping quote
// variants (straight, curly, French, low-double). Preserves Cyrillic case
// folding via toLowerCase().
const QUOTES = /["“”„«»‟″〞〟＂']/g;

// Bulgarian legal-form tokens, longest-first so a glued suffix strips the
// right amount (ЕООД before ООД, АДСИЦ before АД). Lowercased to match the
// normalized string.
const LEGAL_FORM_SUFFIXES = [
  "адсиц",
  "еоод",
  "дззд",
  "кда",
  "еад",
  "оод",
  "ад",
  "ет",
  "кд",
  "сд",
];

// Strip a trailing legal-form suffix so "Отзвук", "Отзвук ЕООД" and the
// glued «Отзвук»ЕООД collapse to one group. A space-separated trailing token
// is always a clear word boundary. A glued suffix is stripped only when the
// preceding character is a non-letter (e.g. `"МИД 2000"ООД` → digit before
// ООД) — this avoids lopping "ЕТ" off a word like "ПОЛЕТ".
const stripLegalFormSuffix = (lowered: string): string => {
  for (const f of LEGAL_FORM_SUFFIXES) {
    if (lowered.endsWith(" " + f)) {
      return lowered.slice(0, -(f.length + 1)).trim();
    }
    if (lowered.endsWith(f) && lowered.length > f.length + 2) {
      const before = lowered[lowered.length - f.length - 1];
      if (before && !/\p{L}/u.test(before)) {
        return lowered.slice(0, -f.length).trim();
      }
    }
  }
  return lowered;
};

// The legal form of a POLITICAL PARTY is written as a prefix, not a suffix —
// "Политическа партия «Движение ДА българия»" and "ПП Движение ДА българия"
// are the same registered party, and the suffix stripper above cannot see it.
// Left unfolded, the party splits into one entry per spelling and each holds
// a different subset of the years (ДА България: the 2021 filings under one,
// the 2023 filings under the other), so both pages under-report.
// Anchored at the start and requiring a following space, so a company whose
// name merely begins with those letters ("ПП Сервиз") is untouched.
const PARTY_FORM_PREFIX = /^(политическа партия|коалиция|пп|кп)\s+/;

// The same vocabulary, narrowed, for the one question the fold cannot answer:
// is this thing a PARTY? A coalition is not. It carries no ЗПП filing
// obligation of its own, and — because the fold above strips its prefix — its
// normalized name is usually its lead party's, so "Коалиция Възраждане" would
// resolve to the party Възраждане's filing record and publish it as the
// coalition's own. That is the Величие АД false claim arriving through the
// other door, with no commercial legal form available to veto it.
// Wide enough to GROUP, deliberately too narrow to IDENTIFY.
const PARTY_ONLY_PREFIX = /^(политическа партия|пп)\s+/;

export const normalizeCompanyName = (raw: string): string =>
  stripLegalFormSuffix(
    raw
      .replace(QUOTES, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
      .replace(PARTY_FORM_PREFIX, ""),
  );

// A COMMERCIAL legal form on the raw name. Separate from the fold above,
// which is a grouping concern: this one is evidence about what the entity IS.
const COMPANY_FORM = new RegExp(
  String.raw`(^|[^\p{L}])(${LEGAL_FORM_SUFFIXES.join("|")})$`,
  "u",
);

/** Is this index entry a registered POLITICAL PARTY rather than a company?
 *
 * Decided from the raw names declarants wrote, never from the folded key —
 * `normalizeCompanyName` strips the party prefix, so by then the evidence is
 * gone. All three clauses are load-bearing, and the last two are what stop a
 * name match from becoming an identity claim:
 *
 *  - "Величие АД" is a joint-stock company whose stripped name is exactly the
 *    party "Величие". Its own АД says it is not a party, so a commercial form
 *    vetoes outright.
 *  - A COALITION is excluded by using the narrow prefix: see PARTY_ONLY_PREFIX.
 *
 * This is the ONLY condition `enrichWithFinancing` tests, so anything it lets
 * through can be published as that entity's own financing record. Widen it
 * only alongside a narrower condition there. */
export const looksLikeParty = (rawNames: string[]): boolean => {
  const prepped = rawNames.map((r) =>
    r.replace(QUOTES, "").replace(/\s+/g, " ").trim().toLowerCase(),
  );
  if (prepped.length === 0) return false;
  if (prepped.some((s) => COMPANY_FORM.test(s))) return false;
  return prepped.some((s) => PARTY_ONLY_PREFIX.test(s));
};

// URL-safe slug. We keep Cyrillic but strip quotes, replace spaces with -,
// and collapse the result. Encoded at link time, decoded on the route side.
export const slugifyCompanyName = (raw: string): string =>
  raw
    .replace(QUOTES, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .trim();

const pickDisplayName = (rawNames: string[]): string => {
  // Pick the most frequent; tie-break by length (longest carries the most detail)
  const counts = new Map<string, number>();
  for (const r of rawNames) counts.set(r, (counts.get(r) ?? 0) + 1);
  let best = rawNames[0];
  let bestCount = 0;
  for (const [name, count] of counts.entries()) {
    if (
      count > bestCount ||
      (count === bestCount && name.length > best.length)
    ) {
      best = name;
      bestCount = count;
    }
  }
  // Court-of-Audit declarations are entered in ALL CAPS verbatim, but the
  // funds / procurement / officials trees all canonicalise to sentence
  // case. Run the chosen display name through the shared org-name
  // normaliser so the same entity reads identically across the dashboard.
  return normaliseOrgName(best);
};

/** `shareSize` carries two unrelated things depending on the row's kind: a
 * quantity for a shareholding ("50%", "40лв.") and a JOB TITLE for a role
 * ("ЧЛЕН НА УПРАВИТЕЛЕН СЪВЕТ"). Declarants type the title in whatever case
 * they like, so one list mixes shouted and sentence-cased variants of the
 * same office — the same de-shouting the display names already get fixes it,
 * and it keeps УС / СД upright where a plain lowercase would not.
 *
 * Applied to roles ONLY: a quantity is not prose, and must stay verbatim. */
export const roleLabel = (stake: MpOwnershipStake): string | null => {
  if (stake.stakeKind !== "role" || !stake.shareSize) return stake.shareSize;
  // normaliseOrgName leaves an already-lowercase word alone by design (it
  // reads that as "somebody typed this properly"), which is right for a name
  // and wrong for a title: "член на Изпълнителния съвет" then sits in a
  // column of capitalised offices as the one row starting lower-case.
  const s = normaliseOrgName(stake.shareSize);
  return s.charAt(0).toLocaleUpperCase("bg-BG") + s.slice(1);
};

/** Link party entries to the Court-of-Audit annual-report register, mutating
 * in place and returning how many landed.
 *
 * This is the only bridge we have to a party's money. Parties register with
 * the Sofia City Court and draw their EIK from БУЛСТАТ, neither of which we
 * ingest — `tr_companies` and `ngos_list` are companies and ЮЛНЦ only — so
 * there is no identifier to join on and the name is all there is. That makes
 * the `looksLikeParty` gate the whole safety story, not a nicety.
 *
 * Silently no-ops when reports.json is absent, keeping a fresh checkout
 * buildable. Idempotent: clears a stale link before re-resolving, so an entry
 * that stops matching does not keep yesterday's party. */
export const enrichWithFinancing = (
  companies: CompanyIndexEntry[],
  reportsPath = path.join(process.cwd(), "data", "financing", "reports.json"),
): number => {
  if (!fs.existsSync(reportsPath)) {
    console.warn(
      `[declarations] financing/reports.json missing — skipping party financing link`,
    );
    return 0;
  }
  const file = JSON.parse(fs.readFileSync(reportsPath, "utf-8")) as {
    years?: { parties?: { name: string; slug: string }[] }[];
  };
  // Newest year first in the file, so the first spelling seen is the most
  // recent one the register used.
  const byName = new Map<string, { slug: string; name: string }>();
  for (const y of file.years ?? []) {
    for (const p of y.parties ?? []) {
      const key = normalizeCompanyName(p.name);
      if (key && !byName.has(key))
        byName.set(key, { slug: p.slug, name: p.name });
    }
  }

  let linked = 0;
  for (const c of companies) {
    delete c.financing;
    if (!c.isParty) continue;
    const match = byName.get(normalizeCompanyName(c.displayName));
    if (!match) continue;
    c.financing = match;
    linked++;
  }
  return linked;
};

export type BuildCompanyIndexArgs = {
  publicFolder: string;
  stringify: (o: object) => string;
};

/** Quality ranking used to pick the best office match per company. */
const QUALITY_RANK: Record<OfficeMatchQuality, number> = {
  high: 4,
  medium: 3,
  low: 2,
  foreign: 1,
  unresolved: 0,
};

/** Enrich each entry with ekatteHQ + hqMatchQuality, mutating in place.
 *
 * For multi-office companies the highest-quality match wins for the
 * `hqMatchQuality` field; `ekatteHQ` collects the union of all resolved
 * EKATTEs across offices (deduplicated, ordered by declaration recency).
 *
 * Resolution sources, in priority order:
 *   1. `registeredOffices[]` — the free-text field from cacbg declarations.
 *   2. `tr.seat` — Commerce Registry registered seat for TR-enriched entries
 *      that have no declared office (e.g. TR-only companies whose link to an
 *      MP is purely via a manager/owner role, not a declared stake). Used
 *      as a fallback only; existing high-quality declaration matches win.
 *
 * Silently no-ops if reference data is missing — keeps the older pipeline
 * runnable on a fresh checkout that hasn't fetched the postcode table yet.
 * Idempotent: safe to call multiple times. Calling once before TR
 * integration + once after it lets the TR-seat fallback fill late-arriving
 * entries without redoing the declaration-text work. */
export const enrichWithEkatteHQ = (
  companies: CompanyIndexEntry[],
): { matched: number; total: number } => {
  const settlementsPath = path.join(process.cwd(), "data", "settlements.json");
  const postcodePath = path.join(process.cwd(), "data", "postcode_ekatte.json");
  if (!fs.existsSync(settlementsPath)) {
    console.warn(
      `[declarations] settlements.json missing — skipping HQ enrichment`,
    );
    return { matched: 0, total: companies.length };
  }
  const settlements: Settlement[] = JSON.parse(
    fs.readFileSync(settlementsPath, "utf-8"),
  );
  const idx = buildSettlementIndex(settlements);
  const pc: PostcodeIndex = fs.existsSync(postcodePath)
    ? (
        JSON.parse(fs.readFileSync(postcodePath, "utf-8")) as {
          byPostcode: PostcodeIndex;
        }
      ).byPostcode
    : {};
  if (Object.keys(pc).length === 0) {
    console.warn(
      `[declarations] postcode_ekatte.json missing/empty — village ambiguities will fall back to first match`,
    );
  }

  let matched = 0;
  for (const c of companies) {
    const ekattes = new Set<string>();
    let best: OfficeMatchQuality = "unresolved";
    for (const office of c.registeredOffices) {
      const m = resolveOffice(office, idx, pc);
      if (QUALITY_RANK[m.quality] > QUALITY_RANK[best]) best = m.quality;
      if (m.ekatte) ekattes.add(m.ekatte);
    }
    // TR-seat fallback — only consult when the declared-offices path produced
    // nothing. Treat tr.seat as a synthetic office string so the same
    // resolver handles all the Sofia/postcode/typo edge cases for free.
    if (ekattes.size === 0 && c.tr?.seat) {
      const m = resolveOffice(c.tr.seat, idx, pc);
      if (QUALITY_RANK[m.quality] > QUALITY_RANK[best]) best = m.quality;
      if (m.ekatte) ekattes.add(m.ekatte);
    }
    // Fully replace — keeps the function deterministic across re-runs (a
    // foreign entry that gained then lost a stale match in a prior pass must
    // come back clean here, even though the resolver no longer matches).
    if (ekattes.size > 0) {
      c.ekatteHQ = Array.from(ekattes);
      matched++;
    } else {
      delete c.ekatteHQ;
    }
    c.hqMatchQuality = best;
  }
  return { matched, total: companies.length };
};

/** Re-run enrichWithEkatteHQ against the on-disk companies-index.json. Used
 * for the post-TR second pass: by the time integrateTr has run, each entry's
 * `tr.seat` is populated, so the seat-fallback path inside the resolver can
 * fill in `ekatteHQ` for TR-only entries that had no declared office. Writes
 * the file back. */
export const reEnrichCompaniesIndex = ({
  publicFolder,
  stringify,
}: BuildCompanyIndexArgs): void => {
  const indexPath = path.join(
    publicFolder,
    "parliament",
    "companies-index.json",
  );
  if (!fs.existsSync(indexPath)) return;
  const file: CompaniesIndexFile = JSON.parse(
    fs.readFileSync(indexPath, "utf-8"),
  );
  const before = file.companies.filter(
    (c) => c.ekatteHQ && c.ekatteHQ.length > 0,
  ).length;
  const { matched, total } = enrichWithEkatteHQ(file.companies);
  fs.writeFileSync(indexPath, stringify(file), "utf-8");
  console.log(
    `[declarations] re-enrich pass: ${matched}/${total} now resolved ` +
      `(+${matched - before} via TR-seat fallback)`,
  );
};

export const buildCompanyIndex = ({
  publicFolder,
  stringify,
}: BuildCompanyIndexArgs): void => {
  const dir = path.join(publicFolder, "parliament", "declarations");
  if (!fs.existsSync(dir)) {
    console.warn(`[declarations] ${dir} not found — skipping company index`);
    return;
  }

  // group: normalized → entries
  type Group = {
    rawNames: string[];
    offices: Set<string>;
    stakes: CompanyIndexEntryStake[];
  };
  const groups = new Map<string, Group>();

  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const decls: MpDeclaration[] = JSON.parse(
      fs.readFileSync(path.join(dir, file), "utf-8"),
    );
    for (const decl of decls) {
      for (const stake of decl.ownershipStakes) {
        const raw = stake.companyName;
        if (!raw) continue;
        const key = normalizeCompanyName(raw);
        if (!key) continue;
        let g = groups.get(key);
        if (!g) {
          g = { rawNames: [], offices: new Set(), stakes: [] };
          groups.set(key, g);
        }
        g.rawNames.push(raw);
        if (stake.registeredOffice) g.offices.add(stake.registeredOffice);
        g.stakes.push({
          mpId: decl.mpId,
          declarantName: decl.declarantName,
          declarationYear: decl.declarationYear,
          fiscalYear: decl.fiscalYear,
          institution: decl.institution,
          sourceUrl: decl.sourceUrl,
          stake: {
            table: stake.table,
            stakeKind: stake.stakeKind,
            shareSize: roleLabel(stake),
            valueEur: stake.valueEur,
            legalBasis: stake.legalBasis,
            fundsOrigin: stake.fundsOrigin,
          },
        });
      }
    }
  }

  const companies: CompanyIndexEntry[] = [];
  // Two distinct groups can slugify to the same string (e.g. names that
  // differ only in casing or quote style). Disambiguate by appending an
  // incrementing suffix so slugs remain unique route keys.
  const slugUseCount = new Map<string, number>();
  let droppedPlaceholder = 0;
  for (const [, g] of groups) {
    const displayName = pickDisplayName(g.rawNames);
    const baseSlug = slugifyCompanyName(displayName);
    // Skip placeholder rows: declarants occasionally enter "-" or pure
    // punctuation in the company name field. Slugifying them yields "" which
    // can't be linked from the UI, and the resulting node ends up as a
    // disconnected blob in the connections graph.
    if (!baseSlug) {
      droppedPlaceholder += g.stakes.length;
      continue;
    }
    const n = slugUseCount.get(baseSlug) ?? 0;
    slugUseCount.set(baseSlug, n + 1);
    const slug = n === 0 ? baseSlug : `${baseSlug}-${n + 1}`;
    companies.push({
      slug,
      displayName,
      registeredOffices: Array.from(g.offices),
      stakes: g.stakes.sort((a, b) => b.declarationYear - a.declarationYear),
      ...(looksLikeParty(g.rawNames) ? { isParty: true as const } : {}),
    });
  }
  if (droppedPlaceholder > 0) {
    console.warn(
      `[declarations] dropped ${droppedPlaceholder} placeholder stake(s) with no resolvable company name`,
    );
  }

  const linked = enrichWithFinancing(companies);
  console.log(
    `[declarations] linked ${linked} party entr(ies) to the gfopp annual-report register`,
  );

  const { matched, total } = enrichWithEkatteHQ(companies);
  console.log(
    `[declarations] resolved HQ → EKATTE for ${matched}/${total} companies`,
  );

  companies.sort((a, b) =>
    a.displayName.localeCompare(b.displayName, "bg", { sensitivity: "base" }),
  );

  const out: CompaniesIndexFile = {
    generatedAt: new Date().toISOString(),
    total: companies.length,
    companies,
  };
  const outPath = path.join(publicFolder, "parliament", "companies-index.json");
  fs.writeFileSync(outPath, stringify(out), "utf-8");
  console.log(
    `[declarations] wrote ${companies.length} companies to ${outPath}`,
  );
};

/**
 * Walk every per-MP declaration JSON and stamp the resolved companies-index
 * slug onto each ownership stake. Lets `MpFinancialDeclarations` link to the
 * right `/mp/company/{slug}` entry even when two companies share a bare slug
 * — the bare `slugifyCompanyName(stake.companyName)` would always point at
 * the alphabetically-first entry and miss the `-2`/`-3` disambiguated ones.
 *
 * Must run AFTER `buildCompanyIndex` because it reads companies-index.json to
 * recover the canonical `normalizedKey → slug` map.
 */
export const annotatePerMpDeclarationsWithSlugs = ({
  publicFolder,
  stringify,
}: BuildCompanyIndexArgs): void => {
  const dir = path.join(publicFolder, "parliament", "declarations");
  const indexPath = path.join(
    publicFolder,
    "parliament",
    "companies-index.json",
  );
  if (!fs.existsSync(dir) || !fs.existsSync(indexPath)) return;

  const idx: CompaniesIndexFile = JSON.parse(
    fs.readFileSync(indexPath, "utf-8"),
  );
  const slugByKey = new Map<string, string>();
  for (const c of idx.companies) {
    slugByKey.set(normalizeCompanyName(c.displayName), c.slug);
  }

  let stamped = 0;
  let rewrote = 0;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const filePath = path.join(dir, file);
    const decls: MpDeclaration[] = JSON.parse(
      fs.readFileSync(filePath, "utf-8"),
    );
    let changed = false;
    for (const decl of decls) {
      for (const stake of decl.ownershipStakes) {
        const raw = stake.companyName;
        const resolved = raw
          ? (slugByKey.get(normalizeCompanyName(raw)) ?? null)
          : null;
        if (stake.companySlug !== resolved) {
          stake.companySlug = resolved;
          changed = true;
        }
        if (resolved) stamped++;
      }
    }
    if (changed) {
      fs.writeFileSync(filePath, stringify(decls), "utf-8");
      rewrote++;
    }
  }
  console.log(
    `[declarations] stamped slug on ${stamped} stake(s) across ${rewrote} per-MP file(s)`,
  );
};
