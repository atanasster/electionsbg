import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export type ElectionContestRow = {
  contestId: string;
  contestKey: string;
  electionType: "parliamentary" | "presidential";
  resultGrain: "national";
  electionDate: string;
  cycleYear: number;
  round: number | null;
  registeredVoters: number | null;
  actualVoters: number | null;
  pctDenominatorVotes: number;
  noneOfAboveVotes: number | null;
  invalidVotes: number | null;
  percentageBasis: string;
  sourcePath: string;
  sourceSha256: string;
  granularSourcePath: string;
  granularSha256: string;
  granularReconciled: boolean;
};

export type ElectionResultRow = {
  contestId: string;
  resultGrain: "national";
  choiceKey: string;
  choiceKind: "party" | "independent" | "presidential_ticket";
  choiceNumber: number;
  canonicalPartyId: string | null;
  presidentName: string | null;
  vicePresidentName: string | null;
  choiceName: string;
  choiceShort: string | null;
  votes: number;
  pct: number;
  seats: number | null;
  passedThreshold: boolean | null;
};

type VoteEntry = {
  key: string;
  results: {
    votes: Array<{ partyNum: number; totalVotes: number }>;
    protocol?: Record<string, number | null | undefined>;
  };
};

type CanonicalParties = {
  parties: Array<{
    id: string;
    history: Array<{ election: string; partyNum: number }>;
  }>;
};

const sha256 = (value: Buffer | string) =>
  createHash("sha256").update(value).digest("hex");

const fail = (source: string, field: string, detail: string): never => {
  throw new Error(`${source}: ${field} ${detail}`);
};

const validDate = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === value
  );
};

const integer = (
  source: string,
  field: string,
  value: unknown,
  minimum = 0,
): number => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum)
    fail(source, field, `must be an integer >= ${minimum}`);
  return Number(value);
};

const percentage = (source: string, field: string, value: unknown): number => {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 100
  )
    fail(source, field, "must be a finite percentage from 0 to 100");
  return value;
};

const entriesOf = (source: string, raw: Buffer): VoteEntry[] => {
  const parsed = JSON.parse(raw.toString("utf8")) as
    | VoteEntry[]
    | { entries?: VoteEntry[] };
  const entries = Array.isArray(parsed) ? parsed : parsed.entries;
  if (!Array.isArray(entries) || entries.length === 0)
    fail(source, "entries", "must be a non-empty array");
  return entries;
};

const granularTotals = (source: string, entries: VoteEntry[]) => {
  const votes = new Map<number, number>();
  let registered = 0;
  let actual = 0;
  let none = 0;
  let invalid = 0;
  for (const [entryIndex, entry] of entries.entries()) {
    if (!entry?.results || !Array.isArray(entry.results.votes))
      fail(source, `entries[${entryIndex}].results.votes`, "must be an array");
    for (const [voteIndex, vote] of entry.results.votes.entries()) {
      const number = integer(
        source,
        `entries[${entryIndex}].results.votes[${voteIndex}].partyNum`,
        vote.partyNum,
        1,
      );
      const total = integer(
        source,
        `entries[${entryIndex}].results.votes[${voteIndex}].totalVotes`,
        vote.totalVotes,
      );
      votes.set(number, (votes.get(number) ?? 0) + total);
    }
    const protocol = entry.results.protocol ?? {};
    registered += Number(
      protocol.numRegisteredVoters ?? protocol.registeredVoters ?? 0,
    );
    actual += Number(protocol.totalActualVoters ?? protocol.signatures ?? 0);
    none += Number(
      protocol.noneOfTheAbove ??
        Number(protocol.numValidNoOneMachineVotes ?? 0) +
          Number(protocol.numValidNoOnePaperVotes ?? 0),
    );
    invalid += Number(
      protocol.invalidBallots ?? protocol.numInvalidBallotsFound ?? 0,
    );
  }
  return { votes, registered, actual, none, invalid };
};

const sameVotes = (
  expected: Map<number, number>,
  actual: Map<number, number>,
) =>
  expected.size === actual.size &&
  [...expected].every(([number, votes]) => actual.get(number) === votes);

export const readNationalElectionSources = (
  dataRoot: string,
): { contests: ElectionContestRow[]; results: ElectionResultRow[] } => {
  const canonical = JSON.parse(
    readFileSync(path.join(dataRoot, "canonical_parties.json"), "utf8"),
  ) as CanonicalParties;
  const canonicalByBallot = new Map<string, string>();
  for (const party of canonical.parties ?? [])
    for (const history of party.history ?? []) {
      const key = `${history.election}:${history.partyNum}`;
      if (canonicalByBallot.has(key))
        fail("canonical_parties.json", key, "maps to more than one party");
      canonicalByBallot.set(key, party.id);
    }

  const contests: ElectionContestRow[] = [];
  const results: ElectionResultRow[] = [];
  const folders = readdirSync(dataRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => /^\d{4}_\d{2}_\d{2}(?:_pvr)?$/.test(name))
    .sort();

  for (const folder of folders) {
    const sourcePath = `${folder}/national_summary.json`;
    let raw: Buffer;
    try {
      raw = readFileSync(path.join(dataRoot, sourcePath));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    const parsed = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;

    if (folder.endsWith("_pvr")) {
      if (parsed.cycle !== folder)
        fail(sourcePath, "cycle", `must equal folder ${folder}`);
      const rounds = parsed.rounds;
      if (!Array.isArray(rounds) || rounds.length === 0)
        fail(sourcePath, "rounds", "must be a non-empty array");
      const seenRounds = new Set<number>();
      for (const [roundIndex, rawRound] of rounds.entries()) {
        const round = rawRound as Record<string, unknown>;
        const roundNumber = integer(
          sourcePath,
          `rounds[${roundIndex}].round`,
          round.round,
          1,
        );
        if (roundNumber > 2 || seenRounds.has(roundNumber))
          fail(
            sourcePath,
            `rounds[${roundIndex}].round`,
            "must be unique 1 or 2",
          );
        seenRounds.add(roundNumber);
        if (!validDate(round.date))
          fail(
            sourcePath,
            `rounds[${roundIndex}].date`,
            "must be a valid date",
          );
        const ranking = round.ranking;
        if (!Array.isArray(ranking) || ranking.length === 0)
          fail(
            sourcePath,
            `rounds[${roundIndex}].ranking`,
            "must be non-empty",
          );
        const turnout = (round.turnout ?? {}) as Record<string, unknown>;
        const voteMeta = (round.votes ?? {}) as Record<string, unknown>;
        const expected = new Map<number, number>();
        const contestId = `${folder}:r${roundNumber}`;
        for (const [choiceIndex, rawChoice] of ranking.entries()) {
          const choice = rawChoice as Record<string, unknown>;
          const number = integer(
            sourcePath,
            `rounds[${roundIndex}].ranking[${choiceIndex}].number`,
            choice.number,
            1,
          );
          if (expected.has(number))
            fail(
              sourcePath,
              `rounds[${roundIndex}].ranking`,
              `duplicates choice ${number}`,
            );
          const votes = integer(
            sourcePath,
            `rounds[${roundIndex}].ranking[${choiceIndex}].votes`,
            choice.votes,
          );
          expected.set(number, votes);
          if (typeof choice.president !== "string" || !choice.president.trim())
            fail(
              sourcePath,
              `rounds[${roundIndex}].ranking[${choiceIndex}].president`,
              "is required",
            );
          if (
            typeof choice.vicePresident !== "string" ||
            !choice.vicePresident.trim()
          )
            fail(
              sourcePath,
              `rounds[${roundIndex}].ranking[${choiceIndex}].vicePresident`,
              "is required",
            );
          const share = percentage(
            sourcePath,
            `rounds[${roundIndex}].ranking[${choiceIndex}].shareOfValid`,
            Number(choice.shareOfValid) * 100,
          );
          results.push({
            contestId,
            resultGrain: "national",
            choiceKey: `ticket:${folder}:${number}`,
            choiceKind: "presidential_ticket",
            choiceNumber: number,
            canonicalPartyId: null,
            presidentName: choice.president,
            vicePresidentName: choice.vicePresident,
            choiceName: `${choice.president} / ${choice.vicePresident}`,
            choiceShort: choice.president,
            votes,
            pct: share,
            seats: null,
            passedThreshold: null,
          });
        }
        const granularPaths = [
          `${folder}/tur${roundNumber}/region_votes.json`,
          `${folder}/tur${roundNumber}/abroad.json`,
        ];
        const granularBuffers = granularPaths.map((entry) =>
          readFileSync(path.join(dataRoot, entry)),
        );
        const totals = granularTotals(
          granularPaths.join(" + "),
          granularBuffers.flatMap((buffer, index) =>
            entriesOf(granularPaths[index], buffer),
          ),
        );
        const registered = integer(
          sourcePath,
          `rounds[${roundIndex}].turnout.registeredVoters`,
          turnout.registeredVoters,
        );
        const actual = integer(
          sourcePath,
          `rounds[${roundIndex}].turnout.cast`,
          turnout.cast,
        );
        contests.push({
          contestId,
          contestKey: folder,
          electionType: "presidential",
          resultGrain: "national",
          electionDate: round.date,
          cycleYear: Number(folder.slice(0, 4)),
          round: roundNumber,
          registeredVoters: registered,
          actualVoters: actual,
          pctDenominatorVotes: integer(
            sourcePath,
            `rounds[${roundIndex}].votes.valid`,
            voteMeta.valid,
            1,
          ),
          noneOfAboveVotes:
            voteMeta.noneOfTheAbove == null
              ? null
              : integer(
                  sourcePath,
                  `rounds[${roundIndex}].votes.noneOfTheAbove`,
                  voteMeta.noneOfTheAbove,
                ),
          invalidVotes:
            voteMeta.invalid == null
              ? null
              : integer(
                  sourcePath,
                  `rounds[${roundIndex}].votes.invalid`,
                  voteMeta.invalid,
                ),
          percentageBasis: "valid_votes_including_none_of_above",
          sourcePath,
          sourceSha256: sha256(raw),
          granularSourcePath: granularPaths.join(" + "),
          granularSha256: sha256(Buffer.concat(granularBuffers)),
          granularReconciled:
            sameVotes(expected, totals.votes) &&
            registered === totals.registered &&
            actual === totals.actual,
        });
      }
      continue;
    }

    if (parsed.election !== folder)
      fail(sourcePath, "election", `must equal folder ${folder}`);
    const parties = parsed.parties;
    if (!Array.isArray(parties) || parties.length === 0)
      fail(sourcePath, "parties", "must be a non-empty array");
    const turnout = (parsed.turnout ?? {}) as Record<string, unknown>;
    const expected = new Map<number, number>();
    for (const [partyIndex, rawParty] of parties.entries()) {
      const party = rawParty as Record<string, unknown>;
      const number = integer(
        sourcePath,
        `parties[${partyIndex}].partyNum`,
        party.partyNum,
        1,
      );
      if (expected.has(number))
        fail(sourcePath, "parties", `duplicates ballot number ${number}`);
      const votes = integer(
        sourcePath,
        `parties[${partyIndex}].totalVotes`,
        party.totalVotes,
      );
      expected.set(number, votes);
      if (typeof party.name !== "string" || !party.name.trim())
        fail(sourcePath, `parties[${partyIndex}].name`, "is required");
      const nickname = typeof party.nickName === "string" ? party.nickName : "";
      const canonicalId = canonicalByBallot.get(`${folder}:${number}`) ?? null;
      const independent = /независим/iu.test(`${nickname} ${party.name}`);
      if (!canonicalId && !independent)
        fail(
          sourcePath,
          `parties[${partyIndex}]`,
          "has no canonical party identity",
        );
      results.push({
        contestId: folder,
        resultGrain: "national",
        choiceKey: canonicalId
          ? `party:${canonicalId}`
          : `independent:${folder}:${number}`,
        choiceKind: canonicalId ? "party" : "independent",
        choiceNumber: number,
        canonicalPartyId: canonicalId,
        presidentName: null,
        vicePresidentName: null,
        choiceName: party.name,
        choiceShort: nickname || null,
        votes,
        pct: percentage(sourcePath, `parties[${partyIndex}].pct`, party.pct),
        seats:
          party.seats == null
            ? null
            : integer(sourcePath, `parties[${partyIndex}].seats`, party.seats),
        passedThreshold:
          typeof party.passedThreshold === "boolean"
            ? party.passedThreshold
            : null,
      });
    }
    const granularPath = `${folder}/region_votes.json`;
    const granularRaw = readFileSync(path.join(dataRoot, granularPath));
    const entries = entriesOf(granularPath, granularRaw);
    if (!entries.some((entry) => entry.key === "32"))
      fail(granularPath, "entries", "must include abroad district 32");
    const totals = granularTotals(granularPath, entries);
    const registered = integer(
      sourcePath,
      "turnout.registered",
      turnout.registered,
    );
    const actual = integer(sourcePath, "turnout.actual", turnout.actual);
    if (
      !sameVotes(expected, totals.votes) ||
      registered !== totals.registered ||
      actual !== totals.actual
    )
      fail(
        sourcePath,
        "national totals",
        `do not reconcile to ${granularPath}`,
      );
    contests.push({
      contestId: folder,
      contestKey: folder,
      electionType: "parliamentary",
      resultGrain: "national",
      electionDate: folder.replace(/_/g, "-"),
      cycleYear: Number(folder.slice(0, 4)),
      round: null,
      registeredVoters: registered,
      actualVoters: actual,
      pctDenominatorVotes: [...expected.values()].reduce(
        (sum, votes) => sum + votes,
        0,
      ),
      noneOfAboveVotes: totals.none,
      invalidVotes: totals.invalid,
      percentageBasis: "party_votes_excluding_none_of_above",
      sourcePath,
      sourceSha256: sha256(raw),
      granularSourcePath: granularPath,
      granularSha256: sha256(granularRaw),
      granularReconciled: true,
    });
  }

  return { contests, results };
};
