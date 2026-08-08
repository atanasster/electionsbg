// Scoped bucket sync — rsync only the named subtrees of `data/` instead of the
// whole tree. Run: `npm run bucket:sync:paths -- prices myarea budget`
//                  `npm run bucket:sync:paths -- --dry-run prices`
//
// WHY: `bucket:sync` (plain `gsutil rsync -r data gs://…`) must build BOTH full
// listings before it diffs anything — 1,033,739 local files and ~761k bucket
// objects — and the `-x` exclusions filter only AFTER enumeration, so the
// PG-served `procurement/` (80,876 files) and `funds/` (182,377) are walked even
// though nothing from them is uploaded. With `parallel_process_count = 1` in
// ~/.boto (the macOS multiprocessing workaround, see the gsutil memory note)
// that listing is single-process and dominates: ~30 min regardless of churn.
// Measured 2026-07-10: prices 2.2s, myarea 1.3s, budget 63s — ~67s total for a
// typical orchestrator run vs ~30 min for the full sync. Same flags, same
// result; the only difference is how much of the tree gsutil has to enumerate.
//
// The full `bucket:sync` is still correct and still the right call after a
// pipeline run that rewrote unknown parts of the tree. This is the surgical
// path for the common case where you know exactly what changed.
//
// SAFETY: procurement/ (except roads.json + derived/mp_party.json), funds/,
// parliament/company-connections/ and _cache/ are served from Cloud SQL or are
// local-only PG load sources. `bucket:sync` excludes them by regex; here we
// REFUSE them outright rather than silently upload — a scoped sync that quietly
// pushed the procurement tree would re-publish a PG-served corpus to GCS.
//
// ORDERING: same as bucket:sync — run `npm run bucket:gz` afterwards if you
// touched one of the hot files it compresses (it re-uploads them gzipped, and
// rsync would otherwise clobber that). See scripts/bucket_gzip.ts.
//
// --delete (gsutil rsync -d) removes bucket objects that no longer exist locally.
// `bucket:sync` has never passed -d, so deleted files linger and are served
// forever — e.g. data/prices/settlement/{06570,07510,12961}.json dropped out of
// the corpus on 2026-07-10 and were still being served. It is OFF by default and
// deliberately NOT wired into the full-tree `bucket:sync`: a whole-tree -d would
// delete any bucket-served artifact that happens to be absent from THIS machine's
// data/ (gitignored trees built elsewhere). Scoped to a subtree you just
// regenerated, it is safe. Always run --dry-run --delete first and read the
// "Would remove" lines.

import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const BUCKET = "gs://data-electionsbg-com";
const DATA_DIR = "data";
const CACHE_CONTROL = "public,max-age=300,must-revalidate";
// Transport-encoding extension list — must match `bucket:sync`'s `-j`.
const GZIP_EXTS = "json,svg,xml,txt,html,css,md";

/** Paths under data/ that bucket:sync's -x regex excludes, i.e. never upload. */
export const isExcluded = (rel: string): string | null => {
  if (rel === "_cache" || rel.startsWith("_cache/"))
    return "_cache/ is a local build cache";
  if (rel === "funds" || rel.startsWith("funds/"))
    return "funds/ is served from Cloud SQL (db:load:funds:pg:cloud)";
  // Open calls are Cloud-SQL-served (open_calls, migration 142) exactly like funds/. The
  // committed data/opencalls/<source>.json is the LOADER'S SOURCE and the archive of what was
  // open when — never a serving artifact. Uploading it would create a second copy on a GCS
  // path nothing reads, i.e. a spare serving surface free to go stale.
  if (rel === "opencalls" || rel.startsWith("opencalls/"))
    return "opencalls/ is a PG load source, served from Cloud SQL (db:load:open-calls:pg:cloud)";
  if (rel.startsWith("parliament/company-connections"))
    return "parliament/company-connections/ is PG-served";
  // Per-MP bio profile shards: served from Cloud SQL (mp_profile_detail, schema 110,
  // /api/db/mp-profile) since persons-pg-retirement-v1 T2.3b. Kept on disk as the loader
  // SOURCE + the rollcall/name-casing build scripts read them; never re-upload. The sibling
  // parliament/photos/*.webp binaries STAY on the bucket (Decision 3).
  if (rel.startsWith("parliament/profiles"))
    return "parliament/profiles/ is a PG load source, served from Cloud SQL — never upload it";
  // The ~950 KB MP roster: served from Cloud SQL (mp_profile + mp_roster_meta, /api/db/mp-roster)
  // since persons-pg-retirement-v1 T2.4. Kept on disk as the loader SOURCE + read by the
  // preferences / person-resolve build scripts; never re-upload. The sibling
  // parliament/photos/*.webp binaries STAY on the bucket (Decision 3).
  if (rel === "parliament/index.json")
    return "parliament/index.json is a PG load source, served from Cloud SQL — never upload it";
  // Per-MP declaration + assets-rollup shards: served from Cloud SQL (mp_declarations()/
  // mp_assets(), /api/db/mp-declarations + mp-assets) since persons-pg-retirement-v1 T2.1b. Kept
  // on disk only as the parity-test reference (mp_serving / mp_declarations_assets gates); the
  // PG declaration tables load from the raw cacbg data, not these shards, so nothing needs them
  // at build time either. Never re-upload.
  if (
    rel.startsWith("parliament/declarations") ||
    rel.startsWith("parliament/mp-assets")
  )
    return "parliament/{declarations,mp-assets}/ are PG-served — never upload them";
  // Reader-free MP leaderboard/avatars singletons: their frontend readers moved to the PG
  // registry + routes in persons-pg-retirement-v1 T2.2/T2.3 (mp_assets_rankings / mp_cars /
  // car-makes / mp-avatars), but the files were never excluded — so bucket:sync would re-upload
  // them. They stay on disk (build output + parity-test reference); never serve them.
  if (
    rel === "parliament/avatars.json" ||
    rel === "parliament/assets-rankings.json" ||
    rel === "parliament/assets-rankings-top.json" ||
    rel === "parliament/mp-cars.json" ||
    rel === "parliament/car-makes.json"
  )
    return "parliament/{avatars,assets-rankings*,mp-cars,car-makes}.json are PG-served — never upload them";
  // The municipal-officials roster + name/search index are served from Cloud SQL
  // (municipal_officials_table, /api/db/table + municipal-officials-*-index) since
  // persons-pg-retirement-v1 T1.5. by_obshtina stays on disk as a PG LOAD SOURCE
  // (load_ngo_board_links_pg reads it for official_roster.obshtina; the councillor-signals
  // builders read it too) but must never re-upload to the bucket; search_index.json is a
  // retired served artifact kept on disk only for the offline search harness.
  if (rel.startsWith("officials/municipal/by_obshtina"))
    return "officials/municipal/by_obshtina/ is a PG load source, served from Cloud SQL — never upload it";
  if (rel === "officials/municipal/search_index.json")
    return "officials/municipal/search_index.json is retired — the header search reads municipal_officials_table via /api/db";
  // Judiciary PG load sources, served from Cloud SQL, never the bucket: magistrate_holdings.json
  // → the magistrate_* routes (schema 070); declarations.json → /api/db/judiciary-declarations
  // (judiciary_payloads, schema 109, persons-pg-retirement-v1 T2.6). Their still-served siblings
  // (caseload.json, court_load.json, budget/vss) stay on the bucket, so this is per-file.
  if (
    rel === "judiciary/magistrate_holdings.json" ||
    rel === "judiciary/declarations.json"
  )
    return "judiciary/*.json PG load source — served from Cloud SQL, never upload it";
  if (rel === "procurement" || rel.startsWith("procurement/")) {
    // Keep in sync with bucket:sync's -x regex allow-list in package.json.
    // procurement/projects/ is the exception: small static curated-project
    // files (the /procurement/project hub gallery) that ARE bucket-served,
    // not part of the PG-served corpus.
    const allowed = [
      "procurement/roads.json",
      "procurement/derived/mp_party.json",
      "procurement/derived/hub_stats.json",
      "procurement/derived/sector_stats.json",
    ];
    const isProjects =
      rel === "procurement/projects" || rel.startsWith("procurement/projects/");
    if (!isProjects && !allowed.includes(rel))
      return `procurement/ is served from Cloud SQL — only ${allowed.join(", ")} + procurement/projects/ belong on the bucket`;
  }
  return null;
};

// Excluded subtrees that live UNDER a still-bucket-served parent, so a scoped DIRECTORY
// rsync of that parent (e.g. `bucket:sync:paths -- officials/municipal`, a natural way to
// re-push the still-served index.json) would otherwise recursively re-upload them —
// isExcluded only guards the top-level argument, and the directory rsync's own -x carries
// just .DS_Store. Keep in lockstep with the isExcluded branches above. Deliberately NOT a
// blanket `search_index.json` match: parliament/votes/derived/search_index.json IS bucket-
// served, so the pattern must be anchored to the officials path.
const CHILD_EXCLUDES: { path: string; isDir: boolean }[] = [
  { path: "officials/municipal/by_obshtina", isDir: true },
  { path: "officials/municipal/search_index.json", isDir: false },
  // Under the still-served judiciary/ parent (caseload.json etc.), so a scoped
  // `bucket:sync:paths -- judiciary` must not re-upload these PG load sources.
  { path: "judiciary/magistrate_holdings.json", isDir: false },
  { path: "judiciary/declarations.json", isDir: false },
  // Under the still-served parliament/ parent (photos/*.webp), so a scoped
  // `bucket:sync:paths -- parliament` must not re-upload the PG-served profile shards
  // or the roster.
  { path: "parliament/profiles", isDir: true },
  { path: "parliament/index.json", isDir: false },
  { path: "parliament/declarations", isDir: true },
  { path: "parliament/mp-assets", isDir: true },
  { path: "parliament/avatars.json", isDir: false },
  { path: "parliament/assets-rankings.json", isDir: false },
  { path: "parliament/assets-rankings-top.json", isDir: false },
  { path: "parliament/mp-cars.json", isDir: false },
  { path: "parliament/car-makes.json", isDir: false },
  // isExcluded refuses `parliament/company-connections` as a direct argument, but that
  // only guards the top-level path — without a child exclude, the natural scoped push
  // `bucket:sync:paths -- parliament` (needed for photos/ + votes/) recursively uploaded
  // all ~16.8k per-EIK shards to the bucket, where nothing reads them: /company/:eik is
  // served from Cloud SQL.
  { path: "parliament/company-connections", isDir: true },
];

/** rsync -x alternatives (source-relative, anchored) for any CHILD_EXCLUDES strictly under
 *  the directory `relDir` — so scoping a sync to an ancestor cannot re-upload them. */
export const childExcludeRegexes = (relDir: string): string[] =>
  CHILD_EXCLUDES.filter((c) => c.path.startsWith(`${relDir}/`)).map((c) => {
    const rest = c.path.slice(relDir.length + 1).replace(/\./g, String.raw`\.`);
    return c.isDir ? `^${rest}/.*` : `^${rest}$`;
  });

const run = (args: string[], dryRun: boolean): number => {
  console.log(`  gsutil ${args.join(" ")}`);
  if (dryRun && !args.includes("-n")) return 0;
  const r = spawnSync("gsutil", args, { stdio: "inherit" });
  return r.status ?? 1;
};

export const syncPaths = (
  paths: string[],
  dryRun: boolean,
  del = false,
): number => {
  let failed = 0;
  for (const rel of paths) {
    const reason = isExcluded(rel);
    if (reason) {
      console.error(`✗ refusing ${rel} — ${reason}`);
      failed++;
      continue;
    }
    const local = join(DATA_DIR, rel);
    if (!existsSync(local)) {
      console.error(`✗ ${local} does not exist`);
      failed++;
      continue;
    }

    const isDir = statSync(local).isDirectory();
    console.log(`\n→ ${local} → ${BUCKET}/${rel}${isDir ? "/" : ""}`);

    // Directory: rsync with bucket:sync's exact header + transport-gzip flags.
    // Single file: `cp -Z` (stores it gzipped, the -j equivalent for cp).
    const args = isDir
      ? [
          "-m",
          "-h",
          `Cache-Control:${CACHE_CONTROL}`,
          "rsync",
          "-r",
          ...(del ? ["-d"] : []),
          ...(dryRun ? ["-n"] : []),
          // .DS_Store + any excluded child living under this dir (FINDING-001): a scoped
          // sync of an ancestor must not re-upload a retired subtree the full-tree -x drops.
          "-x",
          [String.raw`.*\.DS_Store$`, ...childExcludeRegexes(rel)].join("|"),
          "-j",
          GZIP_EXTS,
          local,
          `${BUCKET}/${rel}`,
        ]
      : [
          "-h",
          `Cache-Control:${CACHE_CONTROL}`,
          "cp",
          "-Z",
          local,
          `${BUCKET}/${rel}`,
        ];

    if (!isDir && dryRun) {
      console.log(`  (dry-run) would gsutil cp -Z ${local} ${BUCKET}/${rel}`);
      continue;
    }
    const status = run(args, dryRun);
    if (status !== 0) {
      console.error(`✗ gsutil exited ${status} for ${rel}`);
      failed++;
    }
  }
  return failed;
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run") || argv.includes("-n");
  const del = argv.includes("--delete");
  const paths = argv.filter((a) => !a.startsWith("-"));
  if (paths.length === 0) {
    console.error(
      "usage: bucket:sync:paths -- [--dry-run] [--delete] <subtree> [<subtree> …]\n" +
        "  subtrees are relative to data/, e.g. prices myarea budget data_map.json\n" +
        "  --delete removes bucket objects absent locally (dry-run it first)",
    );
    process.exit(1);
  }
  if (del && !dryRun)
    console.log(
      "⚠ --delete: bucket objects missing from data/ will be REMOVED. Ctrl-C now if you have not dry-run this.",
    );
  const failed = syncPaths(paths, dryRun, del);
  if (failed) {
    console.error(`\n✗ ${failed} path(s) failed`);
    process.exit(1);
  }
  console.log(`\n✓ ${paths.length} path(s) ${dryRun ? "checked" : "synced"}`);
}
