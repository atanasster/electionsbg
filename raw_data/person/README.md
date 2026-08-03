# `raw_data/person/` — load sources for the person layer

Inputs the person layer reads but never serves. They live under `raw_data/` rather than
`data/` on purpose: `bucket:sync` walks and uploads `data/` only, so nothing here costs
enumeration time or bucket storage (see `docs/plans/persons-pg-retirement-v1.md` §0).

## `officials_reslug_2026_07_24.json`

`{ "<old officials slug>": "<new officials slug>" }` — 20,768 entries.

**What it is.** The rename map produced by the 2026-07-24 canonical-slug migration
(`scripts/officials/migrate_slug_normalisation.ts`), which re-slugged every officials shard
after the ingest started hashing the *canonical* declarant name instead of the register's
raw spelling. The rename itself landed in `707bc5871`.

**Why it is committed.** That migration ran with `--apply` but without `--redirects`, so the
map was never written down — and 18,428 `/person` URLs were left resolving to nobody, with
nothing recording where they had gone. It is recoverable, because git still holds the
pre-rename trees:

```bash
git archive 707bc5871^ data/officials | tar -x -C /tmp/prerename
OFFICIALS_MIGRATE_DIR=/tmp/prerename/data/officials \
  tsx scripts/officials/migrate_slug_normalisation.ts --redirects map.json
```

…but only for as long as `officialSlug()`, `canonicalDeclarantName()`,
`_declarant_guid_aliases.json` and `_slug_collisions.json` all keep behaving as they did on
that date. A change to any of them silently changes the reconstruction. Pinning the output
makes the backfill a reviewable, diffable artifact instead of an archaeology session.

**Who reads it.** `scripts/person/load_slug_redirects.ts`, via
`npm run person:slug-redirects -- raw_data/person/officials_reslug_2026_07_24.json`. It runs
as part of `db:refresh`; on Cloud SQL it is a manual deploy step (`:cloud` variant).

## `officials_reslug_2026_07_29.json`

`{ "<old officials slug>": "<new officials slug>" }` — 1 entry.

**What it is.** The redirect from the 2026-07-29 collision repair. Two same-named pairs had
merged onto one slug each under a group label (`ivan-stoyanov-stoyanov-5d97ce` over an
окръжен прокурор and a командир на дивизион; `ivan-georgiev-ivanov-b85a89` over two school
directors), told apart by their `<Personal><Work>` employer. Listing the second GUID of each
in `scripts/officials/_slug_collisions.json` and running
`scripts/officials/split_collision_slugs.ts --apply` peeled the newcomer onto its own slug —
no old slug retired there, those filings had never had one. What DID retire a slug was the
follow-on fold: once `2E6D233C…` was split off `ivan-georgiev-ivanov-b85a89`, the alias table
could finally reunite `EDDF7B29…`'s own two spellings, dropping `ivan-georgiev-ivanov1-94805e`.
This map is that one drop, produced with `--redirects` at rename time per the note below.

**Who reads it.** Same as above — `scripts/person/load_slug_redirects.ts`, wired into
`db:refresh` right after the 2026-07-24 map. The loader upserts, so the two maps compose. On
Cloud SQL it is the same manual step: `npm run person:slug-redirects:cloud --
raw_data/person/officials_reslug_2026_07_29.json`.

**Adding another.** A future officials re-slug needs its own dated map here, produced with
`--redirects` at the time of the rename rather than reconstructed afterwards, and wired into
`db:refresh` next to the existing ones. The resolver warns when orphaned dead slugs appear,
which is the signal that one is missing.

## `kmetstvo_flips_2026_08.json`

`{ generatedAt, flips[], moves[] }` — the local-elections re-parse's effect on
`person_slug_lock`, produced by `scripts/person/kmetstvo_flips.ts --emit`.

**What it is.** A different shape of problem from the re-slug maps above, and it needs an
artifact for the same reason: a decision that is easy to make wrong and impossible to review
after the fact. `person_slug_lock` keys on a MENTION — `local:<cycle>:<obshtina>:<kind>:<key>`
— which names a SEAT, not a person. That is safe until a seat changes hands, and
`docs/plans/village-mayor-attribution-v1.md` changes 267 of them at once by ingesting the
кметство runoffs (§T1) plus a município's worth of refs by splitting общ. Бяла out of VAR05
(§T0).

Left alone, `chooseStableSlug` hands the NEW winner the LOSER's slug: every village/район lock
was seeded in one batch and therefore shares a `first_seen`, so the tie breaks alphabetically.
On the seat that prompted this work, `ivan-stoyanov-1xhzvh` < `rosen-rusev-a0a8lm` — Росен
Русев would have been served at the URL of the man he beat.

Two entry kinds, and they are not interchangeable:

- **`flips`** — same ref, different person. The lock is DELETED, so the new winner derives
  their own slug and the loser's orphans into the existing retirement machinery.
- **`moves`** — same person, different ref (the §T0 re-split). The lock is REKEYED, carrying
  `first_seen` with it: that column is `chooseStableSlug`'s primary sort key, so a row
  re-stamped `now()` would sort last and never win the anchor again — silently undoing the URL
  preservation the move exists for.

**Why it is committed.** It is the review gate. `--emit` is read-only and `--apply` refuses to
act on anything the file does not already contain, so what a human read is what runs. It is
also the only record of which URLs moved and why, on a change that renames pages for named
people.

**Who reads it.** `scripts/person/kmetstvo_flips.ts --apply` (`npm run person:kmetstvo-flips`,
`:cloud` for Cloud SQL). Run it AFTER the re-parse and BEFORE `db:resolve:persons` — it
compares the fresh bundles against the still-old `person_role`, which is the only window in
which both states exist.

**Adding another.** A future re-parse that moves seats needs its own dated file; do not
overwrite this one, since it documents which URLs changed in this pass. `--apply` says so when
it finds an entry the reviewed file has not seen.
