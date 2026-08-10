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
//   - sections/<code>.json  (the per-section party legend — see below)
//   - _unmatched_coalitions.json (operator inbox)
//   - officials_diff{.json,/} (only for regular _mi cycles)
// and globally:
//   - local_chmi_history.json (cross-cycle chmi feed)
//
// THE SECTION LEGEND IS PART OF THIS PASS, and was missing from it until
// 2026-08-09. `municipalities/` alone is not the whole baked surface: each
// `sections/<code>.json` carries its own `parties[]` legend with a baked
// `primaryCanonicalId` AND a baked `color`, and it is what the per-section maps
// render from. Leaving it out meant an override fix reached the município
// bundles and stopped — measured after the ВМРО fix, 3,399 section shards still
// served the retired `vmro` id in grey while every bundle had moved to `p_51`.
// The two must be re-baked together or the same page shows two answers.

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
import { buildIndex, displayMeta } from "./build_index_json";
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

// `elected` is a SEPARATE object from the matching `candidates` row, not a
// reference into it, so re-resolving the list leaves the winner on its old
// ids. Every consumer that shows a single winner — the chmi feed, the mayor
// timeline, the winner tiles — reads `elected`, so missing one of these is
// the shape where a canonical fix lands in the bundle and never reaches the
// page.
const reapplyToOptionalRow = (
  row: LocalMayorResult | null | undefined,
  byNickNameLower: Map<string, string>,
  unmatched: Record<string, string[]>,
): boolean => {
  if (!row) return false;
  const { changed, resolution } = reapplyToRow(row, byNickNameLower);
  if (resolution.unmatchedFragments.length > 0) {
    unmatched[row.localPartyName] = resolution.unmatchedFragments;
  }
  return changed;
};

// The per-section party LEGEND. A different shape from the bundle rows — no
// `memberCanonicalIds`, no `isIndependent`, but a baked `color` — so it gets its
// own pass rather than being forced through `reapplyToRow`.
//
// `color` is re-derived because a stale id and a stale colour travel together:
// fixing only the id would leave a real party rendering as unresolved on every
// section map.
//
// IT MUST MATCH `apply_section_augmentation.ts:116` EXACTLY —
// `leg?.primaryCanonicalId ? meta.color : "#9CA3AF"`. `displayMeta(null)`
// returns "#6B7280", a DIFFERENT grey, so calling it unguarded made this pass
// disagree with the ingest writer: 418,861 legend rows across 45,687 files
// flipped, and because `--local-ingest` and `--resolve-local-canonicals` are
// separate flags the rendered colour then depended on which ran last. Two
// writers of one field have to agree on all of it, including the null branch.
type SectionPartyLegend = {
  localPartyNum: number;
  localPartyName: string;
  primaryCanonicalId: string | null;
  color: string;
};

const reapplyToSectionShard = (
  shard: { parties?: SectionPartyLegend[] },
  byNickNameLower: Map<string, string>,
  canonical: CanonicalPartiesIndex | undefined,
  unmatched: Record<string, string[]>,
): boolean => {
  let dirty = false;
  for (const p of shard.parties ?? []) {
    const resolution = resolveLocalParty(p.localPartyName, byNickNameLower);
    if (resolution.unmatchedFragments.length > 0) {
      unmatched[p.localPartyName] = resolution.unmatchedFragments;
    }
    const color = resolution.primaryCanonicalId
      ? displayMeta(resolution.primaryCanonicalId, canonical).color
      : "#9CA3AF";
    if (p.primaryCanonicalId !== resolution.primaryCanonicalId) {
      p.primaryCanonicalId = resolution.primaryCanonicalId;
      dirty = true;
    }
    if (p.color !== color) {
      p.color = color;
      dirty = true;
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
  if (reapplyToOptionalRow(bundle.mayor.elected, byNickNameLower, unmatched))
    dirty = true;
  // kmetstva — round 1, the runoff table, and the resolved winner
  for (const k of bundle.kmetstva as LocalKmetstvoResult[]) {
    if (reapplyToMayorList(k.candidates, byNickNameLower, unmatched))
      dirty = true;
    if (reapplyToMayorList(k.round2, byNickNameLower, unmatched)) dirty = true;
    if (reapplyToOptionalRow(k.elected, byNickNameLower, unmatched))
      dirty = true;
  }
  // districts (Sofia/Plovdiv/Varna) — same three
  for (const d of bundle.districts as LocalDistrictMayorResult[]) {
    if (reapplyToMayorList(d.candidates, byNickNameLower, unmatched))
      dirty = true;
    if (reapplyToMayorList(d.round2, byNickNameLower, unmatched)) dirty = true;
    if (reapplyToOptionalRow(d.elected, byNickNameLower, unmatched))
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

  // The per-section legends. Same canonical index, same overrides — see the
  // header for why these cannot be left behind when the bundles move.
  const sectionsDir = path.join(cycleFolder, "sections");
  let sectionDirty = 0;
  if (fs.existsSync(sectionsDir)) {
    // RECURSIVE. `sections/` is mixed: a flat `<obshtina>.json` legend per
    // município AND a `<obshtina>/<sectionId>.json` per polling station, each
    // carrying its OWN copy of the legend. A flat readdir sees 288 of a cycle's
    // 2,437 files — which is how the first version of this pass reported 995
    // legends rewritten and still left 3,644 files on the retired id.
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) return walk(full);
        return e.name.endsWith(".json") ? [full] : [];
      });
    for (const fpath of walk(sectionsDir)) {
      // Named, because a bare parse error here is close to undiagnosable: it
      // throws with no path, and it throws AFTER municipalities/ has been
      // rewritten but BEFORE index.json and officials_diff, leaving the cycle
      // half-regenerated. That exposure grew ~170× when this pass went
      // recursive (288 files -> 48,883).
      let shard: { parties?: SectionPartyLegend[] };
      try {
        shard = JSON.parse(fs.readFileSync(fpath, "utf-8"));
      } catch (e) {
        throw new Error(
          `[resolve_canonicals] ${cycle}: cannot parse section shard ${fpath}: ${(e as Error).message}`,
        );
      }
      if (reapplyToSectionShard(shard, byNickNameLower, canonical, unmatched)) {
        fs.writeFileSync(fpath, stringify(shard), "utf-8");
        sectionDirty++;
      }
    }
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
      // Reported separately from the bundles: the two counts move independently
      // (a legend-only party changes no bundle row), and a silent 0 here is what
      // "the fix reached municipalities/ and stopped" looked like.
      `, ${sectionDirty} section legend(s)` +
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

  // NOT regenerated here, and that is the reason they drifted — state it rather
  // than leave the next person to rediscover it.
  //
  // `transitions_local/`, `transitions_prevote/` and `local_place_trends/` all
  // read the SAME per-section legend this pass rewrites (reconcile_local.ts,
  // reconcile_parl_local.ts), so a canonical fix that lands here and stops is
  // the same "reaches one surface and stops" failure one level up — exactly
  // what left 3,697 files on the retired `vmro` id.
  //
  // They are left out deliberately: each is an expensive matrix build with its
  // own CLI flag and its own review surface, and folding them in would make
  // this fast, idempotent pass slow and non-obvious. After changing a canonical
  // id, run them too:
  //
  //   npm run data -- --local-flows
  //   npm run data -- --prevote-flows
  //   npm run data -- --local-place-trends
  //   npm run data -- --local-problem-sections
  //
  // `served_canonical_ids.test.ts` fails if any of them is left stale.
  console.log(
    "[resolve_canonicals] note: transitions_local / transitions_prevote / " +
      "local_place_trends read this legend and are NOT regenerated here — " +
      "run --local-flows, --prevote-flows and --local-place-trends after an id change",
  );
};
