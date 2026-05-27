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
import type {
  MpDeclaration,
  MpOwnershipStake,
  TrCompanyEnrichment,
} from "../../src/data/dataTypes";

/** Trimmed projection of MpOwnershipStake stored in companies-index.json.
 * Only the fields the /mp/company page actually renders. The per-MP
 * declarations under public/parliament/declarations/ keep the full record. */
export type CompanyIndexStake = Pick<
  MpOwnershipStake,
  "table" | "shareSize" | "valueEur" | "legalBasis" | "fundsOrigin"
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
 * historical role, …). Populated for *every* index entry by the post-graph
 * pass in build_connections_graph.ts so the All Companies page can show MPs
 * connected via the Commerce Registry even when no stake was declared. */
export type CompanyIndexEntryMpRole = {
  mpId: number;
  mpName: string;
  /** TR role string — `manager`, `partner`, `tr_owner`, `procurator`, etc.
   * Same vocabulary as `ConnectionsEdge.role`. */
  role: string;
  isCurrent: boolean;
  confidence: "high" | "medium";
};

export type CompanyIndexEntry = {
  slug: string;
  displayName: string; // canonical (most-frequent) raw form
  registeredOffices: string[]; // distinct values across stakes
  stakes: CompanyIndexEntryStake[];
  /** TR-only relationships (no declared stake). Populated for every entry
   * by the post-graph extension so MPs whose link to this company is purely
   * via the Commerce Registry are still visible in the All Companies page. */
  mpRoles?: CompanyIndexEntryMpRole[];
  /** Filled in by Phase 5 TR integration when the declared company name
   * matches a row in raw_data/tr/state.sqlite. */
  tr?: TrCompanyEnrichment;
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

export const normalizeCompanyName = (raw: string): string =>
  stripLegalFormSuffix(
    raw.replace(QUOTES, "").replace(/\s+/g, " ").trim().toLowerCase(),
  );

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

export type BuildCompanyIndexArgs = {
  publicFolder: string;
  stringify: (o: object) => string;
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
            shareSize: stake.shareSize,
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
    });
  }
  if (droppedPlaceholder > 0) {
    console.warn(
      `[declarations] dropped ${droppedPlaceholder} placeholder stake(s) with no resolvable company name`,
    );
  }
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
