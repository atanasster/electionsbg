import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Poll } from "../../src/data/polls/pollsTypes";
import { myaraDraft, myaraReading, SHA } from "./lib/ai_reading.fixtures";
import type { AiReading } from "./lib/ai_reading";
import type { InboxDraft } from "./lib/draft";
import { readPublicationLedger, recordCapture } from "./lib/publication_ledger";
import {
  __setReviewRootForTests,
  groundFills,
  main,
  readingPathFor,
} from "./review";

const ARTICLE = `<html><body><article><p>Ако президентските избори бяха в
началото на октомври, за Илияна Йотова и Кирил Вълчев биха гласували 46,9%, за
Андрей Гюров и Георги Кандев – 25,3%. 2,3% биха избрали „Не подкрепям никого“.
Данните са от независимо изследване на „Мяра“, проведено чрез пряко лично
интервю и онлайн анкета между 26 септември и 4 октомври сред 1000 пълнолетни
българи.</p></article></body></html>`;

describe("polls:review", () => {
  let root: string;
  const draftPath = () =>
    path.join(root, "data/polls/_inbox/my-2026-10-04-presidential.json");
  const readDraftFile = (): InboxDraft =>
    JSON.parse(fs.readFileSync(draftPath(), "utf8"));
  const corpus = (): Poll[] =>
    JSON.parse(
      fs.readFileSync(
        path.join(root, "data/polls/presidential/polls.json"),
        "utf8",
      ),
    );
  const writeReading = (reading: AiReading) => {
    const file = readingPathFor("MY", "1918", SHA);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(reading));
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "polls-review-"));
    __setReviewRootForTests(root);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const capture = path.join(root, "raw_data/polls/myara/1918");
    fs.mkdirSync(capture, { recursive: true });
    fs.writeFileSync(path.join(capture, "page.html"), ARTICLE);
    recordCapture(
      root,
      "MY",
      {
        pubId: "1918",
        url: "https://myara.bg/x-1918/",
        title: null,
        publishedAt: null,
      },
      {
        sha256: SHA,
        capturePath: "raw_data/polls/myara/1918",
        capturedAt: "2026-10-05T16:41:05.770Z",
        attachmentFailures: [],
      },
    );
    for (const f of ["polls.json", "polls_details.json", "runoffs.json"]) {
      fs.mkdirSync(path.join(root, "data/polls/presidential"), {
        recursive: true,
      });
      fs.writeFileSync(path.join(root, "data/polls/presidential", f), "[]");
    }
    fs.mkdirSync(path.join(root, "data/polls/_inbox"), { recursive: true });
    fs.writeFileSync(draftPath(), JSON.stringify(myaraDraft(), null, 2));
  });

  afterEach(() => {
    __setReviewRootForTests();
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("--prepare lists the draft with the capture to read and where to write", async () => {
    const log = vi.mocked(console.log);
    await main(["--prepare"]);
    const tasks = JSON.parse(String(log.mock.calls[0][0]));
    expect(tasks).toEqual([
      expect.objectContaining({
        pollId: "my-2026-10-04-presidential",
        captureDir: "raw_data/polls/myara/1918",
        readingPath: expect.stringMatching(/^state\/polls\/readings\/MY-1918-/),
      }),
    ]);
  });

  it("accepts on agreement, fills methodology from a grounded quote, stamps locked.review", async () => {
    writeReading(myaraReading());
    await main([]);
    expect(fs.existsSync(draftPath())).toBe(false);
    const [poll] = corpus();
    expect(poll.id).toBe("my-2026-10-04-presidential");
    expect(poll.methodology.bg).toMatch(/Пряко лично интервю/);
    expect(poll.locked?.review).toEqual(
      expect.objectContaining({
        kind: "ai_agreement",
        model: "claude-opus-5-5",
      }),
    );
    const record = readPublicationLedger(root, "MY").find(
      (r) => r.pubId === "1918",
    );
    expect(record?.versions[0].drafts[0].acceptedAt).toBeTruthy();
  });

  it("leaves a disagreement for a human, with the diff written on the draft", async () => {
    const r = myaraReading();
    r.polls[0].questions[0].answers[0].value = 46.5;
    writeReading(r);
    await main([]);
    expect(corpus()).toEqual([]);
    const draft = readDraftFile();
    expect(draft.aiReview?.verdict).toBe("needs_human");
    expect(draft.aiReview?.diffs.join()).toMatch(/Илияна Йотова.*46.9.*46.5/);
    expect(draft.poll.methodology).toBeUndefined();
  });

  it("does not accept when the methodology quote is not in the captured text", async () => {
    const r = myaraReading();
    r.polls[0].methodologyQuote = "телефонно интервю с 2000 души";
    writeReading(r);
    await main([]);
    expect(corpus()).toEqual([]);
    expect(readDraftFile().aiReview?.diffs.join()).toMatch(/methodology/);
  });

  it("does nothing without a reading, and --dry-run writes nothing", async () => {
    const before = fs.readFileSync(draftPath(), "utf8");
    await main([]);
    expect(fs.readFileSync(draftPath(), "utf8")).toBe(before);
    writeReading(myaraReading());
    await main(["--dry-run"]);
    expect(fs.readFileSync(draftPath(), "utf8")).toBe(before);
    expect(corpus()).toEqual([]);
  });

  it("restores the extractor draft when accept refuses the merged one", async () => {
    // A locked poll with the same id: accept refuses without --replace.
    fs.writeFileSync(
      path.join(root, "data/polls/presidential/polls.json"),
      JSON.stringify([
        {
          ...myaraDraft().poll,
          methodology: { bg: "x", en: "x" },
          locked: { by: "agency_website", lockedAt: "2026-10-05" },
        },
      ]),
    );
    writeReading(myaraReading());
    await main([]);
    const draft = readDraftFile();
    expect(draft.aiReview?.verdict).toBe("needs_human");
    expect(draft.poll.methodology).toBeUndefined();
    expect(process.exitCode ?? 0).toBe(0);
  });
  it("sends a malformed sponsor to a human instead of dropping it", async () => {
    const r = myaraReading();
    (r.polls[0] as unknown as Record<string, unknown>).sponsor =
      "Мяра (собствени средства)";
    r.polls[0].sponsorQuote = "независимо изследване на „Мяра“";
    writeReading(r);
    await main([]);
    expect(corpus()).toEqual([]);
    expect(readDraftFile().aiReview?.diffs.join()).toMatch(/sponsor/);
  });

  it("fills a well-formed sponsor whose quote is in the capture", async () => {
    const r = myaraReading();
    r.polls[0].sponsor = { bg: "„Мяра“", en: "Myara" };
    r.polls[0].sponsorQuote = "независимо изследване на „Мяра“";
    writeReading(r);
    await main([]);
    expect(corpus()[0].sponsor).toEqual({ bg: "„Мяра“", en: "Myara" });
  });

  it("restores the draft and continues when accept throws", async () => {
    fs.writeFileSync(
      path.join(root, "data/polls/presidential/polls.json"),
      "{not json",
    );
    writeReading(myaraReading());
    await main([]);
    const draft = readDraftFile();
    expect(draft.aiReview?.verdict).toBe("needs_human");
    expect(draft.aiReview?.diffs.join()).toMatch(/threw/);
    expect(draft.poll.methodology).toBeUndefined();
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("takes a publication date only when the capture states the same one", async () => {
    const r = myaraReading();
    r.polls[0].publishedAt = "2026-10-07"; // the page states none
    writeReading(r);
    await main([]);
    expect(corpus()[0].publishedAt ?? null).toBeNull();
  });
});

describe("groundFills", () => {
  const TEXT =
    "Данните не са прогноза за изборен резултат. База: твърдо решили да гласуват.";
  it("accepts a base whose phrase is in the capture, refuses one that is not", () => {
    const base = (phrase: string) => ({
      field: "base" as const,
      questionId: "vote",
      kind: "likely_voters" as const,
      label: { bg: "x", en: "x" },
      phrase,
    });
    expect(groundFills([base("твърдо решили да гласуват")], TEXT)).toEqual([]);
    expect(
      groundFills([base("посочилите конкретна двойка")], TEXT),
    ).toHaveLength(1);
  });
  it("grounds a genre in the agency's own wording", () => {
    expect(
      groundFills([{ field: "genre", value: "raw_attitudes" }], TEXT),
    ).toEqual([]);
    expect(
      groundFills([{ field: "genre", value: "forecast" }], TEXT),
    ).toHaveLength(1);
    expect(
      groundFills(
        [{ field: "genre", value: "raw_attitudes" }],
        "Обществени нагласи.",
      ),
    ).toHaveLength(1);
  });
});
