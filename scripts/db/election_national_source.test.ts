import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readNationalElectionSources } from "./election_national_source";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const snapshot = readNationalElectionSources(path.join(ROOT, "data"));
const hasCorpus = snapshot.contests.some(
  (contest) => contest.contestId === "2026_04_19",
);
const hashFile = (file: string) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

describe.runIf(hasCorpus)(
  "national election source normalization against the corpus",
  () => {
    it("preserves the latest parliamentary identity and independent totals", () => {
      const contest = snapshot.contests.find(
        (candidate) => candidate.contestId === "2026_04_19",
      );
      expect(contest).toMatchObject({
        electionType: "parliamentary",
        electionDate: "2026-04-19",
        round: null,
        registeredVoters: 6_627_747,
        actualVoters: 3_360_330,
        pctDenominatorVotes: 3_240_156,
        percentageBasis: "party_votes_excluding_none_of_above",
        granularReconciled: true,
      });
      const results = snapshot.results
        .filter((result) => result.contestId === "2026_04_19")
        .sort((a, b) => b.votes - a.votes);
      expect(results).toHaveLength(25);
      expect(results[0]).toMatchObject({
        choiceNumber: 21,
        choiceKey: "party:p_20",
        choiceKind: "party",
        canonicalPartyId: "p_20",
        choiceShort: "ПрБ",
        votes: 1_444_920,
        seats: 131,
        passedThreshold: true,
      });
      expect(results.reduce((sum, result) => sum + result.votes, 0)).toBe(
        3_240_156,
      );
    });

    it("keeps presidential rounds separate from parliamentary contests", () => {
      const first = snapshot.contests.find(
        (candidate) => candidate.contestId === "2021_11_14_pvr:r1",
      );
      const runoff = snapshot.contests.find(
        (candidate) => candidate.contestId === "2021_11_14_pvr:r2",
      );
      expect(first).toMatchObject({
        electionType: "presidential",
        cycleYear: 2021,
        round: 1,
        electionDate: "2021-11-14",
      });
      expect(runoff).toMatchObject({
        electionType: "presidential",
        cycleYear: 2021,
        round: 2,
        electionDate: "2021-11-21",
        registeredVoters: 6_672_935,
        actualVoters: 2_310_903,
        pctDenominatorVotes: 2_307_610,
        noneOfAboveVotes: 34_169,
        percentageBasis: "valid_votes_including_none_of_above",
        granularReconciled: true,
      });
      const top = snapshot.results
        .filter((result) => result.contestId === runoff?.contestId)
        .sort((a, b) => b.votes - a.votes)[0];
      expect(top).toMatchObject({
        choiceNumber: 6,
        choiceKey: "ticket:2021_11_14_pvr:6",
        presidentName: "Румен Георгиев Радев",
        vicePresidentName: "Илияна Малинова Йотова",
        choiceShort: "Румен Георгиев Радев",
        votes: 1_539_650,
      });
      expect(top.pct).toBeCloseTo(66.720546, 5);
    });

    it("records recomputable source and granular hashes on every contest", () => {
      expect(snapshot.contests.length).toBeGreaterThan(10);
      for (const contest of snapshot.contests) {
        expect(contest.sourceSha256, contest.contestId).toMatch(
          /^[a-f0-9]{64}$/,
        );
        expect(contest.granularSha256, contest.contestId).toMatch(
          /^[a-f0-9]{64}$/,
        );
      }
      const parliamentary = snapshot.contests.find(
        (contest) => contest.contestId === "2026_04_19",
      )!;
      expect(parliamentary.sourceSha256).toBe(
        hashFile(path.join(ROOT, "data", parliamentary.sourcePath)),
      );
      expect(parliamentary.granularSha256).toBe(
        hashFile(path.join(ROOT, "data", parliamentary.granularSourcePath)),
      );
      const pvr = snapshot.contests.filter(
        (contest) => contest.contestKey === "2021_11_14_pvr",
      );
      expect(pvr).toHaveLength(2);
      expect(pvr[0].sourceSha256).toBe(pvr[1].sourceSha256);
      const presidentialGranular = Buffer.concat(
        pvr[0].granularSourcePath
          .split(" + ")
          .map((source) => readFileSync(path.join(ROOT, "data", source))),
      );
      expect(pvr[0].granularSha256).toBe(
        createHash("sha256").update(presidentialGranular).digest("hex"),
      );
    });

    it("marks the known incomplete 2011 presidential granular source unservable", () => {
      expect(
        snapshot.contests
          .filter((contest) => contest.contestKey === "2011_10_23_pvr")
          .map((contest) => contest.granularReconciled),
      ).toEqual([false, false]);
    });
  },
);

describe("national election source normalization", () => {
  it.each([
    ["empty parliamentary choices", { election: "2020_01_01", parties: [] }],
    [
      "invalid presidential round",
      { cycle: "2020_01_01_pvr", rounds: [{ round: 3, ranking: [] }] },
    ],
  ])("rejects %s with a source-specific error", (_label, summary) => {
    const temp = mkdtempSync(path.join(os.tmpdir(), "election-source-"));
    try {
      writeFileSync(
        path.join(temp, "canonical_parties.json"),
        JSON.stringify({ parties: [] }),
      );
      const folder = String(
        (summary as { election?: string; cycle?: string }).election ??
          (summary as { cycle: string }).cycle,
      );
      mkdirSync(path.join(temp, folder));
      writeFileSync(
        path.join(temp, folder, "national_summary.json"),
        JSON.stringify(summary),
      );
      expect(() => readNationalElectionSources(temp)).toThrow(
        `${folder}/national_summary.json`,
      );
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
