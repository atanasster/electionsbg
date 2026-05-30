// Re-resolve `primaryCanonicalId` / `memberCanonicalIds` / `isIndependent`
// on every row in every already-ingested local-cycle bundle, using the
// current canonical_parties.json + local_coalition_overrides.
//
// Each bundle was first written with whatever the canonical index resolved
// to at ingest time. When the canonical index changes later (a new manual
// canonical, an override edit, a new fragment rule), the baked ids go
// stale. This pass re-walks the bundle JSON and re-applies the resolver
// without re-fetching CIK HTML — fast, network-free, idempotent.
//
// Downstream artifacts that derive from `primaryCanonicalId` are also
// regenerated per cycle:
//   - index.json         (council vote share + mayor-counts rollups)
//   - _unmatched_coalitions.json (operator inbox)
//   - officials_diff{.json,/} (only for regular _mi cycles)
// and globally:
//   - local_chmi_history.json (cross-cycle chmi feed)

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { CanonicalPartiesIndex } from "@/data/parties/canonicalPartyTypes";
import {
  LocalCouncilParty,
  LocalDistrictMayorResult,
  LocalKmetstvoResult,
  LocalMayorResult,
  LocalMunicipalityBundle,
} from "./types";
import {
  buildByNickNameLower,
  CoalitionResolution,
  resolveLocalParty,
} from "./local_coalitions";
import { buildIndex } from "./build_index_json";
import { buildRegionRollups } from "./build_region_json";
import { reconcileOfficials } from "./reconcile_officials";
import { buildChmiHistory } from "./build_chmi_history";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dateFromCycle = (
  cycle: string,
): { round1: string; round2: string | null } => {
  const m = cycle.match(/^(\d{4})_(\d{2})_(\d{2})/);
  if (!m) return { round1: cycle, round2: null };
  const round1 = `${m[1]}-${m[2]}-${m[3]}`;
  const r1Date = new Date(round1);
  const r2 = new Date(r1Date.getTime() + 7 * 86400 * 1000);
  const round2 = `${r2.getFullYear()}-${String(r2.getMonth() + 1).padStart(2, "0")}-${String(r2.getDate()).padStart(2, "0")}`;
  return { round1, round2 };
};

// Compare two id-array fields for change-detection. Order matters: the
// resolver returns members in the order they appear in the coalition name.
const sameIds = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

// Apply a fresh resolution to a row and report whether anything changed.
// Mutates the row in place — caller decides whether to write the file.
const reapplyToRow = (
  row: LocalMayorResult | LocalCouncilParty,
  byNickNameLower: Map<string, string>,
): { changed: boolean; resolution: CoalitionResolution } => {
  const resolution = resolveLocalParty(row.localPartyName, byNickNameLower);
  const changed =
    row.primaryCanonicalId !== resolution.primaryCanonicalId ||
    row.isIndependent !== resolution.isIndependent ||
    !sameIds(row.memberCanonicalIds, resolution.memberCanonicalIds);
  if (changed) {
    row.primaryCanonicalId = resolution.primaryCanonicalId;
    row.memberCanonicalIds = resolution.memberCanonicalIds;
    row.isIndependent = resolution.isIndependent;
  }
  return { changed, resolution };
};

const reapplyToMayorList = (
  rows: LocalMayorResult[] | undefined,
  byNickNameLower: Map<string, string>,
  unmatched: Record<string, string[]>,
): boolean => {
  if (!rows) return false;
  let dirty = false;
  for (const row of rows) {
    const { changed, resolution } = reapplyToRow(row, byNickNameLower);
    if (changed) dirty = true;
    if (resolution.unmatchedFragments.length > 0) {
      unmatched[row.localPartyName] = resolution.unmatchedFragments;
    }
  }
  return dirty;
};

const reapplyToBundle = (
  bundle: LocalMunicipalityBundle,
  byNickNameLower: Map<string, string>,
  unmatched: Record<string, string[]>,
): boolean => {
  let dirty = false;
  // mayor.round1, mayor.round2, mayor.elected
  if (reapplyToMayorList(bundle.mayor.round1, byNickNameLower, unmatched))
    dirty = true;
  if (reapplyToMayorList(bundle.mayor.round2, byNickNameLower, unmatched))
    dirty = true;
  if (bundle.mayor.elected) {
    const { changed, resolution } = reapplyToRow(
      bundle.mayor.elected,
      byNickNameLower,
    );
    if (changed) dirty = true;
    if (resolution.unmatchedFragments.length > 0) {
      unmatched[bundle.mayor.elected.localPartyName] =
        resolution.unmatchedFragments;
    }
  }
  // kmetstva
  for (const k of bundle.kmetstva as LocalKmetstvoResult[]) {
    if (reapplyToMayorList(k.candidates, byNickNameLower, unmatched))
      dirty = true;
  }
  // districts (Sofia/Plovdiv/Varna)
  for (const d of bundle.districts as LocalDistrictMayorResult[]) {
    if (reapplyToMayorList(d.candidates, byNickNameLower, unmatched))
      dirty = true;
  }
  // council parties
  for (const party of bundle.council) {
    const { changed, resolution } = reapplyToRow(party, byNickNameLower);
    if (changed) dirty = true;
    if (resolution.unmatchedFragments.length > 0) {
      unmatched[party.localPartyName] = resolution.unmatchedFragments;
    }
  }
  return dirty;
};

export const resolveCanonicalsForCycle = (opts: {
  cycle: string;
  publicFolder: string;
  canonical: CanonicalPartiesIndex | undefined;
  stringify: (o: object) => string;
}): void => {
  const { cycle, publicFolder, canonical, stringify } = opts;
  const cycleFolder = path.join(publicFolder, cycle);
  const muniDir = path.join(cycleFolder, "municipalities");
  if (!fs.existsSync(muniDir)) {
    console.warn(
      `[resolve_canonicals] ${cycle}: no municipalities/ folder — skip`,
    );
    return;
  }
  const byNickNameLower = buildByNickNameLower(canonical);
  const files = fs.readdirSync(muniDir).filter((f) => f.endsWith(".json"));
  const bundles: LocalMunicipalityBundle[] = [];
  const unmatched: Record<string, string[]> = {};
  let dirtyCount = 0;
  for (const f of files) {
    const fpath = path.join(muniDir, f);
    const bundle = JSON.parse(
      fs.readFileSync(fpath, "utf-8"),
    ) as LocalMunicipalityBundle;
    const dirty = reapplyToBundle(bundle, byNickNameLower, unmatched);
    if (dirty) {
      fs.writeFileSync(fpath, stringify(bundle), "utf-8");
      dirtyCount++;
    }
    bundles.push(bundle);
  }

  // index.json rollups bake displayName/color from the canonical index, so
  // always rewrite it (even when no bundle changed) — a canonical-index
  // edit can shift displayName without flipping any id.
  const dates = dateFromCycle(cycle);
  const index = buildIndex({
    cycle,
    round1Date: dates.round1,
    round2Date: dates.round2,
    bundles,
    canonical,
  });
  fs.writeFileSync(
    path.join(cycleFolder, "index.json"),
    stringify(index),
    "utf-8",
  );

  // Always rewrite _unmatched_coalitions.json — the override file may have
  // gained an entry that empties a row's unmatchedFragments.
  fs.writeFileSync(
    path.join(cycleFolder, "_unmatched_coalitions.json"),
    stringify(unmatched),
    "utf-8",
  );

  // Canonical displayName/color shifts flow into the region rollups too, so
  // rebuild them alongside index.json. Regular _mi cycles only.
  if (cycle.endsWith("_mi")) {
    buildRegionRollups({ publicFolder, cycle, stringify });
  }

  // Only regular _mi cycles produce officials_diff (chmi partials don't —
  // see parse_local_elections.ts for the rationale).
  if (cycle.endsWith("_mi")) {
    reconcileOfficials({ cycle, publicFolder, stringify });
  }

  console.log(
    `[resolve_canonicals] ${cycle}: ${dirtyCount}/${files.length} bundle(s) rewritten` +
      (Object.keys(unmatched).length > 0
        ? `, ${Object.keys(unmatched).length} unmatched coalition(s)`
        : ""),
  );
};

const loadCanonicalParties = (
  publicFolder: string,
): CanonicalPartiesIndex | undefined => {
  const file = path.join(publicFolder, "canonical_parties.json");
  if (!fs.existsSync(file)) {
    console.warn(
      `[resolve_canonicals] canonical_parties.json not found — run \`npm run data -- --summary\` first.`,
    );
    return undefined;
  }
  return JSON.parse(fs.readFileSync(file, "utf-8")) as CanonicalPartiesIndex;
};

export const resolveCanonicalsForAllLocalCycles = (opts: {
  publicFolder?: string;
  canonical?: CanonicalPartiesIndex;
  stringify: (o: object) => string;
}): void => {
  const publicFolder =
    opts.publicFolder ?? path.resolve(__dirname, "../../data");
  const canonical = opts.canonical ?? loadCanonicalParties(publicFolder);
  if (!canonical) return;
  const cycles = fs
    .readdirSync(publicFolder, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((n) => /_(mi|chmi|chmi_nov)$/.test(n))
    .sort();
  for (const cycle of cycles) {
    resolveCanonicalsForCycle({
      cycle,
      publicFolder,
      canonical,
      stringify: opts.stringify,
    });
  }
  // local_chmi_history.json is a cross-cycle index — rebuild once at the
  // end so it sees every refreshed bundle.
  buildChmiHistory({ stringify: opts.stringify });
};
