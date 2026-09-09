import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __setAcceptRootForTests, main, parseArgv } from "./accept";
import type { InboxDraft, PresidentialInboxDraft } from "./lib/draft";
import type {
  Poll,
  PollDetail,
  PresidentialPollDetail,
  Runoff,
} from "../../src/data/polls/pollsTypes";

describe("parseArgv", () => {
  it("reads the positional pollId plus every flag", () => {
    expect(
      parseArgv([
        "tr-2026-04-16",
        "--election",
        "2026-11-08",
        "--genre",
        "forecast",
        "--locked-by",
        "agency_pdf",
        "--replace",
        "--allow-empty",
      ]),
    ).toEqual({
      pollId: "tr-2026-04-16",
      election: "2026-11-08",
      genre: "forecast",
      lockedBy: "agency_pdf",
      replace: true,
      allowEmpty: true,
      cycle: undefined,
    });
  });

  it("reads --cycle (presidential-only)", () => {
    expect(parseArgv(["gm-2026-07-11", "--cycle", "2026_11_08_pvr"])).toEqual({
      pollId: "gm-2026-07-11",
      election: undefined,
      genre: undefined,
      lockedBy: undefined,
      replace: false,
      allowEmpty: false,
      cycle: "2026_11_08_pvr",
    });
  });

  it("defaults booleans to false and the rest to undefined", () => {
    expect(parseArgv([])).toEqual({
      pollId: undefined,
      election: undefined,
      genre: undefined,
      lockedBy: undefined,
      replace: false,
      allowEmpty: false,
      cycle: undefined,
    });
  });
});

describe("main", () => {
  let scratchRoot: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  const pollsFile = () => path.join(scratchRoot, "data/polls/polls.json");
  const detailsFile = () =>
    path.join(scratchRoot, "data/polls/polls_details.json");
  const inboxFile = (name: string) =>
    path.join(scratchRoot, "data/polls/_inbox", name);

  const BASE_DRAFT: InboxDraft = {
    race: "parliamentary",
    poll: {
      id: "tr-2026-04-16",
      agencyId: "TR",
      source: "https://rctrend.bg/project/x/",
      electionDate: null,
      respondents: 1004,
      genre: "raw_attitudes",
      fieldwork: "Apr 13-16 2026",
      methodology: { bg: "Пряко интервю", en: "Direct interview" },
      provenance: {
        url: "https://rctrend.bg/project/x/",
        fetchedAt: "2026-09-09T00:00:00.000Z",
        sha256: "a".repeat(64),
        extractor: "TR",
        fieldworkStart: "2026-04-13",
        fieldworkEnd: "2026-04-16",
        basePhrase: "подкрепа сред заявилите",
        quotes: { "share:ГЕРБ-СДС": "ГЕРБ-СДС с 19,1%" },
      },
    },
    details: [
      {
        pollId: "tr-2026-04-16",
        agencyId: "TR",
        support: 19.1,
        nickName_bg: "ГЕРБ-СДС",
        nickName_en: "",
      },
    ],
    residual: null,
    genre: "raw_attitudes",
    extractor: "TR",
    evidence: { "share:ГЕРБ-СДС": "ГЕРБ-СДС с 19,1%" },
    refused: [],
  };

  const writeDraft = (name: string, draft: InboxDraft) => {
    fs.mkdirSync(path.join(scratchRoot, "data/polls/_inbox"), {
      recursive: true,
    });
    fs.writeFileSync(inboxFile(name), JSON.stringify(draft, null, 2));
  };
  const writeCorpus = (polls: unknown[], details: unknown[]) => {
    fs.mkdirSync(path.join(scratchRoot, "data/polls"), { recursive: true });
    fs.writeFileSync(pollsFile(), JSON.stringify(polls));
    fs.writeFileSync(detailsFile(), JSON.stringify(details));
  };
  const readCorpus = (): { polls: Poll[]; details: PollDetail[] } => ({
    polls: JSON.parse(fs.readFileSync(pollsFile(), "utf8")),
    details: JSON.parse(fs.readFileSync(detailsFile(), "utf8")),
  });

  beforeEach(() => {
    scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "polls-accept-test-"));
    __setAcceptRootForTests(scratchRoot);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    __setAcceptRootForTests();
    fs.rmSync(scratchRoot, { recursive: true, force: true });
    logSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
    process.exitCode = undefined;
  });

  it("accepts a valid draft: writes minified corpus files, sets locked, deletes the inbox file", () => {
    writeDraft("tr-2026-04-16.json", BASE_DRAFT);
    writeCorpus([], []);

    main(["tr-2026-04-16"]);

    expect(process.exitCode).toBeUndefined();
    const raw = fs.readFileSync(pollsFile(), "utf8");
    expect(raw.includes("\n")).toBe(false); // minified, single line

    const { polls, details } = readCorpus();
    expect(polls).toHaveLength(1);
    expect(polls[0].id).toBe("tr-2026-04-16");
    expect(polls[0].locked!.by).toBe("agency_website");
    expect(polls[0].locked!.note).toBe(
      "auto-extracted; evidence in provenance",
    );
    expect(details).toHaveLength(1);
    expect(details[0].nickName_bg).toBe("ГЕРБ-СДС");
    expect(fs.existsSync(inboxFile("tr-2026-04-16.json"))).toBe(false);
  });

  it("--locked-by sets a non-default tier, validated against the same allow-list as PollLock.by", () => {
    writeDraft("tr-2026-04-16.json", BASE_DRAFT);
    writeCorpus([], []);

    main(["tr-2026-04-16", "--locked-by", "third_party_consensus"]);

    expect(process.exitCode).toBeUndefined();
    expect(readCorpus().polls[0].locked!.by).toBe("third_party_consensus");
  });

  it("refuses an invalid --locked-by value", () => {
    main(["tr-2026-04-16", "--locked-by", "not_a_real_tier"]);
    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('"not_a_real_tier" is not one of'),
    );
  });

  it("finds a VERSIONED draft (.v2.json) when the bare filename doesn't exist", () => {
    writeDraft("tr-2026-04-16.v2.json", BASE_DRAFT);
    writeCorpus([], []);

    main(["tr-2026-04-16"]);

    expect(process.exitCode).toBeUndefined();
    expect(fs.existsSync(inboxFile("tr-2026-04-16.v2.json"))).toBe(false);
    expect(readCorpus().polls).toHaveLength(1);
  });

  // TEST-003: when both a bare draft and a newer .vN draft coexist (the
  // exact scenario .v2 versioning exists for — a re-fetch that changed
  // content, decision 7), the NEWER one must win rather than the bare
  // file winning simply because it happens to sort first.
  it("prefers the higher-versioned draft when a bare draft and a .v2 coexist", () => {
    writeDraft("tr-2026-04-16.json", {
      ...BASE_DRAFT,
      poll: { ...BASE_DRAFT.poll, respondents: 500 },
    });
    writeDraft("tr-2026-04-16.v2.json", {
      ...BASE_DRAFT,
      poll: { ...BASE_DRAFT.poll, respondents: 999 },
    });
    writeCorpus([], []);

    main(["tr-2026-04-16"]);

    expect(process.exitCode).toBeUndefined();
    expect(readCorpus().polls[0].respondents).toBe(999);
    // Both drafts are gone — the one used is deleted; the stale bare one
    // is orphaned only in the sense that this run never touches it again,
    // but nothing here asserts it survives (accept only ever deletes the
    // file it read).
    expect(fs.existsSync(inboxFile("tr-2026-04-16.v2.json"))).toBe(false);
  });

  it("refuses a provisional-id draft with a numeric pubId", () => {
    writeDraft("tr-pub-999.json", {
      ...BASE_DRAFT,
      poll: { ...BASE_DRAFT.poll, id: "tr-pub-999", fieldwork: undefined },
    });
    writeCorpus([], []);

    main(["tr-pub-999"]);

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("PROVISIONAL id"),
    );
  });

  // TEST-002: a --url/--archive capture mints a hex sha256Short pubId
  // (scripts/watch/fingerprint.ts), not a numeric one — the original
  // /-pub-\d+$/ regex missed almost every one of these.
  it("refuses a provisional-id draft with a hex pubId (a --url/--archive capture)", () => {
    writeDraft("ar-pub-a1b2c3d4e5f6a7b8.json", {
      ...BASE_DRAFT,
      poll: {
        ...BASE_DRAFT.poll,
        id: "ar-pub-a1b2c3d4e5f6a7b8",
        fieldwork: undefined,
      },
    });
    writeCorpus([], []);

    main(["ar-pub-a1b2c3d4e5f6a7b8"]);

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("PROVISIONAL id"),
    );
  });

  it("refuses when methodology is missing", () => {
    writeDraft("tr-2026-04-16.json", {
      ...BASE_DRAFT,
      poll: { ...BASE_DRAFT.poll, methodology: undefined },
    });
    writeCorpus([], []);

    main(["tr-2026-04-16"]);

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("methodology.bg/.en is missing"),
    );
  });

  it("refuses when methodology is present but one language is an empty string", () => {
    writeDraft("tr-2026-04-16.json", {
      ...BASE_DRAFT,
      poll: {
        ...BASE_DRAFT.poll,
        methodology: { bg: "Пряко интервю", en: "" },
      },
    });
    writeCorpus([], []);

    main(["tr-2026-04-16"]);

    expect(process.exitCode).toBe(1);
  });

  // FINDING-012: whitespace-only strings must not pass a bare truthiness
  // presence check.
  it("refuses when methodology.en is whitespace-only", () => {
    writeDraft("tr-2026-04-16.json", {
      ...BASE_DRAFT,
      poll: {
        ...BASE_DRAFT.poll,
        methodology: { bg: "Пряко интервю", en: "   " },
      },
    });
    writeCorpus([], []);

    main(["tr-2026-04-16"]);

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("methodology.bg/.en is missing"),
    );
  });

  it("refuses when source is whitespace-only", () => {
    writeDraft("tr-2026-04-16.json", {
      ...BASE_DRAFT,
      poll: { ...BASE_DRAFT.poll, source: "   " },
    });
    writeCorpus([], []);

    main(["tr-2026-04-16"]);

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("poll.source is missing or blank"),
    );
  });

  // FINDING-007: a draft is hand-edited, so a typo like a stringified
  // number must be caught rather than silently reaching the corpus.
  it("refuses when respondents is a string instead of a number", () => {
    writeDraft("tr-2026-04-16.json", {
      ...BASE_DRAFT,
      poll: { ...BASE_DRAFT.poll, respondents: "1004" as unknown as number },
    });
    writeCorpus([], []);

    main(["tr-2026-04-16"]);

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("poll.respondents must be a number or null"),
    );
  });

  it("refuses when a detail row's support is not a finite number", () => {
    writeDraft("tr-2026-04-16.json", {
      ...BASE_DRAFT,
      details: [
        { ...BASE_DRAFT.details[0], support: "19.1" as unknown as number },
      ],
    });
    writeCorpus([], []);

    main(["tr-2026-04-16"]);

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("details[0].support must be a finite number"),
    );
  });

  it("refuses a zero-share draft unless --allow-empty", () => {
    writeDraft("ar-2026-03-20.json", { ...BASE_DRAFT, details: [] });
    writeCorpus([], []);

    main(["ar-2026-03-20"]);
    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("zero accepted shares"),
    );

    process.exitCode = undefined;
    main(["ar-2026-03-20", "--allow-empty"]);
    expect(process.exitCode).toBeUndefined();
    expect(readCorpus().polls).toHaveLength(1);
  });

  it("refuses a locked existing poll without --replace", () => {
    writeDraft("tr-2026-04-16.json", BASE_DRAFT);
    writeCorpus(
      [
        {
          id: "tr-2026-04-16",
          agencyId: "TR",
          fieldwork: "Apr 13-16 2026",
          electionDate: null,
          respondents: 1004,
          methodology: { bg: "x", en: "x" },
          source: "https://old.example/",
          locked: {
            by: "agency_website",
            lockedAt: "2026-01-01",
            note: "manual",
          },
        },
      ],
      [],
    );

    main(["tr-2026-04-16"]);

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("already locked"),
    );
    // Untouched.
    expect(readCorpus().polls[0].source).toBe("https://old.example/");
  });

  // TEST-001: a poll protected ONLY by the legacy `genre` marker (no
  // `locked` field at all) must be refused the same way a locked poll is
  // — the corpus's own "either signal protects it" rule
  // (polls_corpus.test.ts).
  it("refuses a legacy genre-only-protected existing poll without --replace", () => {
    writeDraft("tr-2026-04-16.json", BASE_DRAFT);
    writeCorpus(
      [
        {
          id: "tr-2026-04-16",
          agencyId: "TR",
          fieldwork: "Apr 13-16 2026",
          electionDate: null,
          respondents: 1004,
          methodology: { bg: "x", en: "x" },
          source: "https://old.example/",
          genre: "raw_attitudes",
        },
      ],
      [],
    );

    main(["tr-2026-04-16"]);

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("protected by its legacy genre marker"),
    );
    // Untouched, and no misleading "replaced" claim was ever logged.
    expect(readCorpus().polls[0].source).toBe("https://old.example/");
  });

  it("--replace overwrites a legacy genre-only-protected poll and records supersedes", () => {
    writeDraft("tr-2026-04-16.json", BASE_DRAFT);
    const oldPoll = {
      id: "tr-2026-04-16",
      agencyId: "TR",
      fieldwork: "Apr 13-16 2026",
      electionDate: null,
      respondents: 999,
      methodology: { bg: "old", en: "old" },
      source: "https://old.example/",
      genre: "raw_attitudes" as const,
    };
    writeCorpus([oldPoll], []);

    main(["tr-2026-04-16", "--replace"]);

    expect(process.exitCode).toBeUndefined();
    const { polls } = readCorpus();
    expect(polls[0].locked!.supersedes!.poll.source).toBe(
      "https://old.example/",
    );
    expect(
      logSpy.mock.calls.some((c: unknown[]) =>
        String(c[0]).includes("replaced a legacy genre-protected entry"),
      ),
    ).toBe(true);
  });

  it("--replace overwrites a locked poll and records supersedes", () => {
    writeDraft("tr-2026-04-16.json", BASE_DRAFT);
    const oldPoll = {
      id: "tr-2026-04-16",
      agencyId: "TR",
      fieldwork: "Apr 13-16 2026",
      electionDate: null,
      respondents: 999,
      methodology: { bg: "old", en: "old" },
      source: "https://old.example/",
      locked: { by: "agency_pdf", lockedAt: "2026-01-01", note: "manual" },
    };
    const oldDetail = {
      pollId: "tr-2026-04-16",
      agencyId: "TR",
      support: 50,
      nickName_bg: "СТАРА",
      nickName_en: "",
    };
    writeCorpus([oldPoll], [oldDetail]);

    main(["tr-2026-04-16", "--replace"]);

    expect(process.exitCode).toBeUndefined();
    const { polls, details } = readCorpus();
    expect(polls).toHaveLength(1);
    expect(polls[0].source).toBe("https://rctrend.bg/project/x/");
    expect(polls[0].locked!.supersedes!.poll.source).toBe(
      "https://old.example/",
    );
    expect(polls[0].locked!.supersedes!.details).toEqual([oldDetail]);
    // The old detail row for this pollId is gone, replaced by the new one.
    expect(details).toEqual([
      {
        pollId: "tr-2026-04-16",
        agencyId: "TR",
        support: 19.1,
        nickName_bg: "ГЕРБ-СДС",
        nickName_en: "",
      },
    ]);
  });

  it("scopes supersedes.details to only the replaced poll's own rows, not the whole details file", () => {
    writeDraft("tr-2026-04-16.json", BASE_DRAFT);
    const oldPoll = {
      id: "tr-2026-04-16",
      agencyId: "TR",
      fieldwork: "Apr 13-16 2026",
      electionDate: null,
      respondents: 999,
      methodology: { bg: "old", en: "old" },
      source: "https://old.example/",
      locked: { by: "agency_pdf", lockedAt: "2026-01-01", note: "manual" },
    };
    const oldDetailForThisPoll = {
      pollId: "tr-2026-04-16",
      agencyId: "TR",
      support: 50,
      nickName_bg: "СТАРА",
      nickName_en: "",
    };
    const unrelatedDetail = {
      pollId: "ar-2020-01-01",
      agencyId: "AR",
      support: 12,
      nickName_bg: "ДРУГА",
      nickName_en: "",
    };
    writeCorpus([oldPoll], [oldDetailForThisPoll, unrelatedDetail]);

    main(["tr-2026-04-16", "--replace"]);

    const { polls } = readCorpus();
    expect(polls[0].locked!.supersedes!.details).toEqual([
      oldDetailForThisPoll,
    ]);
  });

  it("--genre and --election override the draft's own values", () => {
    writeDraft("tr-2026-04-16.json", BASE_DRAFT);
    writeCorpus([], []);

    main(["tr-2026-04-16", "--genre", "forecast", "--election", "2026-11-08"]);

    const { polls } = readCorpus();
    expect(polls[0].genre).toBe("forecast");
    expect(polls[0].electionDate).toBe("2026-11-08");
  });

  it("refuses an invalid --genre value", () => {
    main(["tr-2026-04-16", "--genre", "not_a_real_genre"]);
    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('"not_a_real_genre" is not one of'),
    );
  });

  // TEST-005: --election is never validated, unlike --genre — a malformed
  // value would otherwise write straight into Poll.electionDate.
  it("refuses a malformed --election value", () => {
    main(["tr-2026-04-16", "--election", "not-a-date"]);
    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("must be an ISO date"),
    );
  });

  it("refuses an empty --election value", () => {
    writeDraft("tr-2026-04-16.json", BASE_DRAFT);
    writeCorpus([], []);
    main(["tr-2026-04-16", "--election", ""]);
    // An empty string after `--election` is swallowed by parseArgv's own
    // "!v.startsWith('--')" check only when it looks like a flag; an
    // explicit empty positional still reaches validation as "" and must
    // be refused rather than silently passing through.
    expect(process.exitCode).toBe(1);
  });

  // TEST-004: the polls:analyze reminder is conditional on electionDate
  // actually being set, both ways.
  it("prints the polls:analyze reminder only when electionDate is set", () => {
    writeDraft("tr-2026-04-16.json", BASE_DRAFT); // electionDate: null
    writeCorpus([], []);

    main(["tr-2026-04-16"]);

    expect(process.exitCode).toBeUndefined();
    expect(
      logSpy.mock.calls.some((c: unknown[]) =>
        String(c[0]).includes("polls:analyze"),
      ),
    ).toBe(false);
  });

  it("prints the polls:analyze reminder when electionDate is set via --election", () => {
    writeDraft("tr-2026-04-16.json", BASE_DRAFT);
    writeCorpus([], []);

    main(["tr-2026-04-16", "--election", "2026-11-08"]);

    expect(
      logSpy.mock.calls.some((c: unknown[]) =>
        String(c[0]).includes("polls:analyze"),
      ),
    ).toBe(true);
  });

  it("prints a usage error when no pollId is given", () => {
    main([]);
    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("usage:"));
  });

  it("errors clearly when no draft exists for the given pollId", () => {
    main(["nonexistent-poll"]);
    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("no inbox draft found"),
    );
  });

  // TEST-006: an orphaned polls_details.json row (no matching polls.json
  // entry, unrelated to the poll being accepted) must be surfaced with a
  // diagnostic rather than silently carried forward with nothing said.
  it("warns about an orphaned polls_details.json row with no matching poll", () => {
    writeDraft("tr-2026-04-16.json", BASE_DRAFT);
    writeCorpus(
      [],
      [
        {
          pollId: "gm-2020-01-01",
          agencyId: "GM",
          support: 10,
          nickName_bg: "ГЕРБ",
          nickName_en: "",
        },
      ],
    );

    main(["tr-2026-04-16"]);

    expect(process.exitCode).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("gm-2020-01-01"),
    );
    // The orphaned row is left alone, not deleted or otherwise touched.
    const { details } = readCorpus();
    expect(details.some((d: PollDetail) => d.pollId === "gm-2020-01-01")).toBe(
      true,
    );
  });
});

describe("main — presidential drafts (Tier 4, decision 10's separate file family)", () => {
  let scratchRoot: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  const inboxFile = (name: string) =>
    path.join(scratchRoot, "data/polls/_inbox", name);
  const writeDraft = (name: string, draft: InboxDraft) => {
    fs.mkdirSync(path.join(scratchRoot, "data/polls/_inbox"), {
      recursive: true,
    });
    fs.writeFileSync(inboxFile(name), JSON.stringify(draft, null, 2));
  };

  const presPollsFile = () =>
    path.join(scratchRoot, "data/polls/presidential/polls.json");
  const presDetailsFile = () =>
    path.join(scratchRoot, "data/polls/presidential/polls_details.json");
  const presRunoffsFile = () =>
    path.join(scratchRoot, "data/polls/presidential/runoffs.json");
  const writePresCorpus = (
    polls: unknown[],
    details: unknown[],
    runoffs: unknown[] = [],
  ) => {
    fs.mkdirSync(path.join(scratchRoot, "data/polls/presidential"), {
      recursive: true,
    });
    fs.writeFileSync(presPollsFile(), JSON.stringify(polls));
    fs.writeFileSync(presDetailsFile(), JSON.stringify(details));
    fs.writeFileSync(presRunoffsFile(), JSON.stringify(runoffs));
  };
  const readPresCorpus = (): {
    polls: Poll[];
    details: PresidentialPollDetail[];
    runoffs: Runoff[];
  } => ({
    polls: JSON.parse(fs.readFileSync(presPollsFile(), "utf8")),
    details: JSON.parse(fs.readFileSync(presDetailsFile(), "utf8")),
    runoffs: JSON.parse(fs.readFileSync(presRunoffsFile(), "utf8")),
  });
  // The plain (non-presidential) corpus, to prove the two families never
  // cross-write each other's files.
  const parliamentaryPollsFile = () =>
    path.join(scratchRoot, "data/polls/polls.json");
  const parliamentaryDetailsFile = () =>
    path.join(scratchRoot, "data/polls/polls_details.json");

  const BASE_PRESIDENTIAL_DRAFT: PresidentialInboxDraft = {
    race: "presidential",
    poll: {
      id: "gm-2026-07-11",
      agencyId: "GM",
      source: "https://globalmetrics.eu/x/",
      electionDate: "2026-11-08",
      cycle: null,
      respondents: 1503,
      genre: "raw_attitudes",
      fieldwork: "Jun 23 - Jul 11 2026",
      methodology: { bg: "Пряко интервю", en: "Direct interview" },
      provenance: {
        url: "https://globalmetrics.eu/x/",
        fetchedAt: "2026-09-09T00:00:00.000Z",
        sha256: "b".repeat(64),
        extractor: "GM",
        fieldworkStart: "2026-06-23",
        fieldworkEnd: "2026-07-11",
        basePhrase: "сред заявилите, че ще гласуват",
        quotes: { "share:Прогресивна България": "Кандидат на ПрБ 39.7%" },
      },
    },
    details: [
      {
        pollId: "gm-2026-07-11",
        agencyId: "GM",
        candidateKey: "placeholder:прб",
        candidateName_bg: "Прогресивна България",
        candidateName_en: "",
        nominator: null,
        placeholderFor: "ПрБ",
        support: 39.7,
      },
    ],
    runoffs: [],
    residual: null,
    genre: "raw_attitudes",
    extractor: "GM",
    evidence: { "share:Прогресивна България": "Кандидат на ПрБ 39.7%" },
    refused: [],
  };

  beforeEach(() => {
    scratchRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "polls-accept-pres-test-"),
    );
    __setAcceptRootForTests(scratchRoot);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    __setAcceptRootForTests();
    fs.rmSync(scratchRoot, { recursive: true, force: true });
    logSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
    process.exitCode = undefined;
  });

  it("creates data/polls/presidential/ itself on the true first-ever presidential accept (no pre-existing directory, no pre-existing files)", () => {
    // Deliberately does NOT call writePresCorpus — every other test in this
    // block does, which pre-creates the directory as a side effect and so
    // never exercises a fresh clone's actual first run. Confirmed absent
    // before main() runs, so a regression back to a bare `writeFileSync`
    // (no `mkdirSync`) fails with ENOENT here rather than passing by
    // accident.
    writeDraft("gm-2026-07-11.json", BASE_PRESIDENTIAL_DRAFT);
    expect(
      fs.existsSync(path.join(scratchRoot, "data/polls/presidential")),
    ).toBe(false);

    main(["gm-2026-07-11"]);

    expect(process.exitCode).toBeUndefined();
    const { polls, details, runoffs } = readPresCorpus();
    expect(polls).toHaveLength(1);
    expect(details).toHaveLength(1);
    expect(runoffs).toEqual([]);
  });

  it("accepts a valid presidential draft: writes the presidential corpus, never the parliamentary one", () => {
    writeDraft("gm-2026-07-11.json", BASE_PRESIDENTIAL_DRAFT);
    writePresCorpus([], []);

    main(["gm-2026-07-11"]);

    expect(process.exitCode).toBeUndefined();
    const { polls, details, runoffs } = readPresCorpus();
    expect(polls).toHaveLength(1);
    expect(polls[0].race).toBe("presidential");
    expect(polls[0].cycle).toBeNull();
    expect(details).toHaveLength(1);
    expect(details[0].candidateKey).toBe("placeholder:прб");
    expect(runoffs).toEqual([]);
    expect(fs.existsSync(inboxFile("gm-2026-07-11.json"))).toBe(false);
    // Never touched the parliamentary files at all.
    expect(fs.existsSync(parliamentaryPollsFile())).toBe(false);
    expect(fs.existsSync(parliamentaryDetailsFile())).toBe(false);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("candidate/placeholder row(s)"),
    );
  });

  it("carries a runoff pairing through to runoffs.json, keyed on pollId", () => {
    writeDraft("gm-2026-07-11.json", {
      ...BASE_PRESIDENTIAL_DRAFT,
      runoffs: [
        {
          pollId: "gm-2026-07-11",
          agencyId: "GM",
          a: "provisional:ivan-ivanov",
          b: "provisional:petar-petrov",
          supportA: 55,
          supportB: 45,
          residual: null,
        },
      ],
    });
    writePresCorpus([], []);

    main(["gm-2026-07-11"]);

    expect(process.exitCode).toBeUndefined();
    const { runoffs } = readPresCorpus();
    expect(runoffs).toHaveLength(1);
    expect(runoffs[0].a).toBe("provisional:ivan-ivanov");
  });

  it("--cycle stamps the round-1 folder id; the draft's own null cycle is the default", () => {
    writeDraft("gm-2026-07-11.json", BASE_PRESIDENTIAL_DRAFT);
    writePresCorpus([], []);

    main(["gm-2026-07-11", "--cycle", "2026_11_08_pvr"]);

    expect(readPresCorpus().polls[0].cycle).toBe("2026_11_08_pvr");
  });

  it("refuses a malformed --cycle value", () => {
    writeDraft("gm-2026-07-11.json", BASE_PRESIDENTIAL_DRAFT);
    writePresCorpus([], []);

    main(["gm-2026-07-11", "--cycle", "not-a-cycle"]);

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("round-1 folder id"),
    );
  });

  it("refuses --cycle on a parliamentary draft", () => {
    writeDraft("tr-2026-04-16.json", {
      race: "parliamentary",
      poll: BASE_PRESIDENTIAL_DRAFT.poll,
      details: [],
      residual: null,
      genre: "raw_attitudes",
      extractor: "TR",
      evidence: {},
      refused: [],
    });
    fs.mkdirSync(path.join(scratchRoot, "data/polls"), { recursive: true });
    fs.writeFileSync(parliamentaryPollsFile(), "[]");
    fs.writeFileSync(parliamentaryDetailsFile(), "[]");

    main(["tr-2026-04-16", "--cycle", "2026_11_08_pvr", "--allow-empty"]);

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("--cycle is presidential-only"),
    );
  });

  it("refuses a zero-row presidential draft unless --allow-empty", () => {
    writeDraft("gm-2026-07-11.json", {
      ...BASE_PRESIDENTIAL_DRAFT,
      details: [],
    });
    writePresCorpus([], []);

    main(["gm-2026-07-11"]);

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("nothing to publish"),
    );
  });

  it("refuses a presidential draft with a blank candidateName_bg", () => {
    writeDraft("gm-2026-07-11.json", {
      ...BASE_PRESIDENTIAL_DRAFT,
      details: [
        { ...BASE_PRESIDENTIAL_DRAFT.details[0], candidateName_bg: "" },
      ],
    });
    writePresCorpus([], []);

    main(["gm-2026-07-11"]);

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("candidateName_bg is missing or blank"),
    );
  });

  it("refuses a presidential draft with a non-finite runoff supportA", () => {
    writeDraft("gm-2026-07-11.json", {
      ...BASE_PRESIDENTIAL_DRAFT,
      runoffs: [
        {
          pollId: "gm-2026-07-11",
          agencyId: "GM",
          a: "a",
          b: "b",
          supportA: Number.NaN,
          supportB: 45,
          residual: null,
        },
      ],
    });
    writePresCorpus([], []);

    main(["gm-2026-07-11"]);

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("runoffs[0].supportA must be a finite number"),
    );
  });

  it("--replace overwrites a locked presidential poll and records supersedes, keyed by pollId across all three files", () => {
    writeDraft("gm-2026-07-11.json", BASE_PRESIDENTIAL_DRAFT);
    const oldPoll = {
      id: "gm-2026-07-11",
      agencyId: "GM",
      fieldwork: "old fieldwork",
      electionDate: "2026-11-08",
      cycle: null,
      respondents: 1000,
      methodology: { bg: "old", en: "old" },
      source: "https://old.example/",
      race: "presidential",
      locked: { by: "agency_pdf", lockedAt: "2026-01-01", note: "manual" },
    };
    const oldDetail = {
      pollId: "gm-2026-07-11",
      agencyId: "GM",
      candidateKey: "placeholder:old",
      candidateName_bg: "СТАРА ПАРТИЯ",
      candidateName_en: "",
      nominator: null,
      placeholderFor: "СТАРА",
      support: 10,
    };
    const oldRunoff = {
      pollId: "gm-2026-07-11",
      agencyId: "GM",
      a: "a",
      b: "b",
      supportA: 60,
      supportB: 40,
      residual: null,
    };
    writePresCorpus([oldPoll], [oldDetail], [oldRunoff]);

    main(["gm-2026-07-11", "--replace"]);

    expect(process.exitCode).toBeUndefined();
    const { polls, details, runoffs } = readPresCorpus();
    expect(polls).toHaveLength(1);
    expect(polls[0].source).toBe("https://globalmetrics.eu/x/");
    expect(polls[0].locked!.supersedes!.poll.source).toBe(
      "https://old.example/",
    );
    expect(polls[0].locked!.supersedes!.details).toEqual([oldDetail]);
    expect(details).toEqual(BASE_PRESIDENTIAL_DRAFT.details);
    // The old runoff for this pollId is gone, replaced by the new draft's
    // own (empty) runoff set.
    expect(runoffs).toEqual([]);
  });

  it("scopes supersedes.details to only the replaced presidential poll's own rows", () => {
    writeDraft("gm-2026-07-11.json", BASE_PRESIDENTIAL_DRAFT);
    const oldPoll = {
      id: "gm-2026-07-11",
      agencyId: "GM",
      fieldwork: "old fieldwork",
      electionDate: "2026-11-08",
      cycle: null,
      respondents: 1000,
      methodology: { bg: "old", en: "old" },
      source: "https://old.example/",
      race: "presidential",
      locked: { by: "agency_pdf", lockedAt: "2026-01-01", note: "manual" },
    };
    const oldDetailForThisPoll = {
      pollId: "gm-2026-07-11",
      agencyId: "GM",
      candidateKey: "placeholder:old",
      candidateName_bg: "СТАРА ПАРТИЯ",
      candidateName_en: "",
      nominator: null,
      placeholderFor: "СТАРА",
      support: 10,
    };
    const unrelatedDetail = {
      pollId: "sh-2020-01-01",
      agencyId: "SH",
      candidateKey: "provisional:x-y",
      candidateName_bg: "Х",
      candidateName_en: "",
      nominator: null,
      placeholderFor: null,
      support: 5,
    };
    writePresCorpus([oldPoll], [oldDetailForThisPoll, unrelatedDetail]);

    main(["gm-2026-07-11", "--replace"]);

    const { polls } = readPresCorpus();
    expect(polls[0].locked!.supersedes!.details).toEqual([
      oldDetailForThisPoll,
    ]);
  });

  it("writes all three presidential corpus files minified, no trailing newline", () => {
    writeDraft("gm-2026-07-11.json", BASE_PRESIDENTIAL_DRAFT);
    writePresCorpus([], []);

    main(["gm-2026-07-11"]);

    for (const f of [presPollsFile(), presDetailsFile(), presRunoffsFile()]) {
      expect(fs.readFileSync(f, "utf8").includes("\n")).toBe(false);
    }
  });

  it("refuses a locked existing presidential poll without --replace", () => {
    writeDraft("gm-2026-07-11.json", BASE_PRESIDENTIAL_DRAFT);
    writePresCorpus(
      [
        {
          id: "gm-2026-07-11",
          agencyId: "GM",
          fieldwork: "old",
          electionDate: null,
          respondents: null,
          methodology: { bg: "old", en: "old" },
          source: "https://old.example/",
          locked: { by: "agency_pdf", lockedAt: "2026-01-01" },
        },
      ],
      [],
    );

    main(["gm-2026-07-11"]);

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("pass --replace to overwrite it"),
    );
  });

  it("warns about an orphaned presidential polls_details.json row with no matching poll", () => {
    writeDraft("gm-2026-07-11.json", BASE_PRESIDENTIAL_DRAFT);
    writePresCorpus(
      [],
      [
        {
          pollId: "sh-2020-01-01",
          agencyId: "SH",
          candidateKey: "provisional:x-y",
          candidateName_bg: "Х",
          candidateName_en: "",
          nominator: null,
          placeholderFor: null,
          support: 10,
        },
      ],
    );

    main(["gm-2026-07-11"]);

    expect(process.exitCode).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("sh-2020-01-01"),
    );
  });

  it("refuses a provisional-id presidential draft the same way as a parliamentary one", () => {
    writeDraft("gm-pub-658.json", {
      ...BASE_PRESIDENTIAL_DRAFT,
      poll: { ...BASE_PRESIDENTIAL_DRAFT.poll, id: "gm-pub-658" },
    });
    writePresCorpus([], []);

    main(["gm-pub-658"]);

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("PROVISIONAL id"),
    );
  });
});
