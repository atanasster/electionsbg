// Is the person-identity layer on the SERVING database still consistent with the
// committed /person prerender manifest — and how far has local drifted from it?
//
//   npm run person:parity                    (local vs the Cloud SQL proxy)
//   npm run person:parity -- --from <url> --to <url>
//
// READ-ONLY. Every statement is a SELECT; nothing here writes, and it is safe to
// run against production at any time.
//
// ⚠️ THIS IS NOT A "MAKE THE NUMBERS EQUAL" TOOL, AND MUST NEVER BECOME ONE.
// `person_id` is a positional ordinal handed out by a DELETE + re-COPY, and
// `person_slug_lock` accumulates PER DATABASE and is never truncated — so two
// databases re-resolved a different number of times assign different slugs to the
// same people, and the gap widens monotonically. A cloud re-resolve re-mints
// against prod's OWN lock table: it converges nothing, churns ~1,400 live /person
// URLs, and costs an ~8-minute window at 500 on /persons, /officials/assets,
// /mp-assets and /declarations/crypto (090's DROP MATERIALIZED VIEW … CASCADE).
// See docs/plans/kzk-columnshift-and-cloud-parity-v1.md §2.4 for the triggers that
// DO justify one — all of them about content, none about parity.
//
// SO EXACTLY ONE SIGNAL IS AN ERROR: a manifest slug the SERVING database cannot
// serve. That is a prerendered page and a sitemap <loc> resolving to nothing —
// a soft-404 we published. Everything else is REPORTED, because it will drift for
// ever by design and an assertion on it is a gate nobody can keep green.
//
// Measured 2026-08-22 (local :5433 vs Cloud SQL :5434): 63,782 public figures on
// BOTH sides, 62,366 shared slugs, ~1,420 differing — of which 1,395 of local's
// 1,422 are collision suffixes. The manifest resolved 100% on cloud and had 1,416
// slugs absent from LOCAL, 834 of them in the prerender set. The guard that keeps
// that from becoming 834 soft-404s is emit_prerender_slugs.ts's isServingDatabase()
// refusal; this probe is what would notice if it ever stopped working.

import { Pool } from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LOCAL_DATABASE_URL, redactUrl, isServingUrl } from "./lib/pg";
import { FLOOR_PREDICATE } from "../person/emit_prerender_slugs";
import type { PersonSlugEntry } from "../person/emit_prerender_slugs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const MANIFEST = path.join(ROOT, "data/person/prerender_slugs.json");

const CLOUD_PROXY_URL = "postgres://postgres@127.0.0.1:5434/electionsbg";

/** A flag's value, refusing the two shapes that silently mean something else —
 *  the same rule as sync_enrichment.ts's, and for the same reason: `--to` as the
 *  last argument falls back to a default the operator did not ask for. */
const flagValue = (argv: string[], name: string): string | undefined => {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  if (!v || v.startsWith("--"))
    throw new Error(
      `${name} needs a connection URL, e.g. ${name} ${redactUrl(LOCAL_DATABASE_URL)}`,
    );
  return v;
};

/**
 * WHICH DATABASE IS THIS, regardless of how it was spelled.
 *
 * `system_identifier` is stamped at initdb and distinguishes CLUSTERS, so
 * `localhost` vs `127.0.0.1`, an `?sslmode=` suffix and a trailing slash all
 * resolve to the same answer — which comparing the two URL strings cannot do.
 * Without it, pointing both flags at the same database reports perfect parity,
 * which is true and useless.
 */
const identity = async (pool: Pool): Promise<string> => {
  const { rows } = await pool.query<{ id: string; db: string }>(
    "SELECT system_identifier::text AS id, current_database() AS db FROM pg_control_system()",
  );
  return `${rows[0]?.id ?? "?"}/${rows[0]?.db ?? "?"}`;
};

/**
 * Which slugs the database can actually SERVE, and whether each clears the
 * manifest's content floor.
 *
 * ⚠️ THE `WHERE` IS THE ASSERTION AND MUST MATCH `person_by_slug()` (082), NOT
 * the manifest's own membership rule. A slug the manifest carries but that
 * function will not return is a soft-404 whatever the manifest thought — and
 * `person_by_slug` requires `status = 'active'` on top of the public-figure gate.
 * Omitting it lets a person moved to `'review'` pass this probe and 404 anyway.
 * (Measured 2026-08-22: 63,782 of 63,782 are active on both sides, so this is
 * latent — but `status` has a CHECK constraint admitting the other values, and
 * emit_prerender_slugs.ts:190 explicitly contemplates widening its own rule.)
 *
 * The floor predicate itself is IMPORTED from emit_prerender_slugs rather than
 * restated, so a change to what `indexable` means cannot leave this probe
 * measuring the old definition.
 */
const FLOOR_SQL = `
  SELECT p.slug, ${FLOOR_PREDICATE} AS indexable
    FROM person p
   WHERE p.is_public_figure AND p.slug IS NOT NULL AND p.status = 'active'`;

const floorMap = async (pool: Pool): Promise<Map<string, boolean>> => {
  const { rows } = await pool.query<{ slug: string; indexable: boolean }>(
    FLOOR_SQL,
  );
  return new Map(rows.map((r) => [r.slug, r.indexable]));
};

/** ⚠️ NOT `slug ~ '-[0-9]+$'`. That also matches every `mp-<id>` slug — 2,118 on
 *  each side — so it reports a constant as if it were collision churn. This was a
 *  real error in the first cut of the measurement this probe automates. */
const collisionSuffixed = (slug: string): boolean =>
  /-[0-9]+$/.test(slug) && !/^mp-[0-9]+$/.test(slug);

const pct = (n: number, d: number): string =>
  d === 0 ? "—" : `${((100 * n) / d).toFixed(1)}%`;

const main = async (): Promise<number> => {
  const argv = process.argv.slice(2);
  const fromUrl = flagValue(argv, "--from") ?? LOCAL_DATABASE_URL;
  const toUrl = flagValue(argv, "--to") ?? CLOUD_PROXY_URL;

  if (!fs.existsSync(MANIFEST)) {
    console.error(
      `No ${path.relative(ROOT, MANIFEST)} — mint it with \`npm run person:slugs:cloud\`. ` +
        "The manifest is the artifact this probe checks; without it there is nothing to say.",
    );
    return 1;
  }
  const manifest = JSON.parse(
    fs.readFileSync(MANIFEST, "utf8"),
  ) as PersonSlugEntry[];

  const from = new Pool({ connectionString: fromUrl, max: 2 });
  const to = new Pool({ connectionString: toUrl, max: 2 });
  // A Pool with no 'error' listener CRASHES the process on an idle backend drop,
  // and the Cloud SQL proxy does exactly that. getPool() carries the same handler.
  for (const [label, p] of [
    ["from", from],
    ["to", to],
  ] as const)
    p.on("error", (e) =>
      console.error(`[pg] ${label}: idle client error (recovered):`, e.message),
    );

  try {
    const [fromId, toId] = await Promise.all([identity(from), identity(to)]);
    console.log(`from : ${redactUrl(fromUrl)}  [${fromId}]`);
    console.log(
      `to   : ${redactUrl(toUrl)}  [${toId}]   ← the SERVING database`,
    );
    if (fromId === toId) {
      console.error(
        "\n✗ both flags resolve to the SAME database — this would report perfect " +
          "parity and mean nothing. Point --to at the Cloud SQL proxy " +
          "(`npm run db:proxy:cloud`).",
      );
      return 1;
    }
    // ⚠️ CHECKED, not merely labelled. Every message below calls `--to` "the
    // serving database", and the failure text tells the operator they have
    // published soft-404s — so pointing `--to` at local (an inverted flag pair,
    // which is one transposition away) would report 834 published soft-404s
    // about a docker container. `isServingUrl` is the repo's one definition of
    // this question; sync_enrichment.ts, the sibling this file is modelled on,
    // uses it for the same reason.
    if (!isServingUrl(toUrl)) {
      console.error(
        `\n✗ --to is not the serving database (${redactUrl(toUrl)}). This probe's ` +
          "whole output is phrased as claims about production — running it against " +
          "anything else produces confident, wrong conclusions. Start the proxy with " +
          "`npm run db:proxy:cloud` and re-run.",
      );
      return 1;
    }

    const [f, t] = await Promise.all([floorMap(from), floorMap(to)]);
    const fSlugs = new Set(f.keys());
    const tSlugs = new Set(t.keys());
    const onlyFrom = [...fSlugs].filter((s) => !tSlugs.has(s));
    const onlyTo = [...tSlugs].filter((s) => !fSlugs.has(s));
    const shared = [...fSlugs].filter((s) => tSlugs.has(s));
    const flips = shared.filter((s) => f.get(s) !== t.get(s));

    console.log("\n── identity drift (REPORTED, never asserted) ──");
    console.log(`  public-figure slugs   from ${f.size}   to ${t.size}`);
    console.log(`  shared                ${shared.length}`);
    console.log(
      `  only on 'from'        ${onlyFrom.length}` +
        `  (collision-suffixed: ${onlyFrom.filter(collisionSuffixed).length})`,
    );
    console.log(
      `  only on 'to'          ${onlyTo.length}` +
        `  (collision-suffixed: ${onlyTo.filter(collisionSuffixed).length})`,
    );
    console.log(
      `  shared but disagree on the content floor   ${flips.length}` +
        ` (${pct(flips.length, shared.length)} of shared)`,
    );

    // ── the one assertion ──────────────────────────────────────────────────
    const missing = manifest.filter((e) => !tSlugs.has(e.slug));
    const missingPrerender = missing.filter((e) => e.prerender);
    const manifestFlips = manifest.filter(
      (e) => t.has(e.slug) && t.get(e.slug) !== e.indexable,
    );

    console.log("\n── the committed manifest vs the SERVING database ──");
    console.log(`  entries                       ${manifest.length}`);
    console.log(
      `  prerendered (files + <loc>)   ${manifest.filter((e) => e.prerender).length}`,
    );
    console.log(`  stale content floor           ${manifestFlips.length}`);
    console.log(
      `  ABSENT from the serving db    ${missing.length}` +
        `  (prerendered: ${missingPrerender.length})`,
    );

    if (missing.length > 0) {
      console.error(
        `\n✗ ${missing.length} manifest slug(s) do not exist on the serving database.\n` +
          // The split matters: only the `prerender` subset is a published
          // artifact. Calling all of them soft-404s overstates the damage by
          // ~40%, and this file's whole job is to be trusted about production.
          `  ${missingPrerender.length} of them are PRERENDERED — each of those is a static ` +
          "page and a sitemap <loc> whose profile fetch returns null, i.e. a published " +
          "soft-404.\n" +
          `  The other ${missing.length - missingPrerender.length} are manifest entries only: ` +
          "no file and no <loc> ship for them today (both consumers filter on `prerender`), " +
          "so they are latent until the prerender set widens.\n" +
          `  e.g. ${missing
            .slice(0, 5)
            .map((e) => e.slug)
            .join(", ")}\n` +
          "  The manifest was almost certainly minted from a database that does not serve " +
          "production. Re-mint it: `npm run person:slugs:cloud`.\n" +
          "  ⚠️ Do NOT re-resolve the serving database to make these appear — that converges " +
          "nothing (person_slug_lock accumulates per database) and takes four pages to 500 " +
          "for ~8 minutes. See docs/plans/kzk-columnshift-and-cloud-parity-v1.md §2.4.",
      );
      return 1;
    }

    // The plan's sixth signal. Reported on BOTH sides, because a redirect chain
    // or a target that no longer exists is a 301 into a 404 — and nothing else
    // asks this of the serving database (person_slug_retired.data.test.ts pins
    // the local one only). Measured 2026-08-22: 0/0/0 on both.
    console.log("\n── person_slug_retired health ──");
    let redirectsBroken = 0;
    for (const [label, pool] of [
      ["from", from],
      ["to  ", to],
    ] as const) {
      const { rows } = await pool.query<{
        rows_: string;
        no_target: string;
        missing: string;
        chains: string;
      }>(`SELECT count(*)::text AS rows_,
                 count(*) FILTER (WHERE target_slug IS NULL)::text AS no_target,
                 count(*) FILTER (WHERE NOT EXISTS
                   (SELECT 1 FROM person p WHERE p.slug = r.target_slug))::text AS missing,
                 count(*) FILTER (WHERE EXISTS
                   (SELECT 1 FROM person_slug_retired r2 WHERE r2.slug = r.target_slug))::text
                   AS chains
            FROM person_slug_retired r`);
      const r = rows[0];
      const bad = Number(r.no_target) + Number(r.missing) + Number(r.chains);
      if (label.trim() === "to") redirectsBroken = bad;
      console.log(
        `  ${label}  ${r.rows_} retired · no target ${r.no_target}` +
          ` · target missing ${r.missing} · chains ${r.chains}` +
          (bad > 0 ? "   ⚠" : ""),
      );
    }
    if (redirectsBroken > 0) {
      console.error(
        `\n✗ the SERVING database has ${redirectsBroken} broken /person redirect(s) — a ` +
          "301 into a 404, or a chain. `collapseSlugRedirectChains()` flattens these and " +
          "is called by both writers; a non-zero count means one of them did not run. " +
          "See raw_data/person/README.md.",
      );
      return 1;
    }

    console.log(
      "\n✓ every manifest slug resolves on the serving database, and its redirects are " +
        "flat. The identity drift above is expected and is NOT a defect — see this " +
        "file's header before acting on it.",
    );
    return 0;
  } finally {
    await from.end().catch(() => undefined);
    await to.end().catch(() => undefined);
  }
};

// `process.exitCode`, never `process.exit()` — the latter tears down the process
// before a piped stdout has flushed, which silently truncates the report this
// tool exists to produce. Both pools are already closed by main()'s `finally`,
// so nothing is left holding the event loop open.
main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
