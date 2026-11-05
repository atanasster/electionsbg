# Move the frozen news project out of data-bg

**Status:** Phases 0–5 done on 2026-11-05 (see the execution log at the end). Phase 6 hold running; Phase 7 needs explicit approval.
**Measured:** 2026-11-05 at `d8dceeccb8`, read-only. Audited the same day; see the audit log at
the end for what changed.
**Goal:** a self-contained project at `/Volumes/Storage/naiasno-news` that builds and tests with
no access to this repo, followed by a clean removal from this repo, without losing any file and
without changing anything live until a deliberate decision to do so.

## Decisions needed before Phase 1

| # | Decision | Recommendation |
| - | -------- | -------------- |
| D1 | **Destination.** `~/Storage` does not exist. `/Volumes/Storage` does: external USB, APFS, 469 GB free. | Use `/Volumes/Storage/naiasno-news`. Keep it separate from the existing `/Volumes/Storage/data-bg/raw_data/prices`. |
| D2 | **Live surfaces.** `news.electionsbg.com` still answers 200, its app-data manifest was last written 2026-10-24, and `newsEvals` stays deployed in the `electionsbg-news` Firebase project, still accepting public submissions nobody is reviewing. | Leave it running during the move. Decide separately whether a frozen site should keep accepting submissions (Phase 8). |
| D3 | **Credentials.** Two service-account keys, a gcloud token store and the OpenRouter key exist. The Storage volume is **not encrypted**. | Use an encrypted sparsebundle, never plaintext on Storage. Revoke what is no longer needed; the hourly job was the main user of these keys, so check for other users first. |
| D4 | **Second copy.** `/Volumes/Storage` is excluded from Time Machine, while `news/data` is included today, so deleting the originals removes it from backup as old snapshots age out. The GCS archive does **not** cover everything (see below). | Make a full second copy of the 5.7+ GB the archive lacks before Phase 7. |
| D5 | **Main-site „В медиите" tile.** Confirmed dead: 0 of 817 live bucket shards carry the `tone` block it needs. | Retire the tile, its hook and its gate. Readers see no change. |
| D6 | **Git remote for the new repo.** `atanasster/electionsbg` is **public**, and the new repo contains third-party article text (`news/data/gold`). | Local only. Any later remote must be private. |
| D7 | **Firestore.** The code names 18 collections, but only 4 exist, holding 12,605 task and sync documents. There are no submissions. | Exported read-only into the encrypted store. |
| D8 | **Public history.** Removing `news/data/gold` from `main` does not remove it from public git history, which still holds the 289 third-party article copies. | Separate decision. A history rewrite is not part of this move; if the text should not be public, that needs its own plan. |

## What was measured

### Size and scope

| Tree | On disk | Files | Git-tracked |
| ---- | ------- | ----- | ----------- |
| `news/` | 8.6 GB | 321,616 | 631 |
| `newsapp/` | 2.3 MB | 213 | 211 |
| `news-functions/` | 95 MB (mostly `node_modules`) | 75 excluding it | 31 |
| `dist-news/` | 269 MB | build output | 0 |
| `data/news/` | 8.8 MB | 1,052 | 0 |

Nearly all of the 8.6 GB is **gitignored**, so `git clone` alone would lose it: `_nightly` 2.8 GB,
`_html` 2.5 GB, `analysis` 1.3 GB, `app-data` 721 MB. The move needs two tracks, history through
git and data through a verified copy. 348 of 6,705 commits touch the three trees, and no file was
renamed into them from elsewhere, so path filtering keeps the full history.

Also part of the project, outside those trees:

- 8 `scripts/news_*` files, `tests/news/` (3 specs), `vite.config.news.ts`,
  `playwright.news.config.ts`, `firebase.news-evals.json`, `firebase.news-evals-emulator.json`
- 69 lines in `package.json`
- 5 skills: `analyze-news-article`, `fetch-news-articles`, `fetch-news-articles-all`,
  `save-news-articles`, `update-news-sites`
- `VITE_NEWS_DATA_BASE_URL` and `VITE_NEWS_EVAL_TURNSTILE_SITE_KEY` in the gitignored root
  `.env.production.local`. Without them the build still exits 0, falling back to `/news-data`
  and leaving the Turnstile key empty.

### Plans, docs and reports

Moved plans must exist as **files** in the new repo, not only in its history.

| Material | Today | Action |
| -------- | ----- | ------ |
| `docs/policies/news-image-rights.md`, `news-person-pages.md` | tracked | move |
| `docs/references/news-home-editorial-grid-v4/`, `news-story-cards-v3/` | tracked | move |
| 15 `docs/plans/news-*.md` + 2 QA `.jpg` | **deleted in `cf6ec257dd`, history only** | restore as files |
| 6 `news/evals/*.md` (jev-benchmark, jev-contract, openrouter-pilot, openrouter-political-100, phase0-scheduler, publish-baseline) | **deleted, history only**; still cited, e.g. by `jev_client.py` | restore as files |
| `news/evals/*.md`, `news/standalone/README.md`, `news/eval_contract/*.md`, `news/prompts/*`, `news-functions/README.md` | tracked, inside the trees | move with the tree |
| `news/var/reports` (2,764), `news/data/_nightly` (1,122), `news/data/_perf`, `news/review` | mostly ignored | Phase 3 copy; the only local record of pipeline runs |
| `.zcode/plans/plan-sess_95332f7a-….md` (the original Наясно Новини app plan) | **ignored, outside the repo's tracked docs** | copy to `docs/plans/` |
| `docs/deferred-followups.md` lines 554–587 | section of a shared file | move the section to the new repo, leave a pointer |
| `docs/audits/deferred-followups-verification-2026-10.md` items 47–49 | section of a dated audit | copy; leave the audit intact |
| `.claude/launch.json` `news-dev` entry | shared file | copy, then remove |
| This plan | here | move last, leave a pointer in `README.md` |

**To stay here, reviewed and unrelated to news:**

- `reports/` (two declarations reports), `scratch/`, and `data-reports/` (169 files, no references
  to the news site)
- `docs/plans/jev-chat-integration-v1.md`, `jev-typesafe-eval-v1.md`, `docs/social/jev-worth-the-hype.md`
  and `docs/audits/editorial-measure-review-*`: AI-chat work, with no news references
- `docs/audits/editorial-question-*.json`: `retrievalCorpus: "news/"` is a type literal describing
  an unavailable AI-chat capability. Nothing reads the folder.
- `docs/audits/ai-chat-audit-2026-09-09.md`: dated record, passing mention only

**Stale after the move, needing a one-line note:** `docs/plans/auth-membership-dashboard-v1.md`
(its Phase 6 and the storage tables assume a news app in this repo).

**Generated, not moved:** `test-results/`, `playwright-report/`, `.firebase/hosting.ZGlzdC1uZXdz.cache`.

**Missing and must be written:**

- `CLAUDE.md` for the new repo. This repo's `CLAUDE.md` holds no news knowledge (its 4 hits are
  unrelated), so the operating notes live in the skills, `news/STANDALONE_SETUP.md` and memory.
- `LICENSE`: the MIT notice must travel with the vendored code.
- `docs/testing-standards.md`: copy it, since the test layout follows it.

**Agent memory**, which no git operation will carry:

| File | Action |
| ---- | ------ |
| `project_news_jev_published.md` | move its content into the new repo's `CLAUDE.md`, then delete |
| `project_naiasno_rebrand.md` lines 58–68 | copy the news facts (`news.naiasno.bg` does not resolve, canonical stays on electionsbg.com); keep the rest |
| `reference_typecheck_tsc_build.md` | remove the `newsapp` warning after Phase 5 |
| `MEMORY.md` | update the index and add a line saying news moved and where |

### Hazards found

1. **`git rm` removes the rules protecting the credentials, and this is a public repo.** Most
   ignored data is covered only by the **nested** files `news/.gitignore`, `news/data/.gitignore`,
   `news/review/.gitignore` and `news-functions/.gitignore`. That includes
   `news/credentials/*.json`, `news/.env.api`, `news/.env.upload`, `news/var/` and all of
   `news/data/*/`. Deleting those files makes everything untracked, and the concurrent
   auto-committer runs `git add -A`. The result would be service-account keys and 320k files
   committed to a public repo. Phase 5 is ordered around this.
2. **`com.naiasno.news-staleness` is still running.** It fires every 30 minutes, last exit 1, and
   writes `news/var/` (latest 2026-11-05 03:55). It would change the tree during a copy and would
   recreate `news/var/` after deletion. `com.naiasno.news-hourly` is already disabled, but its
   plist remains and `news/var/hourly.lock` is stale.
3. **Six tracked files have uncommitted changes:** `news/data/common_words.json`,
   `news/data/gazetteer.json` and four `news/review/*.json` queues. History extraction would
   silently miss them.
4. **The internal disk is 95% full, 21 GB free.** No intermediate copies may go there.
5. **`bucket:sync:paths -- news --delete` can wipe the live site.** `data/news/` holds only
   `mentions/`, while `gs://data-electionsbg-com/news/` also holds `app-data/` (1.31 GiB, what the
   site reads). Plain `bucket:sync` passes no `-d`, so it is safe. Add `news` to `isExcluded`.
6. **`naiasno-post` rule 8 runs `news/scripts/publication_freeze.py`** and says to stop on a
   non-zero exit. Once the script is gone, every run of that step fails.
7. **`news/.env.pipeline` holds an absolute `PGPASSFILE` path**, and `build_gazetteer.py` defaults
   to the local data-bg Postgres. The frozen project must not silently depend on either.
8. **`build:news` mutates data** (`news:data`, `news:evals:tasks:write`). It must not be used for
   the baseline in this repo.
9. **The private archive is partial.** `gs://elections-bg-news-archive` (1.5 GiB, versioned, last
   write 2026-10-24) deliberately excludes `_browser`, `_html`, `_nightly`, `_perf`, `evals`, `gold`
   and `_summaries*`. It also never held `news/var`, `news/review` or `app-data`. Most of the
   measured archive is `analysis/`.
10. **The live build cannot be reproduced exactly.** `dist-news/` dates from 2026-09-26, matching
    the live site's last-modified. The new repo's build will differ.
11. **Secrets that exist only in the cloud:** `NEWS_EVAL_TURNSTILE_SECRET` and
    `NEWS_EVAL_HMAC_KEYRING` are in Firebase Secret Manager. Record that they exist; do not copy
    them out unless redeployment is planned.

### Dependencies

**newsapp depends on this repo for only a small slice**, which makes vendoring cheap:

- 23 `src/` modules (72 KB), computed by bundling `newsapp/main.tsx` with esbuild. A second pass
  over every newsapp, `scripts/news_*` and `tests/news` entry, tests included, adds only
  `scripts/lib/strip_comments.ts` and `tests/edgeTest.ts`.
- `src/index.css`, `src/App.css`, and the 13 entries in `vite.config.news.ts`'s `KEEP` set from
  `public/`.
- Root config: `tsconfig.app.json`, `tsconfig.node.json`, `tailwind.config.js`,
  `postcss.config.js`, `vitest.setup.ts`, `vitest.config.ts` (news arms), `eslint.config.js`,
  `components.json`, plus the `.env.*` rule (line 35 of the root `.gitignore`, which does not
  contain the word "news" and is easy to miss).
- About 50 npm packages (react, react-router, radix, react-i18next, lucide…), plus the build and
  test tooling.

**The news pipeline is close to standalone, but reads more of this repo than `STANDALONE_SETUP.md`
implies:**

| Read | From | Handling |
| ---- | ---- | -------- |
| `data/canonical_parties.json` | `party_identity.py`, `build_gazetteer.py` | vendor |
| `data/governments.json` | `build_gazetteer.py` | vendor |
| `src/locales/bg,en/translation.json` | `person_identity_join.py`, `review_persons.py`, `build_feedback_targets.py` | vendor |
| `src/screens/governance/sectorRegistry.ts` | `build_feedback_targets.py`, which raises rather than degrades | vendor |
| `data/news/mentions/` | `build_mention_index.py`, `upload_to_gcs.py` | copy; path stays the same |
| Postgres `person` tables | `build_gazetteer.py` via `psql` | keep the committed `gazetteer.json`; rebuilding needs a DB and must fail with a clear message |

**Tests that assert things about this repo:**

- `news-functions/test/scaffold.test.mjs` reads `firebase.main-functions.json`, the root
  `package.json`, the CI workflow and `firestore.rules`. Its boundary assertions need rewriting
  for one project.
- `scripts/news_accessibility.test.ts` reads `src/layout/header/Header.tsx`, `src/App.css` and
  `checkbox.tsx`.

Forty scripts resolve the root as `parents[2]`, so **the directory layout must not change**.
`news/`, `newsapp/` and `news-functions/` stay at the top level of the new repo.

**The main site does not use news at runtime in any visible way.** `usePersonMediaTone` fetches
`/news/mentions/person/*.json` from the bucket, and all 817 shards checked live on 2026-11-05
lack `tone`, so `PersonInTheMedia` renders nothing for anyone. Retiring it also retires a gate
(`news_mention_person_slugs.data.test.ts`) that frozen shards would otherwise fail as slugs drift.

### What looks like news and must stay

| Item | Why it stays |
| ---- | ------------ |
| `ai/llm/jev*`, `functions/jev_*`, `data/ai/evals/jev*`, `ai/evals-internal/jev*` | AI-chat model. `news/scripts/jev_client.py` is a port, not a consumer. |
| `src/ux/feed/*` (`NewsCard`, `NewsRail`, `LeadCard`) | Parliament hub UI |
| `FundsNewsRail`, `funds_news`, `funds_wire` | `/funds` feature |
| `scripts/polls/*`, `scripts/opencalls/*`, `scripts/watch/sources/{ahu_calls,cik,…}`, `scripts/defense/sources.ts` | Match on other sites' `/news/` URLs |
| `firestore.rules` | Also deployed to `elections-bg`. Copy it, do not move it. |
| `firebase.main-functions.json` | Main emulator config. A news test reads it, but it belongs here. |
| `scripts/bucket_cors.json`, `functions/llm_origins.js`, `data-changes.ts` link, `data_changes_link_news` | Keep while the site is live. Remove in Phase 8. |

The two `.claude/worktrees/` folders were checked and hold no news data or credentials.

## Phases

Each phase has a gate. A failed gate stops the move. **Phases 0–4 change nothing in this repo
except stopping the agents, committing the six files, and moving credentials out at the end of
Phase 4.** Tracked files are not deleted before Phase 5, and ignored data is not deleted before
Phase 7.

### Phase 0: stop, settle, record

1. `launchctl bootout` the staleness agent. Both plists stay in place until Phase 3 copies them.
2. Commit the six modified files or explicitly discard them, using `git commit -- <paths>` because
   of the concurrent auto-committer.
3. Record the baseline, without `build:news`: `python3 news/scripts/run_tests.py`,
   `vitest run news/scripts newsapp scripts/news_*`, `pnpm run typecheck:news`,
   `npm --prefix news-functions test`, `pnpm run news:evals:test:emulator`,
   `pnpm run news:cards:visual`, and `eslint` over the news paths. Save pass, fail and skip counts.
4. Write a SHA-256 manifest of `news/`, `newsapp/`, `news-functions/`, `data/news/` and `dist-news/`
   to Storage, excluding `node_modules`, `.DS_Store` and `__pycache__`.
5. Export Firestore (D7) with the existing `news:evals:export*` / `news:feedback:export*` commands
   or a managed export. Confirm each of the 18 collections is covered, or record why it is not.
   Write the result to the encrypted store only.
6. Inventory the cloud: both buckets, the `electionsbg-news` project, Secret Manager names (not
   values), DNS, and the service accounts. Save to `ops/cloud-inventory.md`.

**Gate:** no process is writing to the trees (two manifests taken apart are identical), the
baseline is recorded with existing failures noted, and the Firestore export exists.

### Phase 1: extract history

Work only on Storage, never in this repo:

```bash
git clone --no-local /Users/atanasster/data-bg /Volumes/Storage/naiasno-news
```

Then run `git filter-repo --paths-from-file` in that clone, using `glob:` entries for the wildcard
paths: the three trees, `scripts/news_*`, `tests/news/`, the news configs, the five skills,
`docs/policies/news-*`, `docs/references/news-*`, `docs/plans/news-*`. filter-repo removes the
`origin` remote, which is the desired result. Commit the path list to `ops/` afterwards.

**Gate:** `git log` for each path matches the source commit count. `git ls-tree` matches the
source tree for the three directories. `gitleaks detect` over the new history is clean; a
`BEGIN PRIVATE KEY` pickaxe and an add-history check already found nothing, and the secret check
matters more than the rest here.

### Phase 2: make it self-contained

1. Vendor everything in the dependency section into the same relative paths, keeping the `@/`
   alias, so no import changes.
2. Add `VENDORED.md` naming the source commit and each file. The copies are now independent.
3. Restore the history-only docs as files, each from the commit before its deletion, into
   `docs/plans/` and `news/evals/`. Copy the `.zcode` plan, the two follow-up sections and
   `docs/testing-standards.md`. Add `LICENSE`.
4. Build a trimmed `package.json` from the 69 news scripts and the dependencies actually used, a
   new lockfile, `pnpm-workspace.yaml`, and `firebase.json` + `.firebaserc` containing only the
   news hosting target and the `news-evals` codebase.
5. Rewrite the two test files that assert things about this repo.
6. Write the root `.gitignore`, including the `.env.*` rule, the `!news/.env.*.example` exception
   and all the `/news/...` lines. The nested ignore files came through history.
7. Rewrite `build_gazetteer.py`'s default so a missing database fails clearly instead of reaching
   for port 5433.
8. Write `README.md` and `CLAUDE.md` covering what the project is, that it is frozen, how to run
   it, and the memory facts above. Pin the toolchain measured today: Python 3.15.2, Node 22.23.4,
   pnpm 12.16.1, Playwright 1.64.1.

**Gate:** no reference to `data-bg` or `/Users/atanasster` outside history-only docs, no relative
import escapes the repo root, and every row in the docs table is present as a file or marked as
staying.

### Phase 3: copy the ignored data

1. Copy from the source tree with `rsync -a`, skipping files git already restored. Exclude
   `credentials/`, `.env.*` (non-example), `node_modules`, `__pycache__`, `.DS_Store`,
   `news/var/hourly.lock`, `news-functions/lib`.
2. Copy `data/news/`, and copy `dist-news/` to `ops/deployed-dist-news-2026-09-26/`, which is the
   only copy of what is live (hazard 10).
3. Store credentials and live env files in an encrypted sparsebundle (D3), with the passphrase in
   the password manager. Include the absolute-path fix for `PGPASSFILE`.
4. Add the two `VITE_NEWS_*` values to `.env.production.local` in the new repo. Both are public
   build-time values, so they do not need the sparsebundle.
5. Add the two plists under `ops/launchd/`, unloaded.

**Gate:** every entry in the Phase 0 manifest matches by SHA-256 at the destination, apart from
the named exclusions and files changed on purpose in Phase 2. `git status` in the new repo is
clean, which proves the ignore rules are right and no corpus file became tracked.

### Phase 4: prove it works alone

No credential or live env files are present in the working copy, so upload and deploy paths cannot
authenticate. Never run `deploy:*`, `news:hourly`, or any `:sync` script here. Run with
`DATA_BG_ROOT` unset, inside a `sandbox-exec` profile that denies reads of
`/Users/atanasster/data-bg`. Do not rename `data-bg` to test this, because the auto-committer and
other sessions use it.

- `pnpm install`, then lint and typecheck
- the Python suite, Vitest, `news-functions` tests, the Firestore emulator test, Playwright
- `pnpm run build:news` (safe here, this is the copy)
- `pnpm run news:release:gate` without its final manifest write
- `pnpm run dev:news`, and check the home, story and person pages with the local app-data

**Gate:** counts equal the Phase 0 baseline, with any difference explained. Rebuilt `app-data`
matches the copied one, or each difference is explained (timestamps, freeze stamps).

**Then move the secrets:** verify the sparsebundle opens and its contents match the manifest, and
delete `news/credentials/` and the five live `news/.env.*` files from this repo. They must be gone
before Phase 5 starts.

### Phase 5: remove from this repo

**Two commits, in this order, on `main`.** Re-check `git log` first, and use pathspec commits.

**5a. Protect first.** Add `/news/`, `/newsapp/`, `/news-functions/`, `/dist-news/` to the root
`.gitignore` (`/data/news/` is already there) and commit that alone. These rules do not affect
tracked files. Confirm with `git check-ignore -v --no-index` that a root rule, not a nested one,
catches a path under each ignored tree, for example `news/data/_html/x` and `news/var/x`. Also
confirm `news/credentials/` no longer exists.

**5b. Remove.** Ignored data stays on disk.

- `git rm` the tracked trees and the outside-the-tree files listed above, then confirm
  `git status --short` shows no untracked file under those paths before committing.
- `package.json`: the 69 news scripts and `gen:bucket-ts*`.
- `firebase.json` (the `news-functions` entry and the `news` hosting target), `.firebaserc` (the
  `news` alias and target). `deploy:db` uses `--only functions:db -P default`, so it is unaffected.
  The `playwright.config.ts` comment about the `news` target becomes stale.
- `.github/workflows/test.yml`: the news function steps and the bucket-ts check.
- `vitest.config.ts`, `tailwind.config.js`, `.prettierignore`, `pnpm-workspace.yaml`, `README.md`,
  `.claude/launch.json`.
- `scripts/bucket_sync_paths.ts`: add `news` to `isExcluded`, and update its test (hazard 5).
- `naiasno-post` rule 8: replace the script call with a date check or remove it (hazard 6).
- D5: remove `PersonInTheMedia`, its mount in `PersonProfileScreen.tsx:738`, `usePersonMediaTone`,
  the mention gate, the `pp_media_*` keys, then run `i18n:prune`.
- `docs/deferred-followups.md`: replace the News section with a pointer.
- `docs/plans/auth-membership-dashboard-v1.md`: add the one-line note.
- `process-watch-report`: drop the `news/**` wording.
- Remove the `VITE_NEWS_*` lines from this repo's `.env.production.local`, keeping `VITE_AI_*`.
- Check for code only newsapp used (`translitSearch`, `sofiaDateTime`, `PackSelect` and others) and
  delete it only where nothing else imports it. `data/canonical_parties.json`,
  `data/governments.json` and the locales stay.

Do not rewrite this repo's history as part of this move (see D8). No secrets were found in it, a
rewrite changes every SHA, and it would collide with the auto-committer.

**Gate:** `pnpm run lint`, `tsc -b`, `pnpm run test:unit`, `pnpm run test:data`, `pnpm run build`
and `pnpm test` all pass. `key_usage.test.ts` and `entryGraph.test.ts` are the two most likely to
react. Removing the Tailwind `newsapp` paths shrinks generated CSS, so diff the output for lost
classes rather than assuming the result is fine.

### Phase 6: hold

Run normally for two weeks, including at least one `process-watch-report` publish and one hosting
deploy. `news.electionsbg.com` keeps answering. Apply the agent-memory changes.

**Gate:** no regression attributed to the removal, and the news site unchanged.

### Phase 7: delete the originals

**Irreversible, so it requires explicit approval at the time.**

1. Re-verify the Storage copy against the manifest.
2. Confirm the second copy (D4), and that the sparsebundle and Firestore export open.
3. Delete what remains of `news/`, `newsapp/`, `news-functions/`, `dist-news/`, `data/news/`, the
   `.firebase/hosting.ZGlzdC1uZXdz.cache` file, the two plists in `~/Library/LaunchAgents`, and the
   stale `.zcode/skills/*news*` copies.
4. Trim the `.gitignore` news rules, including `!news/.env.*.example`. `git status` should stay
   clean. Move this plan to the new repo and leave a pointer in `README.md`.

This frees about 9 GB on the internal disk.

### Phase 8: optional, separate teardown

Only if D2 changes later. Each item is outward-facing and needs its own approval: stop accepting
submissions, delete the hosting site and `newsEvals`, remove the bucket prefix and the archive
bucket, drop the CORS entries and `llm_origins.js` entry, retire `data-changes.ts` links, and
disable the service accounts. While the frozen site stays live, its links into `/person` can rot
as slugs change, and it still needs a privacy position for the submissions it accepts.

## Rollback

| Point of failure | Recovery |
| ---------------- | -------- |
| Phases 1–4 | Delete `/Volumes/Storage/naiasno-news`. Restore credentials from the sparsebundle if they had been moved. Reload the staleness agent if wanted. |
| Phase 5–6 | `git revert` both commits. Ignored data is still on disk, and credentials come from the sparsebundle. |
| After Phase 7 | Restore from Storage or the second copy, using the manifest to verify. |

## Out of scope

Restarting the pipeline, changing anything live, moving the Jev AI-chat work, rewriting public
history, and flattening the new repo's layout.

## Audit log, 2026-11-05

Gaps and errors found in the first draft, all now corrected above:

| Severity | Finding | Fix |
| -------- | ------- | --- |
| Critical | `git rm` deletes the nested `.gitignore` files, exposing credentials and 320k files to `git add -A` on a public repo. The draft kept only the root rules. | Phase 5 split into 5a/5b; secrets leave at the end of Phase 4 |
| High | Firestore held 18 collections with no local copy, and were not in the plan. | D7, Phase 0 step 5 |
| High | The draft treated the GCS archive as a possible second copy. It excludes 5.7+ GB by design. | D4, hazard 9 |
| High | Retired plans and 6 eval reports would have been in history but not on disk. | Docs table, Phase 2 step 3 |
| High | `build_feedback_targets.py` reads `sectorRegistry.ts` and raises if it is missing. The draft's "exactly four reads" was wrong. | Dependency table corrected |
| Medium | `VITE_NEWS_*` in `.env.production.local` were missed; the build would degrade at exit 0. | Phase 3 step 4 |
| Medium | Repo visibility was unchecked: it is public, so gold-set text remains in public history. | D6, D8 |
| Medium | `scaffold.test.mjs` asserts things about this repo. | Phase 2 step 5 |
| Medium | Phase 4 suggested renaming `data-bg`, which is unsafe alongside the auto-committer. | `sandbox-exec` only |
| Medium | The Phase 4 gate compared against a baseline that lacked the emulator test and lint. | Baseline extended |
| Medium | `dist-news/` was excluded, but it is the only copy of the live build. | Phase 3 step 2 |
| Low | `.zcode` plan, `CLAUDE.md`, `LICENSE`, memory files, and a wrong Phase 7 line about `firebase.news-*` (tracked, so already gone by then). | Docs table, Phase 7 |

Claims confirmed: the tile is dead (817 of 817 live shards lack `tone`), `retrievalCorpus` is a
label, no file was renamed into the trees, and the two stale worktrees are empty of news data.

Not verified: whether anything besides the hourly job uses the service-account keys, and the
content of Firestore (no read was attempted, because that needs the news credentials).

## Execution log, 2026-11-05

The new repo is at `/Volumes/Storage/naiasno-news`. Its proof is in `ops/extraction/`.

Where the run differed from the plan:

- **Six uncommitted files:** committed only in the new repo, not here. They are 660k changed lines
  of named-person review queues, and this repo is public.
- **Firestore:** the operator export commands cover only submissions and adjudications, so all
  collections were read through the REST API with the operator's own account. See D7.
- **Secrets passphrase:** generated randomly and stored in the login Keychain under
  `naiasno-news-secrets`. It should also go in the password manager.
- **Dependencies:** pinned to the exact versions this repo had installed. A fresh resolve picked
  up a newer Prettier and produced 22 false lint errors.
- **`build:news`:** already broken here by two type errors in `PersonRail.tsx`. Fixed in the new
  repo only.
- **Rebuild check:** the first rebuild ran without `.env.pipeline`, which changed the output. It
  was restored from source and repeated with the real settings. Differences are limited to
  clock-driven fields. The copy kept in the new repo is the original, not a rebuild.
- **Gates that fail on the unchanged data:** `news:image-coverage:gate` fails on bytes identical
  to the source. `news:perf:gate` fails on the whole-corpus filter index budget and
  `news:home-health:gate` fails after a rebuild because the corpus is stale. None comes from the move.
- **`bucket:sync`:** `^news/.*` was added to both `-x` regexes as well as `isExcluded`.

Final gate after Phase 5: `pnpm run lint`, `tsc -b`, `functions:test` and `pnpm run build` pass.
`test:unit`, `test:data` and `pnpm test` do not, for reasons unrelated to the removal:

- Eight sampled failing test files were re-run on a clean checkout of `d8dceeccb8`. Every failure
  reproduced there except `scripts/tests/election/surfaces.data.test.ts`, whose count reads
  generated output the checkout does not have.
- 76 of the 86 Playwright failures hardcode `electionsbg.com` in `tests/seo.spec.ts` or
  `chat-migration.seo.spec.ts` while the build emits `naiasno.bg`. The rest were not re-run on the
  old commit. They include hub heads with 0 KPI cells and the entry chunk at 62,364 B against a
  56,000 B budget; the removal only deleted code, so it should not have grown that chunk.

Phase 6 hold ends 2026-11-19. Phase 7 is still to do, and the second copy (D4) does not exist yet.
