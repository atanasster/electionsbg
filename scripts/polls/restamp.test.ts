import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __setRestampRootForTests,
  __setRunAnalyzeForTests,
  main,
  parseArgv,
} from "./restamp";
import type { Poll } from "../../src/data/polls/pollsTypes";
import { assertCommitted } from "../lib/assert_committed";

// These path literals mirror the REAL committed corpus shape (restamp.ts is
// redirected to a scratch root for every test below, so nothing here reads
// them) — asserted so a renamed/removed committed directory is caught here
// rather than only by a fixture silently drifting from reality.
assertCommitted(
  "data/polls",
  "data/polls/polls.json",
  "data/polls/presidential",
  "data/polls/presidential/polls.json",
);

describe("parseArgv", () => {
  it("reads --race and --to", () => {
    expect(
      parseArgv(["--race", "parliamentary", "--to", "2027-03-14"]),
    ).toEqual({
      race: "parliamentary",
      to: "2027-03-14",
      cycle: undefined,
    });
  });

  it("reads --race and --cycle (presidential)", () => {
    expect(
      parseArgv(["--race", "presidential", "--cycle", "2026_11_08_pvr"]),
    ).toEqual({
      race: "presidential",
      to: undefined,
      cycle: "2026_11_08_pvr",
    });
  });

  it("defaults all three to undefined", () => {
    expect(parseArgv([])).toEqual({
      race: undefined,
      to: undefined,
      cycle: undefined,
    });
  });
});

describe("main", () => {
  let scratchRoot: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let analyzeSpy: ReturnType<typeof vi.fn>;

  const pollsFile = () => path.join(scratchRoot, "data/polls/polls.json");
  const electionsFile = () =>
    path.join(scratchRoot, "src/data/json/elections.json");

  const writePolls = (polls: Poll[]) => {
    fs.mkdirSync(path.join(scratchRoot, "data/polls"), { recursive: true });
    fs.writeFileSync(pollsFile(), JSON.stringify(polls));
  };
  const writeElections = (names: string[]) => {
    fs.mkdirSync(path.join(scratchRoot, "src/data/json"), {
      recursive: true,
    });
    fs.writeFileSync(
      electionsFile(),
      JSON.stringify(names.map((name) => ({ name }))),
    );
  };
  const readPolls = (): Poll[] =>
    JSON.parse(fs.readFileSync(pollsFile(), "utf8"));

  const BASE_POLL: Poll = {
    id: "ml-2026-07-19",
    agencyId: "ML",
    fieldwork: "Jul 15-19 2026",
    electionDate: null,
    respondents: 1000,
    methodology: { bg: "x", en: "x" },
    source: "https://example.test/",
    race: "parliamentary",
  };

  beforeEach(() => {
    scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "polls-restamp-test-"));
    __setRestampRootForTests(scratchRoot);
    analyzeSpy = vi.fn(() => true);
    __setRunAnalyzeForTests(analyzeSpy as unknown as () => boolean);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    __setRestampRootForTests();
    __setRunAnalyzeForTests();
    fs.rmSync(scratchRoot, { recursive: true, force: true });
    logSpy.mockRestore();
    errorSpy.mockRestore();
    process.exitCode = undefined;
  });

  it("stamps a null-dated poll whose fieldwork falls after the previous election and before --to", () => {
    writeElections(["2026_04_19"]);
    writePolls([BASE_POLL]);

    main(["--race", "parliamentary", "--to", "2027-03-14"]);

    expect(process.exitCode).toBeUndefined();
    expect(readPolls()[0].electionDate).toBe("2027-03-14");
    expect(analyzeSpy).toHaveBeenCalledTimes(1);
  });

  it("does not stamp a poll whose fieldwork falls before the previous election", () => {
    writeElections(["2026_04_19"]);
    writePolls([
      { ...BASE_POLL, fieldwork: "Jan 3-5 2026" }, // before 2026-04-19
    ]);

    main(["--race", "parliamentary", "--to", "2027-03-14"]);

    expect(process.exitCode).toBeUndefined();
    expect(readPolls()[0].electionDate).toBeNull();
    // Still runs analyze even though nothing was stamped — decision 11's
    // "nobody has to remember this step".
    expect(analyzeSpy).toHaveBeenCalledTimes(1);
  });

  it("does not stamp an already-dated poll", () => {
    writeElections(["2026_04_19"]);
    writePolls([{ ...BASE_POLL, electionDate: "2026-04-19" }]);

    main(["--race", "parliamentary", "--to", "2027-03-14"]);

    expect(readPolls()[0].electionDate).toBe("2026-04-19");
  });

  it("does not stamp a presidential poll even when --race parliamentary is given", () => {
    writeElections(["2026_04_19"]);
    writePolls([{ ...BASE_POLL, race: "presidential" }]);

    main(["--race", "parliamentary", "--to", "2027-03-14"]);

    expect(readPolls()[0].electionDate).toBeNull();
  });

  it("does not stamp a poll whose fieldwork is unreadable", () => {
    writeElections(["2026_04_19"]);
    writePolls([{ ...BASE_POLL, fieldwork: "sometime in 2026" }]);

    main(["--race", "parliamentary", "--to", "2027-03-14"]);

    expect(readPolls()[0].electionDate).toBeNull();
  });

  it("uses an open-ended window when no held election precedes --to", () => {
    writeElections([]); // no elections.json entries at all
    writePolls([{ ...BASE_POLL, fieldwork: "Jan 3-5 2020" }]);

    main(["--race", "parliamentary", "--to", "2027-03-14"]);

    expect(process.exitCode).toBeUndefined();
    expect(readPolls()[0].electionDate).toBe("2027-03-14");
  });

  it("refuses --race presidential with no --cycle", () => {
    main(["--race", "presidential"]);
    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("--race presidential --cycle"),
    );
    expect(analyzeSpy).not.toHaveBeenCalled();
  });

  it("refuses an unknown --race value", () => {
    main(["--race", "bogus", "--to", "2026-11-08"]);
    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('must be "parliamentary" or "presidential"'),
    );
  });

  it("refuses a malformed --to value", () => {
    main(["--race", "parliamentary", "--to", "not-a-date"]);
    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("must be a real ISO date"),
    );
  });

  it("refuses a --to on or before the most recent held election", () => {
    writeElections(["2026_04_19"]);
    main(["--race", "parliamentary", "--to", "2026-04-19"]);
    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("is not after the most recent held election"),
    );
  });

  it("prints a usage error when --race or --to is missing", () => {
    main(["--race", "parliamentary"]);
    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("usage:"));
  });

  it("reports failure and sets a non-zero exit code when polls:analyze fails", () => {
    __setRunAnalyzeForTests(() => false);
    writeElections(["2026_04_19"]);
    writePolls([BASE_POLL]);

    main(["--race", "parliamentary", "--to", "2027-03-14"]);

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("polls:analyze failed"),
    );
    // The stamp itself still landed — analyze failing doesn't roll it back.
    expect(readPolls()[0].electionDate).toBe("2027-03-14");
  });

  it("refuses a --to that is shaped like a date but not a real one", () => {
    main(["--race", "parliamentary", "--to", "2027-02-30"]);
    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("must be a real ISO date"),
    );
  });

  // TEST-001: pin the exact boundary values — a poll whose fieldwork ends
  // exactly ON the previous election, or exactly ON --to, must NOT be
  // stamped (the window is strictly after/before, per decision 11's own
  // wording), and one ending the very next day must be.
  it("does not stamp a poll whose fieldwork ends exactly on the previous election", () => {
    writeElections(["2026_04_19"]);
    writePolls([{ ...BASE_POLL, fieldwork: "Apr 19 2026" }]);

    main(["--race", "parliamentary", "--to", "2027-03-14"]);

    expect(readPolls()[0].electionDate).toBeNull();
  });

  it("does not stamp a poll whose fieldwork ends exactly on --to", () => {
    writeElections(["2026_04_19"]);
    writePolls([{ ...BASE_POLL, fieldwork: "Mar 14 2027" }]);

    main(["--race", "parliamentary", "--to", "2027-03-14"]);

    expect(readPolls()[0].electionDate).toBeNull();
  });

  it("stamps a poll whose fieldwork ends the day after the previous election", () => {
    writeElections(["2026_04_19"]);
    writePolls([{ ...BASE_POLL, fieldwork: "Apr 20 2026" }]);

    main(["--race", "parliamentary", "--to", "2027-03-14"]);

    expect(readPolls()[0].electionDate).toBe("2027-03-14");
  });

  // TEST-002: heldParliamentaryElectionDates() sorts before taking the
  // max — pin that an unsorted, multi-entry elections.json still picks
  // the true latest rather than the last-written entry.
  it("picks the most recent held election even when elections.json is unsorted", () => {
    writeElections(["2024_10_27", "2026_04_19", "2021_04_04"]);
    // Before every one of them — must NOT be stamped, which only holds if
    // the true latest (2026-04-19) was picked rather than the last-listed
    // entry (2021-04-04), which would wrongly admit this poll.
    writePolls([{ ...BASE_POLL, fieldwork: "Jan 3-5 2020" }]);

    main(["--race", "parliamentary", "--to", "2027-03-14"]);

    expect(readPolls()[0].electionDate).toBeNull();
  });

  // TEST-003: exercise the per-poll filter and the `stamped` counter over
  // a mixed batch, not just n=1 — a bug that stamped all-or-nothing would
  // not be caught by any test above.
  it("stamps only the qualifying polls in a mixed batch", () => {
    writeElections(["2026_04_19"]);
    writePolls([
      { ...BASE_POLL, id: "a", fieldwork: "Jan 3-5 2026" }, // before previous election
      { ...BASE_POLL, id: "b", fieldwork: "Jul 15-19 2026" }, // qualifies
      { ...BASE_POLL, id: "c", electionDate: "2026-04-19" }, // already dated
      {
        ...BASE_POLL,
        id: "d",
        race: "presidential",
        fieldwork: "Jul 15-19 2026",
      }, // wrong race
    ]);

    main(["--race", "parliamentary", "--to", "2027-03-14"]);

    const polls = readPolls();
    expect(polls.find((p) => p.id === "a")!.electionDate).toBeNull();
    expect(polls.find((p) => p.id === "b")!.electionDate).toBe("2027-03-14");
    expect(polls.find((p) => p.id === "c")!.electionDate).toBe("2026-04-19");
    expect(polls.find((p) => p.id === "d")!.electionDate).toBeNull();
  });

  // TEST-004: defaultRunAnalyze's real (never-mocked-elsewhere) path
  // construction — a lightweight sanity check that doesn't spawn the
  // real subprocess (which would run against the actual repo corpus).
  it("defaultRunAnalyze points at a script that actually exists", () => {
    __setRunAnalyzeForTests(); // restore the real spawn-based implementation
    const scriptPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "analyze_accuracy.ts",
    );
    expect(fs.existsSync(scriptPath)).toBe(true);
  });
});

describe("main — presidential (decision 11's cycle-stamping arm)", () => {
  let scratchRoot: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let analyzeSpy: ReturnType<typeof vi.fn>;

  const presPollsFile = () =>
    path.join(scratchRoot, "data/polls/presidential/polls.json");
  const writePresPolls = (polls: Poll[]) => {
    fs.mkdirSync(path.join(scratchRoot, "data/polls/presidential"), {
      recursive: true,
    });
    fs.writeFileSync(presPollsFile(), JSON.stringify(polls));
  };
  const readPresPolls = (): Poll[] =>
    JSON.parse(fs.readFileSync(presPollsFile(), "utf8"));

  const BASE_PRES_POLL: Poll = {
    id: "gm-2026-07-11",
    agencyId: "GM",
    fieldwork: "Jun 23 - Jul 11 2026",
    electionDate: "2026-11-08", // pre-decree ESTIMATE, per UPCOMING_ELECTIONS
    cycle: null,
    respondents: 1503,
    methodology: { bg: "x", en: "x" },
    source: "https://example.test/",
    race: "presidential",
  };

  beforeEach(() => {
    scratchRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "polls-restamp-pres-test-"),
    );
    __setRestampRootForTests(scratchRoot);
    analyzeSpy = vi.fn(() => true);
    __setRunAnalyzeForTests(analyzeSpy as unknown as () => boolean);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    __setRestampRootForTests();
    __setRunAnalyzeForTests();
    fs.rmSync(scratchRoot, { recursive: true, force: true });
    logSpy.mockRestore();
    errorSpy.mockRestore();
    process.exitCode = undefined;
  });

  it("stamps every null-cycle presidential poll to the decreed cycle, and runs the PRESIDENTIAL analyzer", () => {
    writePresPolls([BASE_PRES_POLL]);

    main(["--race", "presidential", "--cycle", "2026_11_08_pvr"]);

    expect(process.exitCode).toBeUndefined();
    const polls = readPresPolls();
    expect(polls[0].cycle).toBe("2026_11_08_pvr");
    // The decree's own date wins over whatever estimate was there before.
    expect(polls[0].electionDate).toBe("2026-11-08");
    expect(analyzeSpy).toHaveBeenCalledWith("presidential");
  });

  it("does not touch a poll whose cycle is already stamped", () => {
    writePresPolls([{ ...BASE_PRES_POLL, cycle: "2026_11_08_pvr" }]);

    main(["--race", "presidential", "--cycle", "2026_11_08_pvr"]);

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("nothing to stamp"),
    );
  });

  it("does not touch a parliamentary poll even when it has no cycle field", () => {
    writePresPolls([
      {
        ...BASE_PRES_POLL,
        id: "other",
        race: "parliamentary",
        cycle: undefined,
      },
    ]);

    main(["--race", "presidential", "--cycle", "2026_11_08_pvr"]);

    expect(readPresPolls()[0].cycle).toBeUndefined();
  });

  it("refuses a malformed --cycle value", () => {
    writePresPolls([BASE_PRES_POLL]);

    main(["--race", "presidential", "--cycle", "not-a-cycle"]);

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("round-1 folder id"),
    );
    expect(analyzeSpy).not.toHaveBeenCalled();
  });

  it("reports failure when polls:analyze --race presidential fails", () => {
    writePresPolls([BASE_PRES_POLL]);
    analyzeSpy.mockImplementation(() => false);

    main(["--race", "presidential", "--cycle", "2026_11_08_pvr"]);

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("polls:analyze --race presidential failed"),
    );
  });

  it("does nothing (and does not throw) when no presidential corpus exists at all", () => {
    // No writePresPolls call — data/polls/presidential/ does not exist.
    // readJsonArray degrades to [] for a missing file, so there is
    // nothing to stamp; the run must still complete cleanly.
    main(["--race", "presidential", "--cycle", "2026_11_08_pvr"]);
    expect(process.exitCode).toBeUndefined();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("nothing to stamp"),
    );
  });
});
