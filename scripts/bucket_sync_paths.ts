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
  if (rel.startsWith("parliament/company-connections"))
    return "parliament/company-connections/ is PG-served";
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
