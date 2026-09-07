import path from "path";

/** The skill whose ingest marker a successful `--pvr` run stamps.
 *
 *  ⚠ NAMED, NOT INLINE, so a rename moves the constant AND the file together. As a bare
 *  string literal a rename leaves the old marker on disk, the orchestrator queues the skill on
 *  every run for ever, and every test stays green — `scripts/lib/ingest-state.test.ts` calls
 *  that „the original bug, vouched for". */
const PRESIDENTIAL_INGEST_SKILL = "update-presidential-elections";
import { command, run, string, option, boolean, optional, flag } from "cmd-ts";
import { fileURLToPath } from "url";
import { runStats } from "./stats/collect_stats";
import {
  generateReports,
  generateSummariesOnly,
  generateAllAnalysisStats,
} from "./reports";
import { generateCanonicalParties } from "./parsers/canonicalParties";
import { parseElections } from "./parsers/parse_elections";
import { generateAllSearchFIles } from "./search";
import { parseFinancing } from "./smetna_palata";
import { scrapeErik } from "./smetna_palata/scrape_erik";
import { parseFinancialDeclarations } from "./declarations";
import { runPartyStats } from "./party_stats";
import { createPreferencesFiles } from "./preferences";
import { parseMachinesFlashMemory } from "./machines_memory";
import { backfillSectionCoords } from "./parsers/backfill_section_coords";
import { generateCityRayonData } from "./helpers/gen_city_rayon_data";
import { backfillLocalSectionCoords } from "./parsers_local/backfill_local_section_coords";
import { generateLocalProblemSections } from "./parsers_local/problem_sections_local";
import { generateVoteFlows } from "./voteFlows";
import { generateLocalVoteFlows } from "./voteFlows/local_index";
import { generatePrevoteFlows } from "./voteFlows/parl_local_index";
import { generateLocalPlaceTrends } from "./reports/local/build_local_place_trends";
import { parseLocalElections } from "./parsers_local/parse_local_elections";
import {
  ingestCycles,
  cycleSlugToRawFolder,
} from "./parsers_local/ingest_cycle";
import { ingestLegacyChmiCycle } from "./parsers_local/ingest_legacy_chmi";
import { ingestMi2007 } from "./parsers_local/ingest_mi2007";
import { ingestChmi2009, CHMI2009_SLUG } from "./parsers_local/ingest_chmi2009";
import { downloadCsvBundle } from "./parsers_local/download_csv_bundle";
import { ingestByElectionTurnout } from "./parsers_local/ingest_byelection_turnout";
import { shutdownCikFetch } from "./parsers_local/cik_fetch";
import { resolveCanonicalsForAllLocalCycles } from "./parsers_local/resolve_canonicals";
import { buildLocalRollups } from "./parsers_local/build_region_json";
import { buildChmiHistory } from "./parsers_local/build_chmi_history";
import { buildElectionSurfaces } from "./elections/build_surfaces";
import { downloadPresidentialCycle } from "./parsers_presidential/download";

const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory

let production: boolean | undefined = undefined;
// Election data folders moved out of /public/ to /data/ during the GCS
// migration so they no longer ship through Firebase Hosting. The variable
// keeps the historical name `publicFolder` because every script in this
// pipeline takes a `publicFolder` argument that resolves to the data
// output root — renaming through the entire interface chain would be a
// large unrelated change. See src/data/dataUrl.ts for the runtime seam.
const publicFolder = path.resolve(__dirname, "../data");
const inFolder = path.resolve(__dirname, "../raw_data");

const stringify = (o: object) => stringifyJSON(o, production);

const stringifyJSON = (o: object, production?: boolean) =>
  production ? JSON.stringify(o) : JSON.stringify(o, null, 2);
const app = command({
  name: "commands",
  args: {
    all: flag({
      type: optional(boolean),
      long: "all",
      short: "a",
      defaultValue: () => false,
    }),
    prod: flag({
      type: optional(boolean),
      long: "prod",
      short: "p",
      defaultValue: () => false,
    }),
    date: option({
      type: optional(string),
      long: "date",
      short: "d",
    }),
    election: option({
      type: optional(string),
      long: "election",
      short: "e",
    }),
    reports: flag({
      type: optional(boolean),
      long: "reports",
      short: "r",
      defaultValue: () => false,
    }),
    analysisStats: flag({
      type: optional(boolean),
      long: "analysisStats",
      defaultValue: () => false,
    }),
    stats: flag({
      type: optional(boolean),
      long: "stats",
      short: "s",
      defaultValue: () => false,
    }),
    search: flag({
      type: optional(boolean),
      long: "search",
      short: "c",
      defaultValue: () => false,
    }),
    financing: flag({
      type: optional(boolean),
      long: "financing",
      short: "f",
      defaultValue: () => false,
    }),
    erik: flag({
      type: optional(boolean),
      long: "erik",
      defaultValue: () => false,
    }),
    parties: flag({
      type: optional(boolean),
      long: "parties",
      short: "r",
      defaultValue: () => false,
    }),
    machines: flag({
      type: optional(boolean),
      long: "machines",
      short: "m",
      defaultValue: () => false,
    }),
    candidates: flag({
      type: optional(boolean),
      long: "candidates",
      short: "n",
      defaultValue: () => false,
    }),
    summary: flag({
      type: optional(boolean),
      long: "summary",
      short: "u",
      defaultValue: () => false,
    }),
    coords: flag({
      type: optional(boolean),
      long: "coords",
      short: "g",
      defaultValue: () => false,
    }),
    // Rebuild the Пловдив/Варна район layer (geometry + per-election results +
    // município shards) from the parliamentary section data. Derived, so folded
    // into `--all`; runs after the section coords backfill it depends on.
    cityRayons: flag({
      type: optional(boolean),
      long: "city-rayons",
      defaultValue: () => false,
    }),
    declarations: flag({
      type: optional(boolean),
      long: "declarations",
      defaultValue: () => false,
    }),
    flows: flag({
      type: optional(boolean),
      long: "flows",
      short: "w",
      defaultValue: () => false,
    }),
    // Local elections are parsed by a separate tree under scripts/parsers_local/
    // because the data shape diverges substantially from parliamentary
    // (per-OIK party numbering, multiple race types per município, two
    // mayor rounds). `--all` does NOT auto-include locals — invoke with
    // `--local --all` to rebuild every cycle in raw_data/*_mi/*_chmi.
    local: flag({
      type: optional(boolean),
      long: "local",
      short: "L",
      defaultValue: () => false,
    }),
    localDate: option({
      type: optional(string),
      long: "local-date",
    }),
    // `--local-ingest <cycleSlug>` runs the automated end-to-end ingest:
    // download csv.zip via Playwright-warmed Cloudflare cookie, extract with
    // CP866 fix, mirror per-município HTML pages, then run the parser.
    // The slug uses the CIK URL form, e.g. "mi2023" or
    // "chmi2024-2026/2024-10-20_chastichen".
    localIngest: option({
      type: optional(string),
      long: "local-ingest",
    }),
    // `--local-csv <cycleSlug>` downloads the section-level CSV bundle
    // (votes.txt / sections.txt / protocols.txt) via the CF-clearing headed
    // Playwright session, extracts it (CP866) under raw_data/<folder>/ТУР1/,
    // then re-parses the cycle so council vote share + per-station section
    // shards get backfilled. Flag-gated operator step (pops a browser window).
    // `--pvr-download <cycle>` fetches a presidential bundle from ЦИК and lays it
    // out under raw_data/<cycle>/ТУР1|ТУР2. Flag-gated and idempotent: all five
    // historical cycles are committed, so the ordinary run downloads nothing. It
    // exists so 2026 runs a path that has been exercised. See
    // docs/plans/presidential-elections-v1.md T1.2.
    // `--pvr <cycle>` reads a committed presidential bundle and writes
    // `data/<cycle>/` — the roll-ups, the section shards, `national_summary.json`
    // and `tickets.json`. Pure and offline; `--pvr all` does every cycle.
    // ⚠ NOT folded into `--all`: that flag rebuilds the parliamentary tree, and a
    // presidential cycle is a different election with its own catalogue. Same
    // reasoning as `--local`, which `--all` also leaves alone.
    // See docs/plans/presidential-elections-v1.md T3.4.
    pvr: option({
      type: optional(string),
      long: "pvr",
    }),
    pvrDownload: option({
      type: optional(string),
      long: "pvr-download",
    }),
    pvrForce: flag({
      type: optional(boolean),
      long: "pvr-force",
      defaultValue: () => false,
    }),
    pvrAllowDigestChange: flag({
      type: optional(boolean),
      long: "pvr-allow-digest-change",
      defaultValue: () => false,
    }),
    localCsv: option({
      type: optional(string),
      long: "local-csv",
    }),
    // `--local-byelection-turnout <cycleSlug>` backfills exact turnout onto a
    // chmi cycle's район/община-mayor bundles from ЦИК's "Числови данни от
    // протокол" HTML (the rezultati summary carries vote tallies only). Without
    // it the dashboard can only estimate by-election активност. Flag-gated
    // operator step (pops a browser window via the CF-clearing session).
    localByElectionTurnout: option({
      type: optional(string),
      long: "local-byelection-turnout",
    }),
    // Re-resolve `primaryCanonicalId` on every already-ingested local-cycle
    // bundle against the current canonical_parties.json, without re-fetching
    // CIK HTML. Fast, idempotent — use after editing manualCanonicals,
    // partyOverrides, or local_coalition_overrides.
    resolveLocalCanonicals: flag({
      type: optional(boolean),
      long: "resolve-local-canonicals",
      defaultValue: () => false,
    }),
    // Additive bundle-only pass: rebuild per-oblast region rollups
    // (data/<cycle>/region/<oblast>.json) + the national regions_summary.json
    // from already-ingested município bundles. Scope to one cycle with
    // --local-date, else every regular cycle. Never re-fetches CIK HTML.
    localRollups: flag({
      type: optional(boolean),
      long: "local-rollups",
      defaultValue: () => false,
    }),
    // Rebuild data/local_chmi_history.json + data/chmi_history/<code>.json from the (stamped)
    // per-município bundles — the standalone trigger for build_chmi_history, which otherwise
    // only runs at the tail of a chmi ingest. Used after the personSlug decorate re-stamps the
    // bundles so the chmi feed carries the fresh /person links.
    localChmiHistory: flag({
      type: optional(boolean),
      long: "local-chmi-history",
      defaultValue: () => false,
    }),
    // Estimated council vote-flow ("where did the votes go") between every
    // consecutive pair of regular local cycles. Reads the already-ingested
    // per-município section shards; writes data/transitions_local/. Council
    // ballot only, national + oblast scope. Flag-gated — local cycles land
    // every ~4 years, so it's not part of `--all`.
    localFlows: flag({
      type: optional(boolean),
      long: "local-flows",
      defaultValue: () => false,
    }),
    // Additive pass: stamp lat/lon (+ building address) onto every local-cycle
    // section shard from the latest parliamentary election that ships GPS
    // (shared 9-digit CIK section codes). Powers the local section map +
    // top-sections tiles. Idempotent; reads no network. Run after a fresh
    // parliamentary cycle adds coordinates, or after re-ingesting local
    // sections. Also folded into `--all`.
    localCoords: flag({
      type: optional(boolean),
      long: "local-coords",
      defaultValue: () => false,
    }),
    // Additive pass: flag the curated Roma-neighborhood polling sections inside
    // the local council data — the council-ballot analogue of the parliamentary
    // problem_sections report. Reads the already-ingested section shards + the
    // per-station detail files and writes data/<cycle>/problem_sections.json for
    // every regular `_mi` cycle. Must run AFTER --local-coords (the address
    // keyword match relies on the `address` field that backfill stamps onto the
    // shards). Idempotent, no network. Also folded into `--all`.
    localProblemSections: flag({
      type: optional(boolean),
      long: "local-problem-sections",
      defaultValue: () => false,
    }),
    // Per-place cross-cycle trends (council party share + mayoral winner per
    // cycle) for the settlement and район dashboards. Reads the per-município
    // section detail files; writes data/local_place_trends/<obshtina>.json.
    // Flag-gated — local cycles land every ~4 years, so not part of `--all`.
    localPlaceTrends: flag({
      type: optional(boolean),
      long: "local-place-trends",
      defaultValue: () => false,
    }),
    // The compact per-place result artifacts behind the elections hub
    // (docs/plans/elections-hub-implementation-v1.md §5.0). Reads the canonical
    // shards this run may just have rewritten, so it goes LAST — see the handler.
    //
    // ⚠ DRY-RUN BY DEFAULT even under `--all`: it reports the per-level file and
    // byte deltas §5.0 requires and writes nothing. `--election-surfaces-write`
    // emits, and `--election-surfaces-sections` additionally merges a `surface`
    // key into the 12,302 COMMITTED local station files, which is a large diff
    // and therefore never implicit.
    electionSurfaces: flag({
      type: optional(boolean),
      long: "election-surfaces",
      defaultValue: () => false,
    }),
    electionSurfacesWrite: flag({
      type: optional(boolean),
      long: "election-surfaces-write",
      defaultValue: () => false,
    }),
    electionSurfacesSections: flag({
      type: optional(boolean),
      long: "election-surfaces-sections",
      defaultValue: () => false,
    }),
    // Estimated pre-vote flow: the most recent parliamentary vote before each
    // local cycle → that cycle's council ballot. Writes data/transitions_prevote/.
    // Flag-gated — local cycles land every ~4 years, so not part of `--all`.
    prevoteFlows: flag({
      type: optional(boolean),
      long: "prevote-flows",
      defaultValue: () => false,
    }),
  },
  handler: async ({
    all,
    prod,
    stats,
    date,
    reports,
    analysisStats,
    search,
    financing,
    erik,
    parties,
    candidates,
    machines,
    election,
    summary,
    coords,
    cityRayons,
    declarations,
    flows,
    local,
    localDate,
    localIngest,
    localCsv,
    pvr,
    pvrDownload,
    pvrForce,
    pvrAllowDigestChange,
    localByElectionTurnout,
    resolveLocalCanonicals,
    localRollups,
    electionSurfaces,
    electionSurfacesWrite,
    electionSurfacesSections,
    localChmiHistory,
    localFlows,
    localCoords,
    localProblemSections,
    localPlaceTrends,
    prevoteFlows,
  }) => {
    production = prod;
    // ⚠ FIRST, before parseElections and the coords backfill. Every other
    // flag-gated operator step sits below those, so it pays for a full
    // cross-election section sweep it has no use for — measured, `--pvr-download`
    // walked all 13 parliamentary trees before reaching its own handler. An
    // acquisition step that only touches raw_data/<cycle>_pvr should do that and
    // nothing else.
    if (pvr) {
      // ⚠ Before `--pvr-download`, because this one needs no network and is what a
      // rebuild runs; the download is the operator step that precedes it once.
      const { ingestAllPresidential, ingestPresidentialCycle } =
        await import("./parsers_presidential/ingest");
      // ⚠ The same `--prod` switch every other writer here obeys: minified in
      // production, indented otherwise. Measured, the presidential tree is 134 MB
      // minified across the five cycles, so the difference is not cosmetic.
      const indent = production ? 0 : 2;
      // ⚠ BOTH SPELLINGS FOR „EVERY CYCLE". The plan writes `--pvr --all`; `--pvr all` is
      // what the handler grew first. cmd-ts's `option` requires a value, so the flag form
      // still needs one beside it — `--pvr all --all` and `--pvr all` are the same thing, and
      // `--all` beside a NAMED cycle is refused below rather than silently widened.
      // ⚠ `--all` BESIDE `--pvr <cycle>` IS A CONTRADICTION, NOT A DEFAULT. It used to widen
      // silently to every cycle, so an operator asking for one got five and the parliamentary
      // pipeline `--all` normally drives ran not at all — the `if (pvr)` arm returns before
      // reaching it. Two spellings mean „every cycle" and both are explicit.
      if (all && pvr !== "all")
        throw new Error(
          `--all with --pvr ${pvr} is ambiguous: --all means every presidential cycle here ` +
            `and skips the parliamentary pipeline entirely. Use --pvr all, or --pvr ${pvr} alone.`,
        );
      const results =
        pvr === "all"
          ? ingestAllPresidential({ indent })
          : [ingestPresidentialCycle(pvr, { indent })];
      // ⚠ THE TRANSFER FILE IS PART OF THE INGEST, not a separate operator step. It is derived
      // from the section shards the lines above just wrote, so leaving it to a hand-run script
      // is the „green locally, stale on prod" shape this repo warns about everywhere else: the
      // corpus moves and `/presidential/:cycle` keeps serving the previous runoff's estimate at
      // a 200. A cycle decided in round 1 returns null and writes nothing.
      const { writeRunoffTransfer } =
        await import("./parsers_presidential/build_runoff_transfer");
      // ⚠ THE SPLIT-TICKET FILE IS THE SAME SHAPE OF DERIVED ARTIFACT, and it reads a SECOND
      // corpus — the parliamentary election held the same day — so it goes stale when either
      // side moves. Only 2021 has such a sibling; the other four cycles write nothing.
      const { writeSplitTicket } =
        await import("./parsers_presidential/build_split_ticket");
      // ⚠ THE THIRD DERIVED ARTIFACT, AND IT DEPENDS ON A FILE OUTSIDE THIS TREE —
      // `data/census_2021.json`. It reads the SECTION shards the lines above just wrote (not
      // the municipality roll-up, which cannot see София), so like the two above it goes stale
      // the moment the corpus moves; unlike them it also goes stale when the census is rebuilt,
      // and simply writes nothing when the census file is absent.
      const { writePresidentialCleavages } =
        await import("./parsers_presidential/build_demographics");
      for (const r of results) {
        for (const write of [
          writeRunoffTransfer,
          writeSplitTicket,
          writePresidentialCleavages,
        ]) {
          // ⚠ ONE PATH OR MANY. Two of the three answer with an ARRAY — the transfer writes a
          // cycle file plus one shard per oblast, the cleavages one file per round — and
          // `writeSplitTicket` answers with one path or null. A `files` list that kept only the
          // first would under-report a presidential ingest by up to 33 paths per cycle, and
          // that list is what the ingest reports as having been written.
          const written = write(r.cycle, { indent });
          for (const f of Array.isArray(written)
            ? written
            : written
              ? [written]
              : [])
            r.files.push(f);
        }
        // ⚠ RE-SORTED. `ingestPresidentialCycle` returns `files.sort()` deliberately, and the
        // block above appends up to 32 more paths onto the end — so without this the manifest
        // is sorted-then-appended, which is neither ordering anybody can rely on.
        r.files.sort();
      }
      // ⚠⚠ THE FILENAME IS THE LOOKUP KEY, so it must be the SKILL name — not the watcher
      // source, which is what this plan's own wording says („state/ingest/cik_presidential
      // .json"). `process-watch-report` reads `state/ingest/<skill>.json` BY PATH, and its
      // own step-5 stamp is `stamp-ingest.ts <skill-name>`; the `skill` FIELD inside the file
      // matters only to `readAllIngestStates`, which the orchestrator never calls. So „the
      // field is what counts, the filename is free" is exactly the wrong lesson — a marker
      // filed under a name the map never asks for reads as „never ran" and re-queues this
      // skill on every orchestrator run for ever, silently. That happened once already, to
      // the person layer (`state/ingest/persons.json` against `update-persons`), and
      // `scripts/lib/ingest-state.test.ts` exists because of it.
      //
      // ⚠ A NAMED CONSTANT, so a rename cannot leave the committed marker orphaned while
      // every test stays green — the `resolve_persons.ts` precedent.
      const { writeIngestState } = await import("./lib/ingest-state");
      writeIngestState(PRESIDENTIAL_INGEST_SKILL, {
        summary: results
          .map((r) => `${r.cycle}: ${r.files.length} file(s)`)
          .join("; "),
      });
      return;
    }
    if (pvrDownload) {
      try {
        await downloadPresidentialCycle(pvrDownload, {
          force: pvrForce,
          allowDigestChange: pvrAllowDigestChange,
        });
      } finally {
        // The headed browser keeps the process alive otherwise.
        await shutdownCikFetch();
      }
      return;
    }
    if (machines) {
      if (!date) {
        throw new Error("Machines suemg file with date parameter");
      }
      await parseMachinesFlashMemory(inFolder, date, stringify);
    }
    await parseElections({ date, all, stringify, publicFolder });
    // ⚠ THE SPLIT-TICKET FILE READS **BOTH** CORPORA, so the PARLIAMENTARY side moving stales it
    // too — and only the `--pvr` arm above rebuilt it, which this path never reaches. Without
    // this, `npm run data -- --date 2021_11_14` rewrites the НС section shards and leaves
    // `data/2021_11_14_pvr/split_ticket.json` on the previous vintage, at a 200, with every row
    // count reconciling. Cheap: it re-derives only for a presidential cycle whose same-day
    // sibling is the tree just rebuilt, which today is one cycle and usually none.
    {
      const { presidentialCyclesFor, sameDayParliamentary, writeSplitTicket } =
        await import("./parsers_presidential/build_split_ticket");
      for (const c of presidentialCyclesFor()) {
        const day = sameDayParliamentary(c);
        if (!day || !(all || day === date)) continue;
        const written = writeSplitTicket(c, { indent: production ? 0 : 2 });
        if (written) console.log(`[pvr] re-derived data/${written}`);
      }
    }
    // Runs unconditionally. It used to be gated on `coords || all`, which meant
    // a plain `npm run data -- --date <older election>` rebuilt the section
    // files from a GPS-less source and then skipped the pass that puts the
    // coordinates back — silently, because /data/2*/* is gitignored. Six
    // elections (2021_07_11 … 2024_10_27) were zeroed that way on 2026-07-18
    // and 2026-07-25 and the loss reached GCS. preserveSectionCoords in
    // parse_elections.ts is now the first line of defence; this stays as the
    // populate-a-new-election and repair-a-zeroed-one pass, and it is
    // idempotent (it only fills sections that lack a coordinate), so there is
    // no reason to make it opt-in. `--coords` still forces the full sweep.
    backfillSectionCoords({
      publicFolder,
      dataFolder: inFolder,
      // A single-election run only needs its own year swept; --coords/--all
      // keep the full cross-election sweep.
      only: !coords && !all && date ? [date] : undefined,
      stringify,
    });
    // Пловдив/Варна район layer (geometry + per-election results + município
    // shards). Derived from the section data + the coords backfilled just
    // above, so it runs here and is folded into `--all` — never stale after a
    // parliamentary re-ingest. Output is bucket-served (run bucket:sync:all).
    if (cityRayons || all) {
      generateCityRayonData();
    }
    // Transfer the (now backfilled) parliamentary GPS/address onto the local
    // section shards — shared 9-digit CIK section codes. Runs after the
    // parliamentary backfill so the freshest coordinates are available.
    if (localCoords || all) {
      backfillLocalSectionCoords({ publicFolder, stringify });
    }
    // Roma-neighborhood "problem sections" for local councils. Runs AFTER the
    // coords/address backfill above — the address keyword match depends on the
    // `address` field that backfillLocalSectionCoords stamps onto the shards.
    if (localProblemSections || all) {
      generateLocalProblemSections({ publicFolder, stringify });
    }
    if (stats) {
      runStats(stringify);
    }
    if (parties) {
      runPartyStats(stringify);
    }
    // `--all` (npm run prod) regenerates reports too: they are derived
    // from the freshly-parsed election data, so the full pipeline must
    // not leave them stale (risk score, clusters, benford, summaries, …).
    if (reports || all) {
      generateReports(inFolder, stringify, election);
    }
    if (summary) {
      generateSummariesOnly(stringify, election);
      generateCanonicalParties({ publicFolder, stringify });
      // Canonical regen → refresh every local cycle's baked primaryCanonicalId
      // so they pick up new manualCanonicals / partyOverrides additions
      // without a CIK re-fetch.
      resolveCanonicalsForAllLocalCycles({ publicFolder, stringify });
    }
    if (search) {
      generateAllSearchFIles({
        dataFolder: inFolder,
        publicFolder,
        stringify,
      });
    }
    if (erik) {
      // Scrape ЕРИК campaign-finance data into the raw_data layout the parser
      // reads. `-e <election>` targets a specific election; default = latest.
      await scrapeErik({
        electionKey: election,
        rawFolder: inFolder,
        dataFolder: publicFolder,
        stringify,
      });
    }
    if (financing) {
      await parseFinancing({
        dataFolder: inFolder,
        publicFolder,
        stringify,
      });
    }
    if (candidates) {
      await createPreferencesFiles(stringify, election);
    }
    if (declarations) {
      await parseFinancialDeclarations({
        publicFolder,
        dataFolder: inFolder,
      });
    }
    if (flows || all) {
      generateVoteFlows({ publicFolder, stringify });
    }
    if (local || localDate) {
      await parseLocalElections({
        date: localDate,
        all: local && !localDate,
        publicFolder,
        stringify,
      });
    }
    if (localIngest) {
      try {
        // 2007 (mi2007) is a separate ЦИКМИ archive (mi2007.cik.bg) with a
        // per-place static-HTML model — its own end-to-end ingest.
        if (localIngest === "mi2007") {
          await ingestMi2007({ publicFolder, stringify });
        }
        // The single pre-2012 partial (2009-11-15 Sofia by-election) is a
        // caption-based single page, not the numbered-page legacy model.
        else if (localIngest === CHMI2009_SLUG) {
          await ingestChmi2009({ publicFolder, stringify });
        }
        // The legacy umbrellas (chmi2012-2015 … chmi2019-2023) publish one
        // numbered page per kmetstvo/mayor race rather than per OIK município,
        // so they take a dedicated ingest path.
        else if (/^chmi20(12-2015|16-2018|19-2023)\//.test(localIngest)) {
          await ingestLegacyChmiCycle({
            cycleSlug: localIngest,
            publicFolder,
            stringify,
          });
        } else {
          await ingestCycles({
            cycleSlugs: [localIngest],
            publicFolder,
            stringify,
          });
          // A current-style chmi partial (e.g. chmi2024-2026/<date>_chastichen)
          // re-parses bundles with a zeroed protocol; immediately backfill the
          // exact by-election turnout from ЦИК's числови-данни HTML so it
          // survives the re-ingest. Regular mi cycles already carry turnout
          // from the CSV bundle, so skip them.
          const isCurrentChmi =
            /^chmi/.test(localIngest) &&
            !/^chmi20(12-2015|16-2018|19-2023)\//.test(localIngest);
          if (isCurrentChmi) {
            await ingestByElectionTurnout({
              cycleSlug: localIngest,
              publicFolder,
              rawDataRoot: inFolder,
              stringify,
            });
          }
        }
      } finally {
        // Keep the headless Chromium from blocking process exit.
        await shutdownCikFetch();
      }
    }
    if (localCsv) {
      try {
        const result = await downloadCsvBundle(localCsv);
        if (result) {
          // Re-parse the cycle so the freshly-extracted section CSV backfills
          // council vote share + emits per-station section shards.
          await parseLocalElections({
            date: cycleSlugToRawFolder(localCsv),
            publicFolder,
            stringify,
          });
        }
      } finally {
        await shutdownCikFetch();
      }
    }
    if (localByElectionTurnout) {
      await ingestByElectionTurnout({
        cycleSlug: localByElectionTurnout,
        publicFolder,
        rawDataRoot: inFolder,
        stringify,
      });
    }
    if (resolveLocalCanonicals) {
      resolveCanonicalsForAllLocalCycles({ publicFolder, stringify });
    }
    if (localRollups) {
      buildLocalRollups({ publicFolder, cycle: localDate, stringify });
    }
    if (localChmiHistory) {
      buildChmiHistory({ stringify });
    }
    if (localFlows) {
      generateLocalVoteFlows({ publicFolder, stringify });
    }
    if (localPlaceTrends) {
      generateLocalPlaceTrends({ publicFolder, stringify });
    }
    if (prevoteFlows) {
      generatePrevoteFlows({ publicFolder, stringify });
    }
    // Regenerate the /analysis hub blobs LAST — after every upstream source this
    // run may have rewritten (national summary, risk, benford, the vote-flow
    // transitions from `--flows`, polls, financing) — so no metric is dropped
    // for want of a not-yet-generated file. `--analysisStats` runs it alone.
    if (reports || all || summary || analysisStats) {
      generateAllAnalysisStats(stringify, election);
    }
    // ⚠ AFTER EVERYTHING ELSE. The surfaces are a PROJECTION of the canonical shards this run
    // may just have rewritten — region votes, section shards, local rollups — so generating
    // them earlier would project the previous vintage while every row count reconciled. That
    // is the same ordering rule `db:refresh` learned the hard way for its derived artifacts.
    //
    // ⚠ AND IT IS DRY-RUN UNDER `--all`. It reports the per-level file and byte deltas §5.0
    // requires; writing 23,665 artifacts (and, with `--election-surfaces-sections`, rewriting
    // 12,302 committed station files) is an explicit act.
    if (
      electionSurfaces ||
      electionSurfacesWrite ||
      electionSurfacesSections ||
      all
    ) {
      buildElectionSurfaces({
        write: electionSurfacesWrite || electionSurfacesSections,
        sections: electionSurfacesSections,
        // ⚠ ONLY AN EXPLICIT SURFACE RUN NARROWS TO A CYCLE. Under `--all` the two options name
        // different cycle SPACES — `--date` a parliamentary folder, `--local-date` a local one —
        // so honouring either would silently generate one of the three covered cycles and skip
        // the rest, while the table still printed "ok". The precedent 200 lines above
        // (`!coords && !all && date`) makes the same exemption for `--all`.
        cycle: all ? undefined : localDate || date || undefined,
      });
    }
  },
});

run(app, process.argv.slice(2));
