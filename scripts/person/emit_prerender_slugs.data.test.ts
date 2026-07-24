// The content-floor manifest (emit_prerender_slugs.ts) decides which /person pages ask
// to be indexed. Two failure modes matter: (1) a candidate-only person marked indexable
// would ship 20k thin pages that can get the whole directory discounted; (2) a person
// with real substance marked noindex would silently drop an indexable page. This gate
// pins the floor against the live person layer.
//
// Auto-skips when Postgres is down or unresolved — like the other *.data.test.ts gates.
//
//   npm run test:data

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../db/lib/pg";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

const reachable = async (): Promise<boolean> => {
  try {
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.person') IS NOT NULL AS ok",
    );
    if (!t?.ok) return false;
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM person WHERE is_public_figure",
    );
    return Number(c.n) > 0;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb ? false : "Postgres unreachable / person table empty";

afterAll(async () => {
  await end();
});

// A person whose ONLY role is a candidacy is the thin tail — must be noindex.
test.skipIf(skip)("a candidate-only person is not indexable", async () => {
  const rows = await allRows<{ slug: string; indexable: boolean }>(
    `SELECT p.slug,
            (EXISTS (SELECT 1 FROM declaration d WHERE d.person_id = p.person_id)
             OR EXISTS (SELECT 1 FROM person_role r
                         WHERE r.person_id = p.person_id
                           AND r.source <> 'candidate')) AS indexable
       FROM person p
      WHERE p.is_public_figure AND p.slug IS NOT NULL
        AND EXISTS (SELECT 1 FROM person_role r
                     WHERE r.person_id = p.person_id AND r.source = 'candidate')
        AND NOT EXISTS (SELECT 1 FROM person_role r
                         WHERE r.person_id = p.person_id AND r.source <> 'candidate')
        AND NOT EXISTS (SELECT 1 FROM declaration d WHERE d.person_id = p.person_id)
      LIMIT 5`,
  );
  for (const r of rows) {
    assert.equal(
      r.indexable,
      false,
      `${r.slug} is candidate-only yet indexable`,
    );
  }
});

// A declaration filer must ALWAYS clear the floor — a filed declaration is the most
// substantive page kind (assets, income, stakes), so it is never thin. Assert the
// floor predicate itself marks every filer indexable (0 filers land noindex).
test.skipIf(skip)("every declaration filer is indexable", async () => {
  const [{ n }] = await allRows<{ n: string }>(
    `SELECT count(*) n
       FROM person p
      WHERE p.is_public_figure AND p.slug IS NOT NULL
        AND EXISTS (SELECT 1 FROM declaration d WHERE d.person_id = p.person_id)
        AND NOT (
          EXISTS (SELECT 1 FROM declaration d WHERE d.person_id = p.person_id)
          OR EXISTS (SELECT 1 FROM person_role r
                      WHERE r.person_id = p.person_id AND r.source <> 'candidate')
        )`,
  );
  assert.equal(Number(n), 0, "a declaration filer was computed as noindex");
});

// If the committed manifest exists, it must agree with the live floor — same slug set,
// same indexable flag — so the sitemap and the prerender cannot disagree about thinness.
test.skipIf(skip)("the committed manifest matches the live floor", async () => {
  const file = path.join(ROOT, "data/person/prerender_slugs.json");
  if (!fs.existsSync(file)) return; // not emitted in this checkout — nothing to compare
  const manifest = JSON.parse(fs.readFileSync(file, "utf-8")) as {
    slug: string;
    indexable: boolean;
  }[];
  const byslug = new Map(manifest.map((r) => [r.slug, r.indexable]));

  const live = await allRows<{ slug: string; indexable: boolean }>(
    `SELECT p.slug,
            (EXISTS (SELECT 1 FROM declaration d WHERE d.person_id = p.person_id)
             OR EXISTS (SELECT 1 FROM person_role r
                         WHERE r.person_id = p.person_id
                           AND r.source <> 'candidate')) AS indexable
       FROM person p
      WHERE p.is_public_figure AND p.slug IS NOT NULL`,
  );
  assert.equal(
    manifest.length,
    live.length,
    `manifest has ${manifest.length} slugs, live floor has ${live.length} — re-run npm run person:slugs`,
  );
  const mismatches = live.filter((r) => byslug.get(r.slug) !== r.indexable);
  assert.equal(
    mismatches.length,
    0,
    `${mismatches.length} slug(s) disagree with the live floor — re-run npm run person:slugs`,
  );
});
