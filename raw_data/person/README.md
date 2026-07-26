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

**Adding another.** A future officials re-slug needs its own dated map here, produced with
`--redirects` at the time of the rename rather than reconstructed afterwards. The resolver
warns when orphaned dead slugs appear, which is the signal that one is missing.
