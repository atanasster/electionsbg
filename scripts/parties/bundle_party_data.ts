/**
 * Bundles every relevant data point for ONE party in ONE election into a single
 * compact JSON, ready to feed to an LLM for a campaign retrospect.
 *
 * Output: prints the bundle to stdout (so a skill can `node -e ...` or the
 * generate_retrospect.ts script can pipe it directly).
 *
 * Data sources (per party):
 *   - public/elections.json                              → election metadata
 *   - public/{election}/cik_parties.json                 → party info, color
 *   - public/{election}/national_summary.json            → national context
 *   - public/{election}/region_votes.json                → regional split (current)
 *   - public/{prior}/region_votes.json                   → prior regional split
 *   - public/{election}/parties/by_region/{N}.json       → per-region for THIS party
 *   - public/{election}/parties/by_municipality/{N}.json → per-municipality
 *   - public/{election}/parties/by_settlement/{N}.json   → per-settlement
 *   - public/{election}/parties/financing/{N}/filing.json (optional)
 *   - public/polls/polls.json + polls_details.json + accuracy.json (optional)
 *   - public/{election}/preferences/by_region/{N}.json (optional)
 *
 * Usage:
 *   tsx scripts/parties/bundle_party_data.ts --election 2024_10_27 --party 18
 *   tsx scripts/parties/bundle_party_data.ts --election 2024_10_27 --party 18 --out /tmp/bundle.json
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { command, run, option, string, optional } from "cmd-ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, "../../public");
const ELECTIONS_INDEX = path.resolve(
  __dirname,
  "../../src/data/json/elections.json",
);

type ElectionInfo = {
  name: string;
  hasFinancials?: boolean;
  hasPreferences?: boolean;
  hasRecount?: boolean;
  results?: {
    votes: {
      number: number;
      partyNum: number;
      nickName: string;
      commonName?: string[];
      totalVotes: number;
      paperVotes?: number;
      machineVotes?: number;
    }[];
  };
};

type PartyInfo = {
  number: number;
  name: string;
  nickName: string;
  color?: string;
  name_en?: string;
  commonName?: string[];
};

type Region = {
  oblast: string;
  name?: string;
  name_en?: string;
};

type PartyResultsRow = {
  oblast?: string;
  obshtina?: string;
  ekatte?: string;
  position: number;
  totalVotes: number;
  machineVotes?: number;
  paperVotes?: number;
  allVotes: number;
  prevYearVotes?: number;
  prevYearVotesConsolidated?: number;
};

const readJson = <T>(p: string): T | undefined => {
  if (!fs.existsSync(p)) return undefined;
  return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
};

const round = (n: number, d = 2) => {
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
};

const findPriorElection = (
  electionName: string,
  index: ElectionInfo[],
): ElectionInfo | undefined => {
  const idx = index.findIndex((e) => e.name === electionName);
  return idx >= 0 && idx < index.length - 1 ? index[idx + 1] : undefined;
};

const matchPrior = (
  party: { nickName: string; commonName?: string[] },
  votes: {
    number: number;
    nickName: string;
    commonName?: string[];
    totalVotes: number;
  }[],
) => {
  const matched = votes.filter((v) => {
    if (v.nickName === party.nickName) return true;
    if (
      v.commonName?.length &&
      party.nickName &&
      v.commonName.includes(party.nickName)
    )
      return true;
    if (
      party.commonName?.length &&
      v.commonName?.length &&
      party.commonName.some((c) => v.commonName!.includes(c))
    )
      return true;
    return false;
  });
  if (!matched.length) return undefined;
  return matched.reduce((s, v) => s + v.totalVotes, 0);
};

const positionOf = (
  partyNum: number,
  votes: { partyNum: number; totalVotes: number }[],
) => {
  const sorted = [...votes].sort((a, b) => b.totalVotes - a.totalVotes);
  const idx = sorted.findIndex((v) => v.partyNum === partyNum);
  return idx >= 0 ? idx + 1 : undefined;
};

const buildBundle = (election: string, partyNum: number) => {
  const electionsIndex = readJson<ElectionInfo[]>(ELECTIONS_INDEX);
  if (!electionsIndex) throw new Error(`missing ${ELECTIONS_INDEX}`);
  const electionInfo = electionsIndex.find((e) => e.name === election);
  if (!electionInfo) throw new Error(`unknown election: ${election}`);
  const prior = findPriorElection(election, electionsIndex);

  const partyInfos = readJson<PartyInfo[]>(
    path.join(PUBLIC_DIR, election, "cik_parties.json"),
  );
  if (!partyInfos) throw new Error(`missing cik_parties.json for ${election}`);
  const party = partyInfos.find((p) => p.number === partyNum);
  if (!party) throw new Error(`party ${partyNum} not found in ${election}`);

  const regions = readJson<Region[]>(
    path.resolve(__dirname, "../../src/data/json/regions.json"),
  );

  const totalVotes =
    electionInfo.results?.votes.reduce((s, v) => s + v.totalVotes, 0) ?? 0;
  const partyVotesEntry = electionInfo.results?.votes.find(
    (v) => v.number === partyNum,
  );
  const partyTotal = partyVotesEntry?.totalVotes ?? 0;
  const pos = positionOf(
    partyNum,
    electionInfo.results?.votes.map((v) => ({
      partyNum: v.number,
      totalVotes: v.totalVotes,
    })) ?? [],
  );

  let priorTotal: number | undefined;
  let priorPartyTotal: number | undefined;
  let priorPos: number | undefined;
  if (prior?.results) {
    priorTotal = prior.results.votes.reduce((s, v) => s + v.totalVotes, 0);
    priorPartyTotal = matchPrior(
      { nickName: party.nickName, commonName: party.commonName },
      prior.results.votes,
    );
    if (priorPartyTotal) {
      const matchedNum = prior.results.votes.find(
        (v) => v.nickName === party.nickName,
      )?.number;
      if (matchedNum !== undefined) {
        priorPos = positionOf(
          matchedNum,
          prior.results.votes.map((v) => ({
            partyNum: v.number,
            totalVotes: v.totalVotes,
          })),
        );
      }
    }
  }

  // Per-region for this party (pre-aggregated file)
  const byRegion = readJson<PartyResultsRow[]>(
    path.join(PUBLIC_DIR, election, "parties", "by_region", `${partyNum}.json`),
  );
  const enrichedRegions = (byRegion ?? [])
    .map((r) => {
      const info = regions?.find((x) => x.oblast === r.oblast);
      const prior = r.prevYearVotesConsolidated ?? r.prevYearVotes;
      const priorPctOfRegion =
        prior !== undefined && r.allVotes
          ? round((100 * prior) / r.allVotes)
          : undefined;
      const currentPct = r.allVotes
        ? round((100 * r.totalVotes) / r.allVotes)
        : 0;
      return {
        oblast: r.oblast,
        name_en: info?.name_en,
        name_bg: info?.name,
        position: r.position,
        votes: r.totalVotes,
        priorVotes: prior,
        deltaVotes: prior !== undefined ? r.totalVotes - prior : undefined,
        pctOfRegion: currentPct,
        priorPctOfRegion,
        deltaPctPoints:
          priorPctOfRegion !== undefined
            ? round(currentPct - priorPctOfRegion)
            : undefined,
        pctOfPartyTotal: partyTotal
          ? round((100 * r.totalVotes) / partyTotal)
          : 0,
        machinePct: r.totalVotes
          ? round((100 * (r.machineVotes ?? 0)) / r.totalVotes)
          : 0,
      };
    })
    .sort((a, b) => b.votes - a.votes);

  // Per-municipality and per-settlement (top 25 each is enough for an LLM)
  const byMunicipality = readJson<PartyResultsRow[]>(
    path.join(
      PUBLIC_DIR,
      election,
      "parties",
      "by_municipality",
      `${partyNum}.json`,
    ),
  );
  const topMunicipalities = (byMunicipality ?? [])
    .slice()
    .sort((a, b) => b.totalVotes - a.totalVotes)
    .slice(0, 25)
    .map((r) => {
      const prior = r.prevYearVotesConsolidated ?? r.prevYearVotes;
      return {
        oblast: r.oblast,
        obshtina: r.obshtina,
        position: r.position,
        votes: r.totalVotes,
        deltaVotes: prior !== undefined ? r.totalVotes - prior : undefined,
        pctOfMuni: r.allVotes ? round((100 * r.totalVotes) / r.allVotes) : 0,
      };
    });

  const bySettlement = readJson<PartyResultsRow[]>(
    path.join(
      PUBLIC_DIR,
      election,
      "parties",
      "by_settlement",
      `${partyNum}.json`,
    ),
  );
  const topSettlements = (bySettlement ?? [])
    .slice()
    .sort((a, b) => b.totalVotes - a.totalVotes)
    .slice(0, 25)
    .map((r) => {
      const prior = r.prevYearVotesConsolidated ?? r.prevYearVotes;
      return {
        oblast: r.oblast,
        obshtina: r.obshtina,
        ekatte: r.ekatte,
        position: r.position,
        votes: r.totalVotes,
        deltaVotes: prior !== undefined ? r.totalVotes - prior : undefined,
        pctOfSettlement: r.allVotes
          ? round((100 * r.totalVotes) / r.allVotes)
          : 0,
      };
    });

  // Top regional gainers/losers
  const swings = enrichedRegions
    .filter((r) => r.deltaPctPoints !== undefined)
    .slice()
    .sort((a, b) => (b.deltaPctPoints ?? 0) - (a.deltaPctPoints ?? 0));
  const topGainers = swings.slice(0, 5);
  const topLosers = swings.slice(-5).reverse();

  // Optional: financing (only if hasFinancials)
  let financing: unknown = undefined;
  if (electionInfo.hasFinancials) {
    financing = readJson(
      path.join(
        PUBLIC_DIR,
        election,
        "parties",
        "financing",
        String(partyNum),
        "filing.json",
      ),
    );
  }

  // Optional: polling accuracy for THIS party (uses nickName as key).
  // CRITICAL: agencyHistoricalBias is recomputed from elections ≤ current so a
  // retrospect for an older election doesn't leak future-cycle data into the
  // "agency historical bias" that the LLM is given. The pre-aggregated
  // agencyProfiles in accuracy.json is built across ALL elections globally and
  // would leak future cycles into older retrospects.
  type Accuracy = {
    elections: {
      electionDate: string;
      agencies: {
        agencyId: string;
        daysBefore: number;
        respondents: number | null;
        errors: {
          key: string;
          polled: number;
          actual: number;
          error: number;
        }[];
      }[];
    }[];
  };
  const accuracy = readJson<Accuracy>(
    path.join(PUBLIC_DIR, "polls", "accuracy.json"),
  );
  const electionIso = election.replace(/_/g, "-");
  let pollingForParty:
    | {
        agencyId: string;
        daysBefore: number;
        respondents: number | null;
        polled: number;
        actual: number;
        error: number;
      }[]
    | undefined;
  let agencyHistoricalBias:
    | { agencyId: string; meanError: number; samples: number }[]
    | undefined;
  if (accuracy) {
    const eRow = accuracy.elections.find((e) => e.electionDate === electionIso);
    if (eRow) {
      pollingForParty = eRow.agencies
        .map((a) => {
          const e = a.errors.find((x) => x.key === party.nickName);
          if (!e) return undefined;
          return {
            agencyId: a.agencyId,
            daysBefore: a.daysBefore,
            respondents: a.respondents,
            polled: e.polled,
            actual: e.actual,
            error: e.error,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== undefined);
    }
    // Recompute bias per agency for this party using only elections ≤ current
    const priorAndCurrent = accuracy.elections.filter(
      (e) => e.electionDate <= electionIso,
    );
    const biasByAgency = new Map<string, { sum: number; n: number }>();
    for (const e of priorAndCurrent) {
      for (const a of e.agencies) {
        const err = a.errors.find((x) => x.key === party.nickName);
        if (!err) continue;
        const cur = biasByAgency.get(a.agencyId) ?? { sum: 0, n: 0 };
        cur.sum += err.error;
        cur.n += 1;
        biasByAgency.set(a.agencyId, cur);
      }
    }
    agencyHistoricalBias = [...biasByAgency.entries()]
      .map(([agencyId, { sum, n }]) => ({
        agencyId,
        meanError: round(sum / n),
        samples: n,
      }))
      .sort((a, b) => Math.abs(a.meanError) - Math.abs(b.meanError));
  }

  return {
    schemaVersion: 1,
    election,
    priorElection: prior?.name,
    party: {
      number: party.number,
      nickName: party.nickName,
      name_bg: party.name,
      name_en: party.name_en,
      color: party.color,
    },
    nationalContext: {
      totalNationalVotes: totalVotes,
      partyVotes: partyTotal,
      partyPct: totalVotes ? round((100 * partyTotal) / totalVotes) : 0,
      position: pos,
      passedThreshold: totalVotes
        ? (100 * partyTotal) / totalVotes >= 4
        : false,
      priorTotalNationalVotes: priorTotal,
      priorPartyVotes: priorPartyTotal,
      priorPartyPct:
        priorTotal && priorPartyTotal !== undefined
          ? round((100 * priorPartyTotal) / priorTotal)
          : undefined,
      priorPosition: priorPos,
      deltaVotes:
        priorPartyTotal !== undefined
          ? partyTotal - priorPartyTotal
          : undefined,
      deltaPctPoints:
        priorTotal && priorPartyTotal !== undefined && totalVotes
          ? round(
              (100 * partyTotal) / totalVotes -
                (100 * priorPartyTotal) / priorTotal,
            )
          : undefined,
    },
    paperMachine: partyVotesEntry
      ? {
          paper: partyVotesEntry.paperVotes ?? 0,
          machine: partyVotesEntry.machineVotes ?? 0,
          paperPct:
            (partyVotesEntry.paperVotes ?? 0) +
              (partyVotesEntry.machineVotes ?? 0) >
            0
              ? round(
                  (100 * (partyVotesEntry.paperVotes ?? 0)) /
                    ((partyVotesEntry.paperVotes ?? 0) +
                      (partyVotesEntry.machineVotes ?? 0)),
                )
              : 0,
        }
      : undefined,
    regions: enrichedRegions,
    topGainerRegions: topGainers,
    topLoserRegions: topLosers,
    topMunicipalities,
    topSettlements,
    financing: financing ?? null,
    polling: pollingForParty
      ? {
          finalPollErrors: pollingForParty,
          agencyHistoricalBias,
        }
      : null,
  };
};

const app = command({
  name: "bundle_party_data",
  args: {
    election: option({
      type: string,
      long: "election",
      short: "e",
      description: "Election folder name, e.g. 2024_10_27",
    }),
    party: option({
      type: string,
      long: "party",
      short: "p",
      description: "Party number (matches cik_parties.json)",
    }),
    out: option({
      type: optional(string),
      long: "out",
      short: "o",
      description: "Optional output file (default: stdout)",
    }),
  },
  handler: ({ election, party, out }) => {
    const partyNum = parseInt(party, 10);
    if (!Number.isFinite(partyNum)) throw new Error(`invalid party: ${party}`);
    const bundle = buildBundle(election, partyNum);
    const json = JSON.stringify(bundle, null, 2);
    if (out) {
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, json);
      console.error(`✓ wrote ${out} (${json.length} bytes)`);
    } else {
      process.stdout.write(json);
    }
  },
});

run(app, process.argv.slice(2));
