// Shared candidate-facts loader. Both the OG-card generator (scripts/og/
// generate.ts) and the prerenderer (scripts/prerender/dynamicRoutes.ts) need
// the same per-candidate facts — total preference votes, strongest oblast,
// party, MP role — and they MUST agree (a card that says "44,282 преференции"
// while the page description says something else is worse than no card).
// This module is the single source of truth for those facts.
//
// Scope of the card set: every candidate in the latest election PLUS every MP
// in the parliament index. Older one-time candidates are intentionally left
// out — they get the default site OG image — to keep dist/ from ballooning.

import fs from "node:fs";
import path from "node:path";

// Mirrors normalizeName() in scripts/prerender/dynamicRoutes.ts so a card
// keyed here resolves against the same key the prerenderer matches MPs with.
export const normalizeName = (s: string): string =>
  s.toUpperCase().replace(/\s+/g, " ").trim();

const BG_MONTHS = [
  "януари",
  "февруари",
  "март",
  "април",
  "май",
  "юни",
  "юли",
  "август",
  "септември",
  "октомври",
  "ноември",
  "декември",
];

export const formatElectionDateBg = (folder: string): string => {
  const m = /^(\d{4})_(\d{2})_(\d{2})$/.exec(folder);
  if (!m) return folder;
  return `${parseInt(m[3], 10)} ${BG_MONTHS[parseInt(m[2], 10) - 1]} ${m[1]}`;
};

export type CandidateRole = "current_mp" | "former_mp" | "candidate";

// Most-recent election in which the candidate has preference-vote results.
export type CandidateFacts = {
  electionDate: string; // e.g. "2026_04_19"
  totalPreferences: number; // summed across all oblasts they ran in
  topOblast: string; // oblast code, e.g. "BGS"
  topOblastName: string; // Bulgarian display name, e.g. "Бургас"
  topOblastNameEn: string; // English display name, e.g. "Burgas"
  topOblastPreferences: number;
  party: {
    number: number;
    name: string; // Bulgarian full name, e.g. "ПРОГРЕСИВНА БЪЛГАРИЯ"
    nameEn: string; // English full name, e.g. "Progressive Bulgaria"
    nickName: string; // Bulgarian short name, e.g. "ПрБ"
    nickNameEn: string; // English short name, e.g. "PB"
    color: string;
  };
};

export type CandidateCardData = {
  name: string; // Bulgarian display name — also the OG-card filename key
  nameEn: string;
  role: CandidateRole;
  // Parliament-index enrichment, present when the name matches an MP.
  mp?: {
    id: number;
    photoPath?: string; // absolute path to the cached photo, if the file exists
    partyGroupShort?: string;
    position?: string;
  };
  // Latest-election candidacy, present when the name is on the current ballot.
  candidacy?: {
    partyNum: number;
    partyNickName?: string;
    partyNickNameEn?: string;
    partyColor?: string;
    oblast: string;
    oblastName: string;
    pref: string;
  };
  // Most-recent preference results — null when the candidate has no preference
  // data (ran before preference voting, or simply no votes recorded).
  facts: CandidateFacts | null;
};

type RawRegion = {
  oblast: string;
  name: string;
  name_en?: string;
  long_name?: string;
  long_name_en?: string;
};
type RawElection = { name: string };
type RawCandidate = {
  name: string;
  name_en?: string;
  partyNum: number;
  oblast: string;
  pref: string;
};
type RawParty = {
  number: number;
  nickName?: string;
  name?: string;
  color?: string;
};
type RawMp = {
  id: number;
  name: string;
  name_en?: string;
  normalizedName?: string;
  photoUrl?: string;
  currentPartyGroupShort?: string | null;
  position?: string | null;
  isCurrent?: boolean;
};
type RawPrefStats = {
  stats: Array<{
    elections_date: string;
    party?: { number: number; name: string; nickName: string; color: string };
    preferences?: Array<{ oblast: string; pref: string; preferences?: number }>;
  }>;
};

const readJson = <T>(file: string): T | null => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
  } catch {
    return null;
  }
};

// English party names live in canonical_parties.json, not in the per-election
// cik_parties.json / preferences_stats.json (those are BG-only). Keyed by
// "{election}|{partyNum}" since the same party sits at a different ballot
// number each election.
export type EnPartyName = { nameEn: string; nickNameEn: string };

export const loadEnPartyNames = (
  projectRoot: string,
): Map<string, EnPartyName> => {
  const canonical = readJson<{
    parties: Array<{
      displayNameEn?: string;
      history?: Array<{
        election: string;
        partyNum: number;
        nameEn?: string;
      }>;
    }>;
  }>(path.join(projectRoot, "data", "canonical_parties.json"));
  const map = new Map<string, EnPartyName>();
  for (const p of canonical?.parties ?? []) {
    for (const h of p.history ?? []) {
      const key = `${h.election}|${h.partyNum}`;
      if (h.nameEn && !map.has(key)) {
        map.set(key, {
          nameEn: h.nameEn,
          nickNameEn: p.displayNameEn || h.nameEn,
        });
      }
    }
  }
  return map;
};

// Finds the candidate's preferences_stats.json (it lives under whichever
// election folder they last ran in) and reduces it to the most-recent
// election that actually has preference results.
const computeFacts = (
  prefStatsFile: string,
  oblastNames: Map<string, string>,
  oblastNamesEn: Map<string, string>,
  enParties: Map<string, EnPartyName>,
): CandidateFacts | null => {
  const data = readJson<RawPrefStats>(prefStatsFile);
  if (!data?.stats) return null;
  // stats[] is ordered newest-first; the first entry with non-empty
  // preferences is the candidate's most recent result.
  const entry = data.stats.find(
    (s) => s.party && s.preferences && s.preferences.length > 0,
  );
  if (!entry || !entry.party || !entry.preferences) return null;
  let total = 0;
  let top = entry.preferences[0];
  for (const p of entry.preferences) {
    const v = p.preferences ?? 0;
    total += v;
    if (v > (top.preferences ?? 0)) top = p;
  }
  const en = enParties.get(`${entry.elections_date}|${entry.party.number}`);
  return {
    electionDate: entry.elections_date,
    totalPreferences: total,
    topOblast: top.oblast,
    topOblastName: oblastNames.get(top.oblast) ?? top.oblast,
    topOblastNameEn: oblastNamesEn.get(top.oblast) ?? top.oblast,
    topOblastPreferences: top.preferences ?? 0,
    party: {
      number: entry.party.number,
      name: entry.party.name,
      nameEn: en?.nameEn ?? entry.party.name,
      nickName: entry.party.nickName,
      nickNameEn: en?.nickNameEn ?? entry.party.nickName,
      color: entry.party.color,
    },
  };
};

export type CandidateCardSet = {
  latestElection: string;
  cards: CandidateCardData[];
  // Keyed by normalizeName(name) — the prerenderer looks cards up this way to
  // attach the right OG image and facts to each /candidate/{name} route.
  byNormalizedName: Map<string, CandidateCardData>;
};

export const loadCandidateCardData = (
  projectRoot: string,
): CandidateCardSet => {
  const dataFolder = path.join(projectRoot, "data");
  const elections =
    readJson<RawElection[]>(
      path.join(projectRoot, "src/data/json/elections.json"),
    ) ?? [];
  const latestElection = elections[0]?.name ?? "";

  const regions =
    readJson<RawRegion[]>(
      path.join(projectRoot, "src/data/json/regions.json"),
    ) ?? [];
  const oblastNames = new Map<string, string>();
  const oblastNamesEn = new Map<string, string>();
  for (const r of regions) {
    if (!oblastNames.has(r.oblast)) {
      oblastNames.set(r.oblast, r.long_name || r.name);
      oblastNamesEn.set(r.oblast, r.long_name_en || r.name_en || r.name);
    }
  }

  // newestFolderByName[name] = the most-recent election folder that has a
  // per-candidate directory for that name. One readdir per folder (cheap)
  // beats an existsSync probe per candidate per folder.
  const newestFolderByName = new Map<string, string>();
  for (const e of elections) {
    const candDir = path.join(dataFolder, e.name, "candidates");
    let entries: string[];
    try {
      entries = fs.readdirSync(candDir);
    } catch {
      continue;
    }
    for (const dirName of entries) {
      if (!newestFolderByName.has(dirName)) {
        newestFolderByName.set(dirName, e.name);
      }
    }
  }

  const enParties = loadEnPartyNames(projectRoot);

  const factsFor = (name: string): CandidateFacts | null => {
    const folder = newestFolderByName.get(name);
    if (!folder) return null;
    return computeFacts(
      path.join(
        dataFolder,
        folder,
        "candidates",
        name,
        "preferences_stats.json",
      ),
      oblastNames,
      oblastNamesEn,
      enParties,
    );
  };

  const byNormalizedName = new Map<string, CandidateCardData>();

  // 1. Latest-election candidates — the current ballot.
  const latestCandidates =
    readJson<RawCandidate[]>(
      path.join(dataFolder, latestElection, "candidates.json"),
    ) ?? [];
  const parties =
    readJson<RawParty[]>(
      path.join(dataFolder, latestElection, "cik_parties.json"),
    ) ?? [];
  const partyByNum = new Map<number, RawParty>();
  for (const p of parties) partyByNum.set(p.number, p);

  for (const c of latestCandidates) {
    const key = normalizeName(c.name);
    if (byNormalizedName.has(key)) continue; // first row wins (same person, two lists is rare)
    const party = partyByNum.get(c.partyNum);
    const enParty = enParties.get(`${latestElection}|${c.partyNum}`);
    byNormalizedName.set(key, {
      name: c.name,
      nameEn: c.name_en ?? c.name,
      role: "candidate",
      candidacy: {
        partyNum: c.partyNum,
        partyNickName: party?.nickName,
        partyNickNameEn: enParty?.nickNameEn,
        partyColor: party?.color,
        oblast: c.oblast,
        oblastName: oblastNames.get(c.oblast) ?? c.oblast,
        pref: c.pref,
      },
      facts: null, // filled below
    });
  }

  // 2. MPs — enrich an existing entry, or add a new one for former MPs who
  //    aren't on the current ballot.
  const mpIndex = readJson<{ mps: RawMp[] }>(
    path.join(dataFolder, "parliament", "index.json"),
  );
  for (const mp of mpIndex?.mps ?? []) {
    const key = normalizeName(mp.normalizedName || mp.name);
    const photoFile = mp.photoUrl
      ? path.join(dataFolder, mp.photoUrl.replace(/^\//, ""))
      : "";
    const mpData = {
      id: mp.id,
      photoPath: photoFile && fs.existsSync(photoFile) ? photoFile : undefined,
      partyGroupShort: mp.currentPartyGroupShort || undefined,
      position: mp.position || undefined,
    };
    const role: CandidateRole = mp.isCurrent ? "current_mp" : "former_mp";
    const existing = byNormalizedName.get(key);
    if (existing) {
      // Keep the candidates.json display name (it's the canonical route name
      // for the current election) — just attach MP enrichment.
      existing.role = role;
      existing.mp = mpData;
      if (!existing.nameEn || existing.nameEn === existing.name) {
        existing.nameEn = mp.name_en ?? existing.nameEn;
      }
    } else {
      byNormalizedName.set(key, {
        name: mp.name,
        nameEn: mp.name_en ?? mp.name,
        role,
        mp: mpData,
        facts: null, // filled below
      });
    }
  }

  // 3. Attach the most-recent preference results to every card.
  for (const card of byNormalizedName.values()) {
    card.facts = factsFor(card.name);
  }

  return {
    latestElection,
    cards: Array.from(byNormalizedName.values()),
    byNormalizedName,
  };
};
