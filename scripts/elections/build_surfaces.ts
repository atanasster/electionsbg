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
  type ElectionSurfaceV1,
} from "../../src/data/elections/surfaceTypes";
import * as P from "./build_parliamentary_surface";
import * as L from "./build_local_surface";

export const DATA_ROOT = path.join(process.cwd(), "data");

/** ⚠ CYCLE COVERAGE IS BOUNDED AND STATED (§5.0). v1 generates the latest parliamentary cycle
 *  and the latest two regular local cycles. Backfilling earlier ones is a separate decision with
 *  its own object-count line, and the shell falls back to the legacy composition for any cycle
 *  with no artifact — the same path a missing artifact already takes. */
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
  return [
    ...(parl ? [{ kind: "parliamentary" as const, cycle: parl }] : []),
    ...locals.map((cycle) => ({ kind: "local" as const, cycle })),
  ];
};

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

export const generate = (kind: ElectionKind, cycle: string): Emitted[] =>
  kind === "parliamentary" ? parliamentary(cycle) : local(cycle);

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
