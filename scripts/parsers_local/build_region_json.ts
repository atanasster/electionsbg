// Per-oblast local-election rollups + a national region-control summary.
//
// Additive, bundle-only pass: reads the already-assembled per-município
// bundles (data/<cycle>/municipalities/*.json) and the cycle index.json, and
// emits
//
//   data/<cycle>/region/<oblast>.json   — full per-oblast rollup (the region
//                                          dashboard's single fetch; replaces
//                                          the old N-município client fan-out)
//   data/<cycle>/regions_summary.json   — lightweight per-oblast control rows
//                                          (national mayors-control choropleth
//                                          + top-regions table)
//
// It never touches the fragile HTML re-parse path — it only re-reads JSON that
// parse_local_elections already produced, so it's safe to run repeatedly.
//
// Party identity/colour is taken from the cycle index.json, which already
// resolved every canonical bucket (council vote share + mayors-won) to a
// displayName + colour. That avoids re-loading canonical_parties.json and
// re-implementing the bucketing rules here.

import fs from "fs";
import path from "path";
import { INDEPENDENT_CANONICAL_ID } from "./local_coalitions";
import type {
  LocalElectionIndex,
  LocalMayorResult,
  LocalMunicipalityBundle,
} from "./types";

type PartyMeta = { displayName: string; color: string };

const FALLBACK_META: PartyMeta = {
  displayName: "Неразпознато",
  color: "#9CA3AF",
};

// Same bucketing rule build_index_json uses, kept in sync deliberately.
const councilBucketId = (party: {
  primaryCanonicalId: string | null;
  isIndependent: boolean;
  localPartyName: string;
}): string => {
  if (party.primaryCanonicalId) return party.primaryCanonicalId;
  if (party.isIndependent) return INDEPENDENT_CANONICAL_ID;
  return `local:${party.localPartyName.toLocaleLowerCase("bg")}`;
};

const mayorBucketId = (elected: LocalMayorResult): string => {
  if (elected.isIndependent) return INDEPENDENT_CANONICAL_ID;
  if (elected.primaryCanonicalId) return elected.primaryCanonicalId;
  return `local:${elected.localPartyName.toLocaleLowerCase("bg")}`;
};

const isSofiaRayon = (code: string): boolean => /^S2\d{3}$/.test(code);

// Region code for grouping. Bundles carry the parliamentary region (МИР) code
// in `oblastName` — including the legitimately-split Plovdiv oblast `PDV` vs
// Plovdiv city `PDV-00`, which we keep so the local region pages line up 1:1
// with the parliamentary region pages and GeoJSON. The sole exception is the
// Sofia city bundle, which stores a display name ("София (столица)") rather
// than a code; parliamentary splits Sofia city into S23/S24/S25, but local
// government treats it as one entity — we key it `SOF` and surface it via the
// dedicated Sofia dashboard.
const oblastCodeOf = (b: LocalMunicipalityBundle): string =>
  b.obshtinaCode === "SOF" ? "SOF" : b.oblastName;

type RegionMunicipalityRow = {
  obshtinaCode: string;
  name: string;
  hadRound2: boolean;
  councilSeats: number;
  electedMayor: {
    candidateName: string;
    canonicalId: string;
    displayName: string;
    color: string;
    localPartyName: string;
  } | null;
  turnout: {
    numRegisteredVoters: number;
    totalActualVoters: number;
    numValidVotes: number;
    pct: number | null;
  };
};

export type RegionRollup = {
  cycle: string;
  oblast: string;
  round1Date: string;
  round2Date: string | null;
  municipalityCount: number;
  runoffCount: number;
  turnout: {
    numRegisteredVoters: number;
    totalActualVoters: number;
    numValidVotes: number;
    pct: number | null;
  };
  mayorsWon: {
    canonicalId: string;
    displayName: string;
    color: string;
    count: number;
  }[];
  councilSeats: {
    canonicalId: string;
    displayName: string;
    color: string;
    seats: number;
  }[];
  municipalities: RegionMunicipalityRow[];
};

export type RegionsSummaryRow = {
  oblast: string;
  municipalityCount: number;
  runoffCount: number;
  totalCouncilSeats: number;
  turnoutPct: number | null;
  // Party controlling the most municipality mayoralties in the oblast — drives
  // the national choropleth fill.
  topMayor: {
    canonicalId: string;
    displayName: string;
    color: string;
    count: number;
  } | null;
  // Top council party by seats across the oblast.
  topCouncil: {
    canonicalId: string;
    displayName: string;
    color: string;
    seats: number;
  } | null;
};

export type RegionsSummary = {
  cycle: string;
  round1Date: string;
  round2Date: string | null;
  regions: RegionsSummaryRow[];
};

const sorted = <T extends { count?: number; seats?: number }>(arr: T[]): T[] =>
  arr
    .slice()
    .sort((a, b) => (b.count ?? b.seats ?? 0) - (a.count ?? a.seats ?? 0));

/**
 * Build region rollups + the national region-control summary for one cycle.
 * Returns the number of oblast files written (0 if the cycle has no bundles).
 */
export const buildRegionRollups = (opts: {
  publicFolder: string;
  cycle: string;
  stringify: (o: object) => string;
}): number => {
  const { publicFolder, cycle, stringify } = opts;
  const cycleDir = path.join(publicFolder, cycle);
  const muniDir = path.join(cycleDir, "municipalities");
  const indexPath = path.join(cycleDir, "index.json");
  if (!fs.existsSync(muniDir) || !fs.existsSync(indexPath)) return 0;

  const index = JSON.parse(
    fs.readFileSync(indexPath, "utf-8"),
  ) as LocalElectionIndex;

  // canonicalId → {displayName, color} from the already-resolved index rollups.
  const metaById = new Map<string, PartyMeta>();
  for (const r of index.councilVoteShare)
    metaById.set(r.canonicalId, { displayName: r.displayName, color: r.color });
  for (const r of index.mayorsByCanonical)
    if (!metaById.has(r.canonicalId))
      metaById.set(r.canonicalId, {
        displayName: r.displayName,
        color: r.color,
      });
  const metaFor = (id: string, fallbackName?: string): PartyMeta =>
    metaById.get(id) ??
    (fallbackName
      ? { displayName: fallbackName, color: "#9CA3AF" }
      : FALLBACK_META);

  // Load every município bundle, skipping the replicated Sofia район shards
  // (they duplicate the SOF city council and would double-count).
  const bundles: LocalMunicipalityBundle[] = [];
  for (const f of fs.readdirSync(muniDir)) {
    if (!f.endsWith(".json")) continue;
    const code = f.replace(/\.json$/, "");
    if (isSofiaRayon(code)) continue;
    bundles.push(
      JSON.parse(
        fs.readFileSync(path.join(muniDir, f), "utf-8"),
      ) as LocalMunicipalityBundle,
    );
  }

  // Group by region code (parliamentary МИР code; Sofia city normalised to SOF).
  const byOblast = new Map<string, LocalMunicipalityBundle[]>();
  for (const b of bundles) {
    const code = oblastCodeOf(b);
    const arr = byOblast.get(code) ?? [];
    arr.push(b);
    byOblast.set(code, arr);
  }

  fs.mkdirSync(path.join(cycleDir, "region"), { recursive: true });

  const summaryRows: RegionsSummaryRow[] = [];

  for (const [oblast, group] of byOblast) {
    const mayorsWon = new Map<string, number>();
    const councilSeats = new Map<string, number>();
    let reg = 0;
    let act = 0;
    let val = 0;
    let runoffs = 0;

    const municipalities: RegionMunicipalityRow[] = group
      .map((b) => {
        const seats = b.council.reduce((a, p) => a + p.mandatesWon, 0);
        for (const p of b.council) {
          if (p.mandatesWon <= 0) continue;
          const id = councilBucketId(p);
          councilSeats.set(id, (councilSeats.get(id) ?? 0) + p.mandatesWon);
        }
        const elected = b.mayor.elected;
        let mayorRow: RegionMunicipalityRow["electedMayor"] = null;
        if (elected) {
          const id = mayorBucketId(elected);
          mayorsWon.set(id, (mayorsWon.get(id) ?? 0) + 1);
          const meta = metaFor(id, elected.localPartyName);
          mayorRow = {
            candidateName: elected.candidateName,
            canonicalId: id,
            displayName: meta.displayName,
            color: meta.color,
            localPartyName: elected.localPartyName,
          };
        }
        reg += b.protocol.numRegisteredVoters;
        act += b.protocol.totalActualVoters;
        val += b.protocol.numValidVotes;
        const hadRound2 = !!b.mayor.round2 && b.mayor.round2.length > 0;
        if (hadRound2) runoffs += 1;
        return {
          obshtinaCode: b.obshtinaCode,
          name: b.obshtinaName,
          hadRound2,
          councilSeats: seats,
          electedMayor: mayorRow,
          turnout: {
            numRegisteredVoters: b.protocol.numRegisteredVoters,
            totalActualVoters: b.protocol.totalActualVoters,
            numValidVotes: b.protocol.numValidVotes,
            pct:
              b.protocol.numRegisteredVoters > 0
                ? (b.protocol.totalActualVoters /
                    b.protocol.numRegisteredVoters) *
                  100
                : null,
          },
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "bg"));

    const mayorsRollup = sorted(
      Array.from(mayorsWon.entries()).map(([id, count]) => {
        const meta = metaFor(id);
        return {
          canonicalId: id,
          displayName: meta.displayName,
          color: meta.color,
          count,
        };
      }),
    );
    const councilRollup = sorted(
      Array.from(councilSeats.entries()).map(([id, seats]) => {
        const meta = metaFor(id);
        return {
          canonicalId: id,
          displayName: meta.displayName,
          color: meta.color,
          seats,
        };
      }),
    );
    const turnoutPct = reg > 0 ? (act / reg) * 100 : null;

    const rollup: RegionRollup = {
      cycle,
      oblast,
      round1Date: index.round1Date,
      round2Date: index.round2Date,
      municipalityCount: group.length,
      runoffCount: runoffs,
      turnout: {
        numRegisteredVoters: reg,
        totalActualVoters: act,
        numValidVotes: val,
        pct: turnoutPct,
      },
      mayorsWon: mayorsRollup,
      councilSeats: councilRollup,
      municipalities,
    };
    fs.writeFileSync(
      path.join(cycleDir, "region", `${oblast}.json`),
      stringify(rollup),
      "utf-8",
    );

    summaryRows.push({
      oblast,
      municipalityCount: group.length,
      runoffCount: runoffs,
      totalCouncilSeats: councilRollup.reduce((a, r) => a + r.seats, 0),
      turnoutPct,
      topMayor: mayorsRollup[0] ?? null,
      topCouncil: councilRollup[0] ?? null,
    });
  }

  summaryRows.sort((a, b) => a.oblast.localeCompare(b.oblast));
  const summary: RegionsSummary = {
    cycle,
    round1Date: index.round1Date,
    round2Date: index.round2Date,
    regions: summaryRows,
  };
  fs.writeFileSync(
    path.join(cycleDir, "regions_summary.json"),
    stringify(summary),
    "utf-8",
  );

  console.log(
    `[parsers_local] ${cycle}: wrote ${summaryRows.length} oblast rollup(s) + regions_summary.json`,
  );
  return summaryRows.length;
};

/** Discover regular local cycles (folders matching YYYY_MM_DD_mi with an index.json). */
const discoverRegularCycles = (publicFolder: string): string[] =>
  fs
    .readdirSync(publicFolder, { withFileTypes: true })
    .filter(
      (d) =>
        d.isDirectory() &&
        /^\d{4}_\d{2}_\d{2}_mi$/.test(d.name) &&
        fs.existsSync(path.join(publicFolder, d.name, "index.json")),
    )
    .map((d) => d.name);

/**
 * Build region rollups for one cycle (when `cycle` is given) or every regular
 * cycle. Wired into the CLI as `--local-rollups [--local-date <cycle>]`.
 */
export const buildLocalRollups = (opts: {
  publicFolder: string;
  cycle?: string;
  stringify: (o: object) => string;
}): void => {
  const { publicFolder, cycle, stringify } = opts;
  const cycles = cycle ? [cycle] : discoverRegularCycles(publicFolder);
  for (const c of cycles) {
    buildRegionRollups({ publicFolder, cycle: c, stringify });
  }
};
