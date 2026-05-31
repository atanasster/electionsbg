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
  LocalDistrictMayorResult,
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

// CIK marks both runoff finalists elected in round 1, so prefer the
// runoff-resolved winner. Mirrors the SPA's resolveDistrictMayor.
const resolveDistrictMayor = (
  d: LocalDistrictMayorResult,
): LocalMayorResult | undefined =>
  d.elected ?? d.candidates.find((c) => c.isElected) ?? d.candidates[0];

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

type PartyRef = {
  canonicalId: string;
  displayName: string;
  color: string;
};

type RegionMunicipalityRow = {
  obshtinaCode: string;
  name: string;
  hadRound2: boolean;
  councilSeats: number;
  electedMayor:
    | (PartyRef & {
        candidateName: string;
        localPartyName: string;
        mpId?: number;
        isIndependent: boolean;
        // Vote share in the decisive round — surfaced by the standalone
        // município-list pages (independent-mayors table).
        pctOfValid: number;
      })
    | null;
  // Party leading this município's council (most seats; ties broken by votes).
  // Distinct from electedMayor — the mayoralty is winner-take-all/personality,
  // the council is the proportional party signal. Drives the council-support
  // choropleth alongside the mayors-control one.
  topCouncil:
    | (PartyRef & {
        localPartyName: string;
        seats: number;
        pctOfValid: number;
      })
    | null;
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
  // Full party breakdowns (sorted desc) so the map tooltip can list the top
  // parties — not just the leader — mirroring the parliamentary votes map.
  // topMayor / topCouncil remain the [0] entries (kept for the choropleth fill
  // + top-regions table).
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
  // Sofia only: the 24 районни кметове (directly-elected district mayors)
  // tallied by party. The national mayor map surfaces this on hover instead of
  // the single city mayoralty in `mayorsWon` (which stays on the Sofia-city
  // skyline shortcut). Absent for every other oblast and for cycles with no
  // Sofia district data.
  districtMayors?: {
    canonicalId: string;
    displayName: string;
    color: string;
    count: number;
  }[];
};

export type RegionsSummary = {
  cycle: string;
  round1Date: string;
  round2Date: string | null;
  regions: RegionsSummaryRow[];
};

// National per-município directory — every município row (mayor + leading
// council party + runoff flag), concatenated across oblasti and tagged with
// the oblast code. The single fetch behind the standalone stat-tile pages
// (all municipalities / runoffs / split control / independent mayors) on the
// country dashboard, so they don't fan out across all ~265 bundles.
export type NationalMunicipalityRow = RegionMunicipalityRow & {
  oblast: string;
};

export type NationalMunicipalities = {
  cycle: string;
  round1Date: string;
  round2Date: string | null;
  municipalities: NationalMunicipalityRow[];
};

// === National leader tiles ===============================================
// Precomputed cross-município leaderboards for the country dashboard, so the
// SPA renders them from one fetch instead of pulling all ~265 bundles.

type CandidateRef = {
  candidateName: string;
  mpId?: number;
  party: PartyRef & { localPartyName: string };
  pctOfValid: number;
  votes: number;
};

type NationalMayorLeader = {
  obshtinaCode: string;
  obshtinaName: string;
  oblast: string;
  round: 1 | 2;
} & CandidateRef;

type ClosestRace = {
  obshtinaCode: string;
  obshtinaName: string;
  oblast: string;
  round: 1 | 2;
  marginPct: number; // winner.pctOfValid − runnerUp.pctOfValid in the decisive round
  winner: CandidateRef;
  runnerUp: CandidateRef;
};

type SplitControlRow = {
  obshtinaCode: string;
  obshtinaName: string;
  oblast: string;
  candidateName: string;
  mayor: PartyRef;
  council: PartyRef;
};

type IndependentMayorRow = {
  obshtinaCode: string;
  obshtinaName: string;
  oblast: string;
  candidateName: string;
  mpId?: number;
  pctOfValid: number;
};

export type NationalLeaders = {
  cycle: string;
  round1Date: string;
  round2Date: string | null;
  topMayorsByPct: NationalMayorLeader[];
  closestRaces: ClosestRace[];
  splitControl: { count: number; rows: SplitControlRow[] };
  independentMayors: { count: number; rows: IndependentMayorRow[] };
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

  // Leading council party for one município, bucketed the same way as the
  // rollups. Most seats wins; ties broken by votes (also covers councils not
  // yet seat-allocated — falls back to the vote leader).
  const leadingCouncil = (
    b: LocalMunicipalityBundle,
  ): RegionMunicipalityRow["topCouncil"] => {
    const agg = new Map<
      string,
      { seats: number; votes: number; localPartyName: string }
    >();
    for (const p of b.council) {
      const id = councilBucketId(p);
      const cur = agg.get(id) ?? {
        seats: 0,
        votes: 0,
        localPartyName: p.localPartyName,
      };
      cur.seats += p.mandatesWon;
      cur.votes += p.totalVotes;
      agg.set(id, cur);
    }
    let bestId: string | null = null;
    let best = { seats: -1, votes: -1, localPartyName: "" };
    for (const [id, v] of agg) {
      if (
        v.seats > best.seats ||
        (v.seats === best.seats && v.votes > best.votes)
      ) {
        bestId = id;
        best = v;
      }
    }
    if (!bestId) return null;
    const totalVotes = b.council.reduce((a, p) => a + p.totalVotes, 0);
    const meta = metaFor(bestId, best.localPartyName);
    return {
      canonicalId: bestId,
      displayName: meta.displayName,
      color: meta.color,
      localPartyName: best.localPartyName,
      seats: best.seats,
      pctOfValid: totalVotes > 0 ? (best.votes / totalVotes) * 100 : 0,
    };
  };

  // CandidateRef from a mayor result, bucketed for party identity/colour.
  const candidateRef = (c: LocalMayorResult): CandidateRef => {
    const id = mayorBucketId(c);
    const meta = metaFor(id, c.localPartyName);
    return {
      candidateName: c.candidateName,
      mpId: c.mpId,
      party: {
        canonicalId: id,
        displayName: meta.displayName,
        color: meta.color,
        localPartyName: c.localPartyName,
      },
      pctOfValid: c.pctOfValid,
      votes: c.votes,
    };
  };

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

  // National leaderboards, accumulated across every oblast.
  const topMayorsByPct: NationalMayorLeader[] = [];
  const closestRaces: ClosestRace[] = [];
  const splitControl: SplitControlRow[] = [];
  const independentMayors: IndependentMayorRow[] = [];

  // National município directory — every row tagged with its oblast.
  const nationalMunicipalities: NationalMunicipalityRow[] = [];

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
            mpId: elected.mpId,
            isIndependent: elected.isIndependent,
            pctOfValid: elected.pctOfValid,
          };
        }
        reg += b.protocol.numRegisteredVoters;
        act += b.protocol.totalActualVoters;
        val += b.protocol.numValidVotes;
        const hadRound2 = !!b.mayor.round2 && b.mayor.round2.length > 0;
        if (hadRound2) runoffs += 1;
        const topCouncilRow = leadingCouncil(b);

        // National leaderboards. The decisive round is the runoff when held,
        // else round 1; uncontested 1-candidate races are skipped so the
        // "strongest mandates" / "closest races" lists stay meaningful.
        if (elected && mayorRow) {
          const decisive = hadRound2 ? b.mayor.round2! : b.mayor.round1;
          const ranked = [...decisive].sort((a, c) => c.votes - a.votes);
          const roundNum: 1 | 2 = hadRound2 ? 2 : 1;
          if (ranked.length >= 2) {
            topMayorsByPct.push({
              obshtinaCode: b.obshtinaCode,
              obshtinaName: b.obshtinaName,
              oblast,
              round: roundNum,
              ...candidateRef(ranked[0]),
            });
            closestRaces.push({
              obshtinaCode: b.obshtinaCode,
              obshtinaName: b.obshtinaName,
              oblast,
              round: roundNum,
              marginPct: ranked[0].pctOfValid - ranked[1].pctOfValid,
              winner: candidateRef(ranked[0]),
              runnerUp: candidateRef(ranked[1]),
            });
          }
          if (elected.isIndependent) {
            independentMayors.push({
              obshtinaCode: b.obshtinaCode,
              obshtinaName: b.obshtinaName,
              oblast,
              candidateName: elected.candidateName,
              mpId: elected.mpId,
              pctOfValid: elected.pctOfValid,
            });
          }
          if (
            topCouncilRow &&
            topCouncilRow.canonicalId !== mayorRow.canonicalId
          ) {
            splitControl.push({
              obshtinaCode: b.obshtinaCode,
              obshtinaName: b.obshtinaName,
              oblast,
              candidateName: elected.candidateName,
              mayor: {
                canonicalId: mayorRow.canonicalId,
                displayName: mayorRow.displayName,
                color: mayorRow.color,
              },
              council: {
                canonicalId: topCouncilRow.canonicalId,
                displayName: topCouncilRow.displayName,
                color: topCouncilRow.color,
              },
            });
          }
        }
        return {
          obshtinaCode: b.obshtinaCode,
          name: b.obshtinaName,
          hadRound2,
          councilSeats: seats,
          electedMayor: mayorRow,
          topCouncil: topCouncilRow,
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

    for (const m of municipalities)
      nationalMunicipalities.push({ ...m, oblast });

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

    // Sofia: tally the directly-elected районни кметове across the SOF bundle's
    // 24 districts so the national mayor map can break Sofia down by district
    // mayoralty rather than showing the lone city mayor.
    let districtMayors: RegionsSummaryRow["districtMayors"];
    if (oblast === "SOF") {
      const tally = new Map<
        string,
        { count: number; localPartyName: string }
      >();
      for (const b of group) {
        for (const d of b.districts ?? []) {
          const winner = resolveDistrictMayor(d);
          if (!winner) continue;
          const id = mayorBucketId(winner);
          const cur = tally.get(id) ?? {
            count: 0,
            localPartyName: winner.localPartyName,
          };
          cur.count += 1;
          tally.set(id, cur);
        }
      }
      if (tally.size > 0) {
        districtMayors = sorted(
          Array.from(tally.entries()).map(([id, v]) => {
            const meta = metaFor(id, v.localPartyName);
            return {
              canonicalId: id,
              displayName: meta.displayName,
              color: meta.color,
              count: v.count,
            };
          }),
        );
      }
    }

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
      mayorsWon: mayorsRollup,
      councilSeats: councilRollup,
      districtMayors,
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

  topMayorsByPct.sort((a, b) => b.pctOfValid - a.pctOfValid);
  closestRaces.sort((a, b) => a.marginPct - b.marginPct);
  splitControl.sort((a, b) =>
    a.obshtinaName.localeCompare(b.obshtinaName, "bg"),
  );
  independentMayors.sort((a, b) =>
    a.obshtinaName.localeCompare(b.obshtinaName, "bg"),
  );
  const nationalLeaders: NationalLeaders = {
    cycle,
    round1Date: index.round1Date,
    round2Date: index.round2Date,
    topMayorsByPct: topMayorsByPct.slice(0, 12),
    closestRaces: closestRaces.slice(0, 12),
    splitControl: {
      count: splitControl.length,
      rows: splitControl.slice(0, 80),
    },
    independentMayors: {
      count: independentMayors.length,
      rows: independentMayors.slice(0, 80),
    },
  };
  fs.writeFileSync(
    path.join(cycleDir, "national_leaders.json"),
    stringify(nationalLeaders),
    "utf-8",
  );

  nationalMunicipalities.sort((a, b) => a.name.localeCompare(b.name, "bg"));
  const nationalMunicipalitiesDoc: NationalMunicipalities = {
    cycle,
    round1Date: index.round1Date,
    round2Date: index.round2Date,
    municipalities: nationalMunicipalities,
  };
  fs.writeFileSync(
    path.join(cycleDir, "national_municipalities.json"),
    stringify(nationalMunicipalitiesDoc),
    "utf-8",
  );

  // Lightweight trends sidecar: the cross-cycle trends tile fans out across
  // every cycle's index.json (4× ~100KB) but only ever needs the two rollup
  // arrays. Emit a trimmed copy so the country dashboard pulls ~40KB instead
  // of ~480KB across cycles.
  const indexTrends = {
    cycle,
    round1Date: index.round1Date,
    round2Date: index.round2Date,
    councilVoteShare: index.councilVoteShare,
    mayorsByCanonical: index.mayorsByCanonical,
  };
  fs.writeFileSync(
    path.join(cycleDir, "index_trends.json"),
    stringify(indexTrends),
    "utf-8",
  );

  console.log(
    `[parsers_local] ${cycle}: wrote ${summaryRows.length} oblast rollup(s) + regions_summary.json + national_leaders.json + national_municipalities.json + index_trends.json`,
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
