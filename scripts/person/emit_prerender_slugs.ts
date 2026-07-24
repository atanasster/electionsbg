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
// Stable: person slugs are frozen by the resolver, so this file is append-mostly. A diff
// is a genuinely new person page (or a thin page crossing the floor), reviewable before
// it can break an indexed URL.
//
// Runs AFTER db:resolve:persons (needs the resolved person + person_role) and the
// declarations load (the floor consults `declaration`). Wired into db:refresh.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, end } from "../db/lib/pg";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const OUT = path.join(ROOT, "data/person/prerender_slugs.json");

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

  const payload = rows.map((r) => ({ slug: r.slug, indexable: r.indexable }));
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload) + "\n");

  const indexable = payload.filter((r) => r.indexable).length;
  console.log(
    `[person-slugs] wrote ${payload.length} slugs → ${path.relative(ROOT, OUT)} ` +
      `(${indexable} indexable, ${payload.length - indexable} noindex/thin)`,
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
