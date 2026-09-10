---
name: update-presidential-elections
description: Refresh presidential-elections (президентски избори) data — download ЦИК's round bundles and rebuild data/<cycle>_pvr/. Use when the daily watch report flags "ЦИК presidential-elections results bundles" as changed, when a runoff publishes about a week after round 1, when the user asks to refresh or ingest presidential results, or after a fresh clone if data/2021_11_14_pvr/ is missing. Bypasses Cloudflare via a headed Playwright session.
allowed-tools:
  - Read
  - Bash
  - Edit
  - Write
---

# Update presidential-elections skill

Ingests Bulgarian presidential-elections data (президент и вицепрезидент) from ЦИК into `data/<cycle>_pvr/`. Five cycles are committed — 2001, 2006, 2011, 2016, 2021 — and the next is due in **November 2026**.

⚠ **THIS IS ITS OWN WATCHER AND ITS OWN SKILL, deliberately.** `cik_results` (local elections) is coupled by `process-watch-report` to `update-persons` and `db:load:person-elections:pg`, and that loader reads the **parliamentary** candidate files. A presidential flip routed through it would stall on a tree it cannot read or skip the new cycle silently. The watcher is `cik_presidential`; the map routes it here and nowhere else. See `docs/plans/presidential-elections-v1.md` T7.2.

## When to run

| Trigger | Action |
| --- | --- |
| Watcher reports `<slug>: NEW CYCLE <year> — not ingested` | A presidential election happened and ЦИК published its archive. **Step 1** (add the cycle to the catalogue) then Steps 2–6. |
| Watcher reports `<slug> tur2: bundle published` | The runoff landed, about a week after round 1. Re-run Steps 2–6 for that cycle — the ingest is idempotent. |
| Watcher reports `<slug> turN: bundle re-uploaded` | ЦИК corrected a bundle. Same: Steps 2–6. |
| Watcher reports `… (URL guessed)` beside a publish | The cycle is not in `PRESIDENTIAL_SOURCES` yet, so the URL was a template. **Verify the real archive URL in a browser before trusting the signal** — see Step 1. |
| Watcher reports `<slug>: newly listed` | ЦИК added an archive for a cycle already in the catalogue — usually a re-publish of an old one. Nothing to ingest unless a round line accompanies it. |
| Watcher reports `<slug>: no longer listed by ЦИК` | ЦИК withdrew an archive. **Not a re-ingest** — `raw_data/` is committed, so our copy stands. Worth knowing before a link starts 404ing. |
| User asks to refresh presidential results | Steps 2–6 with `--pvr all`. |
| `data/2021_11_14_pvr/` missing on a fresh clone | `npm run data -- --pvr all` (offline — `raw_data/` is committed). |

## Architecture (read once)

```
ЦИК archive (a DIFFERENT URL every cycle — see below)
   │
   ▼  scripts/parsers_presidential/download.ts     ← headed Playwright, Cloudflare
   │
raw_data/<YYYY_MM_DD_pvr>/ТУР1|ТУР2/…              ← COMMITTED
   │
   ▼  scripts/parsers_presidential/ingest.ts       ← pure, offline
   │
data/<YYYY_MM_DD_pvr>/
  national_summary.json                 ← the cycle's outcome per round, every basis named
  tickets.json                          ← the ballot, with each pair's colour
  runoff_transfer.json                  ← the ESTIMATED round-1→balotage matrix + the observed
                                          per-oblast pickup + what neither covers (abroad,
                                          placement-refused); absent for a one-round cycle
  split_ticket.json                     ← the ПВР ticket against the same nominator's НС list,
                                          section by section; 2021 ONLY (the one cycle whose
                                          vote shared its day with a parliamentary election)
  tur1|tur2/region_votes.json           ← per-oblast roll-up + protocol
  tur1|tur2/municipality_votes.json
  tur1|tur2/settlement_votes.json
  tur1|tur2/abroad.json                 ← keyed by COUNTRY
  tur1|tur2/placement.json              ← what placed and how, what did not and why, and which
                                          abroad stations took their country from their
                                          code-group rather than their name
  tur1|tur2/sections/<oblast>.json      ← per-section shards
```

⚠ **THE ARCHIVE URL IS DIFFERENT IN EVERY CYCLE, AND 2006 IS ON A DIFFERENT HOST.** `export.zip`, `el2011_t1.zip`, `export_t1.zip`, `2001_prezident.zip`; `pvr2006.cik.bg` rather than `results.cik.bg`. `PRESIDENTIAL_SOURCES` in `scripts/parsers_presidential/sources.ts` is the record, and `scripts/watch/sources/cik_presidential.ts` reads it — measured, a uniform `tur{n}/export.zip` template is wrong for **seven of the ten** committed (cycle, round) pairs. Two cycles (2016, 2001) ship ONE archive covering both rounds.

## Steps

### 1. A NEW cycle: add it to the catalogue first

The watcher discovers the slug; the ingest needs the archive URLs, which only a human can confirm. Open `https://results.cik.bg/` and the new archive, then add an entry to `PRESIDENTIAL_SOURCES`:

```ts
"2026_11_08_pvr": {
  cycle: "2026_11_08_pvr",
  slug: "pvr2026",              // whatever ЦИК actually used
  era: "2021",                  // the newest reader, unless the format moved
  encoding: "utf8",
  archives: { … },              // the REAL urls, checked in a browser
  rounds: { 1: {…}, 2: {…} },
  note: "…",
},
```

⚠ **A runoff is a separate publish about a week later.** Add the round-2 archive when it exists; until then the round-2 entry may be absent and the ingest handles a one-round cycle.

The catalogue `src/data/json/presidential_elections.json` is REGENERATED, never hand-edited — but it reads `raw_data/`, so it runs **after Step 2's download**, not here:

```bash
npx tsx scripts/parsers_presidential/build_catalogue.ts            # report only — DIFFERS or OK
npx tsx scripts/parsers_presidential/build_catalogue.ts --write    # rewrite it
```

⚠ **WITHOUT `--write` IT IS A SILENT NO-OP AT EXIT 0.** The bare form prints „DIFFERS from the committed file" and returns success, so a run that looks clean has changed nothing.

### 2. Download

```bash
npm run data -- --pvr-download <cycle>
```

Headed Playwright (Cloudflare). Idempotent and digest-checked: a re-download that would change committed bytes REFUSES unless `--pvr-allow-digest-change` is passed. All five historical cycles are committed, so this downloads nothing for them.

### 3. Ingest

```bash
npm run data -- --pvr <cycle>     # or: --pvr all
```

Pure and offline — reads `raw_data/`, writes `data/<cycle>_pvr/`. It stamps `state/ingest/update-presidential-elections.json` on success, which is what stops `process-watch-report` re-queueing this skill for ever.

⚠ **THE STAMP FIRES HERE, AT STEP 3 OF 7 — it records that the CORPUS was rebuilt, not that the cycle was published.** So if the run stops after this step the orchestrator will not queue the skill again, and the surfaces, the sitemap shard and the bucket push are all still undone. Finish the chain, or re-run from Step 4 by hand: nothing will remind you.

### 4. Rebuild the derived surfaces

```bash
npm run data -- --pvr <cycle>          # (step 3 already did this)
npm run elections:surfaces -- --write                   # the per-place surface artifacts
# The ticket→/person map, IF the person layer has moved since it was last minted.
# ⚠ LOCAL POSTGRES ONLY — person slugs are per-database, and the script refuses anything else.
PGPASSFILE=$PWD/.pgpass npx tsx scripts/parsers_presidential/build_ticket_persons.ts --write
npm run sitemap                                        # the presidential sitemap shard
```

⚠ **THE SITEMAP IS A COMMITTED ARTIFACT AND `npm run sitemap` PRUNES BEFORE IT WRITES.** Run it only on a machine that HAS the `data/*_pvr` trees; a corpus-less mint deletes `public/sitemap_presidential.xml`, drops it from the index, and exits 0. `scripts/sitemap/families.data.test.ts` carries the floor that catches it.

### 5. Verify

```bash
npx vitest run scripts/parsers_presidential/ scripts/elections/ scripts/sitemap/ \
  scripts/llms/ scripts/prerender/ src/data/presidential/ src/data/elections/ \
  src/screens/presidential/ src/screens/elections/
```

| Symptom | Cause |
| --- | --- |
| `presidential/<cycle>: N section(s) appear only in the runoff` on stderr | Expected — real stations opened for the runoff alone (mobile boxes, hospital sections). They are named and get no page: a one-ballot surface whose strip describes „round 1" is a page about a round that did not happen there. |
| A place publishes 0.00% turnout | Its protocols report точка 3 = 0 while casting real votes. The shared rule refuses a rate there; if it did not, the section-gap counter is wrong. |
| Abroad shows a turnout percentage | A defect. There is no registered-voter denominator outside the country — abroad publishes a COUNT. |
| „не подкрепям никого" shows 0 before 2016 | A defect. The form did not ask; the field must be ABSENT, never 0. |
| The corpus section vanishes from `llms-full.txt` | The build ran without `data/*_pvr`. `REQUIRED_SECTIONS` refuses the write; restore the trees. |
| „Откъде дойдоха гласовете на балотажа" is missing from a cycle page | Either the cycle was decided in round 1 (correct — there is no transfer to estimate) or `runoff_transfer.json` has not reached the bucket. It is written by the ingest, so a re-run of step 3 plus a bucket sync is the fix. |
| The Sankey's node totals are below the published result (2011 especially) | Expected, and the size is the point. The matrix covers only DOMESTIC sections matched in both rounds; abroad is outside it (published by country, no roll for „не гласували"), and so are sections whose OBLAST placement was refused — 1,355 of them in 2011, all Sofia, 422,726 runoff votes. `coverage.abroadVotes` and `coverage.unplacedVotes` are the two figures that close the gap, and the tile prints both. A cycle whose `_unplaced` shard is empty (2001/2006/2016/2021) reconciles on abroad alone. |
| „Кой раздели бюлетините си" is missing | Expected on 2001/2006/2011/2016 — none of them had a parliamentary election the same day, so there is no list to compare a ticket against. (2011 and 2016 shared their day with LOCAL elections; a mayoral or council ballot is not a party list and the comparison is deliberately not made.) On 2021 it means `split_ticket.json` has not reached the bucket: re-run step 3 and sync. ⚠ It ALSO stales when the PARLIAMENTARY sibling is re-parsed — `npm run data -- --date 2021_11_14` rewrites the НС section shards, and although that path now re-derives the file, a run that skipped it leaves the previous vintage at a 200. Re-run `npm run data -- --pvr 2021_11_14_pvr` after any parliamentary rebuild of a shared day. Also expected on the RUNOFF view: the comparison is against the ballot cast on round 1's day, so the section is shown only there. |
| The split-ticket „За листата" column is below the published national result | Expected, and the size is the point. The comparison covers only the sections present in BOTH protocols — 12,488 of 13,238 — and all 750 unmatched ones are MIR 32, abroad: the presidential tree keeps those in `abroad.json` rather than in `tur1/sections`, so they have no ticket row to compare against. ДПС reads 253,257 here against 341,000 nationally. `coverage.sectionsNsOnly` is the figure that closes the gap and the tile prints it. The FLOOR is unaffected — restricting a sum of non-negative per-section terms to a subset of disjoint sections yields a weaker bound, never an overstated one. |
| `N abroad section(s) have no country` on stdout | Expected, and small. The abroad city table is DERIVED from the parliamentary corpora (2005→2026), so a station in a posting that closed before 2005 is not in it. Most are recovered from the section code's country-ordinal group (2001: 22 → 6, 2011: 11 → 1); what remains is a single-section country with no resolvable sibling, and it stays counted in `abroad.json`'s `""` bucket rather than guessed. ⚠ 2006 recovers NONE by design — all 144 of its abroad sections carry a constant `99`, so its one group spans 48 countries and the rule refuses it. |
| The split-ticket table shows 14 pairs, not 23 | Correct, and the missing nine are named under it. They were nominated by инициативни комитети and have no list; both finalists are among them. Do NOT „fix" this by mapping Герджиков to ГЕРБ-СДС — the backing is a political fact the ballot does not record, and the whole point of the refusal is that this repo does not assert it. |
| The Sankey renders with no caveat above it | Impossible by construction, and if seen it is a defect in the hook: `useRunoffTransfer` refuses a payload whose `basis`/`basisEn` is missing, so the chart cannot mount without the sentence. Check the browser console for „missing the estimate's caveat". |
| A candidate's name is plain text where you expected a link | Either the person layer has no public figure by that name, or more than one does — the map refuses a shared name rather than guessing, and the page says how many share it. Not a defect. |
| Every candidate is plain text | `data/presidential/ticket_persons.json` is stale or was minted against the wrong database. Re-run the builder above; it ships in the BUNDLE, so it needs a build and a deploy, not a bucket sync. |

### 6. Publish

```bash
npm run bucket:sync:paths -- <cycle>          # e.g. 2026_11_08_pvr — the id ALREADY ends in _pvr
npm run db:load:election-national:pg:cloud    # the national summary → migration 195's tables
npm run build && npm run deploy               # prerendered pages + og cards + the sitemap
```

⚠ **THE POSTGRES STEP IS NEW, AND THIS SECTION SAID THERE WAS NONE.** It read „NO POSTGRES — nothing in this family loads into a database" until 2026-09-10, which was true when it was written and stopped being true when migration 195 landed: `db:load:election-national:pg` reads `data/<cycle>/national_summary.json` for EVERY election folder, `_pvr` included, so a presidential ingest now moves a corpus that reaches production only through that command. Skip it and prod serves the previous vintage of the national results at a 200, with every row count reconciling — while local is correct.

⚠ **Its input is GITIGNORED.** `national_summary.json` lives under `data/<cycle>/`, which is not tracked, so the file only exists on a machine that ran the ingest. That is why the loader has to be run from here rather than picked up by a chain: nothing else on the cloud side can see the corpus.

⚠ Still **no `person:slugs`** — unlike every other election ingest. The person layer does not read presidential results in v1 (plan T8.1 is where a ticket becomes a `person_role`).

### 7. Record the change

```bash
npx tsx scripts/append-data-change.ts update-presidential-elections \
  --summary "Президентски избори <дата> — резултати по секции, области и общини" \
  --source "ЦИК"
```

⚠ **THE APPENDER, NOT A HAND EDIT.** `data/data-changes.json` is append-only and byte-stable; editing it by hand is how two ingests running the same day produce a conflicting diff. `process-watch-report` reads it for the `/data/updates` feed.
