// Unit tests for crosscheck.ts. `readWikiRows`'s parsing was validated
// against the REAL live bg.wikipedia.org parliamentary page via a
// disposable scratch script before this file was written (0 unknown
// agencies, correct rows, a genuine renormalization disagreement caught
// against the real corpus) — these tests use a minimal synthetic page so
// they run deterministically with no network.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../watch/fingerprint", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../watch/fingerprint")>()),
  fetchText: vi.fn(),
}));

import { fetchText } from "../watch/fingerprint";
import {
  __setCrosscheckRootForTests,
  diffAgainstCorpus,
  main,
  parseArgv,
  readWikiRows,
  type WikiRow,
} from "./crosscheck";
import type { Poll, PollDetail } from "../../src/data/polls/pollsTypes";

const mockedFetchText = vi.mocked(fetchText);

beforeEach(() => {
  mockedFetchText.mockReset();
});

// Four party columns — `readWikiRows` only accepts a wikitable with >= 4
// party columns as THE polling table (the real page carries a second,
// unrelated `wikitable sortable` for party info-boxes; that threshold is
// what tells them apart), so a synthetic fixture needs at least that many
// to exercise the real parsing path rather than falling through to "no
// polling table found".
const WIKI_PAGE = (rows: string): string => `<html><body>
<table class="wikitable sortable">
<tbody>
<tr><th>Социологическа агенция</th><th>Период на проучването</th><th>Извадка</th><th>Прогресивна България</th><th>ГЕРБ – СДС</th><th>ПП – ДБ</th><th>Възраждане</th><th>Други</th></tr>
<tr><td>Централна избирателна комисия</td><td>19 април 2026</td><td>3 228 962</td><td><b>44,6</b><br><small>131</small></td><td>13,4</td><td>12,6</td><td>7,5</td><td>—</td></tr>
${rows}
</tbody>
</table>
<ol class="references">
  <li id="cite_note-1"><span class="mw-reference-text"><a class="external" href="https://example.test/article-1">ref</a></span></li>
  <li id="cite_note-2"><span class="mw-reference-text"><a class="external" href="https://example.test/article-2">ref</a></span></li>
</ol>
</body></html>`;

const ROW_ML = `<tr><td>Market Links<sup class="reference"><a href="#cite_note-1">[1]</a></sup></td><td>7 – 14 април 2026</td><td>1 003</td><td>38,0</td><td>19,8</td><td>13,1</td><td>5,6</td></tr>`;
const ROW_UNKNOWN = `<tr><td>Некой Изследвания<sup class="reference"><a href="#cite_note-2">[2]</a></sup></td><td>1 – 5 март 2026</td><td>500</td><td>30,0</td><td>20,0</td><td>10,0</td><td>5,0</td></tr>`;
const FILLER_ROW = `<tr><td colspan="8">Закриване на предизборната кампания</td></tr>`;

describe("parseArgv", () => {
  it("defaults race to parliamentary and cycle to the wiki_polls constant", () => {
    const opts = parseArgv([]);
    expect(opts.race).toBe("parliamentary");
    expect(opts.cycle).toContain("bg.wikipedia.org");
  });

  it("reads --race and --cycle overrides", () => {
    expect(
      parseArgv(["--race", "presidential", "--cycle", "https://x.test/"]),
    ).toEqual({ race: "presidential", cycle: "https://x.test/" });
  });
});

describe("readWikiRows", () => {
  it("parses a real-shaped row, skips the CEC row and filler rows, resolves the cite-note URL", async () => {
    mockedFetchText.mockResolvedValue(WIKI_PAGE(`${ROW_ML}\n${FILLER_ROW}`));

    const { rows, unknownAgencies } = await readWikiRows("https://x.test/");

    expect(unknownAgencies.size).toBe(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      agencyId: "ML",
      fieldworkEnd: "2026-04-14",
      sample: 1003,
      source: "https://example.test/article-1",
    });
    expect(rows[0].parties).toEqual([
      { nickBg: "Прогресивна България", pct: 38 },
      { nickBg: "ГЕРБ – СДС", pct: 19.8 },
      { nickBg: "ПП – ДБ", pct: 13.1 },
      { nickBg: "Възраждане", pct: 5.6 },
    ]);
  });

  it("collects an unrecognized agency name rather than dropping the row silently", async () => {
    mockedFetchText.mockResolvedValue(WIKI_PAGE(ROW_UNKNOWN));

    const { rows, unknownAgencies } = await readWikiRows("https://x.test/");

    expect(rows).toHaveLength(0);
    expect(unknownAgencies).toEqual(new Set(["Некой Изследвания"]));
  });

  it("dedupes two rows for the same (agency, fieldwork end) — first one wins", async () => {
    mockedFetchText.mockResolvedValue(WIKI_PAGE(`${ROW_ML}\n${ROW_ML}`));

    const { rows } = await readWikiRows("https://x.test/");

    expect(rows).toHaveLength(1);
  });

  it("throws when no polling table can be found (page restructured)", async () => {
    mockedFetchText.mockResolvedValue("<html><body>nothing here</body></html>");

    await expect(readWikiRows("https://x.test/")).rejects.toThrow(
      /no polling table found/,
    );
  });

  it("throws on an empty response", async () => {
    // The real `fetchText(url)` (no `allow404`) can only resolve to a
    // falsy value in production as an actual empty-string 200 body, never
    // `null` — its `null` return is reserved for a 404 with `allow404`
    // set, which this call never passes. "" is the reachable case.
    mockedFetchText.mockResolvedValue("");

    await expect(readWikiRows("https://x.test/")).rejects.toThrow(
      /empty response/,
    );
  });

  it("skips a row whose first cell spans multiple columns even with >= 4 cells total", async () => {
    // Distinct from FILLER_ROW (a single <td colspan> — caught by the
    // `cells.length < 4` guard before the colspan check even runs): this
    // fixture has 4 real cells, so it specifically exercises the OTHER
    // guard, `firstColspan > 1`.
    const rowMergedFirstCell = `<tr><td colspan="2">поредни избори</td><td>500</td><td>10,0</td><td>5,0</td></tr>`;
    mockedFetchText.mockResolvedValue(WIKI_PAGE(rowMergedFirstCell));

    const { rows } = await readWikiRows("https://x.test/");

    expect(rows).toHaveLength(0);
  });

  it("reports sample: null when the page has no sample/size column at all", async () => {
    const pageNoSampleColumn = `<html><body>
<table class="wikitable sortable">
<tbody>
<tr><th>Социологическа агенция</th><th>Период на проучването</th><th>Прогресивна България</th><th>ГЕРБ – СДС</th><th>ПП – ДБ</th><th>Възраждане</th></tr>
<tr><td>Market Links</td><td>7 – 14 април 2026</td><td>38,0</td><td>19,8</td><td>13,1</td><td>5,6</td></tr>
</tbody>
</table>
</body></html>`;
    mockedFetchText.mockResolvedValue(pageNoSampleColumn);

    const { rows } = await readWikiRows("https://x.test/");

    expect(rows).toHaveLength(1);
    expect(rows[0].sample).toBeNull();
  });

  it("falls back to a direct external link when no cite-note is present", async () => {
    const rowDirectLink = `<tr><td><a class="external" href="https://marketlinks.bg/report">Market Links</a></td><td>7 – 14 април 2026</td><td>1 003</td><td>38,0</td><td>19,8</td><td>13,1</td><td>5,6</td></tr>`;
    mockedFetchText.mockResolvedValue(WIKI_PAGE(rowDirectLink));

    const { rows } = await readWikiRows("https://x.test/");

    expect(rows[0].source).toBe("https://marketlinks.bg/report");
  });
});

describe("diffAgainstCorpus", () => {
  const wikiRow = (over: Partial<WikiRow> = {}): WikiRow => ({
    agencyId: "ML",
    agencyText: "Market Links",
    fieldworkEnd: "2026-04-14",
    fieldworkText: "Apr 7-14 2026",
    sample: 1000,
    source: "https://example.test/",
    parties: [{ nickBg: "ГЕРБ – СДС", pct: 20 }],
    ...over,
  });

  const corpusEntry = (
    over: Partial<Poll> = {},
    details: PollDetail[] = [
      {
        pollId: "ml-2026-04-14",
        agencyId: "ML",
        support: 20,
        nickName_bg: "ГЕРБ-СДС",
        nickName_en: "GERB-SDS",
      },
    ],
  ) => ({
    poll: {
      id: "ml-2026-04-14",
      agencyId: "ML",
      fieldwork: "Apr 7-14 2026",
      electionDate: null,
      respondents: 1000,
      methodology: { bg: "x", en: "x" },
      source: "https://old.example/",
      ...over,
    } as Poll,
    details,
  });

  it("reports no findings when wiki and corpus agree exactly", () => {
    const corpus = new Map([["ML|2026-04-14", corpusEntry()]]);
    const report = diffAgainstCorpus([wikiRow()], corpus);

    expect(report.missingHere).toEqual([]);
    expect(report.missingThere).toEqual([]);
    expect(report.disagreements).toEqual([]);
  });

  it("matches labels across dash-spelling variants (normKey folding)", () => {
    // Wiki spells it "ГЕРБ – СДС" (en dash + spaces), the corpus stores
    // "ГЕРБ-СДС" (bare hyphen) — these must fold to the same key.
    const corpus = new Map([["ML|2026-04-14", corpusEntry()]]);
    const report = diffAgainstCorpus(
      [wikiRow({ parties: [{ nickBg: "ГЕРБ – СДС", pct: 20 }] })],
      corpus,
    );
    expect(report.disagreements).toEqual([]);
  });

  it("flags a label mismatch strictly greater than the 0.5pp tolerance, not at the boundary", () => {
    const corpus = new Map([["ML|2026-04-14", corpusEntry()]]);

    // Exactly 0.5pp — must NOT be flagged ("> 0.5 pp", not ">=").
    const atBoundary = diffAgainstCorpus(
      [wikiRow({ parties: [{ nickBg: "ГЕРБ – СДС", pct: 20.5 }] })],
      corpus,
    );
    expect(atBoundary.disagreements).toEqual([]);

    // Just past it — must be flagged.
    const overBoundary = diffAgainstCorpus(
      [wikiRow({ parties: [{ nickBg: "ГЕРБ – СДС", pct: 20.6 }] })],
      corpus,
    );
    expect(overBoundary.disagreements).toHaveLength(1);
    expect(overBoundary.disagreements[0].labelMismatches).toEqual([
      { label: "ГЕРБ-СДС", wiki: 20.6, corpus: 20, delta: 0.6 },
    ]);
  });

  it("flags a sample-size mismatch", () => {
    const corpus = new Map([["ML|2026-04-14", corpusEntry()]]);
    const report = diffAgainstCorpus([wikiRow({ sample: 1008 })], corpus);

    expect(report.disagreements).toEqual([
      {
        pollId: "ml-2026-04-14",
        agencyId: "ML",
        fieldworkEnd: "2026-04-14",
        sampleMismatch: { wiki: 1008, corpus: 1000 },
        labelMismatches: [],
      },
    ]);
  });

  it("reports a label with no corpus counterpart as an extra label, not a disagreement", () => {
    const corpus = new Map([["ML|2026-04-14", corpusEntry()]]);
    const report = diffAgainstCorpus(
      [
        wikiRow({
          parties: [
            { nickBg: "ГЕРБ – СДС", pct: 20 },
            { nickBg: "Величие", pct: 3 }, // no corpus detail row for this
          ],
        }),
      ],
      corpus,
    );
    expect(report.disagreements).toEqual([]);
    // Not silently dropped either — surfaced so an operator can still see
    // it, since the poll itself matched (so it can't be "missing here").
    expect(report.extraLabels).toEqual([
      {
        pollId: "ml-2026-04-14",
        agencyId: "ML",
        fieldworkEnd: "2026-04-14",
        label: "Величие",
        pct: 3,
      },
    ]);
  });

  it("classifies several rows independently in one pass", () => {
    const corpus = new Map([
      ["ML|2026-04-14", corpusEntry()],
      [
        "AR|2026-03-01",
        corpusEntry({ id: "ar-2026-03-01", agencyId: "AR" }, [
          {
            pollId: "ar-2026-03-01",
            agencyId: "AR",
            support: 15,
            nickName_bg: "ГЕРБ-СДС",
            nickName_en: "GERB-SDS",
          },
        ]),
      ],
    ]);
    const report = diffAgainstCorpus(
      [
        wikiRow(), // agrees with the ML entry
        wikiRow({
          agencyId: "AR",
          fieldworkEnd: "2026-03-01",
          parties: [{ nickBg: "ГЕРБ – СДС", pct: 20 }], // disagrees (15 vs 20)
        }),
        wikiRow({ agencyId: "SH", fieldworkEnd: "2026-05-01" }), // missing here
      ],
      corpus,
    );
    expect(report.missingHere).toHaveLength(1);
    expect(report.missingHere[0].agencyId).toBe("SH");
    expect(report.disagreements).toHaveLength(1);
    expect(report.disagreements[0].agencyId).toBe("AR");
    expect(report.missingThere).toEqual([]);
  });

  it("reports a wiki row with no corpus counterpart as missing here", () => {
    const report = diffAgainstCorpus([wikiRow()], new Map());

    expect(report.missingHere).toEqual([
      {
        agencyId: "ML",
        fieldworkEnd: "2026-04-14",
        fieldworkText: "Apr 7-14 2026",
        sample: 1000,
        source: "https://example.test/",
      },
    ]);
    expect(report.missingThere).toEqual([]);
  });

  it("reports a corpus poll with no wiki counterpart as missing there (informational)", () => {
    const corpus = new Map([["ML|2026-04-14", corpusEntry()]]);
    const report = diffAgainstCorpus([], corpus);

    expect(report.missingHere).toEqual([]);
    expect(report.missingThere).toEqual([
      { pollId: "ml-2026-04-14", agencyId: "ML", fieldworkEnd: "2026-04-14" },
    ]);
  });
});

describe("main", () => {
  let scratchRoot: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    scratchRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "polls-crosscheck-test-"),
    );
    __setCrosscheckRootForTests(scratchRoot);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    __setCrosscheckRootForTests();
    fs.rmSync(scratchRoot, { recursive: true, force: true });
    logSpy.mockRestore();
    errorSpy.mockRestore();
    process.exitCode = undefined;
  });

  const writeCorpus = (polls: unknown[], details: unknown[] = []) => {
    fs.mkdirSync(path.join(scratchRoot, "data/polls"), { recursive: true });
    fs.writeFileSync(
      path.join(scratchRoot, "data/polls/polls.json"),
      JSON.stringify(polls),
    );
    fs.writeFileSync(
      path.join(scratchRoot, "data/polls/polls_details.json"),
      JSON.stringify(details),
    );
  };

  it("refuses --race presidential — not supported yet", async () => {
    await main(["--race", "presidential"]);
    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("polls:crosscheck only supports parliamentary"),
    );
    expect(mockedFetchText).not.toHaveBeenCalled();
  });

  it("runs end to end and prints the three-section report with exit 0", async () => {
    mockedFetchText.mockResolvedValue(WIKI_PAGE(ROW_ML));
    writeCorpus([]);

    await main([]);

    expect(process.exitCode).toBeUndefined();
    const printed = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    expect(printed).toContain("missing here");
    expect(printed).toContain("missing there");
    expect(printed).toContain("disagreements");
    expect(printed).toContain(
      "1 missing here, 0 missing there, 0 disagreement(s), 0 extra label(s)",
    );
  });

  it("never surfaces a presidential corpus poll as missing there", async () => {
    mockedFetchText.mockResolvedValue(WIKI_PAGE(""));
    // No data rows beyond the always-skipped CEC row — the table is still
    // correctly SELECTED (its header shape matches), it simply yields
    // zero polling rows this run, which is a legitimate (if unlikely on
    // the real page) outcome, not a "wrong table" signal.
    writeCorpus([
      {
        id: "gm-2026-07-28",
        agencyId: "GM",
        race: "presidential",
        fieldwork: "through Jul 28 2026",
        electionDate: "2026-11-08",
        respondents: 1503,
        methodology: { bg: "x", en: "x" },
        source: "https://globalmetrics.eu/",
      },
    ]);

    await main([]);

    expect(process.exitCode).toBeUndefined();
    const printed = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    expect(printed).toContain(
      "0 missing here, 0 missing there, 0 disagreement(s), 0 extra label(s)",
    );
  });
});
