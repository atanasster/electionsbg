/* eslint-disable @typescript-eslint/no-explicit-any */
// =================================================================
// 1. SHARED TYPES AND ENUMS
// Defining these centrally makes the code clean and consistent.
// =================================================================

export interface ElectionInfo {
  identifier: string; // e.g., "2021-07", "2021-11"
  name: {
    en: string; // e.g., "Parliamentary Elections July 2021"
    bg: string; // e.g., "Парламентарни избори Юли 2021"
  };
  date: string; // e.g., "2021-07-11"
  hasRecount?: boolean;
  hasSuemg?: boolean;
  hasPreferences?: boolean;
  hasFinancials?: boolean;
}

export enum AdminLevel {
  National = "national",
  Region = "region",
  Municipality = "municipality",
  Settlement = "settlement",
  Station = "station",
}

export enum VoteType {
  Total = "total",
  Paper = "paper",
  Machine = "machine",
}

export enum SortOrder {
  Descending = "descending",
  Ascending = "ascending",
}

export enum DonorType {
  Individual = "individual",
  Candidate = "candidate",
  All = "all",
}

// Interfaces for structured return data
export interface ElectionResultItem {
  party_name: string;
  votes: number;
  percentage: number;
}

export interface TurnoutData {
  station_id?: string;
  location_name: string;
  level: AdminLevel;
  eligible_voters: number;
  ballots_cast: number;
  turnout_percentage: number;
  voters_on_additional_list?: number;
}

export interface VoteAdoptionData {
  election_identifier: string;
  region_name: string;
  machine_vote_percentage: number;
  paper_vote_percentage: number;
}

export interface CandidatePerformance {
  candidate_name: string;
  party_name: string;
  region_name: string;
  preference_votes: number;
}

export interface PreferenceAnomaly {
  region_name: string;
  party_name: string;
  candidate_name: string;
  candidate_preferences: number;
  list_leader_name: string;
  list_leader_preferences: number;
}

export interface FinancialReport {
  party_name: string;
  election_identifier: string;
  income?: Record<string, number>; // e.g., { donors: 50000, subsidy: 100000 }
  expenses?: Record<string, number>; // e.g., { marketing: 75000, events: 25000 }
}

export interface Donor {
  name: string;
  amount: number;
  type: Exclude<DonorType, DonorType.All>;
  party_donated_to: string;
  other_donations?: { party_name: string; amount: number }[];
}

export interface ComparisonResult {
  party_name: string;
  location_name: string;
  results: Array<{
    election_identifier: string;
    votes: number;
    percentage: number;
  }>;
}

export interface FinancialComparisonItem {
  election_identifier: string;
  // The data field will hold either income or expense records.
  data?: Record<string, number>;
  total: number;
}
export interface FinancialComparisonResult {
  party_name: string;
  results: FinancialComparisonItem[];
}

export interface DiscrepancyReportItem {
  section_id: string;
  location_name: string;
  discrepancy_type: "recount_vs_initial" | "machine_vs_paper";
  value1_description: string;
  value1: number;
  value2_description: string;
  value2: number;
  difference_percent: number;
}

export interface PartyVoteDiscrepancy {
  location_name: string;
  level: AdminLevel;
  party_name: string;
  machine_vote_percentage: number;
  paper_vote_percentage: number;
}

export interface EfficiencyResult {
  party_name: string;
  total_votes: number;
  total_spending: number;
  cost_per_vote: number;
}

export interface FocusArea {
  location_name: string;
  level: AdminLevel;
  reason: string;
  data: Record<string, any>;
}

export interface InvalidBallotAnomaly {
  station_id: string;
  location_name: string;
  region_name: string;
  invalid_ballot_percentage: number;
  regional_average_percentage: number;
  total_ballots_cast: number;
  invalid_ballots_count: number;
}

export interface AdditionalVoterAnomaly {
  station_id: string;
  location_name: string;
  region_name: string;
  ballots_cast: number;
  voters_on_additional_list: number;
  additional_voter_percentage: number;
}

export interface AggregatedAdditionalVoters {
  location_name: string;
  level: AdminLevel;
  total_voters_on_additional_list: number;
}

export interface NoneOfTheAboveResult {
  location_name: string;
  level: AdminLevel;
  votes: number;
  percentage: number;
}

export interface MachineVoteDiscrepancy {
  party_name: string;
  protocol_machine_votes: number;
  flash_memory_votes: number;
  difference: number;
  difference_percentage: number;
}

export type ChatRole = "user" | "model" | "function";

export interface ChatMessage {
  role: ChatRole;
  parts:
    | { text: string }[]
    | { functionCall: any }[]
    | { functionResponse: any }[];
  id: string;
}
