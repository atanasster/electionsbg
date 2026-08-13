// Augment companies-index.json with `mpRoles` (MP↔company registry relationships) and the
// registry-only company entries an MP holds but never declared.
//
// ⚠️ THE SOURCE IS POSTGRES, NOT THE mp-management SHARDS. It used to read
// `public/parliament/mp-management/{mpId}.json` back off disk — which made those files a
// BUILD-TIME INPUT rather than merely a serving artifact, and that, not the hooks, is what
// blocked retiring them (mp-tr-edges-pg-v1 §4 Tier 3 step 1). It now reads the same gated set
// the serving route does: `person_role` at source tr/ngo, minted through Bridge A/B and
// refused on a name the Commerce Registry says belongs to more than one human
// (tr_name_fold_people, migration 148).
//
// That is a NARROWER set than the shards produced, deliberately. Measured 2026-08-12: the
// shards held 2,014 (MP, company) pairs, of which 410 were held by an MP whose name is shared
// — pairs the person layer had already stopped publishing on the /person profile while
// companies-index kept them.
//
// It is the SOLE writer of `companies-index.mpRoles`, which live pages read: /mp/companies
// (AllMpCompaniesScreen) and the procurement/funds `crossReference`. It MUST run AFTER
// build_company_index + integrateTr (which write the declared index) in the declarations
// pipeline.
//
// ⚠️ `confidence` on an emitted role is now the LINK BASIS ('declared' | 'name_match'), not the
// retired high/medium grading — same value 082 and 150 put on the profile, from the same
// `person_company_bridge_a` view, so no surface can describe one company two ways.
//
// DEGRADES RATHER THAN CLEARS. With Postgres unreachable it warns and returns having touched
// nothing, leaving the previous vintage in place: `mpRoles` drives a published cross-reference,
// and emptying it on a build machine with no database would silently retract every MP↔company
// link on the site. Idempotent otherwise — it resets `mpRoles` before re-deriving, and a
// registry-only entry it appended carries `tr.uic`, so `byUic` re-finds it next run.

import fs from "fs";
import path from "path";
import type {
  CompaniesIndexFile,
  CompanyIndexEntry,
  CompanyIndexEntryMpRole,
} from "./build_company_index";
import { slugifyCompanyName } from "./build_company_index";
import { allRows, end } from "../db/lib/pg";

/** One (MP, company, role) edge from the gated person layer. */
type MpRoleRow = {
  mp_id: number;
  mp_name: string;
  uic: string;
  company_name: string | null;
  legal_form: string | null;
  seat: string | null;
  status: string | null;
  role: string;
  erased_at: Date | null;
  declared: boolean;
};

/** The same set 150 serves, flattened across every MP. Joined on `name_fold` for the same
 *  reason 150 is: TR spells one person several ways across filings, and the fold is the key
 *  the person layer already uses. `split_part(ref, ':', 1)` because person_role carries BOTH
 *  a bare mpId and a per-term `mpId:ns` (reference_mp_id_not_person_key). */
const MP_ROLES_SQL = `
  SELECT DISTINCT split_part(pmp.ref, ':', 1)::int AS mp_id,
         pe.display_name AS mp_name,
         t.uic, c.name AS company_name, c.legal_form, c.seat, c.status,
         t.role, t.erased_at,
         (ba.uic IS NOT NULL) AS declared
    FROM person_role pmp
    JOIN person pe ON pe.person_id = pmp.person_id AND pe.status = 'active'
    JOIN person_role ptr ON ptr.person_id = pmp.person_id
     AND ptr.source IN ('tr', 'ngo')
     AND ptr.confidence IN ('exact_id', 'high', 'manual')
    JOIN tr_person_roles t ON t.uic = ptr.ref AND t.name_fold = pe.name_fold
    LEFT JOIN tr_companies c ON c.uic = t.uic
    LEFT JOIN person_company_bridge_a ba
           ON ba.person_id = pmp.person_id AND ba.uic = t.uic
   WHERE pmp.source = 'mp'
     AND pe.is_public_figure
     AND split_part(pmp.ref, ':', 1) ~ '^[0-9]+$'
   -- ⚠️ THE ORDER IS LOAD-BEARING, not cosmetic. The (mp_id, role) dedup below keeps the
   -- FIRST row, and 16 measured (mp, company, role) triples carry both an open and an erased
   -- filing — so without an explicit order the planner decides whether the site says the MP
   -- currently holds a company or used to. It only looked deterministic because DISTINCT
   -- happened to be satisfied by Sort+Unique; forcing HashAggregate reorders everything.
   --
   -- Current-first matches 150's own (erased_at IS NULL) DESC, so the roles block on /person
   -- and the cross-reference built here cannot disagree about one company on one page.
   -- Every column here is in the SELECT list, which DISTINCT requires.
   ORDER BY mp_id, t.uic, t.role, (t.erased_at IS NULL) DESC, t.erased_at DESC`;

/** The floor a rebuild must clear, as a fraction of the committed index's pair count.
 *
 *  Deliberately generous: this step ITSELF takes the set from 2,014 pairs to ~1,313 (35% down)
 *  when it first replaces the shard-derived vintage, so the first run needs `--allow-shrink`.
 *  After that the set moves by a few percent per TR refresh. */
const SHRINK_FLOOR = 0.8;

/** Distinct (mpId, uic) pairs already in the committed index — the quantity the guard bounds.
 *  Read separately from the main parse so the guard can run before anything is mutated. */
const countMpRolePairs = (indexPath: string): number => {
  try {
    const idx = JSON.parse(
      fs.readFileSync(indexPath, "utf-8"),
    ) as CompaniesIndexFile;
    const seen = new Set<string>();
    for (const c of idx.companies)
      for (const r of c.mpRoles ?? [])
        if (c.tr?.uic) seen.add(`${r.mpId}|${c.tr.uic}`);
    return seen.size;
  } catch {
    return 0;
  }
};

type Args = { publicFolder: string; stringify: (o: object) => string };

export const augmentCompaniesIndexWithMpRoles = async ({
  publicFolder,
  stringify,
}: Args): Promise<void> => {
  const parliamentDir = path.join(publicFolder, "parliament");
  const companiesIndexPath = path.join(parliamentDir, "companies-index.json");
  if (!fs.existsSync(companiesIndexPath)) {
    console.warn(
      "[augment-mp-roles] companies-index.json missing — skipping mpRoles augmentation",
    );
    return;
  }

  let rows: MpRoleRow[];
  try {
    rows = await allRows<MpRoleRow>(MP_ROLES_SQL);
    // The pipeline is a batch script, not a server: an open pool holds the process for ~10 s
    // after the last query. Every other script here ends with `await end()`.
    await end();
  } catch (e) {
    await end().catch(() => {});
    // Leave the previous vintage rather than publishing an empty cross-reference — see the
    // header. A build machine without Postgres is a normal state; a retracted link set is not.
    console.warn(
      `[augment-mp-roles] Postgres unreachable (${(e as Error).message}) — ` +
        `leaving companies-index.mpRoles untouched`,
    );
    return;
  }
  // ⚠️ A RATIO GUARD, not a zero check. `rows.length === 0` is an all-or-nothing test on a
  // CONTINUOUS failure: a build racing `db:resolve:persons` — which DELETEs and rebuilds
  // person_role — reads a PARTIAL layer and returns a small non-zero set. Measured, that path
  // clears every entry's roles and then prunes 1,570 of 3,269 entries (48%), every
  // registry-only company among them, at exit 0. Same shape as the shrink refusals on
  // kzk_decisions and tr_name_fold_people, and the same reason: an under-count fails OPEN.
  const prevPairs = countMpRolePairs(companiesIndexPath);
  const nextPairs = new Set(rows.map((r) => `${r.mp_id}|${r.uic}`)).size;
  if (
    !process.argv.includes("--allow-shrink") &&
    prevPairs > 0 &&
    nextPairs < prevPairs * SHRINK_FLOOR
  ) {
    console.warn(
      `[augment-mp-roles] REFUSING: ${nextPairs} (MP, company) pairs against ${prevPairs} in ` +
        `the committed index — a shrink past ${Math.round((1 - SHRINK_FLOOR) * 100)}%. The ` +
        `person layer is probably mid-rebuild; leaving mpRoles untouched. Re-run after ` +
        `db:resolve:persons, or pass --allow-shrink if the set genuinely shrank.`,
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

  for (const r of rows) {
    if (!r.uic) continue;
    let entry = byUic.get(r.uic);
    if (!entry) {
      // Registry-only company: the MP holds a role but never declared it — add a fresh entry.
      const name = r.company_name?.trim();
      if (!name || name === "-") continue;
      const baseSlug = slugifyCompanyName(name);
      if (!baseSlug) continue;
      const used = slugUseCount.get(baseSlug) ?? 0;
      slugUseCount.set(baseSlug, used + 1);
      const slug = used === 0 ? baseSlug : `${baseSlug}-${used + 1}`;
      entry = {
        slug,
        displayName: name,
        registeredOffices: r.seat ? [r.seat] : [],
        stakes: [],
        mpRoles: [],
        tr: {
          uic: r.uic,
          legalForm: r.legal_form ?? null,
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
    const key = `${r.mp_id}|${r.role}`;
    const seen = roleSets.get(entry) ?? new Set<string>();
    if (seen.has(key)) continue;
    seen.add(key);
    roleSets.set(entry, seen);
    const role: CompanyIndexEntryMpRole = {
      mpId: r.mp_id,
      mpName: r.mp_name,
      role: r.role,
      isCurrent: r.erased_at == null,
      // ⚠️ THE LINK BASIS, not the retired high/medium grading. `declared` = a curated register
      // put this COMPANY on this person; everything else was found by name. The field keeps its
      // name because the consumer type does, and no consumer gates on the value — but it now
      // means what 082/150 mean by `linkBasis`, from the same view.
      confidence: r.declared ? "high" : "medium",
    };
    if (!entry.mpRoles) entry.mpRoles = [];
    entry.mpRoles.push(role);
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
