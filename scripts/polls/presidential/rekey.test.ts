import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  Poll,
  PresidentialPollDetail,
} from "../../../src/data/polls/pollsTypes";
import {
  __setRekeyRootForTests,
  buildCandidatesProjection,
  main,
  parseArgv,
  rekeyDetails,
} from "./rekey";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

// The REAL 2021 ticket set — 23 tickets, committed, real ЦИК data.
const ticketsFile = path.join(REPO_ROOT, "data/2021_11_14_pvr/tickets.json");
const has2021Corpus = fs.existsSync(ticketsFile);
const tickets2021 = has2021Corpus
  ? JSON.parse(fs.readFileSync(ticketsFile, "utf8")).tickets
  : [];

const BASE_POLL: Poll = {
  id: "test-poll",
  agencyId: "TEST",
  fieldwork: "Nov 5-10 2021",
  electionDate: "2021-11-14",
  cycle: "2021_11_14_pvr",
  respondents: 1000,
  methodology: { bg: "x", en: "x" },
  source: "https://example.test",
  genre: "raw_attitudes",
};

const row = (
  overrides: Partial<PresidentialPollDetail>,
): PresidentialPollDetail => ({
  pollId: BASE_POLL.id,
  agencyId: "TEST",
  candidateKey: "provisional:placeholder",
  candidateName_bg: "",
  candidateName_en: "",
  nominator: null,
  placeholderFor: null,
  support: 0,
  ...overrides,
});

describe.runIf(has2021Corpus)("rekeyDetails — real 2021 ticket set", () => {
  it("upgrades a provisional key to the real canonicalKey once tickets exist", () => {
    const details = [
      row({ candidateKey: "provisional:x-y", candidateName_bg: "Румен Радев" }),
    ];
    const { details: next, upgraded } = rekeyDetails(
      "2021_11_14_pvr",
      [BASE_POLL],
      details,
      tickets2021,
    );
    expect(upgraded).toBe(1);
    expect(next[0].candidateKey).toBe("румен георгиев радев");
  });

  it("leaves an unresolvable name provisional — refuses rather than guesses", () => {
    const details = [
      row({
        candidateKey: "provisional:никой-никойов",
        candidateName_bg: "Никой Никойов",
      }),
    ];
    const { details: next, upgraded } = rekeyDetails(
      "2021_11_14_pvr",
      [BASE_POLL],
      details,
      tickets2021,
    );
    expect(upgraded).toBe(0);
    expect(next[0].candidateKey).toBe("provisional:никой-никойов");
  });

  it("does not touch a row already resolved to a real key", () => {
    const details = [
      row({
        candidateKey: "румен георгиев радев",
        candidateName_bg: "Румен Радев",
      }),
    ];
    const { upgraded } = rekeyDetails(
      "2021_11_14_pvr",
      [BASE_POLL],
      details,
      tickets2021,
    );
    expect(upgraded).toBe(0);
  });

  it("does not touch a 'none' or 'placeholder:...' row", () => {
    const details = [
      row({ candidateKey: "none", candidateName_bg: "Не подкрепям никого" }),
      row({
        candidateKey: "placeholder:прб",
        candidateName_bg: "Прогресивна България",
        placeholderFor: "ПрБ",
      }),
    ];
    const { details: next, upgraded } = rekeyDetails(
      "2021_11_14_pvr",
      [BASE_POLL],
      details,
      tickets2021,
    );
    expect(upgraded).toBe(0);
    expect(next.map((d) => d.candidateKey)).toEqual([
      "none",
      "placeholder:прб",
    ]);
  });

  it("only rekeys rows belonging to a poll stamped to THIS cycle", () => {
    const otherPoll: Poll = {
      ...BASE_POLL,
      id: "other-poll",
      cycle: "2016_11_06_pvr",
    };
    const details = [
      row({
        pollId: otherPoll.id,
        candidateKey: "provisional:x-y",
        candidateName_bg: "Румен Радев",
      }),
    ];
    const { upgraded } = rekeyDetails(
      "2021_11_14_pvr",
      [otherPoll],
      details,
      tickets2021,
    );
    expect(upgraded).toBe(0);
  });

  it("is idempotent — re-running after an upgrade finds nothing left to do", () => {
    const details = [
      row({ candidateKey: "provisional:x-y", candidateName_bg: "Румен Радев" }),
    ];
    const first = rekeyDetails(
      "2021_11_14_pvr",
      [BASE_POLL],
      details,
      tickets2021,
    );
    const second = rekeyDetails(
      "2021_11_14_pvr",
      [BASE_POLL],
      first.details,
      tickets2021,
    );
    expect(second.upgraded).toBe(0);
    expect(second.details).toEqual(first.details);
  });
});

describe.runIf(has2021Corpus)(
  "buildCandidatesProjection — real 2021 ticket set",
  () => {
    it("includes every real ticket, registered (ticketNumber set)", () => {
      const candidates = buildCandidatesProjection(
        [],
        new Map([["2021_11_14_pvr", tickets2021]]),
      );
      expect(candidates).toHaveLength(23);
      const radev = candidates.find(
        (c) => c.candidateKey === "румен георгиев радев",
      );
      expect(radev).toMatchObject({
        name_bg: "Румен Георгиев Радев",
        ticketNumber: 6,
        nominator: "ИК за Румен Радев и Илияна Йотова",
      });
      expect(radev!.colour).toBeTruthy();
      expect(radev!.name_en).toBeTruthy();
    });

    it("adds a still-provisional name as an unregistered entry (ticketNumber/colour null)", () => {
      const details = [
        row({
          candidateKey: "provisional:никой-никойов",
          candidateName_bg: "Никой Никойов",
        }),
      ];
      const candidates = buildCandidatesProjection(
        details,
        new Map([["2021_11_14_pvr", tickets2021]]),
      );
      expect(candidates).toHaveLength(24);
      const unknown = candidates.find(
        (c) => c.candidateKey === "provisional:никой-никойов",
      );
      expect(unknown).toMatchObject({
        name_bg: "Никой Никойов",
        ticketNumber: null,
        colour: null,
        nominator: null,
      });
    });

    it("never adds a placeholder or 'none' row as a candidate", () => {
      const details = [
        row({ candidateKey: "none", candidateName_bg: "Не подкрепям никого" }),
        row({
          candidateKey: "placeholder:прб",
          candidateName_bg: "Прогресивна България",
          placeholderFor: "ПрБ",
        }),
      ];
      const candidates = buildCandidatesProjection(details, new Map());
      expect(candidates).toEqual([]);
    });

    it("does not duplicate a real ticket already resolved in the details", () => {
      const details = [
        row({
          candidateKey: "румен георгиев радев",
          candidateName_bg: "Румен Радев",
        }),
      ];
      const candidates = buildCandidatesProjection(
        details,
        new Map([["2021_11_14_pvr", tickets2021]]),
      );
      expect(
        candidates.filter((c) => c.candidateKey === "румен георгиев радев"),
      ).toHaveLength(1);
    });
  },
);

describe.runIf(has2021Corpus)(
  "main — real corpus, real 2021 ticket file",
  () => {
    let scratchRoot: string;

    beforeEach(() => {
      scratchRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), "presidential-rekey-test-"),
      );
      __setRekeyRootForTests(scratchRoot);
      // The real 2021 tree, so main() can find a genuine tickets.json.
      fs.mkdirSync(path.join(scratchRoot, "data/2021_11_14_pvr"), {
        recursive: true,
      });
      fs.copyFileSync(
        path.join(REPO_ROOT, "data/2021_11_14_pvr/tickets.json"),
        path.join(scratchRoot, "data/2021_11_14_pvr/tickets.json"),
      );
    });
    afterEach(() => {
      __setRekeyRootForTests();
      fs.rmSync(scratchRoot, { recursive: true, force: true });
      process.exitCode = undefined;
    });

    const presDir = () => path.join(scratchRoot, "data/polls/presidential");
    const writeCorpus = (polls: Poll[], details: PresidentialPollDetail[]) => {
      fs.mkdirSync(presDir(), { recursive: true });
      fs.writeFileSync(
        path.join(presDir(), "polls.json"),
        JSON.stringify(polls),
      );
      fs.writeFileSync(
        path.join(presDir(), "polls_details.json"),
        JSON.stringify(details),
      );
    };

    it("rekeys the real corpus and writes candidates.json", () => {
      writeCorpus(
        [BASE_POLL],
        [
          row({
            candidateKey: "provisional:x-y",
            candidateName_bg: "Румен Радев",
          }),
        ],
      );

      main(["--cycle", "2021_11_14_pvr"]);

      expect(process.exitCode).toBeUndefined();
      const details = JSON.parse(
        fs.readFileSync(path.join(presDir(), "polls_details.json"), "utf8"),
      );
      expect(details[0].candidateKey).toBe("румен георгиев радев");
      const candidates = JSON.parse(
        fs.readFileSync(path.join(presDir(), "candidates.json"), "utf8"),
      );
      expect(candidates).toHaveLength(23);
    });

    it("errors clearly when this cycle's tickets.json does not exist yet", () => {
      writeCorpus([{ ...BASE_POLL, cycle: "2026_11_08_pvr" }], []);
      main(["--cycle", "2026_11_08_pvr"]);
      expect(process.exitCode).toBe(1);
    });

    it("errors clearly when no presidential corpus exists yet", () => {
      main(["--cycle", "2021_11_14_pvr"]);
      expect(process.exitCode).toBe(1);
    });

    it("prints a usage error when --cycle is missing", () => {
      main([]);
      expect(process.exitCode).toBe(1);
    });

    it("refuses a malformed --cycle value before touching the filesystem", () => {
      main(["--cycle", "../../etc"]);
      expect(process.exitCode).toBe(1);
    });

    it("never reads or writes runoffs.json", () => {
      writeCorpus(
        [BASE_POLL],
        [
          row({
            candidateKey: "provisional:x-y",
            candidateName_bg: "Румен Радев",
          }),
        ],
      );
      const runoffsFile = path.join(presDir(), "runoffs.json");
      const before = JSON.stringify([
        {
          pollId: BASE_POLL.id,
          agencyId: "TEST",
          a: "provisional:stale-a",
          b: "provisional:stale-b",
          supportA: 1,
          supportB: 2,
          residual: null,
        },
      ]);
      fs.writeFileSync(runoffsFile, before);

      main(["--cycle", "2021_11_14_pvr"]);

      expect(fs.readFileSync(runoffsFile, "utf8")).toBe(before);
    });
  },
);

describe("parseArgv", () => {
  it("reads --cycle", () => {
    expect(parseArgv(["--cycle", "2026_11_08_pvr"])).toEqual({
      cycle: "2026_11_08_pvr",
    });
  });

  it("defaults to undefined", () => {
    expect(parseArgv([])).toEqual({ cycle: undefined });
  });
});
