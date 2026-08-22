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
// SAFETY: procurement/ (except roads.json + derived/mp_party.json), funds/ and
// _cache/ are served from Cloud SQL or are local-only PG load sources;
// parliament/company-connections/ is refused for a DIFFERENT reason — it is a
// RETIRED tree whose builder is deleted but whose local copy survives on every
// machine that ever ran it, see its branch below. `bucket:sync` excludes them by regex; here we
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
  // ⚠️ PRE-EXISTING LOCKSTEP HOLE, closed 2026-08-21. `prices/` is in BOTH -x regexes and had
  // no branch here — and `prices` is this file's own worked example, in the usage header, the
  // dry-run line and the CLI help. So the one command the documentation tells you to run,
  // `bucket:sync:paths -- prices`, walked straight past the guard and re-published a
  // Cloud-SQL-served tree (migration 048: every dashboard payload is a price_payloads row
  // behind /api/db/price-payload). Exactly the failure the SAFETY header describes, reachable
  // from the header's own example.
  //
  // The two files that DO live under data/prices/ — product_slugs.json (prerender + sitemap)
  // and product_overrides.json (an input to rebuild_catalog) — are read from the local repo
  // path at build time and never fetched over HTTP, so refusing the whole prefix costs
  // nothing.
  if (rel === "prices" || rel.startsWith("prices/"))
    return "prices/ is served from Cloud SQL (price_payloads, migration 048) — never upload it";
  // ⚠️ [2026-08-16] THE DECISION THIS BRANCH RECORDED AS OPEN HAS BEEN TAKEN: the tool moved
  // to Postgres and the bucket tree is GONE (`gsutil -m rm -r` on the same day; `gsutil ls`
  // returns „matched no objects"). It is kept as an exclusion, not deleted, so a stale local
  // `data/parliament/company-connections/` cannot silently re-upload 19,232 objects on the
  // next full sync.
  //
  // The history, because the failure mode is the reusable part. This branch used to say the
  // tree was „PG-served". It was not: the AI chat's `companyConnections` tool fetched
  // `/parliament/company-connections/{eik}.json` from THIS BUCKET at runtime, and since
  // `gsutil rsync -x` excludes a match from DELETION as well as upload, the 16,609 objects sat
  // frozen at their 2026-07-29 vintage while the tool answered from that snapshot at a 200.
  // An exclusion FREEZES a tree; it never retires one, and a comment asserting why a tree is
  // excluded is not evidence that the reason is still true.
  //
  // It is genuinely PG-served now: migration 158 `company_political_links`, behind
  // `/api/db/company-connections`. Not a port — the shards matched TR officers to a power
  // roster by name; the function reads the gated `person_role` tr/ngo set and refuses a name
  // the Commerce Registry records for more than one human.
  //
  // ⚠️ THE EXCLUSION NOW GUARDS RESIDUE, WHICH IS WHY IT OUTLIVES ITS PRODUCER.
  // `scripts/declarations/tr/build_company_connections.ts` was DELETED on 2026-08-16 (it was
  // retained for a day on the theory that it was the only path able to reconstruct the removed
  // objects — untrue twice over: it was a git-TRACKED file, so `git show <sha>:<path>` restores
  // it, and its 19,232-file output was still on disk). Nothing writes the tree any more.
  //
  // But nothing DELETES it either, and it is gitignored — so those 19,232 files (83 MB) sit on
  // every machine that ever ran a `tr:daily-refresh` or `--declarations`, frozen at whatever
  // vintage that machine last built, for ever. A retired producer makes this branch MORE
  // load-bearing, not less: while the builder ran the tree was at least current, and a
  // re-upload would merely have been pointless. Now it would republish a dead snapshot.
  //
  // Anchored to the DIRECTORY. Without the trailing slash this also swallowed
  // `parliament/company-connections-stats.json` — a different artifact, with no
  // reader — and told the operator „an AI tool still reads it", which is false
  // of that file. It is handled by the retired-artifact arm below.
  if (
    rel === "parliament/company-connections" ||
    rel.startsWith("parliament/company-connections/")
  )
    return "parliament/company-connections/ is retired — PG-served via /api/db/company-connections (migration 158); bucket objects removed 2026-08-16";
  // Retired connections artifacts with NO reader anywhere — checked across src/,
  // ai/, scripts/ and functions/. `ai/` is the one that matters and the one a
  // grep of the first three misses: it is where company-connections and both
  // connections-rankings files turned out to be live, so absence here was
  // established the same way their presence was.
  //
  // NOT in this list, deliberately: `connections.json` (a published dataset on
  // /data — scripts/prerender/routes.ts's CATALOG_SPECS offers it for download
  // in both languages), and `connections-rankings{,-top}.json` (fetched by the
  // AI's mpConnectionsTop and per-party rollup tools).
  if (
    rel.startsWith("parliament/mp-connections") ||
    rel.startsWith("parliament/official-connections") ||
    rel === "parliament/connections-search.json" ||
    rel === "parliament/connections-top-pairs.json" ||
    rel === "parliament/connections-stats.json" ||
    rel === "parliament/connections-party-matrix.json" ||
    rel === "parliament/company-connections-stats.json"
  )
    return "retired connections artifact — no reader in src/, ai/, scripts/ or functions/";
  // The per-MP roster shards, retired by persons-pg-retirement-v1 T2.1 in favour
  // of /api/db/mp-entry (mp_profile, migration 105). The DISK copy stays — it is
  // the parity reference mp_serving.data.test.ts reads and build_mp_by_id.ts
  // still writes it — but the 2,123 bucket objects have no reader at all.
  if (rel.startsWith("parliament/by-id"))
    return "parliament/by-id/ is PG-served (/api/db/mp-entry); the disk copy is a parity reference, never upload it";
  // Per-município quarterly fiscal indicators: served from Cloud SQL
  // (municipal_fiscal, migration 149, db:load:municipal-fiscal:pg:cloud). The
  // committed data/budget/municipal_fiscal/*.json is the LOADER'S SOURCE, never
  // a serving artifact — same rule as funds/ and opencalls/ above. It also
  // needs the CHILD_EXCLUDES twin below, because this branch only guards a
  // DIRECT argument and the natural push is the whole `budget` subtree.
  if (rel.startsWith("budget/municipal_fiscal"))
    return "budget/municipal_fiscal/ is a PG load source (db:load:municipal-fiscal:pg)";
  // The council corpus is PG-served (migrations 160/161) — /api/db/council-overview,
  // -muni and -resolution. Every reader moved off the bucket in council-hub-v1
  // tiers 5-7: the My-Area tile, the alerts builder and both AI tools.
  //
  // The tree STAYS on disk and in git — data/council/<code>/<YYYY>/<id>.json is
  // the loader's input, and index.json + votes/ are the scraper's own output.
  // What must not happen is a second copy on a bucket path nothing reads, free
  // to go stale: this repo has pushed ~16.8k orphan shards that way before.
  //
  // ⚠️ This FREEZES the bucket copy, it does not remove it. `gsutil rsync -x`
  // excludes a match from DELETION as well as upload and syncPaths passes -x
  // with -d, so the existing objects stay until an explicit operator action:
  //   gsutil -m rm -r gs://data-electionsbg-com/council
  // Do that only after the readers are deployed — removing them while a shipped
  // reader still fetches is what left parliament/company-connections/ answering
  // from a July snapshot at a 200.
  if (rel === "council" || rel.startsWith("council/"))
    return "council/ is a PG load source, served from Cloud SQL (db:load:council:pg:cloud)";
  // The registry people-count artifact: a 12 MB LOADER SOURCE for tr_name_fold_people
  // (migration 148, db:load:tr-name-fold-people:pg), never fetched by a browser. Same rule
  // as opencalls/ above, with two extra reasons to be sure: .tsv is not in GZIP_EXTS so it
  // would go up UNCOMPRESSED, and a stale public copy of a name→people-count table is a
  // worse thing to leave lying around than a stale copy of most artifacts.
  if (rel === "person/tr_name_fold_people.tsv")
    return "person/tr_name_fold_people.tsv is a PG load source (db:load:tr-name-fold-people:pg)";
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
  // The three MP↔company shard families, retired by mp-tr-edges-pg-v1. Unlike most entries
  // here these are not load sources either — nothing on disk or at build time reads them any
  // more (step 4 cut augment_mp_roles' loop, which was the last reader). They are served by
  // mp_tr_roles (150) and place_mp_companies (151) instead, from the GATED person layer, so
  // the bucket copies do not merely go stale: they publish 410 attributions that rest on a
  // name the Commerce Registry says belongs to more than one human, which every other surface
  // has stopped making.
  if (
    rel.startsWith("parliament/mp-management") ||
    rel.startsWith("parliament/companies-by-ekatte") ||
    rel.startsWith("parliament/companies-by-obshtina")
  )
    return "parliament/{mp-management,companies-by-ekatte,companies-by-obshtina}/ are retired — served from Cloud SQL (migrations 150/151)";
  // companies-index.json — the 4.16 MB name-keyed company index behind the retired
  // /mp/company/:slug. DELETED from the repo in the same commit as this entry
  // (company-page-consolidation-v1 Tier 5.2), so unlike the entries above this is not a
  // "stale but harmless" case and not a load source either: no producer remains, and the
  // bucket copy would be the last surviving instance of a set of MP↔company attributions
  // that 096 declines to make for 1,751 of its 2,120 UICs.
  //
  // ⚠️ AN EXCLUSION FREEZES, IT DOES NOT RETIRE. gsutil rsync -x excludes a match from
  // DELETION as well as upload, and syncPaths passes -x with -d, so removing the object is a
  // separate operator action:
  //     gsutil rm gs://<bucket>/parliament/companies-index.json
  if (rel === "parliament/companies-index.json")
    return "parliament/companies-index.json is retired and deleted — never upload it (gsutil rm the bucket copy)";
  // ⚠️ [2026-08-16] THESE THREE ARE GONE FROM THE BUCKET, and this note used to
  // say their removal was pending. Measured with `gsutil ls`: mp-management/,
  // companies-by-ekatte/ and companies-by-obshtina/ each return „matched no
  // objects". The „1,542 frozen objects" the old paragraph described no longer
  // exist — and that figure was itself 896+376+270, the LOCAL FILE counts
  // presented as a bucket measurement, which is the same drift one level down.
  //
  // WHAT removed them is not recoverable: the bucket has no lifecycle rule and
  // versioning is Suspended, so an operator `rm`, a pre-exclusion
  // `bucket:sync:paths --delete`, or a console deletion all fit the evidence
  // equally. Only the absence is measured.
  //
  // The MECHANISM this note documents is still true and still the thing to know:
  // `gsutil rsync -x` excludes a match from DELETION as well as from upload
  // ("not copied or deleted" — gsutil's own help), and syncPaths passes `-x`
  // together with `-d`. So an exclusion FREEZES a tree rather than retiring it,
  // and removing the objects is always separate:
  //
  //   gsutil -m rm -r gs://<bucket>/parliament/<family>
  //
  // Scoping a sync to the tree instead does not work — isExcluded refuses it as
  // a top-level argument, by design.
  //
  // FROZEN UNDER parliament/ TODAY, so the mechanism is live rather than
  // historical (measured 2026-08-16):
  //
  //   · the eight site-hygiene-v1 T6b families — 12,533 objects, 52.5 MB, none
  //     with a reader. These are the ones an `rm` would be right for.
  //
  // company-connections/ was a ninth entry here until 2026-08-16, listed as
  // „⚠️ DO NOT rm — it has a LIVE READER". That was true when written and false
  // by the time it was read: the reader moved to Postgres and the 16,609 objects
  // were removed the same day, while this list went on saying otherwise a few
  // dozen lines below the branch that recorded the removal. Two descriptions of
  // one tree in one file is how that happens — when a family leaves this list,
  // check its isExcluded branch says the same thing.
  //
  // („Frozen" here is scoped to parliament/ on purpose: funds/ and procurement/
  // are excluded too and far larger — funds/ alone is 182,075 objects and
  // 560 MB — but those are PG-served by design, not retired artifacts.)
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
  // A diagnostic left over from the postcode ingest — a list of postcodes the resolver could
  // not place. No reader anywhere (verified across src/, ai/, functions/, scripts/prerender/
  // 2026-08-21); it was never a serving artifact, it was uploaded because the whole tree was.
  // Retired 2026-08-21 (json-retirement-v2 Tier 4a): the My-Area tender tile reads
  // /api/db/myarea-place-tenders (migration 179) and build_alerts.ts no longer writes these
  // files. Unlike most retirements here the 286 shards were git-TRACKED rather than
  // gitignored, so they were DELETED in the same commit — a tracked artifact with no
  // producer and no reader is not residue to be guarded, it is a file to remove, and leaving
  // it would have frozen a corpus-anchored snapshot in git that goes stale on the next
  // tenders load. This entry therefore guards a working copy that predates the deletion.
  //
  // ⚠️ AN EXCLUSION FREEZES, IT DOES NOT RETIRE. Ship the reader, verify on prod, then:
  //     gsutil -m rm -r gs://<bucket>/myarea/place_tenders
  // The per-MP shard tree and dissents.json, retired by json-retirement-v2 Tier 2. Both are
  // served from Postgres now — /api/db/mp-dissents (135) and /api/db/mp-loyalty (182) — and
  // useMpShard is deleted, so nothing fetches either.
  //
  // dissents.json alone was 32,575,807 bytes served UNCOMPRESSED, reached whenever the
  // per-MP shard was missing, which it was for 36 members.
  //
  // ⚠️ loyalty.json AND similarity.json ARE NOT HERE, and the first draft of this entry
  // wrongly listed both. They still have LIVE READERS that a `src/`-only grep misses —
  // exactly the blind spot CLAUDE.md records from the company-connections incident, where an
  // excluded-but-still-fetched tree answered from a frozen snapshot at a 200 for weeks:
  //
  //   loyalty.json     src/data/myarea/useMpSignals.ts (two My-Area screens)
  //                    ai/tools/parliament.ts (mpLoyalty + a per-party rollup, and it is
  //                    named in those tools' `provenance`)
  //   similarity.json  ai/tools/parliament.ts
  //
  // Retiring them means moving those readers first — the My-Area one onto /api/db/mp-loyalty,
  // the AI tools onto the same routes — not adding a line here.
  //
  // The two that ARE listed stay on disk: rebuildDerived still writes them and the gates read
  // them as parity references. What must not happen is a second copy on a bucket path nothing
  // fetches, free to go stale — the shape that put ~16.8k orphan shards there.
  //
  // ⚠️ AN EXCLUSION FREEZES, IT DOES NOT RETIRE. Ship the readers, verify on prod, then:
  //     gsutil -m rm -r gs://<bucket>/parliament/votes/derived/per-mp
  //     gsutil rm gs://<bucket>/parliament/votes/derived/dissents.json
  if (
    rel === "parliament/votes/derived/per-mp" ||
    rel.startsWith("parliament/votes/derived/per-mp/") ||
    rel === "parliament/votes/derived/dissents.json" ||
    // Tier 3c. Its only reader was usePartyPairBreaks, now on /api/db/party-pair-breaks
    // (party_pair_break, 183); no ai/ tool touches it, checked the way the two above were.
    rel === "parliament/votes/derived/party_pair_breaks.json"
  )
    return "parliament/votes/derived/{per-mp,dissents,party_pair_breaks} are retired — served from Cloud SQL (135 + 182 + 183)";
  if (rel === "myarea/place_tenders" || rel.startsWith("myarea/place_tenders/"))
    return "myarea/place_tenders/ is retired — served from Cloud SQL (/api/db/myarea-place-tenders, migration 179)";
  if (rel === "parliament/postcode_unresolved.json")
    return "parliament/postcode_unresolved.json is an ingest diagnostic with no reader — never upload it";
  // The municipal-officials roster + name/search index are served from Cloud SQL
  // (municipal_officials_table, /api/db/table + municipal-officials-*-index) since
  // persons-pg-retirement-v1 T1.5. by_obshtina stays on disk as a PG LOAD SOURCE
  // (load_ngo_board_links_pg reads it for official_roster.obshtina; the councillor-signals
  // builders read it too) but must never re-upload to the bucket; search_index.json is a
  // retired served artifact kept on disk only for the offline search harness.
  //
  // ⚠️ WIDENED 2026-08-21 from those two paths to the WHOLE of officials/municipal/ (and
  // officials/declarations/ + officials/derived/ + the four root JSONs below). The narrow
  // form matched what had been retired one artifact at a time and left the rest of a
  // 510 MB tree syncing, of which — measured by enumerating every `dataUrl()` call site in
  // src/, ai/, functions/ and scripts/prerender/ — exactly ONE file has a live reader:
  // officials/municipal_contacts/index.json, 226 KB, which stays uploadable below.
  //
  // The rest is loader input and retired serving artifacts:
  //   declarations/  252 MB  the `declaration` corpus (089); read off DISK by the loader
  //   municipal/      49 MB  municipal_officials_table (102) + /api/db/municipal-officials-*
  //   derived/        15 MB  connections.json + the retired company_links.json (Tier 6)
  // Those are LOCAL sizes (23,054 files) — what a sync would stop uploading. The BUCKET holds
  // 510 MB under officials/, so ~190 MB of it no longer exists locally at all: stale objects
  // that only an explicit `gsutil rm` removes, since an exclusion also excludes from -d.
  // by_obshtina stays on disk as a PG LOAD SOURCE (load_ngo_board_links_pg reads it for
  // official_roster.obshtina; the councillor-signals builders read it too) — excluded here
  // means "never re-upload", never "delete from disk".
  if (
    rel === "officials/declarations" ||
    rel.startsWith("officials/declarations/")
  )
    return "officials/declarations/ is a PG load source (db:load:declarations:pg) — never upload it";
  if (rel === "officials/municipal" || rel.startsWith("officials/municipal/"))
    return "officials/municipal/ is a PG load source, served from Cloud SQL (municipal_officials_table, 102) — never upload it";
  if (rel === "officials/derived" || rel.startsWith("officials/derived/"))
    return "officials/derived/ is retired — company_links.json was deleted 2026-08-21 (company_politicians at kind='official' replaces it)";
  // The four officials root artifacts, all replaced by officials_rankings_table (100) and
  // the `officials_rankings` registry resource. Per-file rather than a prefix, because
  // officials/municipal_contacts/ is a LIVE bucket read (useMunicipalContacts).
  if (
    rel === "officials/index.json" ||
    rel === "officials/obligations.json" ||
    rel === "officials/assets-rankings.json" ||
    rel === "officials/assets-rankings-top.json"
  )
    return "officials/{index,obligations,assets-rankings,assets-rankings-top}.json are PG-served (officials_rankings_table, 100) — never upload them";

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
  // Under the still-served person/ parent (prerender_slugs.json), so a scoped
  // `bucket:sync:paths -- person` must not carry the 12 MB load source up with it.
  { path: "person/tr_name_fold_people.tsv", isDir: false },
  // WIDENED 2026-08-21 alongside isExcluded: the whole of these three, not the three
  // individual artifacts that used to be listed. officials/ keeps ONE live reader
  // (municipal_contacts/index.json), so the parent cannot be excluded and every scoped
  // `bucket:sync:paths -- officials` walks straight into these subtrees without the twin.
  { path: "officials/declarations", isDir: true },
  { path: "officials/municipal", isDir: true },
  { path: "officials/derived", isDir: true },
  { path: "officials/index.json", isDir: false },
  { path: "officials/obligations.json", isDir: false },
  { path: "officials/assets-rankings.json", isDir: false },
  { path: "officials/assets-rankings-top.json", isDir: false },
  // Under the still-served parliament/ parent (photos/, connections.json, votes/).
  { path: "parliament/postcode_unresolved.json", isDir: false },
  // Under the still-served myarea/ parent (alerts/ is still a bucket read until Tier 4b).
  { path: "myarea/place_tenders", isDir: true },
  // Under the still-served parliament/ parent (photos/, connections.json, votes/index.json).
  { path: "parliament/votes/derived/per-mp", isDir: true },
  { path: "parliament/votes/derived/dissents.json", isDir: false },
  { path: "parliament/votes/derived/party_pair_breaks.json", isDir: false },
  // Under the still-served judiciary/ parent (caseload.json etc.), so a scoped
  // `bucket:sync:paths -- judiciary` must not re-upload these PG load sources.
  { path: "judiciary/magistrate_holdings.json", isDir: false },
  { path: "judiciary/declarations.json", isDir: false },
  // Under the still-served parliament/ parent (photos/*.webp), so a scoped
  // `bucket:sync:paths -- parliament` must not re-upload the PG-served profile shards
  // or the roster.
  // Deleted from the repo (Tier 5.2), so a scoped `bucket:sync:paths -- parliament` cannot
  // upload it — but the bucket copy survives an exclusion, and this twin is what stops a
  // future re-appearance of the file being pushed back up beside it.
  { path: "parliament/companies-index.json", isDir: false },
  { path: "parliament/mp-management", isDir: true },
  { path: "parliament/companies-by-ekatte", isDir: true },
  { path: "parliament/companies-by-obshtina", isDir: true },
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
  // all ~16.8k per-EIK shards to the bucket.
  //
  // ⚠️ THIS TWIN IS NOW THE LOAD-BEARING HALF. The bucket objects were removed 2026-08-16 and
  // `build_company_connections.ts` was deleted with them — but deleting the producer does not
  // delete its output. The 19,232 gitignored local files stay on every machine that ever ran a
  // TR refresh, unread and un-rewritten, so without this entry the next
  // `bucket:sync:paths -- parliament` would re-create the whole retired tree in the bucket from
  // a snapshot that no longer has anything regenerating it.
  { path: "parliament/company-connections", isDir: true },
  // The T6b set. Each needs its twin here as well as the isExcluded branch,
  // because that branch only guards a DIRECT argument and the push anyone
  // actually runs is `bucket:sync:paths -- parliament` (needed for photos/ and
  // votes/) — which recurses straight past it. That is the exact shape that put
  // ~16.8k company-connection shards on the bucket in the first place.
  { path: "parliament/mp-connections", isDir: true },
  { path: "parliament/official-connections", isDir: true },
  { path: "parliament/by-id", isDir: true },
  { path: "parliament/connections-search.json", isDir: false },
  { path: "parliament/connections-top-pairs.json", isDir: false },
  { path: "parliament/connections-stats.json", isDir: false },
  { path: "parliament/connections-party-matrix.json", isDir: false },
  { path: "parliament/company-connections-stats.json", isDir: false },
  // Under the still-served budget/ parent (kfp.json, ministries/, noi/ …), so a
  // scoped `bucket:sync:paths -- budget` must not re-upload this PG load source.
  // Without it the isExcluded branch above is dead for the only push anyone
  // actually runs — the same shape that put ~16.8k company-connection shards on
  // a bucket where nothing reads them.
  { path: "budget/municipal_fiscal", isDir: true },
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
