// Derive "new" / "modified" EU-funds contracts by diffing the freshly-parsed
// ИСУН corpus against a persisted snapshot keyed by contractNumber.
//
// Why a diff? The ИСУН "Проекти" export carries no native new-vs-amendment
// field — it is one row per contract with a single `status`. The only way to
// surface a "new project" / "value or status changed" signal is to compare
// successive ingests on the stable `contractNumber` primary key.
//
// The snapshot lives in state/funds/projects_snapshot.json — persistent on the
// ingest host, same model as state/watch/*; gitignored because it is fully
// rebuildable from the corpus. On the very first run there is no prior
// snapshot, so we seed it and emit nothing (otherwise all ~80k contracts would
// read as "new" and flood the alert feed).
//
// Output (served): data/funds/projects/changes/<obshtina>.json (per município,
// keyed by the same muni codes as by-muni/) + changes/index.json (national
// summary). The directory is reset each run, so each file reflects only the
// most-recent ingest's diff — exactly the "what changed in the last update"
// framing the My-Area alert feed renders.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { ResolvedFundsProject } from "./projects_types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STATE_DIR = path.resolve(__dirname, "../../state/funds");
const SNAPSHOT_FILE = path.join(STATE_DIR, "projects_snapshot.json");
const CHANGES_DIR = path.resolve(
  __dirname,
  "../../data/funds/projects/changes",
);
const CHANGES_INDEX = path.join(CHANGES_DIR, "index.json");

// Per-município cap so a bulk re-publication can't bloat a single shard. New +
// modified per ingest per município is normally small; this is a guard.
const PER_OBSHTINA_CAP = 50;

// Compact snapshot entry — only the mutable fields that define a "change".
type SnapshotEntry = {
  t: number; // totalEur
  g: number; // grantEur
  p: number; // paidEur
  s: string; // status
  d: number; // durationMonths
};
type Snapshot = Record<string, SnapshotEntry>;

export type FundsProjectChangeType = "new" | "modified";

export interface FundsProjectChange {
  contractNumber: string;
  title: string;
  type: FundsProjectChangeType;
  /** Mutable fields that changed (only for type === "modified"). */
  changedFields?: string[];
  /** Prior total value (only for "modified") — lets the UI render a delta. */
  prevTotalEur?: number;
  totalEur: number;
  paidEur: number;
  status: string;
  programCode: string;
  programName: string;
  beneficiaryName: string;
  /** ISO YYYY-MM-DD the change was detected (the ingest day). */
  detectedAt: string;
}

export interface FundsProjectChangesFile {
  obshtina: string;
  generatedAt: string;
  changes: FundsProjectChange[];
}

export interface ProjectChangesResult {
  seeded: boolean;
  newCount: number;
  modifiedCount: number;
  obshtinaCount: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

const toEntry = (r: ResolvedFundsProject): SnapshotEntry => ({
  t: round2(r.totalEur),
  g: round2(r.grantEur),
  p: round2(r.paidEur),
  s: r.status ?? "",
  d: r.durationMonths ?? 0,
});

const readSnapshot = (): Snapshot | null => {
  try {
    return JSON.parse(fs.readFileSync(SNAPSHOT_FILE, "utf-8")) as Snapshot;
  } catch {
    return null;
  }
};

const FIELD_LABELS: Array<[keyof SnapshotEntry, string]> = [
  ["t", "totalEur"],
  ["g", "grantEur"],
  ["p", "paidEur"],
  ["s", "status"],
  ["d", "durationMonths"],
];

const diffEntry = (prev: SnapshotEntry, next: SnapshotEntry): string[] => {
  const changed: string[] = [];
  for (const [k, label] of FIELD_LABELS) {
    if (prev[k] !== next[k]) changed.push(label);
  }
  return changed;
};

const makeChange = (
  r: ResolvedFundsProject,
  type: FundsProjectChangeType,
  extra: { changedFields?: string[]; prevTotalEur?: number } | undefined,
  detectedAt: string,
): FundsProjectChange => ({
  contractNumber: r.contractNumber,
  title: r.title,
  type,
  ...(extra?.changedFields ? { changedFields: extra.changedFields } : {}),
  ...(extra?.prevTotalEur != null ? { prevTotalEur: extra.prevTotalEur } : {}),
  totalEur: round2(r.totalEur),
  paidEur: round2(r.paidEur),
  status: r.status ?? "",
  programCode: r.programCode,
  programName: r.programName,
  beneficiaryName: r.beneficiaryName,
  detectedAt,
});

const resetDir = (dir: string): void => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
};

const canonicalJson = (data: unknown): string =>
  JSON.stringify(data, null, 2) + "\n";

/**
 * Build the new snapshot, diff against the prior, write per-município change
 * files + a national index, and persist the new snapshot.
 *
 * @param resolved   The fully-resolved corpus (the same array the ingest
 *                   writes into the per-place shards).
 * @param ingestDate ISO YYYY-MM-DD the diff is detected (the ingest day).
 */
export const buildAndWriteProjectChanges = (
  resolved: ResolvedFundsProject[],
  ingestDate: string,
): ProjectChangesResult => {
  // New snapshot keyed by contractNumber (contractNumber is the stable PK;
  // last write wins for the rare duplicate).
  const next: Snapshot = {};
  const meta = new Map<string, ResolvedFundsProject>();
  for (const r of resolved) {
    if (!r.contractNumber) continue;
    next[r.contractNumber] = toEntry(r);
    meta.set(r.contractNumber, r);
  }

  const prev = readSnapshot();

  // Persist the new snapshot LAST — after the change files + index are written
  // (see calls below). If the process dies mid-write, the baseline must not have
  // advanced past an un-emitted diff; the artifact is rebuildable, but ordering
  // it right costs nothing.
  const writeSnapshot = (): void => {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(next) + "\n");
  };

  resetDir(CHANGES_DIR);
  const generatedAt = new Date().toISOString();

  // First run — seed only, emit nothing (else every contract reads as "new").
  if (!prev) {
    fs.writeFileSync(
      CHANGES_INDEX,
      canonicalJson({
        generatedAt,
        detectedAt: ingestDate,
        seeded: true,
        newCount: 0,
        modifiedCount: 0,
        obshtinaCount: 0,
      }),
    );
    writeSnapshot();
    return { seeded: true, newCount: 0, modifiedCount: 0, obshtinaCount: 0 };
  }

  // Diff the new corpus against the prior snapshot.
  const changes: FundsProjectChange[] = [];
  let newCount = 0;
  let modifiedCount = 0;
  for (const [cn, entry] of Object.entries(next)) {
    const before = prev[cn];
    const r = meta.get(cn)!;
    if (!before) {
      changes.push(makeChange(r, "new", undefined, ingestDate));
      newCount++;
    } else {
      const fields = diffEntry(before, entry);
      if (fields.length > 0) {
        changes.push(
          makeChange(
            r,
            "modified",
            { changedFields: fields, prevTotalEur: before.t },
            ingestDate,
          ),
        );
        modifiedCount++;
      }
    }
  }

  // Group by município (a multi-location contract is replicated across every
  // muni it names; region/national/unresolved rows have no muni and surface
  // only in the national summary). Keyed by the same muni codes as by-muni/.
  const byObshtina = new Map<string, FundsProjectChange[]>();
  for (const c of changes) {
    const munis = meta.get(c.contractNumber)?.location.munis ?? [];
    for (const muni of munis) {
      const arr = byObshtina.get(muni) ?? [];
      arr.push(c);
      byObshtina.set(muni, arr);
    }
  }

  let cappedObshtina = 0;
  let droppedRows = 0;
  for (const [obshtina, arr] of byObshtina) {
    // New first, then by value desc — the most notable changes lead the feed.
    arr.sort(
      (a, b) =>
        (a.type === b.type ? 0 : a.type === "new" ? -1 : 1) ||
        b.totalEur - a.totalEur,
    );
    if (arr.length > PER_OBSHTINA_CAP) {
      cappedObshtina++;
      droppedRows += arr.length - PER_OBSHTINA_CAP;
    }
    const file: FundsProjectChangesFile = {
      obshtina,
      generatedAt,
      changes: arr.slice(0, PER_OBSHTINA_CAP),
    };
    fs.writeFileSync(
      path.join(CHANGES_DIR, `${obshtina}.json`),
      canonicalJson(file),
    );
  }
  // No silent caps — surface any truncation. The national index counts below
  // stay uncapped (they're the honest totals); only the per-município files cap.
  if (cappedObshtina > 0) {
    console.log(
      `→ capped ${cappedObshtina} município(s) at ${PER_OBSHTINA_CAP} changes ` +
        `(${droppedRows} row(s) dropped from per-município files; national counts are uncapped)`,
    );
  }

  fs.writeFileSync(
    CHANGES_INDEX,
    canonicalJson({
      generatedAt,
      detectedAt: ingestDate,
      seeded: false,
      newCount,
      modifiedCount,
      obshtinaCount: byObshtina.size,
    }),
  );

  writeSnapshot();
  return {
    seeded: false,
    newCount,
    modifiedCount,
    obshtinaCount: byObshtina.size,
  };
};
