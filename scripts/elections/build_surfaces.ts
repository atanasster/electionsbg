// The surface generator's entry point: decide what to write, write it, and report the deltas
// §5.0 demands ("record generated file-count and total-byte deltas per cycle and per level").
//
// ⚠ WHAT IT WRITES IS DERIVED FROM `SURFACE_POLICY`, NEVER LISTED HERE. A second list is how a
// level ends up in the policy with no producer — which happened once already, when `settlement`
// was flipped to `artifact` on measurement and the parliamentary builder still handled two
// levels. `emittedLevels()` drives the loop and an unhandled level THROWS, so the failure is at
// the top of a run rather than 5,365 pages later.
//
// ⚠ THE LOCAL SECTION LEVEL REWRITES A COMMITTED FILE. §5.0 makes it `embedded` — the surface
// goes in as a `surface` key on `data/<cycle>/sections/<obshtina>/<code>.json` rather than as a
// second artifact, because a second one costs ~24,600 bucket objects to save 3.4 KB. Rewriting
// 12,302 committed files is a big diff, so it is OPT-IN (`--sections`) and off by default.
//
// ⚠ NOTHING HERE READS THE CLOCK. `status.updatedAt` comes from the source file's mtime, so a
// rebuild is byte-identical (§9) and the gate on that is not vacuous.
//
// Usage:
//   npm run elections:surfaces                          # every covered cycle, dry run
//   npm run elections:surfaces -- --write               # write the artifacts
//   npm run elections:surfaces -- --write --sections    # …and the embedded local sections
//   npm run elections:surfaces -- --cycle 2026_04_19    # one cycle

import fs from "node:fs";
import path from "node:path";
import {
  SURFACE_BUDGET_BYTES,
  artifactPath,
  emittedLevels,
} from "../../src/data/elections/surfacePath";
import {
  isWellFormedElectionSurfaceV1,
  surfaceCapViolations,
  type ElectionKind,
  type ElectionPlaceLevel,
  type ElectionStandout,
  type ElectionSurfaceV1,
} from "../../src/data/elections/surfaceTypes";
import * as P from "./build_parliamentary_surface";
import * as L from "./build_local_surface";
import * as PR from "./build_presidential_surface";
import {
  capStandouts,
  selectCloseContests,
  selectFragmentedCouncils,
  selectTurnoutDepartures,
  type CouncilRow,
  type MarginRow,
  type TurnoutRow,
} from "./standouts";

export const DATA_ROOT = path.join(process.cwd(), "data");

/**
 * ⚠ CYCLE COVERAGE IS BOUNDED AND STATED (§5.0). v1 generates the latest parliamentary cycle
 * and the latest two regular local cycles. Backfilling earlier ones is a separate decision with
 * its own object-count line, and the shell falls back to the legacy composition for any cycle
 * with no artifact — the same path a missing artifact already takes.
 *
 * ⚠⚠ PRESIDENTIAL IS BUILT AND WITHHELD, FOR ONE REMAINING REASON. `build_presidential_surface.ts`
 * is complete and tested; what it may not yet do is run in a PUBLISH, because **its destinations
 * name routes the app does not serve** — every surface links to `/presidential/<cycle>/…` and
 * `routes.tsx` declares no such route, 81,256 unresolvable destinations measured by this repo's
 * own gate. A producer that links to a 404 is the same defect the tile registry, the header
 * dropdown and the hub search each refused.
 *
 * The OTHER reason is closed: the object count. Five cycles of section artifacts were ~60,000
 * objects on their own, taking the corpus to 105,218 — 44% of the ~240,000-object shape §5.0
 * rejects rather than the tenth it asks for. Sections are bounded to the latest cycle now
 * (`sectionArtifactCycle`), which mirrors how every other kind is bounded and lands the corpus
 * at 59,212. ⚠ That is 1.3% under the 60,000 gate, so the next level added here needs its own
 * arithmetic rather than an assumption of room.
 *
 * Removing `presidential` from this list is what turns the surfaces on, and `emittedLevels`
 * already says which levels they are. Plan Tier 5's route family owns the last step.
 */
const KINDS_NOT_PUBLISHED: readonly ElectionKind[] = ["presidential"];
export const coveredCycles = (
  root = DATA_ROOT,
): { kind: ElectionKind; cycle: string }[] => {
  if (!fs.existsSync(root)) return [];
  const dirs = fs.readdirSync(root);
  const parl = dirs
    .filter((d) => /^\d{4}_\d{2}_\d{2}$/.test(d))
    .sort()
    .at(-1);
  const locals = dirs
    .filter((d) => /^\d{4}_\d{2}_\d{2}_mi$/.test(d))
    .sort()
    .slice(-2);
  // ⚠ EVERY presidential cycle, not the latest two. There are five, they are historical and
  // they do not change — and a reader arriving at 2001 needs the same surfaces as one
  // arriving at 2021.
  const pres = KINDS_NOT_PUBLISHED.includes("presidential")
    ? []
    : dirs.filter((d) => /^\d{4}_\d{2}_\d{2}_pvr$/.test(d)).sort();
  return [
    ...(parl ? [{ kind: "parliamentary" as const, cycle: parl }] : []),
    ...locals.map((cycle) => ({ kind: "local" as const, cycle })),
    ...pres.map((cycle) => ({ kind: "presidential" as const, cycle })),
  ];
};

/** ⚠ Exported so a gate can assert the withholding is a decision rather than an omission —
 *  „no presidential surfaces" and „nobody built them" are indistinguishable in a publish. */
export const kindsNotPublished = (): readonly ElectionKind[] =>
  KINDS_NOT_PUBLISHED;

export type Emitted = {
  kind: ElectionKind;
  cycle: string;
  level: ElectionPlaceLevel;
  id: string;
  /** Relative to the data root, or the host file for an `embedded` level. */
  file: string;
  /** ⚠ THE BYTES THAT ACTUALLY LAND ON DISK — the pretty-printed form the writer emits, not
   *  the compact one. Measuring `JSON.stringify(s)` under-reports by **1.68x** (29.93 MB
   *  against 50.14 MB written), and this number is the §5.0 ledger the emit decisions rest on,
   *  so an under-report is a budget check performed against a file nobody writes. */
  bytes: number;
  surface: ElectionSurfaceV1;
  /** True where the artifact already exists with this exact content — see `summarise`. */
  unchanged?: boolean;
};

export type LevelDelta = {
  kind: ElectionKind;
  cycle: string;
  level: ElectionPlaceLevel;
  files: number;
  totalBytes: number;
  maxBytes: number;
  budget: number;
  overBudget: string[];
  malformed: string[];
};

// ─── generation ─────────────────────────────────────────────────────────────────────────────

const parliamentary = (cycle: string): Emitted[] => {
  const out: Emitted[] = [];
  const index = P.loadPartyIndex();
  const regionFile = path.join(DATA_ROOT, cycle, "region_votes.json");
  if (!fs.existsSync(regionFile)) return out;
  const prior = P.priorCycleOf(cycle);
  const ctx: P.BuildContext = {
    cycle,
    index,
    updatedAt: P.sourceUpdatedAt(regionFile),
    priorCycle: prior,
    priorByPlace: prior ? P.readPriorRegionIndex(prior) : undefined,
  };
  const push = (
    level: ElectionPlaceLevel,
    id: string,
    s: ElectionSurfaceV1,
  ) => {
    const file = artifactPath(level, cycle, id);
    if (!file)
      throw new Error(`no artifact path for parliamentary/${level}/${id}`);
    out.push({
      kind: "parliamentary",
      cycle,
      level,
      id,
      file,
      bytes: Buffer.byteLength(serialize(s)),
      surface: s,
    });
  };

  for (const level of emittedLevels("parliamentary")) {
    switch (level) {
      case "region":
      case "abroad":
        // Both come from `region_votes.json`; the row's key decides which level it is, so the
        // two cases are handled once and skipped on the second pass.
        if (level === "abroad") break;
        for (const row of P.readRegionRows(cycle)) {
          const s = P.buildRegionSurface(row, ctx);
          push(s.place.level, row.key, s);
        }
        break;
      case "settlement":
        for (const ekatte of P.settlementEkattes(cycle)) {
          const f = P.readSettlement(cycle, ekatte);
          if (!f) continue;
          push("settlement", ekatte, P.buildSettlementSurface(f, ctx));
        }
        break;
      case "section":
        for (const oblast of P.sectionOblasts(cycle))
          for (const row of Object.values(P.readSectionShard(cycle, oblast)))
            push("section", row.section, P.buildSectionSurface(row, ctx));
        break;
      default:
        // ⚠ THE POLICY GAINED A LEVEL AND THIS FILE DID NOT. Loud, at the top of the run.
        throw new Error(
          `parliamentary/${level} emits an artifact and has no producer in build_surfaces.ts`,
        );
    }
  }
  return out;
};

/**
 * Presidential surfaces.
 *
 * ⚠ ONE PRODUCER FOR ALL FOUR LEVELS, unlike the two arms above. `buildPresidentialSurfaces`
 * reads the per-round roll-ups and returns every place already tagged with its level, because
 * this tree has no per-place files to walk: below the country each level is ONE file per
 * round, so „which places exist" is a property of that file rather than of the filesystem.
 *
 * ⚠ THE COVERAGE CHECK IS THE SAME CONTRACT the parliamentary arm states in its `default`
 * arm: a level the policy says emits and this file cannot produce is a failure at the TOP of
 * the run, not thousands of pages quietly keeping the legacy composition. That arm exists
 * because `settlement` was once exactly that — the header said „only two" while the policy
 * returned four.
 */
const presidential = (cycle: string): Emitted[] => {
  const built = PR.buildPresidentialSurfaces(cycle);
  if (!built.length) return [];
  const emitted = new Set(emittedLevels("presidential"));
  const produced = new Set(built.map((b) => b.level));
  for (const level of emitted)
    if (!produced.has(level))
      throw new Error(
        `presidential/${level} emits an artifact and has no producer in build_surfaces.ts`,
      );
  return built.map(({ level, id, surface }) => {
    const file = artifactPath(level, cycle, id);
    if (!file)
      throw new Error(`no artifact path for presidential/${level}/${id}`);
    return {
      kind: "presidential" as const,
      cycle,
      level,
      id,
      file,
      bytes: Buffer.byteLength(serialize(surface)),
      surface,
    };
  });
};

const local = (cycle: string): Emitted[] => {
  const out: Emitted[] = [];
  const indexFile = path.join(DATA_ROOT, cycle, "index.json");
  if (!fs.existsSync(indexFile)) return out;
  const ctx: L.LocalContext = {
    cycle,
    updatedAt: L.sourceUpdatedAt(indexFile),
  };
  const map = L.loadKmetstvoEkatte();
  const push = (
    level: ElectionPlaceLevel,
    id: string,
    s: ElectionSurfaceV1,
  ) => {
    const file = artifactPath(level, cycle, id);
    if (!file) throw new Error(`no artifact path for local/${level}/${id}`);
    out.push({
      kind: "local",
      cycle,
      level,
      id,
      file,
      bytes: Buffer.byteLength(serialize(s)),
      surface: s,
    });
  };

  for (const level of emittedLevels("local")) {
    switch (level) {
      case "country": {
        const idx = L.readIndex(cycle);
        if (idx)
          push(
            "country",
            "BG",
            L.buildCountrySurface(idx, ctx, L.nationalSeatsByParty(cycle)),
          );
        break;
      }
      case "region":
        for (const oblast of L.regionCodes(cycle)) {
          const r = L.readRegion(cycle, oblast);
          if (r) push("region", oblast, L.buildRegionSurface(r, ctx));
        }
        break;
      case "municipality":
        for (const code of L.municipalityCodes(cycle)) {
          const m = L.readMunicipality(cycle, code);
          if (m) push("municipality", code, L.buildMunicipalitySurface(m, ctx));
        }
        break;
      case "settlement":
        for (const code of L.municipalityCodes(cycle)) {
          const m = L.readMunicipality(cycle, code);
          if (!m) continue;
          for (const race of L.settlementRacesOf(m, map))
            push(
              "settlement",
              race.ekatte,
              L.buildSettlementSurface({ obshtina: code, ...race }, ctx),
            );
        }
        break;
      default:
        throw new Error(
          `local/${level} emits an artifact and has no producer in build_surfaces.ts`,
        );
    }
  }
  return out;
};

/** The `embedded` level: a `surface` key on each polling-station file (§5.0). Returned
 *  separately because it rewrites COMMITTED files rather than writing new ones. */
export const localSections = (cycle: string): Emitted[] => {
  const indexFile = path.join(DATA_ROOT, cycle, "index.json");
  if (!fs.existsSync(indexFile)) return [];
  const ctx: L.LocalContext = {
    cycle,
    updatedAt: L.sourceUpdatedAt(indexFile),
  };
  const out: Emitted[] = [];
  for (const obshtina of L.sectionObshtini(cycle))
    for (const file of L.sectionFilesOf(cycle, obshtina)) {
      const f = L.readLocalSection(file);
      const s = L.buildLocalSectionSurface(f, ctx);
      out.push({
        kind: "local",
        cycle,
        level: "section",
        id: f.section.sectionCode,
        file: path.relative(DATA_ROOT, file),
        bytes: Buffer.byteLength(serialize(s)),
        surface: s,
      });
    }
  return out;
};

// ─── standouts (§7) ─────────────────────────────────────────────────────────────────────────
//
// ⚠ A SECOND PASS, AND IT HAS TO BE. Every §7 threshold is a percentile OF THE CYCLE'S OWN
// DISTRIBUTION, so no per-place builder can compute one: a place cannot know whether its margin
// is in the bottom 5% until every other place at its level has been measured. The builders stay
// pure and per-place, and the corpus-wide reasoning lives here, where the corpus is.
//
// ⚠ AND THEY ATTACH AT REGION AND MUNICIPALITY ONLY. §7's thresholds were measured at that
// scale (289 councils, 305 municipalities, per-cycle margin percentiles), and a standout is a
// review LEAD about a place. Run over 12,721 polling stations the close-contest selector emits
// ~636 leads saying one station was closely fought — which is what a station IS, noise wearing
// the clothes of a finding — and the sample floors were never calibrated at that scale.

/** Which levels carry standouts. The others deliberately carry none — see above. */
export const STANDOUT_LEVELS: Partial<
  Record<ElectionKind, readonly ElectionPlaceLevel[]>
> = {
  parliamentary: ["region"],
  local: ["municipality"],
};

/** ⚠ `same_page` IS EVIDENCE, NOT ITS ABSENCE, and reading it as absence empties the feature.
 *  A standout attaches to the surface of the place it is ABOUT, and at both attaching levels
 *  that place's complete result IS that page — a region's is `/municipality/:oblast`, a
 *  município's is its own local page. So the only honest destination is „here".
 *
 *  For months `completeResult` supplied a route equal to the page itself and this returned it,
 *  which satisfied §7's string check with a „виж" link that navigated nowhere. When the
 *  generator learned to refuse that self-link, all 36 standouts in the corpus (2 parliamentary,
 *  34 local) disappeared in the same commit — measured, not predicted. The fix is to say which
 *  of the two it is rather than to hand back an empty string for both. */
const evidenceFor = (
  e: Emitted,
): { evidenceTo: string; evidenceOnPage?: boolean } => {
  const cr = e.surface.destinations.completeResult;
  if (cr.available && cr.to) return { evidenceTo: cr.to };
  if (cr.reason === "same_page")
    return { evidenceTo: "", evidenceOnPage: true };
  // Anything else is a genuinely missing destination, and §7 drops the standout.
  return { evidenceTo: "" };
};

/** ⚠ §7.1 — A FIGURE APPEARS ONCE PER SCREEN, and the strip renders above the standouts.
 *  `split_control` and `runoff_pending` are §7 signals AND facts at local/municipality, so
 *  emitting them here would print one finding twice on one page. They stay facts: the strip is
 *  where a reader looks first, and a standout is for what the strip cannot say. */
const factCodes = (e: Emitted): ReadonlySet<string> =>
  new Set(e.surface.facts.map((f) => f.code));

export const attachStandouts = (
  emitted: Emitted[],
  kind: ElectionKind,
  cycle: string,
): void => {
  for (const level of STANDOUT_LEVELS[kind] ?? []) {
    const places = emitted.filter((e) => e.level === level);
    if (places.length === 0) continue;

    // ── close contest: the winner-to-runner-up margin, over this level's own distribution ──
    const margins: MarginRow[] = [];
    for (const e of places) {
      // The margin belongs to the ballot a reader came for — the mayor where there is one.
      const ballot =
        e.surface.ballots.find((b) => b.kind === "municipality_mayor") ??
        e.surface.ballots[0];
      const m = ballot?.preview[0]?.marginPct;
      if (m === undefined || !ballot) continue;
      margins.push({
        id: e.id,
        level,
        marginPct: m,
        validVotes: ballot.totals.validVotes,
        resultStatus: ballot.resultStatus,
        ...evidenceFor(e),
      });
    }
    const close = selectCloseContests(margins, cycle);

    // ── turnout departure: the place's change minus the NATIONAL change ──
    const turnouts: TurnoutRow[] = [];
    let nationalDelta: number | null = null;
    let comparedWith = "";
    if (kind === "parliamentary" && level === "region") {
      const prior = P.priorCycleOf(cycle);
      const now = P.readRegionRows(cycle);
      const then = prior ? P.readRegionRows(prior) : [];
      const thenBy = new Map(then.map((r) => [r.key, r]));
      const a = P.nationalTurnoutPct(now);
      const b = P.nationalTurnoutPct(then);
      if (prior && a !== null && b !== null) {
        nationalDelta = a - b;
        comparedWith = prior;
        for (const row of now) {
          const before = thenBy.get(row.key);
          const place = places.find((x) => x.id === row.key);
          if (!before || !place) continue;
          const t1 = P.turnoutPctOf(row.results.protocol);
          const t0 = P.turnoutPctOf(before.results.protocol);
          if (t1 === null || t0 === null) continue;
          turnouts.push({
            id: row.key,
            level,
            // ⚠ THE OBLAST IS THE PLACE'S OWN CODE, which is what lets the selector drop abroad
            // — whose rows are 523.4 pp and 149.5 pp against ≤22.0 pp for everything else.
            oblast: row.key,
            deltaPp: t1 - t0,
            registeredVoters:
              (row.results.protocol.numRegisteredVoters ?? 0) +
              (row.results.protocol.numAdditionalVoters ?? 0),
            turnoutBasisUnavailable:
              place.surface.ballots[0]?.totals.turnoutBasis === "unavailable",
            resultStatus: "final",
            ...evidenceFor(place),
          });
        }
      }
    }
    const turnout =
      nationalDelta === null
        ? []
        : selectTurnoutDepartures(turnouts, nationalDelta, cycle, comparedWith);

    // ── fragmented council ──
    const councils: CouncilRow[] = [];
    if (kind === "local" && level === "municipality")
      for (const e of places) {
        const b = e.surface.ballots.find((x) => x.kind === "municipal_council");
        if (!b?.seatsTotal) continue;
        const m = L.readMunicipality(cycle, e.id);
        const parties = (m?.council ?? []).filter(
          (r) => (r.mandatesWon || 0) > 0,
        ).length;
        if (parties === 0) continue;
        councils.push({
          id: e.id,
          level,
          partiesWithSeats: parties,
          seatsTotal: b.seatsTotal,
          resultStatus: b.resultStatus,
          ...evidenceFor(e),
        });
      }
    const fragmented = selectFragmentedCouncils(councils, cycle);

    const byPlace = new Map<string, ElectionStandout[]>();
    for (const s of [...close, ...turnout, ...fragmented]) {
      const list = byPlace.get(s.scope.id) ?? [];
      list.push(s);
      byPlace.set(s.scope.id, list);
    }
    for (const e of places) {
      // ⚠ ASSIGNED UNCONDITIONALLY, so the pass can REMOVE as well as add. `if (!kept.length)
      // continue` made it append-only: a surface that already carried a standout kept it even
      // when the current run selects none — which is what a §7.1 collision, a threshold change
      // or a re-run after a corpus fix all look like. It also made the §7.1 test pass for the
      // wrong reason, since it had to clear the list by hand first.
      const found = byPlace.get(e.id) ?? [];
      const already = factCodes(e);
      const kept = capStandouts(found.filter((s) => !already.has(s.signal)));
      if (kept.length === 0 && e.surface.standouts.length === 0) continue;
      e.surface.standouts = kept;
      // The bytes moved, so the ledger and every budget check must see the new size.
      e.bytes = Buffer.byteLength(serialize(e.surface));
    }
  }
};

export const generate = (kind: ElectionKind, cycle: string): Emitted[] => {
  // ⚠ EXHAUSTIVE OVER THE KIND. The ternary this replaces sent every non-parliamentary kind
  // to `local`, so a presidential cycle would have been read as a local one — the same
  // implicit-`else` trap the hub, the header and the tile registry each had.
  const out =
    kind === "parliamentary"
      ? parliamentary(cycle)
      : kind === "presidential"
        ? presidential(cycle)
        : local(cycle);
  attachStandouts(out, kind, cycle);
  return out;
};

// ─── verification and reporting ─────────────────────────────────────────────────────────────

export const summarise = (emitted: readonly Emitted[]): LevelDelta[] => {
  const byLevel = new Map<string, LevelDelta>();
  for (const e of emitted) {
    const key = `${e.kind}/${e.cycle}/${e.level}`;
    let d = byLevel.get(key);
    if (!d) {
      d = {
        kind: e.kind,
        cycle: e.cycle,
        level: e.level,
        files: 0,
        totalBytes: 0,
        maxBytes: 0,
        budget: SURFACE_BUDGET_BYTES[e.level],
        overBudget: [],
        malformed: [],
      };
      byLevel.set(key, d);
    }
    d.files++;
    d.totalBytes += e.bytes;
    d.maxBytes = Math.max(d.maxBytes, e.bytes);
    if (e.bytes > d.budget) d.overBudget.push(`${e.id} (${e.bytes} B)`);
    if (
      !isWellFormedElectionSurfaceV1(e.surface) ||
      surfaceCapViolations(e.surface).length > 0
    )
      d.malformed.push(e.id);
  }
  return [...byLevel.values()];
};

const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;

/** ⚠ NEW BUCKET OBJECTS AND REWRITES ARE DIFFERENT NUMBERS, and §5.0's whole argument is about
 *  the first. An `embedded` level rewrites a file that already exists, so counting it as an
 *  object overstates the bucket cost — measured on a full `--sections` run, 48,108 reported
 *  against 23,665 actual, a 2x overstatement of the exact figure `surfacePath.ts`'s
 *  `budgetWaiver` arithmetic rests on. */
export const objectCounts = (
  deltas: readonly LevelDelta[],
): { artifacts: number; embedded: number } => ({
  artifacts: deltas
    .filter((d) => d.level !== "section" || d.kind !== "local")
    .reduce((a, d) => a + d.files, 0),
  embedded: deltas
    .filter((d) => d.level === "section" && d.kind === "local")
    .reduce((a, d) => a + d.files, 0),
});

export const renderDeltas = (deltas: readonly LevelDelta[]): string => {
  const head =
    "| kind × level | cycle | files | total | max | budget | status |";
  const sep = "| --- | --- | ---: | ---: | ---: | ---: | --- |";
  const rows = deltas.map((d) => {
    const status = d.malformed.length
      ? `⚠ ${d.malformed.length} malformed`
      : d.overBudget.length
        ? `⚠ ${d.overBudget.length} over budget`
        : "ok";
    return `| ${d.kind}/${d.level} | ${d.cycle} | ${d.files} | ${kb(
      d.totalBytes,
    )} | ${kb(d.maxBytes)} | ${kb(d.budget)} | ${status} |`;
  });
  const { artifacts, embedded } = objectCounts(deltas);
  const bytes = deltas.reduce((a, d) => a + d.totalBytes, 0);
  return [
    head,
    sep,
    ...rows,
    `\n**${artifacts.toLocaleString("en")} new bucket objects` +
      (embedded
        ? `, plus ${embedded.toLocaleString("en")} rewritten station files (no new objects)`
        : "") +
      `, ${kb(bytes)} written.**`,
  ].join("\n");
};

// ─── writing ────────────────────────────────────────────────────────────────────────────────

/** ⚠ REFUSES TO WRITE A MALFORMED OR OVER-BUDGET SURFACE. A generator that writes first and
 *  reports afterwards publishes the defect and prints a warning nobody reads — which is exactly
 *  what `writeEmbedded` did until it was made to call this too. */
export const verifyOrThrow = (emitted: readonly Emitted[]): void => {
  for (const d of summarise(emitted)) {
    if (d.malformed.length)
      throw new Error(
        `${d.kind}/${d.level} @ ${d.cycle}: ${d.malformed.length} malformed surface(s): ${d.malformed.slice(0, 5).join(", ")}`,
      );
    if (d.overBudget.length)
      throw new Error(
        `${d.kind}/${d.level} @ ${d.cycle}: ${d.overBudget.length} over the ${kb(d.budget)} budget: ${d.overBudget.slice(0, 5).join(", ")}`,
      );
  }
};

export const writeArtifacts = (emitted: readonly Emitted[]): number => {
  verifyOrThrow(emitted);
  let written = 0;
  for (const e of emitted) {
    const target = path.join(DATA_ROOT, e.file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const body = serialize(e.surface);
    if (fs.existsSync(target) && fs.readFileSync(target, "utf8") === body)
      continue;
    fs.writeFileSync(target, body);
    written++;
  }
  return written;
};

/** The exact bytes an artifact is written as. Two spaces and a trailing newline — the repo's
 *  committed-JSON convention, and stable so the byte-identical rebuild gate compares bytes
 *  rather than formatting. */
export const serialize = (s: ElectionSurfaceV1): string =>
  `${JSON.stringify(s, null, 2)}\n`;

/** The `embedded` write: merge a `surface` key into each station file, leaving everything else
 *  byte-identical. Separate from `writeArtifacts` because it MUTATES COMMITTED FILES. */
export const writeEmbedded = (emitted: readonly Emitted[]): number => {
  // ⚠ THE SAME VERIFICATION, AND IT WAS MISSING. This arm mutates 12,302 COMMITTED files, so it
  // is the one where writing a malformed surface is hardest to undo — and `summarise` runs over
  // the embedded set too, so the defect was printed in the table and then written anyway.
  verifyOrThrow(emitted);
  let written = 0;
  for (const e of emitted) {
    const target = path.join(DATA_ROOT, e.file);
    const raw = JSON.parse(fs.readFileSync(target, "utf8")) as Record<
      string,
      unknown
    >;
    const next = { ...raw, surface: e.surface };
    const body = `${JSON.stringify(next, null, 2)}\n`;
    if (fs.readFileSync(target, "utf8") === body) continue;
    fs.writeFileSync(target, body);
    written++;
  }
  return written;
};

// ─── CLI ────────────────────────────────────────────────────────────────────────────────────

export const buildElectionSurfaces = (opts: {
  write?: boolean;
  sections?: boolean;
  cycle?: string;
  log?: (s: string) => void;
}): LevelDelta[] => {
  const log = opts.log ?? ((s: string) => process.stdout.write(`${s}\n`));
  const cycles = coveredCycles().filter(
    (c) => !opts.cycle || c.cycle === opts.cycle,
  );
  if (cycles.length === 0) {
    log("election surfaces: no covered cycle on disk — nothing to do");
    return [];
  }
  const all: Emitted[] = [];
  for (const { kind, cycle } of cycles) all.push(...generate(kind, cycle));
  const embedded = opts.sections
    ? cycles
        .filter((c) => c.kind === "local")
        .flatMap((c) => localSections(c.cycle))
    : [];

  const deltas = summarise([...all, ...embedded]);
  log(renderDeltas(deltas));
  if (!opts.write) {
    log("\n(dry run — pass --write to emit)");
    return deltas;
  }
  const wrote = writeArtifacts(all);
  log(`\nwrote ${wrote} artifact(s) of ${all.length}`);
  if (opts.sections) {
    const merged = writeEmbedded(embedded);
    log(`embedded ${merged} section surface(s) of ${embedded.length}`);
  }
  return deltas;
};

if (process.argv[1]?.endsWith("build_surfaces.ts")) {
  const arg = (name: string) => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  buildElectionSurfaces({
    write: process.argv.includes("--write"),
    sections: process.argv.includes("--sections"),
    cycle: arg("cycle"),
  });
}
