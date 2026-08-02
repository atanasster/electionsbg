// Augment companies-index.json with `mpRoles` (TR-only MP↔company relationships) and the TR-only
// company entries an MP manages but never declared. This was previously a tail-step of the retired
// static connections-graph generator (build_connections_graph.ts → augmentCompaniesIndexFromGraph),
// which derived it from the in-memory graph. Since that graph is retired (connections-engine-v1 §P4.3),
// it is re-derived HERE directly from the per-MP `mp-management/{mpId}.json` files that Phase 5 TR
// integration already writes — no graph, no connections*.json.
//
// It is the SOLE writer of `companies-index.mpRoles`, which live pages read: /mp/companies
// (AllMpCompaniesScreen), CompaniesHqTile / useCompaniesAtSettlement, and the procurement/funds
// `crossReference`. It MUST run in the declarations pipeline where buildConnectionsGraph used to, AFTER
// build_company_index + integrateTr (which write the declared index + the mp-management files) and
// BEFORE build_companies_by_{settlement,obshtina} (which read `mpRoles`).
//
// Equivalence with the retired graph pass: the old augment KEPT only companies with a declared stake OR
// a direct MP TR role (2-hop co-officer-only companies were filtered out), and its `mpRoles` came from
// the MP↔company TR edges — which ARE exactly the mp-management roles. So re-deriving from
// mp-management reproduces the same kept set (measured: 2061/3178 vs the graph's 2063/3181 — the ~3-row
// delta is the graph's extra TR-officer-name-match heuristic, absent from the per-MP files). Two value
// notes, both cosmetic (no consumer gates on them): (1) a role also present as a declared TR
// officer-match kept the graph's PROMOTED `high` confidence, whereas here it keeps its mp-management
// confidence (usually `medium`); (2) mp-management is arguably the more authoritative per-MP source.
// Idempotent: it resets `mpRoles` before re-deriving, and a TR-only entry it appended carries `tr.uic`,
// so `byUic` re-finds it on the next run — no duplicate, no bumped `-N` slug.

import fs from "fs";
import path from "path";
import type {
  CompaniesIndexFile,
  CompanyIndexEntry,
  CompanyIndexEntryMpRole,
} from "./build_company_index";
import { slugifyCompanyName } from "./build_company_index";

type MpManagementRole = {
  uic: string;
  companyName: string;
  legalForm?: string | null;
  seat?: string | null;
  status?: string | null;
  role: string;
  erasedAt?: string | null;
  confidence?: string | null;
};
type MpManagementFile = {
  mpId: number;
  mpName: string;
  roles?: MpManagementRole[];
};

type Args = { publicFolder: string; stringify: (o: object) => string };

export const augmentCompaniesIndexWithMpRoles = ({
  publicFolder,
  stringify,
}: Args): void => {
  const parliamentDir = path.join(publicFolder, "parliament");
  const companiesIndexPath = path.join(parliamentDir, "companies-index.json");
  const mpManagementDir = path.join(parliamentDir, "mp-management");
  if (!fs.existsSync(companiesIndexPath) || !fs.existsSync(mpManagementDir)) {
    console.warn(
      "[augment-mp-roles] companies-index.json or mp-management/ missing — skipping mpRoles augmentation",
    );
    return;
  }

  const idx = JSON.parse(
    fs.readFileSync(companiesIndexPath, "utf-8"),
  ) as CompaniesIndexFile;
  const entries = idx.companies;

  // uic → entry. The declared index can carry one legal entity under several slug variants
  // (`-2`/`-3`); a uic-keyed merge folds an MP's TR role onto the right one instead of spawning a
  // duplicate — and keeps the procurement cross-reference (which joins on `tr.uic`) intact.
  const byUic = new Map<string, CompanyIndexEntry>();
  for (const c of entries)
    if (c.tr?.uic && !byUic.has(c.tr.uic)) byUic.set(c.tr.uic, c);

  // Slug disambiguation carried over from the existing index so a TR-only company that slugifies to an
  // already-used base gets a stable `-N` suffix. Strip any trailing `-N` first so the base count starts
  // where the last build left off.
  const slugUseCount = new Map<string, number>();
  for (const c of entries) {
    const m = c.slug.match(/^(.*?)(?:-(\d+))?$/);
    const base = m ? m[1] : c.slug;
    slugUseCount.set(base, (slugUseCount.get(base) ?? 0) + 1);
  }

  // Idempotent: clear any prior mpRoles before re-deriving.
  for (const c of entries) c.mpRoles = [];

  // (entry, `${mpId}|${role}`) dedup — a manager+partner combo shows two rows, but the same TR row
  // reaching us twice collapses. Keyed by ENTRY (multiple uics/slugs alias to one) not by slug.
  const roleSets = new Map<CompanyIndexEntry, Set<string>>();

  for (const file of fs
    .readdirSync(mpManagementDir)
    .filter((f) => f.endsWith(".json"))) {
    const mm = JSON.parse(
      fs.readFileSync(path.join(mpManagementDir, file), "utf-8"),
    ) as MpManagementFile;
    for (const r of mm.roles ?? []) {
      if (!r.uic) continue;
      let entry = byUic.get(r.uic);
      if (!entry) {
        // TR-only company: the MP manages it but never declared it — add a fresh index entry.
        if (
          !r.companyName ||
          r.companyName.trim() === "" ||
          r.companyName === "-"
        )
          continue;
        const baseSlug = slugifyCompanyName(r.companyName);
        if (!baseSlug) continue;
        const used = slugUseCount.get(baseSlug) ?? 0;
        slugUseCount.set(baseSlug, used + 1);
        const slug = used === 0 ? baseSlug : `${baseSlug}-${used + 1}`;
        entry = {
          slug,
          displayName: r.companyName,
          registeredOffices: r.seat ? [r.seat] : [],
          stakes: [],
          mpRoles: [],
          tr: {
            uic: r.uic,
            legalForm: r.legalForm ?? null,
            status: r.status ?? "unknown",
            seat: r.seat ?? null,
            lastUpdated: null,
            currentOfficers: [],
            currentOwners: [],
          },
        };
        byUic.set(r.uic, entry);
        entries.push(entry);
      }
      const key = `${mm.mpId}|${r.role}`;
      const seen = roleSets.get(entry) ?? new Set<string>();
      if (seen.has(key)) continue;
      seen.add(key);
      roleSets.set(entry, seen);
      const role: CompanyIndexEntryMpRole = {
        mpId: mm.mpId,
        mpName: mm.mpName,
        role: r.role,
        isCurrent: r.erasedAt == null,
        // The type is narrowed to high|medium; low/undefined collapse to medium.
        confidence: r.confidence === "high" ? "high" : "medium",
      };
      if (!entry.mpRoles) entry.mpRoles = [];
      entry.mpRoles.push(role);
    }
  }

  // Keep only companies with a real MP link (declared stake OR TR role) — drop any index entry that
  // ended up with neither. Sort by MP-link count desc, then display name (bg collation).
  const kept = entries.filter(
    (c) => c.stakes.length > 0 || (c.mpRoles?.length ?? 0) > 0,
  );
  kept.sort((a, b) => {
    const am = a.stakes.length + (a.mpRoles?.length ?? 0);
    const bm = b.stakes.length + (b.mpRoles?.length ?? 0);
    if (am !== bm) return bm - am;
    return a.displayName.localeCompare(b.displayName, "bg", {
      sensitivity: "base",
    });
  });

  fs.writeFileSync(
    companiesIndexPath,
    stringify({
      generatedAt: idx.generatedAt,
      total: kept.length,
      companies: kept,
    }) + "\n",
    "utf-8",
  );
  const withRoles = kept.filter((c) => (c.mpRoles?.length ?? 0) > 0).length;
  console.log(
    `[augment-mp-roles] companies-index: ${kept.length} companies, ${withRoles} with mpRoles`,
  );
};
