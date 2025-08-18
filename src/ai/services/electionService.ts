/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  ElectionInfo,
  AdminLevel,
  VoteType,
  SortOrder,
  DonorType,
  ElectionResultItem,
  TurnoutData,
  CandidatePerformance,
  PreferenceAnomaly,
  FinancialReport,
  Donor,
  ComparisonResult,
  DiscrepancyReportItem,
  EfficiencyResult,
  FocusArea,
  PartyVoteDiscrepancy,
  InvalidBallotAnomaly,
  AdditionalVoterAnomaly,
  AggregatedAdditionalVoters,
  FinancialComparisonResult,
  NoneOfTheAboveResult,
  VoteAdoptionData,
  MachineVoteDiscrepancy,
} from "@/ai/types";
import electionsData from "@/data/json/elections.json";
import { ElectionInfo as RawElectionData } from "@/data/dataTypes";

// =================================================================
// DATA PROCESSING FROM elections.json
// =================================================================

// Helper to generate a user-friendly name from a date string (YYYY-MM-DD) in both languages
const generateElectionName = (dateStr: string): { en: string; bg: string } => {
  const [year, month] = dateStr.split("-");
  const monthNamesBg: { [key: string]: string } = {
    "01": "Януари",
    "02": "Февруари",
    "03": "Март",
    "04": "Април",
    "05": "Май",
    "06": "Юни",
    "07": "Юли",
    "08": "Август",
    "09": "Септември",
    "10": "Октомври",
    "11": "Ноември",
    "12": "Декември",
  };
  const monthNamesEn: { [key: string]: string } = {
    "01": "January",
    "02": "February",
    "03": "March",
    "04": "April",
    "05": "May",
    "06": "June",
    "07": "July",
    "08": "August",
    "09": "September",
    "10": "October",
    "11": "November",
    "12": "December",
  };
  // A simple heuristic for naming - assuming parliamentary elections
  return {
    bg: `Парламентарни избори ${monthNamesBg[month] || month} ${year}`,
    en: `Parliamentary Elections ${monthNamesEn[month] || month} ${year}`,
  };
};

// Process the imported JSON data to fit the ElectionInfo interface
const allElectionsInfo: ElectionInfo[] = (
  electionsData as RawElectionData[]
).map((election) => {
  const dateParts = election.name.split("_");
  const year = dateParts[0];
  const month = dateParts[1];
  const day = dateParts[2];
  const date = `${year}-${month}-${day}`;

  return {
    identifier: `${year}-${month}`,
    name: generateElectionName(date),
    date: date,
  };
  // The data is already sorted from newest to oldest in the JSON file.
});

// In a real application, these would query your database.
const LATEST_ELECTION_IDENTIFIER =
  allElectionsInfo.length > 0 ? allElectionsInfo[0].identifier : "2023-10";

// =================================================================
// BILINGUAL MOCK DATA & HELPERS
// =================================================================

const parties: Record<
  string,
  {
    en: string;
    bg: string;
    first_election: string;
    aliases?: string[];
    website?: string;
  }
> = {
  "gerb-sds": {
    en: "GERB-SDS",
    bg: "ГЕРБ-СДС",
    first_election: "2021-04",
    aliases: ["gerb", "герб"],
    website: "https://gerb.bg/",
  },
  "pp-db": {
    en: "PP-DB",
    bg: "ПП-ДБ",
    first_election: "2023-04",
    aliases: ["ppdb", "pp", "ппдб", "пп"],
    website: "https://ppdb.bg/",
  },
  vazrazhdane: {
    en: "Vazrazhdane",
    bg: "Възраждане",
    first_election: "2017-03",
    aliases: ["revival"],
  },
  dps: {
    en: "Movement for Rights and Freedoms",
    bg: "Движение за права и свободи",
    first_election: "2005-06",
    aliases: ["dps", "дпс", "mrf"],
    website: "https://dps.bg/",
  },
  bsp: {
    en: "BSP for Bulgaria",
    bg: "БСП за България",
    first_election: "2005-06",
    aliases: ["bsp", "бсп"],
  },
  itn: {
    en: "There Is Such a People",
    bg: "Има такъв народ",
    first_election: "2021-04",
    aliases: ["itn", "итн"],
  },
  velichie: {
    en: "Velichie",
    bg: "Величие",
    first_election: "2024-06",
    aliases: ["greatness"],
  },
  "none-of-the-above": {
    en: "I do not support anyone",
    bg: "Не подкрепям никого",
    first_election: "2017-03",
    aliases: ["none"],
  },
};
type PartyId = keyof typeof parties;

function findPartyId(name: string): PartyId | undefined {
  if (!name) return undefined;
  const lowerCaseName = name.toLowerCase().replace(/[-.\s]/g, ""); // Normalize input by removing hyphens, dots, and spaces.
  for (const id in parties) {
    const party = parties[id as PartyId];
    const partyNames = [
      party.en.toLowerCase().replace(/[-.\s]/g, ""),
      party.bg.toLowerCase().replace(/[-.\s]/g, ""),
      ...(party.aliases?.map((a) => a.toLowerCase().replace(/[-.\s]/g, "")) ||
        []),
    ];
    if (partyNames.includes(lowerCaseName)) {
      return id as PartyId;
    }
  }
  // Fallback search in raw nicknames from JSON as they can be different
  for (const election of electionsData as RawElectionData[]) {
    for (const vote of election.results?.votes || []) {
      if (
        vote.nickName &&
        vote.nickName.toLowerCase().replace(/[-.\s]/g, "") === lowerCaseName
      ) {
        // This is a weak link, find a party with a matching alias if possible
        const commonName =
          vote.commonName?.[0]?.toLowerCase() || vote.nickName.toLowerCase();
        for (const id in parties) {
          const party = parties[id as PartyId];
          if (party.aliases?.includes(commonName)) return id as PartyId;
        }
      }
    }
  }
  return undefined;
}

type DonationRecord = {
  name: string;
  amount: number;
  type: DonorType.Individual | DonorType.Candidate;
  partyId: PartyId;
};

const allDonations: DonationRecord[] = [
  {
    name: "Ivan Ivanov",
    amount: 50000,
    type: DonorType.Individual,
    partyId: "vazrazhdane",
  },
  {
    name: "Georgi Georgiev",
    amount: 45000,
    type: DonorType.Individual,
    partyId: "vazrazhdane",
  },
  {
    name: "Maria Petrova",
    amount: 30000,
    type: DonorType.Individual,
    partyId: "itn",
  },
  {
    name: "Stefan Popov (Candidate)",
    amount: 15000,
    type: DonorType.Candidate,
    partyId: "itn",
  },
  {
    name: "Petar Petrov (Candidate)",
    amount: 75000,
    type: DonorType.Candidate,
    partyId: "bsp",
  },
  {
    name: "Andrey Andreev",
    amount: 60000,
    type: DonorType.Individual,
    partyId: "bsp",
  },
  {
    name: "Liliya Ivanova",
    amount: 20000,
    type: DonorType.Individual,
    partyId: "velichie",
  },
  {
    name: "Hristo Stoichkov (Candidate)",
    amount: 90000,
    type: DonorType.Candidate,
    partyId: "velichie",
  },
  {
    name: "Ekaterina Zaharieva",
    amount: 5000,
    type: DonorType.Individual,
    partyId: "velichie",
  },
  {
    name: "Ahmed Dogan",
    amount: 100000,
    type: DonorType.Individual,
    partyId: "dps",
  },
  {
    name: "Ivan Ivanov",
    amount: 10000,
    type: DonorType.Individual,
    partyId: "bsp",
  },
  {
    name: "Boyko Borisov (Candidate)",
    amount: 25000,
    type: DonorType.Candidate,
    partyId: "gerb-sds",
  },
  {
    name: "Kiril Petkov (Candidate)",
    amount: 50000,
    type: DonorType.Candidate,
    partyId: "pp-db",
  },
];

const allCandidates: (Omit<CandidatePerformance, "preference_votes"> & {
  election_identifier: string;
  preference_votes: number;
  is_leader: boolean;
})[] = [
  {
    candidate_name: "Kostadin Kostadinov",
    party_name: "Vazrazhdane",
    region_name: "Varna",
    preference_votes: 12000,
    election_identifier: "2023-04",
    is_leader: true,
  },
  {
    candidate_name: "Slavi Trifonov",
    party_name: "There Is Such a People",
    region_name: "Stara Zagora",
    preference_votes: 11000,
    election_identifier: "2023-04",
    is_leader: true,
  },
  {
    candidate_name: "Korneliya Ninova",
    party_name: "BSP for Bulgaria",
    region_name: "Sofia",
    preference_votes: 25000,
    election_identifier: "2023-04",
    is_leader: true,
  },
  {
    candidate_name: "Nikolay Markov",
    party_name: "Velichie",
    region_name: "Sofia",
    preference_votes: 35000,
    election_identifier: "2024-06",
    is_leader: true,
  },
  {
    candidate_name: "Viktoria Vasileva",
    party_name: "Velichie",
    region_name: "Sofia",
    preference_votes: 38000,
    election_identifier: "2024-06",
    is_leader: false,
  },
  {
    candidate_name: "Delian Peevski",
    party_name: "Movement for Rights and Freedoms",
    region_name: "Kardzhali",
    preference_votes: 50000,
    election_identifier: "2024-06",
    is_leader: true,
  },
  {
    candidate_name: "Boyko Borisov",
    party_name: "GERB-SDS",
    region_name: "Sofia",
    preference_votes: 45000,
    election_identifier: "2024-06",
    is_leader: true,
  },
  {
    candidate_name: "Kiril Petkov",
    party_name: "PP-DB",
    region_name: "Sofia",
    preference_votes: 42000,
    election_identifier: "2024-06",
    is_leader: true,
  },
];

const mockFinancialData: Record<
  string,
  Partial<
    Record<PartyId, Omit<FinancialReport, "party_name" | "election_identifier">>
  >
> = {
  "2024-06": {
    "gerb-sds": {
      income: { donors: 150000, subsidy: 400000, candidates: 25000 },
      expenses: { marketing: 300000, events: 100000, admin: 50000 },
    },
    "pp-db": {
      income: { donors: 250000, subsidy: 350000, candidates: 50000 },
      expenses: { marketing: 320000, events: 90000, admin: 40000 },
    },
    dps: {
      income: { donors: 100000, subsidy: 300000 },
      expenses: { marketing: 250000, events: 80000, admin: 40000 },
    },
    vazrazhdane: {
      income: { donors: 125000, subsidy: 200000, candidates: 15000 },
      expenses: { marketing: 180000, events: 50000, admin: 25000 },
    },
    bsp: {
      income: { donors: 60000, subsidy: 150000, candidates: 75000 },
      expenses: { marketing: 150000, events: 40000, admin: 30000 },
    },
    itn: {
      income: { donors: 20000, subsidy: 100000, candidates: 90000 },
      expenses: { marketing: 120000, events: 30000, admin: 15000 },
    },
    velichie: {
      income: { donors: 5000, subsidy: 50000 },
      expenses: { marketing: 40000, events: 10000, admin: 5000 },
    },
  },
  "2023-04": {
    "gerb-sds": {
      income: { donors: 140000, subsidy: 390000, candidates: 22000 },
      expenses: { marketing: 290000, events: 95000, admin: 48000 },
    },
    "pp-db": {
      income: { donors: 230000, subsidy: 360000, candidates: 45000 },
      expenses: { marketing: 310000, events: 85000, admin: 42000 },
    },
    dps: {
      income: { donors: 95000, subsidy: 290000 },
      expenses: { marketing: 240000, events: 75000, admin: 35000 },
    },
    vazrazhdane: {
      income: { donors: 110000, subsidy: 190000, candidates: 12000 },
      expenses: { marketing: 160000, events: 45000, admin: 22000 },
    },
    itn: {
      income: { donors: 15000, subsidy: 90000, candidates: 80000 },
      expenses: { marketing: 100000, events: 25000, admin: 12000 },
    },
  },
  "2022-10": {
    "gerb-sds": {
      income: { donors: 120000, subsidy: 380000, candidates: 20000 },
      expenses: { marketing: 280000, events: 90000, admin: 45000 },
    },
    "pp-db": {
      income: { donors: 200000, subsidy: 300000, candidates: 40000 },
      expenses: { marketing: 290000, events: 80000, admin: 35000 },
    }, // Simplified aggregate
    dps: {
      income: { donors: 90000, subsidy: 280000 },
      expenses: { marketing: 220000, events: 70000, admin: 30000 },
    },
    vazrazhdane: {
      income: { donors: 100000, subsidy: 180000, candidates: 10000 },
      expenses: { marketing: 150000, events: 40000, admin: 20000 },
    },
    bsp: {
      income: { donors: 50000, subsidy: 130000, candidates: 60000 },
      expenses: { marketing: 130000, events: 30000, admin: 25000 },
    },
  },
};

interface MockStationTurnoutData {
  station_id: string;
  location_name: string;
  region_name: string;
  eligible_voters: number;
  ballots_cast: number;
  voters_on_additional_list: number;
}

const mockStationTurnoutData: MockStationTurnoutData[] = [
  {
    station_id: "224600001",
    location_name: "Sofia-Sredets",
    region_name: "Sofia",
    eligible_voters: 800,
    ballots_cast: 450,
    voters_on_additional_list: 15,
  },
  {
    station_id: "224600002",
    location_name: "Sofia-Studentski",
    region_name: "Sofia",
    eligible_voters: 1000,
    ballots_cast: 600,
    voters_on_additional_list: 80,
  },
  {
    station_id: "093400015",
    location_name: "Kardzhali-Center",
    region_name: "Kardzhali",
    eligible_voters: 500,
    ballots_cast: 480,
    voters_on_additional_list: 120,
  },
  {
    station_id: "012300005",
    location_name: "Ahtopol",
    region_name: "Burgas",
    eligible_voters: 300,
    ballots_cast: 290,
    voters_on_additional_list: 75,
  },
  {
    station_id: "012300006",
    location_name: "Sinemorets",
    region_name: "Burgas",
    eligible_voters: 250,
    ballots_cast: 220,
    voters_on_additional_list: 105,
  },
];

// =================================================================
// MOCK FUNCTION IMPLEMENTATIONS
// =================================================================

interface GetTurnoutStatisticsArgs {
  election_identifier?: string;
  start_year?: number;
  level?: AdminLevel;
  location_name?: string;
  min_turnout_threshold?: number;
  max_turnout_threshold?: number;
}

interface FindDiscrepanciesBetweenVoteTypesArgs {
  election_identifier?: string;
  level: AdminLevel;
  min_machine_vote_percentage: number;
  max_paper_vote_percentage: number;
}

interface FindStationsWithHighInvalidBallotsArgs {
  election_identifier?: string;
  region_name?: string;
  threshold_multiplier?: number;
}

export const get_list_of_elections = (): ElectionInfo[] => {
  return allElectionsInfo;
};

export const get_total_state_subsidy = ({
  year,
}: {
  year: number;
}): { total_subsidy: number; year: number } | { error: string } => {
  const yearStr = String(year);
  const electionIdsForYear = allElectionsInfo
    .filter((e) => e.date.startsWith(yearStr))
    .map((e) => e.identifier);

  if (electionIdsForYear.length === 0) {
    return { error: `No election data found for the year ${year}.` };
  }

  let totalSubsidy = 0;
  let foundData = false;

  for (const electionId of electionIdsForYear) {
    const financialData = mockFinancialData[electionId];
    if (financialData) {
      foundData = true;
      for (const partyId in financialData) {
        const partyFinances = financialData[partyId as PartyId];
        if (partyFinances?.income?.subsidy) {
          totalSubsidy += partyFinances.income.subsidy;
        }
      }
    }
  }

  if (!foundData) {
    return { error: `No financial data found for any elections in ${year}.` };
  }

  return { total_subsidy: totalSubsidy, year: year };
};

export const get_party_info = ({
  party_name,
}: {
  party_name: string;
}): { name: string; website?: string } | null => {
  const partyId = findPartyId(party_name);
  if (partyId) {
    const party = parties[partyId];
    return {
      name: party.en,
      website: party.website,
    };
  }
  return null;
};

export const get_new_parties = ({
  established_after_year,
}: {
  established_after_year: number;
}): string[] => {
  const newParties: string[] = [];
  for (const id in parties) {
    const party = parties[id as PartyId];
    const partyYear = parseInt(party.first_election.split("-")[0], 10);
    if (partyYear > established_after_year) {
      newParties.push(party.en);
    }
  }
  return newParties;
};

export const get_vote_adoption_by_region = (args: {
  election_identifiers: string[];
  region_names?: string[];
}): VoteAdoptionData[] => {
  const mockData: Record<
    string,
    Record<string, { machine: number; paper: number }>
  > = {
    "2023-04": {
      Sofia: { machine: 0.7, paper: 0.3 },
      Plovdiv: { machine: 0.55, paper: 0.45 },
      Varna: { machine: 0.62, paper: 0.38 },
      Kardzhali: { machine: 0.15, paper: 0.85 },
    },
    "2022-10": {
      Sofia: { machine: 0.75, paper: 0.25 },
      Plovdiv: { machine: 0.6, paper: 0.4 },
      Varna: { machine: 0.65, paper: 0.35 },
      Kardzhali: { machine: 0.2, paper: 0.8 },
    },
  };

  const results: VoteAdoptionData[] = [];
  const firstElectionId = args.election_identifiers[0];
  if (!mockData[firstElectionId]) return [];

  const regions = args.region_names || Object.keys(mockData[firstElectionId]);

  args.election_identifiers.forEach((electionId) => {
    if (mockData[electionId]) {
      regions.forEach((regionName) => {
        const regionData = mockData[electionId][regionName];
        if (regionData) {
          results.push({
            election_identifier: electionId,
            region_name: regionName,
            machine_vote_percentage: regionData.machine * 100,
            paper_vote_percentage: regionData.paper * 100,
          });
        }
      });
    }
  });
  return results;
};

export const get_available_elections_for_year = ({
  year,
}: {
  year: number;
}): ElectionInfo[] => {
  return allElectionsInfo.filter((e) => e.date.startsWith(String(year)));
};

export const get_election_results = (args: {
  election_identifier?: string;
  party_names?: string[];
  level?: AdminLevel;
  location_name?: string;
  vote_type?: VoteType;
}): ElectionResultItem[] => {
  const electionId = args.election_identifier || LATEST_ELECTION_IDENTIFIER;
  const level = args.level || AdminLevel.National;

  // Use real data from JSON for national level, if level is national or not specified
  if (level === AdminLevel.National && !args.location_name) {
    const electionJsonNamePrefix = electionId.replace("-", "_");
    const electionData = (electionsData as RawElectionData[]).find((e) =>
      e.name.startsWith(electionJsonNamePrefix),
    );

    if (electionData && electionData.results && electionData.results.protocol) {
      const protocol = electionData.results.protocol;
      const totalValidVotes =
        (protocol.numValidVotes || 0) +
        (protocol.numValidMachineVotes || 0) +
        (protocol.numValidNoOneMachineVotes || 0) +
        (protocol.numValidNoOnePaperVotes || 0);

      if (totalValidVotes > 0) {
        const results: ElectionResultItem[] = electionData.results.votes.map(
          (vote) => {
            // Try to find a canonical party name from our list, otherwise use the nickname
            const partyId =
              findPartyId(vote.nickName || "") ||
              findPartyId(vote.commonName?.[0] || "");
            const partyName = partyId
              ? parties[partyId].en
              : vote.nickName || `Party #${vote.partyNum}`;

            return {
              party_name: partyName,
              votes: vote.totalVotes,
              percentage: (vote.totalVotes / totalValidVotes) * 100,
            };
          },
        );

        // Add 'I do not support anyone' as a separate entry
        const noOneVotes =
          Number(protocol.numValidNoOneMachineVotes || 0) +
          Number(protocol.numValidNoOnePaperVotes || 0);
        if (noOneVotes > 0) {
          results.push({
            party_name: parties["none-of-the-above"].en,
            votes: noOneVotes,
            percentage: (noOneVotes / totalValidVotes) * 100,
          });
        }

        if (args.party_names && args.party_names.length > 0) {
          const lowerCasePartyNames = args.party_names.map((p) =>
            p.toLowerCase(),
          );
          return results.filter((r) => {
            const partyId = findPartyId(r.party_name);
            const partyInfo = partyId ? parties[partyId] : null;
            return lowerCasePartyNames.some(
              (requestedName) =>
                r.party_name.toLowerCase() === requestedName ||
                (partyInfo && partyInfo.en.toLowerCase() === requestedName) ||
                (partyInfo && partyInfo.bg.toLowerCase() === requestedName) ||
                partyInfo?.aliases?.includes(requestedName),
            );
          });
        }
        return results.sort((a, b) => b.votes - a.votes);
      }
    }
  }

  // Fallback to old mock data for other levels (region, municipality, etc.)
  const resultsDb: Record<
    string,
    Record<string, Record<string, Omit<ElectionResultItem, "party_name">>>
  > = {
    "2024-06": {
      // Mocks for a recent election for demo purposes
      // REGIONS
      Sofia: {
        "GERB-SDS": { votes: 80000, percentage: 24 },
        "PP-DB": { votes: 75000, percentage: 22 },
        Vazrazhdane: { votes: 50000, percentage: 15 },
        "BSP for Bulgaria": { votes: 45000, percentage: 13 },
        "There Is Such a People": { votes: 30000, percentage: 9 },
        Velichie: { votes: 25000, percentage: 7 },
        "Movement for Rights and Freedoms": { votes: 5000, percentage: 1.5 },
        "I do not support anyone": { votes: 15000, percentage: 4.5 },
      },
      Kardzhali: {
        "Movement for Rights and Freedoms": { votes: 80000, percentage: 80 },
        "GERB-SDS": { votes: 4000, percentage: 4 },
        "PP-DB": { votes: 3000, percentage: 3 },
        "I do not support anyone": { votes: 1000, percentage: 1.0 },
      },
      Burgas: {
        "GERB-SDS": { votes: 42000, percentage: 23 },
        "PP-DB": { votes: 35000, percentage: 19 },
        Vazrazhdane: { votes: 20000, percentage: 11 },
        "BSP for Bulgaria": { votes: 18000, percentage: 10 },
        "There Is Such a People": { votes: 10000, percentage: 5.5 },
        "Movement for Rights and Freedoms": { votes: 25000, percentage: 14 },
        "I do not support anyone": { votes: 5000, percentage: 2.7 },
      },
      // MUNICIPALITIES
      Tsarevo: {
        "GERB-SDS": { votes: 1500, percentage: 35 },
        "PP-DB": { votes: 1000, percentage: 23 },
        "BSP for Bulgaria": { votes: 900, percentage: 21 },
        "I do not support anyone": { votes: 250, percentage: 5.8 },
      },
      // SETTLEMENTS
      Ahtopol: {
        "GERB-SDS": { votes: 400, percentage: 40 },
        "PP-DB": { votes: 250, percentage: 25 },
        "BSP for Bulgaria": { votes: 200, percentage: 20 },
        "I do not support anyone": { votes: 50, percentage: 5.0 },
      },
    },
  };

  const electionResults = resultsDb[electionId];
  if (!electionResults) return [];

  const location = args.location_name || "National";
  const locationResults = electionResults[location];

  if (!locationResults) return [];

  if (args.party_names && args.party_names.length > 0) {
    return args.party_names
      .map((name) => {
        const partyId = findPartyId(name);
        const partyEnName = partyId ? parties[partyId].en : undefined;
        const partyData = partyEnName
          ? locationResults[partyEnName]
          : undefined;
        return partyData && partyEnName
          ? { party_name: partyEnName, ...partyData }
          : null;
      })
      .filter(Boolean) as ElectionResultItem[];
  }

  return Object.entries(locationResults).map(([name, data]) => ({
    party_name: name,
    ...data,
  }));
};

export const get_turnout_statistics = (
  args: GetTurnoutStatisticsArgs,
): TurnoutData[] => {
  // For simplicity, I'll just return one aggregated record for a region query
  if (args.location_name && args.level === AdminLevel.Region) {
    const regionName = args.location_name;
    if (regionName.toLowerCase() === "sofia") {
      return [
        {
          location_name: "Sofia",
          level: AdminLevel.Region,
          eligible_voters: 1100000,
          ballots_cast: 550000,
          turnout_percentage: 50.0,
          voters_on_additional_list: 15000,
        },
      ];
    }
    if (regionName.toLowerCase() === "kardzhali") {
      return [
        {
          location_name: "Kardzhali",
          level: AdminLevel.Region,
          eligible_voters: 150000,
          ballots_cast: 105000,
          turnout_percentage: 70.0,
          voters_on_additional_list: 8000,
        },
      ];
    }
  }

  // Use real data for national turnout if available
  const electionId = args.election_identifier || LATEST_ELECTION_IDENTIFIER;
  const electionJsonNamePrefix = electionId.replace("-", "_");
  const electionData = (electionsData as RawElectionData[]).find((e) =>
    e.name.startsWith(electionJsonNamePrefix),
  );
  if (electionData && electionData.results && electionData.results.protocol) {
    const p = electionData.results.protocol;
    const eligibleVoters = p.numRegisteredVoters || 0;
    const ballotsCast = p.totalActualVoters;
    return [
      {
        location_name: "National",
        level: AdminLevel.National,
        eligible_voters: eligibleVoters,
        ballots_cast: ballotsCast,
        turnout_percentage:
          eligibleVoters > 0 ? (ballotsCast / eligibleVoters) * 100 : 0,
        voters_on_additional_list: p.numAdditionalVoters || 0,
      },
    ];
  }

  return [
    {
      location_name: "National",
      level: AdminLevel.National,
      eligible_voters: 6000000,
      ballots_cast: 3000000,
      turnout_percentage: 50.0,
      voters_on_additional_list: 120000,
    },
  ];
};

export const get_candidate_performance = ({
  election_identifier = LATEST_ELECTION_IDENTIFIER,
  region_name,
  party_name,
  sort_order = SortOrder.Descending,
  limit = 5,
}: {
  election_identifier?: string;
  region_name?: string;
  party_name?: string;
  sort_order?: SortOrder;
  limit?: number;
}): CandidatePerformance[] => {
  let candidates = allCandidates.filter(
    (c) => c.election_identifier === election_identifier,
  );
  if (region_name) {
    candidates = candidates.filter(
      (c) => c.region_name.toLowerCase() === region_name.toLowerCase(),
    );
  }
  if (party_name) {
    const partyId = findPartyId(party_name);
    const partyEnName = partyId ? parties[partyId].en : undefined;
    if (partyEnName) {
      candidates = candidates.filter((c) => c.party_name === partyEnName);
    } else {
      return [];
    }
  }

  candidates.sort((a, b) => {
    if (sort_order === SortOrder.Descending) {
      return b.preference_votes - a.preference_votes;
    }
    return a.preference_votes - b.preference_votes;
  });

  return candidates
    .slice(0, limit)
    .map(({ is_leader, election_identifier, ...rest }) => rest);
};

export const find_preference_anomalies = ({
  election_identifier = LATEST_ELECTION_IDENTIFIER,
  region_name,
}: {
  election_identifier?: string;
  region_name?: string;
}): PreferenceAnomaly[] => {
  let candidates = allCandidates.filter(
    (c) => c.election_identifier === election_identifier,
  );
  if (region_name) {
    candidates = candidates.filter(
      (c) => c.region_name.toLowerCase() === region_name.toLowerCase(),
    );
  }

  const anomalies: PreferenceAnomaly[] = [];
  const partiesInScope = [...new Set(candidates.map((c) => c.party_name))];

  partiesInScope.forEach((party) => {
    const partyCandidates = candidates.filter((c) => c.party_name === party);
    const leader = partyCandidates.find((c) => c.is_leader);
    if (leader) {
      partyCandidates.forEach((candidate) => {
        if (
          !candidate.is_leader &&
          candidate.preference_votes > leader.preference_votes
        ) {
          anomalies.push({
            region_name: candidate.region_name,
            party_name: candidate.party_name,
            candidate_name: candidate.candidate_name,
            candidate_preferences: candidate.preference_votes,
            list_leader_name: leader.candidate_name,
            list_leader_preferences: leader.preference_votes,
          });
        }
      });
    }
  });

  return anomalies;
};

export const get_campaign_finances = ({
  election_identifier = LATEST_ELECTION_IDENTIFIER,
  party_names,
  finance_type,
}: {
  election_identifier?: string;
  party_names?: string[];
  finance_type: "income" | "expenses";
}): FinancialReport[] => {
  const electionFinances = mockFinancialData[election_identifier];
  if (!electionFinances) return [];

  const targetPartyIds =
    party_names && party_names.length > 0
      ? party_names.map(findPartyId).filter((id): id is PartyId => !!id)
      : (Object.keys(electionFinances) as PartyId[]);

  return targetPartyIds
    .map((partyId) => {
      const partyData = electionFinances[partyId];
      if (!partyData) return null;

      const report: FinancialReport = {
        party_name: parties[partyId].en,
        election_identifier: election_identifier,
      };

      if (finance_type === "income" && partyData.income) {
        report.income = partyData.income;
      } else if (finance_type === "expenses" && partyData.expenses) {
        report.expenses = partyData.expenses;
      }

      return report;
    })
    .filter((r): r is FinancialReport => r !== null);
};

export const get_top_donors = ({
  election_identifier = LATEST_ELECTION_IDENTIFIER,
  party_name,
  donor_type = DonorType.All,
  limit = 5,
}: {
  election_identifier?: string;
  party_name?: string;
  donor_type?: DonorType;
  limit?: number;
}): Donor[] => {
  let filteredDonations = allDonations; // No election filter for mock data

  if (party_name) {
    const partyId = findPartyId(party_name);
    if (partyId) {
      filteredDonations = filteredDonations.filter(
        (d) => d.partyId === partyId,
      );
    } else {
      return [];
    }
  }

  if (donor_type !== DonorType.All) {
    filteredDonations = filteredDonations.filter((d) => d.type === donor_type);
  }

  const sortedDonations = [...filteredDonations].sort(
    (a, b) => b.amount - a.amount,
  );

  const topDonations = sortedDonations.slice(0, limit);

  return topDonations.map((d) => {
    const otherDonations = allDonations
      .filter((od) => od.name === d.name && od.partyId !== d.partyId)
      .map((od) => ({ party_name: parties[od.partyId].en, amount: od.amount }));

    return {
      name: d.name,
      amount: d.amount,
      type: d.type,
      party_donated_to: parties[d.partyId].en,
      ...(otherDonations.length > 0 && { other_donations: otherDonations }),
    };
  });
};

export const compare_election_results = ({
  election_identifiers,
  party_names,
  level = AdminLevel.National,
  location_name,
}: {
  election_identifiers: string[];
  party_names: string[];
  level?: AdminLevel;
  location_name?: string;
}): ComparisonResult[] => {
  if (!party_names || party_names.length === 0) {
    return [];
  }

  const comparisonResults: ComparisonResult[] = [];

  // If level is national, location_name can be omitted, otherwise it's needed.
  const effectiveLocation =
    level === AdminLevel.National ? "National" : location_name;
  if (!effectiveLocation) return [];

  party_names.forEach((partyName) => {
    const partyId = findPartyId(partyName);
    const canonicalPartyName = partyId ? parties[partyId].en : partyName;

    const partyResult: ComparisonResult = {
      party_name: canonicalPartyName,
      location_name: effectiveLocation,
      results: [],
    };

    election_identifiers.forEach((electionId) => {
      const resultsForElection = get_election_results({
        election_identifier: electionId,
        party_names: [partyName],
        level: level,
        location_name: location_name,
      });

      if (resultsForElection.length > 0) {
        const partyData = resultsForElection[0];
        partyResult.results.push({
          election_identifier: electionId,
          votes: partyData.votes,
          percentage: partyData.percentage,
        });
      }
    });

    if (partyResult.results.length > 0) {
      partyResult.results.sort((a, b) => {
        const dateA =
          allElectionsInfo.find((e) => e.identifier === a.election_identifier)
            ?.date || "";
        const dateB =
          allElectionsInfo.find((e) => e.identifier === b.election_identifier)
            ?.date || "";
        return new Date(dateA).getTime() - new Date(dateB).getTime();
      });
      comparisonResults.push(partyResult);
    }
  });

  return comparisonResults;
};

export const find_voting_discrepancies = (args: {
  discrepancy_type: "recount_vs_initial" | "machine_vs_paper";
}): DiscrepancyReportItem[] => {
  if (args.discrepancy_type === "machine_vs_paper") {
    return [
      {
        section_id: "11223344",
        location_name: "Varna",
        discrepancy_type: "machine_vs_paper",
        value1_description: "Machine Votes (Vazrazhdane)",
        value1: 250,
        value2_description: "Paper Votes (Vazrazhdane)",
        value2: 50,
        difference_percent: 400.0,
      },
    ];
  }
  // Default to recount_vs_initial
  return [
    {
      section_id: "33221144",
      location_name: "Sofia",
      discrepancy_type: "recount_vs_initial",
      value1_description: "Initial",
      value1: 100,
      value2_description: "Recount",
      value2: 95,
      difference_percent: 5.0,
    },
  ];
};

export const find_discrepancies_between_vote_types = (
  args: FindDiscrepanciesBetweenVoteTypesArgs,
): PartyVoteDiscrepancy[] => {
  return [
    {
      location_name: "Smolyan Municipality",
      level: AdminLevel.Municipality,
      party_name: "Movement for Rights and Freedoms",
      machine_vote_percentage: 92,
      paper_vote_percentage: 25,
    },
  ];
};

export const calculate_campaign_efficiency = ({
  election_identifier = LATEST_ELECTION_IDENTIFIER,
  party_names,
  limit = 5,
}: {
  election_identifier?: string;
  party_names?: string[];
  limit?: number;
}): EfficiencyResult[] => {
  // 1. Get finances (expenses) for all relevant parties
  const financialReports = get_campaign_finances({
    election_identifier,
    party_names, // Pass this through; if undefined, get_campaign_finances fetches all
    finance_type: "expenses",
  });

  if (!financialReports || financialReports.length === 0) {
    return [];
  }

  const partyEnNames = financialReports.map((fr) => fr.party_name);

  // 2. Get election results (votes) for the same parties
  const electionResults = get_election_results({
    election_identifier,
    party_names: partyEnNames,
    level: AdminLevel.National,
  });

  const resultsMap = new Map<string, number>();
  electionResults.forEach((res) => {
    resultsMap.set(res.party_name, res.votes);
  });

  // 3. Calculate efficiency
  const efficiencyResults: EfficiencyResult[] = [];
  financialReports.forEach((report) => {
    const total_votes: number = resultsMap.get(report.party_name) || 0;
    const total_spending = report.expenses
      ? (Object.values(report.expenses).reduce(
          (sum: number, val: number) => sum + val,
          0,
        ) as number)
      : 0;

    // Avoid division by zero and only include parties with votes
    if (total_votes > 0) {
      efficiencyResults.push({
        party_name: report.party_name,
        total_votes: total_votes,
        total_spending: total_spending,
        cost_per_vote:
          total_spending && total_spending > 0
            ? total_spending / total_votes
            : 0,
      });
    }
  });

  // 4. Sort by cost_per_vote (ascending - lower is better)
  efficiencyResults.sort((a, b) => a.cost_per_vote - b.cost_per_vote);

  // 5. Return top 'limit' results
  return efficiencyResults.slice(0, limit);
};

export const suggest_campaign_focus_areas = ({
  party_name,
  analysis_type,
  limit = 5,
}: {
  party_name: string;
  analysis_type: "weakest_areas" | "growth_potential";
  election_identifier?: string;
  comparison_election_identifier?: string;
  limit?: number;
}): FocusArea[] => {
  const areas: FocusArea[] = [
    {
      location_name: "Pernik",
      level: AdminLevel.Region,
      reason: "Lowest vote share",
      data: { votes: 500, percentage: 2.5 },
    },
    {
      location_name: "Vidin",
      level: AdminLevel.Region,
      reason: "Significant drop since last election",
      data: { vote_change: -2000 },
    },
    {
      location_name: "Razgrad",
      level: AdminLevel.Region,
      reason: "High number of eligible voters, low turnout",
      data: { eligible: 80000, turnout: 0.35 },
    },
  ];
  return areas.slice(0, limit);
};

export const find_stations_with_high_invalid_ballots = (
  args: FindStationsWithHighInvalidBallotsArgs,
): InvalidBallotAnomaly[] => {
  return [
    {
      station_id: "11223344",
      location_name: "Ahtopol",
      region_name: "Burgas",
      invalid_ballot_percentage: 15.5,
      regional_average_percentage: 4.2,
      total_ballots_cast: 500,
      invalid_ballots_count: 77,
    },
  ];
};

export const find_stations_with_high_additional_voters = ({
  election_identifier = LATEST_ELECTION_IDENTIFIER,
  min_percentage_threshold,
  min_absolute_threshold,
}: {
  election_identifier?: string;
  min_percentage_threshold?: number;
  min_absolute_threshold?: number;
}): AdditionalVoterAnomaly[] => {
  // If neither threshold is provided, use a default percentage.
  const effective_min_percentage =
    min_percentage_threshold ??
    (min_absolute_threshold !== undefined ? undefined : 10);

  const anomalies: AdditionalVoterAnomaly[] = [];
  mockStationTurnoutData.forEach((station) => {
    let isAnomaly = false;
    const additionalVoters = station.voters_on_additional_list;

    if (
      min_absolute_threshold !== undefined &&
      additionalVoters >= min_absolute_threshold
    ) {
      isAnomaly = true;
    }

    if (station.ballots_cast > 0 && effective_min_percentage !== undefined) {
      const percentage = (additionalVoters / station.ballots_cast) * 100;
      if (percentage >= effective_min_percentage) {
        isAnomaly = true;
      }
    }

    if (isAnomaly) {
      const percentage =
        station.ballots_cast > 0
          ? (additionalVoters / station.ballots_cast) * 100
          : 0;
      anomalies.push({
        station_id: station.station_id,
        location_name: station.location_name,
        region_name: station.region_name,
        ballots_cast: station.ballots_cast,
        voters_on_additional_list: additionalVoters,
        additional_voter_percentage: parseFloat(percentage.toFixed(2)),
      });
    }
  });
  return anomalies.sort(
    (a, b) => b.additional_voter_percentage - a.additional_voter_percentage,
  );
};

export const get_aggregated_additional_voters = ({
  election_identifier = LATEST_ELECTION_IDENTIFIER,
  level = AdminLevel.Region,
  sort_order = SortOrder.Descending,
  limit = 5,
}: {
  election_identifier?: string;
  level?: AdminLevel;
  sort_order?: SortOrder;
  limit?: number;
}): AggregatedAdditionalVoters[] => {
  const regionalData: AggregatedAdditionalVoters[] = [
    {
      location_name: "Sofia",
      level: AdminLevel.Region,
      total_voters_on_additional_list: 15000,
    },
    {
      location_name: "Kardzhali",
      level: AdminLevel.Region,
      total_voters_on_additional_list: 8000,
    },
    {
      location_name: "Varna",
      level: AdminLevel.Region,
      total_voters_on_additional_list: 6500,
    },
    {
      location_name: "Plovdiv",
      level: AdminLevel.Region,
      total_voters_on_additional_list: 5000,
    },
    {
      location_name: "Burgas",
      level: AdminLevel.Region,
      total_voters_on_additional_list: 4500,
    },
  ];

  regionalData.sort((a, b) => {
    if (sort_order === SortOrder.Descending) {
      return (
        b.total_voters_on_additional_list - a.total_voters_on_additional_list
      );
    }
    return (
      a.total_voters_on_additional_list - b.total_voters_on_additional_list
    );
  });

  return regionalData.slice(0, limit);
};

export const compare_campaign_finances = ({
  election_identifiers,
  party_names,
  finance_type,
}: {
  election_identifiers: string[];
  party_names: string[];
  finance_type: "income" | "expenses";
}): FinancialComparisonResult[] => {
  if (!party_names || party_names.length === 0) {
    return [];
  }

  const resultsByParty = new Map<string, FinancialComparisonResult>();

  party_names.forEach((name) => {
    const partyId = findPartyId(name);
    const canonicalName = partyId ? parties[partyId].en : name;
    if (!resultsByParty.has(canonicalName)) {
      resultsByParty.set(canonicalName, {
        party_name: canonicalName,
        results: [],
      });
    }
  });

  election_identifiers.forEach((electionId) => {
    const financeReports = get_campaign_finances({
      election_identifier: electionId,
      party_names: party_names,
      finance_type: finance_type,
    });

    financeReports.forEach((report) => {
      const partyResult = resultsByParty.get(report.party_name);
      if (partyResult) {
        const data =
          finance_type === "income" ? report.income : report.expenses;
        const total = data
          ? Object.values(data).reduce(
              (sum: number, val) => sum + Number(val || 0),
              0,
            )
          : 0;

        partyResult.results.push({
          election_identifier: electionId,
          data: data,
          total: total,
        });
      }
    });
  });

  // Sort the inner results by date
  resultsByParty.forEach((partyResult) => {
    partyResult.results.sort((a, b) => {
      const dateA =
        allElectionsInfo.find((e) => e.identifier === a.election_identifier)
          ?.date || "";
      const dateB =
        allElectionsInfo.find((e) => e.identifier === b.election_identifier)
          ?.date || "";
      return new Date(dateA).getTime() - new Date(dateB).getTime();
    });
  });

  return Array.from(resultsByParty.values());
};

export const get_none_of_the_above_stats = ({
  election_identifier = LATEST_ELECTION_IDENTIFIER,
  level,
  sort_by = "votes",
  limit = 5,
}: {
  election_identifier?: string;
  level: AdminLevel.Region | AdminLevel.Municipality;
  sort_by?: "votes" | "percentage";
  limit?: number;
}): NoneOfTheAboveResult[] => {
  // This function uses the main results DB and filters it to find the requested data.
  const noneOfTheAbovePartyName = parties["none-of-the-above"].en;

  // In a real app, you'd have a way to query all locations for a given level.
  // Here we use the mock locations we have defined in the resultsDb fallback.
  const mockLocationsByLevel = {
    [AdminLevel.Region]: ["Sofia", "Plovdiv", "Varna", "Kardzhali", "Burgas"],
    [AdminLevel.Municipality]: ["Sozopol", "Tsarevo", "Sredets"],
  };

  const locations = mockLocationsByLevel[level];
  if (!locations) return [];

  const results: NoneOfTheAboveResult[] = locations
    .map((locationName): NoneOfTheAboveResult | null => {
      const locationResults = get_election_results({
        election_identifier: election_identifier,
        location_name: locationName,
        level: level,
        party_names: [noneOfTheAbovePartyName],
      });

      if (locationResults.length > 0) {
        return {
          location_name: locationName,
          level: level,
          votes: locationResults[0].votes,
          percentage: locationResults[0].percentage,
        };
      }
      return null;
    })
    .filter((r): r is NoneOfTheAboveResult => r !== null);

  results.sort((a, b) => {
    if (sort_by === "percentage") {
      return b.percentage - a.percentage;
    }
    return b.votes - a.votes;
  });

  return results.slice(0, limit);
};

export const get_national_vote_type_summary = ({
  election_identifiers,
}: {
  election_identifiers: string[];
}):
  | Array<{
      election_identifier: string;
      paper_vote_percentage: number;
      machine_vote_percentage: number;
      total_valid_votes: number;
    }>
  | { error: string } => {
  const results = [];

  for (const electionId of election_identifiers) {
    const electionJsonNamePrefix = electionId.replace("-", "_");
    const electionData = (electionsData as RawElectionData[]).find((e) =>
      e.name.startsWith(electionJsonNamePrefix),
    );

    if (electionData && electionData.results && electionData.results.protocol) {
      const p = electionData.results.protocol;

      const validPaperVotes =
        (p.numValidVotes || 0) + (p.numValidNoOnePaperVotes || 0);
      const validMachineVotes =
        (p.numValidMachineVotes || 0) + (p.numValidNoOneMachineVotes || 0);
      const totalValidVotes = validPaperVotes + validMachineVotes;

      if (totalValidVotes > 0) {
        results.push({
          election_identifier: electionId,
          paper_vote_percentage: parseFloat(
            ((validPaperVotes / totalValidVotes) * 100).toFixed(2),
          ),
          machine_vote_percentage: parseFloat(
            ((validMachineVotes / totalValidVotes) * 100).toFixed(2),
          ),
          total_valid_votes: totalValidVotes,
        });
      }
    }
  }

  if (results.length < election_identifiers.length) {
    console.warn("Could not find protocol data for all specified elections.");
  }

  if (results.length === 0) {
    return {
      error: `Could not find any protocol data for the specified elections.`,
    };
  }

  return results;
};

export const get_ballot_summary = ({
  election_identifier = LATEST_ELECTION_IDENTIFIER,
}: {
  election_identifier?: string;
}):
  | {
      election_identifier: string;
      invalid_ballots: number;
      total_valid_votes: number;
      invalid_ballot_percentage: number;
    }
  | { error: string } => {
  const electionJsonNamePrefix = election_identifier.replace("-", "_");
  const electionData = (electionsData as RawElectionData[]).find((e) =>
    e.name.startsWith(electionJsonNamePrefix),
  );

  if (
    !electionData ||
    !electionData.results ||
    !electionData.results.protocol
  ) {
    return {
      error: `Protocol data not found for election ${election_identifier}.`,
    };
  }

  const protocol = electionData.results.protocol;
  const invalidBallots = Number(protocol.numInvalidBallotsFound || 0);
  const totalValidVotes =
    Number(protocol.numValidVotes || 0) +
    Number(protocol.numValidMachineVotes || 0) +
    Number(protocol.numValidNoOneMachineVotes || 0) +
    Number(protocol.numValidNoOnePaperVotes || 0);

  const totalBallots = invalidBallots + totalValidVotes;
  const invalidBallotPercentage =
    totalBallots > 0 ? (invalidBallots / totalBallots) * 100 : 0;

  return {
    election_identifier: election_identifier,
    invalid_ballots: invalidBallots,
    total_valid_votes: totalValidVotes,
    invalid_ballot_percentage: parseFloat(invalidBallotPercentage.toFixed(2)),
  };
};

export const find_machine_vote_discrepancies = ({
  election_identifier = LATEST_ELECTION_IDENTIFIER,
  min_difference_threshold = 0,
}: {
  election_identifier?: string;
  min_difference_threshold?: number;
}): MachineVoteDiscrepancy[] | { error: string } => {
  const electionJsonNamePrefix = election_identifier.replace("-", "_");
  const electionData = (electionsData as RawElectionData[]).find((e) =>
    e.name.startsWith(electionJsonNamePrefix),
  );

  if (!electionData || !electionData.results || !electionData.results.votes) {
    return {
      error: `Vote data not found for election ${election_identifier}.`,
    };
  }

  if (!electionData.hasSuemg) {
    return {
      error: `Flash memory (SUEMG) data is not available for election ${election_identifier}.`,
    };
  }

  const discrepancies: MachineVoteDiscrepancy[] = [];

  electionData.results.votes.forEach((vote) => {
    const protocolVotes = vote.machineVotes ?? 0;
    const flashVotes = vote.suemgVotes ?? 0;
    const difference = protocolVotes - flashVotes;

    if (Math.abs(difference) > min_difference_threshold) {
      const partyId =
        findPartyId(vote.nickName || "") ||
        findPartyId(vote.commonName?.[0] || "");
      const partyName = partyId
        ? parties[partyId].en
        : vote.nickName || `Party #${vote.partyNum}`;

      discrepancies.push({
        party_name: partyName,
        protocol_machine_votes: protocolVotes,
        flash_memory_votes: flashVotes,
        difference: difference,
        difference_percentage:
          protocolVotes > 0
            ? parseFloat(((difference / protocolVotes) * 100).toFixed(2))
            : 0,
      });
    }
  });

  return discrepancies.sort(
    (a, b) => Math.abs(b.difference) - Math.abs(a.difference),
  );
};
