// Emit the person slug + content-floor manifest that /person prerender + sitemap read.
//
// The G6 decision (docs/plans/persons-declarations-audit-v1.md): every public person
// gets a page, but only those ABOVE a content floor get a prerendered static file and
// a sitemap <loc>; the thin tail (a single candidacy and nothing else) stays SPA/DB-
// served with a runtime noindex. scripts/prerender/ and scripts/sitemap/ never open a
// DB (they read JSON off disk, and the maintainer's local PG is stale vs Cloud SQL), so
// the person layer — which holds the authoritative connection — writes this manifest,
// exactly as scripts/prices/export_slugs.ts does for products. A build-time enumeration
// list is the accepted PG→prerender shape (feedback_no_json_from_pg forbids SERVING
// generated JSON, not an enumeration manifest).
//
// THE CONTENT FLOOR. `indexable` is true when the person has any substance beyond a bare
// candidacy — a filed declaration, an elected/appointed office, a company/NGO role. A
// person who is ONLY ever a candidate has a one-line page; shipping 20k of those as
// indexable static files invites Google to discount the whole directory, so they are
// `indexable: false` → SPA-only, noindex, no <loc>. The flag and the page are computed
// from the same layer, so the sitemap and the prerender cannot disagree about which
// pages are thin.
//
// ---------------------------------------------------------------------------
// THE `prerender` FLAG — NET-NEUTRAL, A DELIBERATE DEVIATION FROM G6 (T1.4, 2026-07-26).
//
// G6 above says EVERY indexable person (38,353 of them) gets a prerendered file + <loc>.
// That is NOT what ships. The Firebase deploy has already hit the per-site file ceiling
// once (officials was capped at 5,000, candidate sub-tabs were reverted at 369k), and
// 38,353 × 2 languages ≈ 77k NEW files on top of ~116k deployed is unmeasured territory.
// So the officials→person cutover (T1.3) is NET-NEUTRAL: it REPLACES the ~5,000 prerendered
// /officials/<slug> pages with the SAME ~5,000 people at /person/<slug>, holding total
// deployed HTML flat (docs/plans/persons-pg-retirement-v1.md §0.5, Decision 4 overrides G6).
//
// So `prerender` marks exactly the set officialsForStaticPages picked for /officials — the
// executive-officials top OFFICIALS_STATIC_PAGE_LIMIT by (priority tier, then declared net
// worth) — resolved into PERSON slugs. Reusing that one function is what guarantees the
// person set is the same humans the officials set was, so no indexed URL loses its SEO body
// as it moves from /officials/<slug> to /person/<slug>. The `card` fields ride along so the
// prerenderer can build the same net-worth body without a DB read.
//
// TO SHIP THE FULL G6 SET LATER: measure the ceiling with a staging deploy FIRST (§0.5),
// then widen the selection here. A future implementer who just prerenders everything
// `indexable` will blow the deploy — this comment, and the cap, are the guardrail.
//
// ---------------------------------------------------------------------------
// Stable: person slugs are frozen by the resolver, so this file is append-mostly. A diff
// is a genuinely new person page (or a thin page crossing the floor), reviewable before
// it can break an indexed URL.
//
// Runs AFTER db:resolve:persons (needs the resolved person + person_role), the declarations
// load (the floor consults `declaration`) AND the officials_rankings_table refresh (the
// `prerender` set reads it). Wired into db:refresh after those.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, end } from "../db/lib/pg";
import {
  OFFICIALS_STATIC_PAGE_LIMIT,
  officialsForStaticPages,
} from "@/lib/officialCategoryLabels";
import type { OfficialCategoryKind } from "@/data/dataTypes";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const OUT = path.join(ROOT, "data/person/prerender_slugs.json");

/** The SEO-body fields a prerendered /person page needs, carried in the manifest so the
 *  prerenderer + sitemap stay DB-free. Present only on `prerender` entries. */
export type PersonPrerenderCard = {
  name: string;
  category: OfficialCategoryKind;
  institution: string | null;
  positionTitle: string | null;
  year: number | null;
  /** null when the person filed but declared nothing of value. */
  netWorthEur: number | null;
};

export type PersonSlugEntry = {
  slug: string;
  indexable: boolean;
  /** true for the net-neutral ex-officials set (see the header). Absent = false. */
  prerender?: true;
  card?: PersonPrerenderCard;
};

// THE CONTENT FLOOR, stated once as the plan states it (G6): a person clears the floor
// when they have any substance BEYOND a bare candidacy — a filed declaration, or any
// person_role whose source is not 'candidate' (an office, a company/NGO footprint, a
// sanctions/ДС fact). A denylist, not an allowlist: "anything but candidate" cannot go
// stale when person_source (081) gains a new source, whereas an allowlist would silently
// drop a newly-populated source to noindex. The data-test computes indexability the same
// way, so the two cannot disagree.
const FLOOR_PREDICATE = `(
  EXISTS (SELECT 1 FROM declaration d WHERE d.person_id = p.person_id)
  OR EXISTS (SELECT 1 FROM person_role r
              WHERE r.person_id = p.person_id AND r.source <> 'candidate')
)`;

export const emitPersonSlugs = async (): Promise<void> => {
  const [{ n }] = await allRows<{ n: string }>(
    "SELECT count(*) n FROM person WHERE is_public_figure",
  );
  if (Number(n) === 0) {
    console.log(
      "[person-slugs] person table empty — skipping (resolver not run?)",
    );
    return;
  }

  const rows = await allRows<{ slug: string; indexable: boolean }>(
    `SELECT p.slug, ${FLOOR_PREDICATE} AS indexable
       FROM person p
      WHERE p.is_public_figure AND p.slug IS NOT NULL
      ORDER BY p.slug COLLATE "C" ASC`,
  );

  // The net-neutral prerender set: the SAME executive officials officialsForStaticPages
  // picks for /officials, now keyed by PERSON slug (officials_rankings_table.slug IS the
  // person slug, and is already §6-gated to active + public). Best-effort: on a DB that
  // has never loaded declarations the matview is absent, and the manifest degrades to
  // "nothing prerendered" rather than aborting the resolver pipeline.
  const cardBySlug = new Map<string, PersonPrerenderCard>();
  const prerenderSet = new Set<string>();
  try {
    const officials = await allRows<{
      slug: string;
      name: string;
      category: OfficialCategoryKind;
      institution: string | null;
      position_title: string | null;
      latest_declaration_year: number | null;
      net_worth_eur: string | null;
    }>(
      `SELECT slug, name, category, institution, position_title,
              latest_declaration_year, net_worth_eur
         FROM officials_rankings_table
        WHERE is_exec`,
    );
    const ranked = officials.map((o) => ({
      slug: o.slug,
      category: o.category,
      netWorthEur: o.net_worth_eur == null ? 0 : Number(o.net_worth_eur),
      raw: o,
    }));
    for (const o of officialsForStaticPages(
      ranked,
      OFFICIALS_STATIC_PAGE_LIMIT,
    )) {
      prerenderSet.add(o.slug);
      cardBySlug.set(o.slug, {
        name: o.raw.name,
        category: o.raw.category,
        institution: o.raw.institution,
        positionTitle: o.raw.position_title,
        year: o.raw.latest_declaration_year,
        netWorthEur:
          o.raw.net_worth_eur == null ? null : Number(o.raw.net_worth_eur),
      });
    }
  } catch (e) {
    console.warn(
      `[person-slugs] officials_rankings_table unavailable — 0 prerendered (${(e as Error).message})`,
    );
  }

  const payload: PersonSlugEntry[] = rows.map((r) => {
    const entry: PersonSlugEntry = { slug: r.slug, indexable: r.indexable };
    // A prerendered page must clear the content floor too — but every officials-role
    // person does, so this is a guard, not a filter.
    if (r.indexable && prerenderSet.has(r.slug)) {
      entry.prerender = true;
      const card = cardBySlug.get(r.slug);
      if (card) entry.card = card;
    }
    return entry;
  });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload) + "\n");

  const indexable = payload.filter((r) => r.indexable).length;
  const prerendered = payload.filter((r) => r.prerender).length;
  console.log(
    `[person-slugs] wrote ${payload.length} slugs → ${path.relative(ROOT, OUT)} ` +
      `(${indexable} indexable, ${payload.length - indexable} noindex/thin, ` +
      `${prerendered} prerendered — net-neutral vs officials)`,
  );
};

// Direct-run entry point (also callable from the person pipeline).
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  emitPersonSlugs()
    .then(() => end())
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
