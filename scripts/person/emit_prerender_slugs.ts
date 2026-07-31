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
// So `prerender` marks the executive-officials top OFFICIALS_STATIC_PAGE_LIMIT, in PERSON
// space. But count-neutral is NOT set-neutral — the retired JSON was keyed per officials
// POSITION (5,000 positions → ~4,487 persons), so a naive person-grain top-5,000 silently
// drops ~114 of those persons near the net-worth boundary, and their indexed /officials URL
// would then 301 to a non-prerendered /person page (a soft-404). To honor "no indexed URL
// loses its SEO body," the selection below FORCE-INCLUDES the persons the old officials
// pages 301 to (continuity), then tops up the remaining budget with the current
// highest-value officials (freshness). See emitPersonSlugs. The `card` fields ride along so
// the prerenderer builds the net-worth body without a DB read.
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
// `prerender` set reads it) — on the SERVING database: `npm run person:slugs:cloud`, after
// the cloud twins of those three. db:refresh still calls the local `person:slugs`, which
// now warns and skips rather than writing (see "WHICH DATABASE MAY WRITE THIS FILE" below).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, end, DATABASE_URL, LOCAL_DATABASE_URL } from "../db/lib/pg";
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

// ---------------------------------------------------------------------------
// WHICH DATABASE MAY WRITE THIS FILE.
//
// The header above says scripts/prerender/ and scripts/sitemap/ stay DB-free because "the
// maintainer's local PG is stale vs Cloud SQL" — but the wiring did the opposite of what
// that sentence implies: `person:slugs` sat in db:refresh reading the LOCAL Postgres, and
// the determinism gate below called emitPersonSlugs() during test:data, so BOTH paths
// minted the committed manifest from the stale side.
//
// person_slug_lock accumulates PER DATABASE and is never truncated, so two databases
// re-resolved a different number of times assign different slugs to the same people
// (measured 2026-07-31: 1,436 mention→slug locks disagreed and 640 person slugs existed
// only locally, mostly `-2` collision suffixes). Every one of those 640 was in this
// manifest, naming a person prod cannot serve.
//
// SCOPE, HONESTLY: today that is LATENT, not live. Both consumers — buildPersonRoutes and
// the sitemap's enumeratePersons — filter on `prerender`, and that ~5,000-entry
// ex-officials set was byte-identical between the local- and cloud-minted manifests (0
// churn, measured). Nothing reads `indexable` at runtime. So no wrong page was built and no
// wrong <loc> shipped. The divergence sat entirely in the non-prerendered remainder.
//
// It stops being latent the moment the prerender set widens — which the header above
// explicitly plans ("TO SHIP THE FULL G6 SET LATER", all 38,353 indexable). Then those 640
// become built pages and <loc>s whose profile fetch returns `null` on prod, while the 640
// slugs prod can actually serve get neither. A manifest minted from a database that does
// not serve production is wrong whether or not anything currently reads the wrong part.
//
// So writing is gated on the connection being the SERVING database. The local docker
// Postgres is the one URL we know is not it; everything else (the Cloud SQL proxy) is
// taken at face value, matching how every :cloud script here targets prod.
//
// Exported because the same signal gates the manifest↔DB assertions in the two data tests:
// a manifest minted from the serving database CANNOT be checked against local Postgres —
// the slug sets legitimately differ, so the comparison would fail on provenance, not on a
// real defect. DB-only invariants (the content floor, emitter determinism) run anywhere.
export const isServingDatabase = (): boolean =>
  DATABASE_URL !== LOCAL_DATABASE_URL;

/** Read the manifest payload from whatever database is connected, WITHOUT writing it.
 *  Returns null when the person layer is unresolved (nothing meaningful to emit).
 *  The determinism gate uses this so a test run cannot mutate the committed artifact. */
export const computePersonSlugs = async (): Promise<
  PersonSlugEntry[] | null
> => {
  const [{ n }] = await allRows<{ n: string }>(
    "SELECT count(*) n FROM person WHERE is_public_figure",
  );
  if (Number(n) === 0) {
    console.log(
      "[person-slugs] person table empty — skipping (resolver not run?)",
    );
    return null;
  }

  const rows = await allRows<{ slug: string; indexable: boolean }>(
    `SELECT p.slug, ${FLOOR_PREDICATE} AS indexable
       FROM person p
      WHERE p.is_public_figure AND p.slug IS NOT NULL
      ORDER BY p.slug COLLATE "C" ASC`,
  );

  // The net-neutral prerender set. Two forces, in order:
  //
  //   1. CONTINUITY (no indexed URL loses its SEO body — §0.5 requires this, and it is the
  //      whole point of the cutover). The retired /officials group prerendered the top
  //      OFFICIALS_STATIC_PAGE_LIMIT officials POSITIONS; those pages are indexed today and
  //      301 to /person, so the person they redirect to MUST be prerendered or Google lands
  //      on the SPA shell (a soft-404). Count-neutral is not set-neutral: 5,000 positions
  //      collapse to ~4,487 persons, and a fresh person-grain top-5,000 drops ~114 of them
  //      near the net-worth boundary. So the OLD set's redirect targets are force-included.
  //   2. FRESHNESS. Any budget left under the cap is filled with the current highest-value
  //      executive officials (person-grain), so a newly-appointed high-net-worth official
  //      still gets a page.
  //
  // officials_rankings_table.slug IS the person slug, §6-gated to active + public. The
  // whole thing is best-effort: on a DB that has never loaded declarations the matview is
  // absent and the manifest degrades to "nothing prerendered" rather than aborting the
  // resolver pipeline.
  const cardBySlug = new Map<string, PersonPrerenderCard>();
  const prerenderSet = new Set<string>();
  try {
    // ORDER BY is not cosmetic: it makes the top-N boundary reproducible across matview
    // refreshes (idx_officials_rankings_exec is btree (net_worth_eur DESC NULLS LAST, slug)
    // WHERE is_exec — a covering match), and officialsForStaticPages's slug tiebreak
    // finishes the job for cross-tier ties.
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
        WHERE is_exec
        ORDER BY net_worth_eur DESC NULLS LAST, slug`,
    );
    // Card for EVERY exec official — a continuity person may sit outside the person-grain
    // top-N, so cards can't be built only for the selected slice.
    for (const o of officials) {
      cardBySlug.set(o.slug, {
        name: o.name,
        category: o.category,
        institution: o.institution,
        positionTitle: o.position_title,
        year: o.latest_declaration_year,
        netWorthEur: o.net_worth_eur == null ? null : Number(o.net_worth_eur),
      });
    }
    const ranked = officials.map((o) => ({
      slug: o.slug,
      category: o.category,
      netWorthEur: o.net_worth_eur == null ? 0 : Number(o.net_worth_eur),
    }));

    // (1) Continuity: the persons the retired officials group's pages 301 to. Read the
    // still-present assets-rankings.json (the actual old source) and map each selected
    // officials slug through officials_person_slug() — the SAME function the 301 uses, so a
    // current OR re-slug-retired slug both resolve. Best-effort: once T1.5 retires that
    // JSON, this yields nothing and the set is pure person-grain — by then the swap's
    // continuity has long served its purpose (Google has re-indexed /person).
    const oldRankingsFile = path.join(
      ROOT,
      "data/officials/assets-rankings.json",
    );
    if (fs.existsSync(oldRankingsFile)) {
      try {
        const old = JSON.parse(fs.readFileSync(oldRankingsFile, "utf-8")) as {
          topOfficials?: {
            slug: string;
            category: OfficialCategoryKind;
            netWorthEur?: number | null;
          }[];
        };
        const oldSlugs = officialsForStaticPages(
          old.topOfficials ?? [],
          OFFICIALS_STATIC_PAGE_LIMIT,
        ).map((o) => o.slug);
        const mapped = await allRows<{ person_slug: string | null }>(
          `SELECT officials_person_slug(s) AS person_slug
             FROM unnest($1::text[]) AS s`,
          [oldSlugs],
        );
        for (const m of mapped) {
          // Only force-include a continuity person we can actually render a body for. One
          // who lost their card (now muni-only, or no longer public) SHOULD drop — they are
          // no longer an indexable exec official.
          if (m.person_slug && cardBySlug.has(m.person_slug)) {
            prerenderSet.add(m.person_slug);
          }
        }
      } catch (e) {
        console.warn(
          `[person-slugs] assets-rankings.json unreadable — continuity skipped (${(e as Error).message})`,
        );
      }
    }

    // (2) Freshness top-up: fill the remaining budget with the current highest-value
    // person-grain officials, capped at the limit. Superset of the continuity set.
    for (const o of officialsForStaticPages(
      ranked,
      OFFICIALS_STATIC_PAGE_LIMIT,
    )) {
      if (prerenderSet.size >= OFFICIALS_STATIC_PAGE_LIMIT) break;
      prerenderSet.add(o.slug);
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
  return payload;
};

/** Compute AND write the manifest. Refuses to overwrite the committed file from the local
 *  docker Postgres (see isServingDatabase) — pass `allowLocal` only when you genuinely want
 *  the local view on disk. Skipping is the safe degradation: the committed manifest already
 *  describes the serving database, so leaving it untouched keeps prerender + sitemap honest. */
export const emitPersonSlugs = async (opts?: {
  allowLocal?: boolean;
}): Promise<void> => {
  const payload = await computePersonSlugs();
  if (!payload) return;

  if (!isServingDatabase() && !opts?.allowLocal) {
    console.warn(
      `[person-slugs] connected to the LOCAL Postgres — refusing to overwrite ` +
        `${path.relative(ROOT, OUT)}, which the production prerender + sitemap read. ` +
        `Mint it from the serving database instead:\n` +
        `  npm run person:slugs:cloud\n` +
        `(override with \`npm run person:slugs -- --local\` if you really want the local view)`,
    );
    return;
  }

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
  emitPersonSlugs({ allowLocal: process.argv.includes("--local") })
    .then(() => end())
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
