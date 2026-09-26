import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  pendingPublications,
  readPublicationLedger,
  recordAcceptance,
  recordCapture,
  recordExtraction,
  recordPublicationFailure,
  rememberPublications,
} from "./publication_ledger";
import {
  pendingSiteTargets,
  pendingPressNotices,
  rememberPollWatch,
} from "./capture";
import type { ParliamentaryInboxDraft } from "./draft";
import { readState } from "../../watch/state";

vi.mock("../../watch/state", () => ({ readState: vi.fn(() => null) }));

const at = "2026-09-26T00:00:00Z";
const discovery = {
  pubId: "42",
  url: "https://example.org/poll",
  title: "Presidential poll",
  publishedAt: "2026-09-25",
};
const capture = {
  sha256: "a".repeat(64),
  capturePath: "raw_data/polls/trend/42",
  capturedAt: at,
  attachmentFailures: [],
};
const draft: ParliamentaryInboxDraft = {
  race: "parliamentary",
  poll: {
    id: "tr-2026-09-24",
    agencyId: "TR",
    provenance: {
      url: discovery.url,
      sha256: capture.sha256,
      fetchedAt: at,
      extractor: "TR",
      fieldworkStart: null,
      fieldworkEnd: null,
      basePhrase: null,
      quotes: {},
    },
  },
  details: [],
  genre: "unclear",
  residual: null,
  extractor: "TR",
  evidence: {},
  refused: [],
};
let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "poll-ledger-"));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("durable publication processing", () => {
  it("reconciles percent-encoding case variants of the same publication", () => {
    rememberPublications(
      root,
      "TR",
      [{ ...discovery, url: "https://example.org/%D0%BF/" }],
      at,
    );
    rememberPublications(
      root,
      "TR",
      [{ ...discovery, pubId: "43", url: "https://example.org/%d0%bf/" }],
      at,
    );
    expect(readPublicationLedger(root, "TR")).toHaveLength(1);
    expect(readPublicationLedger(root, "TR")[0].pubIds).toEqual(["42", "43"]);
  });

  it("retains pending discoveries after unchanged checks and a fresh read", () => {
    rememberPollWatch(
      "polls_trend",
      {
        newestId: 42,
        items: [
          {
            id: 42,
            url: discovery.url,
            title: discovery.title,
            publishedAt: discovery.publishedAt,
          },
        ],
      },
      at,
      root,
    );
    rememberPollWatch("polls_trend", { newestId: 42, items: [] }, at, root);
    expect(pendingSiteTargets("TR", root)?.map((item) => item.pubId)).toEqual([
      "42",
    ]);
    expect(
      JSON.parse(
        fs.readFileSync(path.join(root, "state/polls/TR.json"), "utf8"),
      ),
    ).toHaveLength(1);
  });

  it("keeps failed and incomplete captures queued until attachments succeed", () => {
    recordPublicationFailure(root, "TR", discovery, "capture", "timeout", at);
    expect(pendingPublications(root, "TR")).toHaveLength(1);
    recordCapture(root, "TR", discovery, {
      ...capture,
      attachmentFailures: ["https://example.org/chart.pdf"],
    });
    expect(pendingPublications(root, "TR")).toHaveLength(1);
    recordCapture(root, "TR", discovery, capture);
    expect(pendingPublications(root, "TR")).toEqual([]);
    expect(readPublicationLedger(root, "TR")[0]).toMatchObject({
      failures: { capture: 1, extraction: 0 },
      lastError: null,
    });
  });

  it("deduplicates manual and watcher IDs for the same source and retains versions", () => {
    rememberPublications(root, "TR", [discovery], at);
    recordCapture(
      root,
      "TR",
      { ...discovery, pubId: "url-hash", url: discovery.url + "/#chart" },
      capture,
    );
    recordCapture(root, "TR", discovery, {
      ...capture,
      sha256: "b".repeat(64),
      capturePath: capture.capturePath + ".v2",
    });
    const records = readPublicationLedger(root, "TR");
    expect(records).toHaveLength(1);
    expect(records[0].pubIds).toEqual(["42", "url-hash"]);
    expect(records[0].versions).toHaveLength(2);
  });

  it("does not regress newer incomplete evidence when an older alias capture is replayed", () => {
    recordCapture(root, "TR", discovery, capture);
    const newer = {
      ...capture,
      sha256: "b".repeat(64),
      capturedAt: "2026-09-27T00:00:00Z",
      attachmentFailures: ["https://example.org/chart.pdf"],
    };
    recordCapture(root, "TR", { ...discovery, pubId: "another-id" }, newer);
    recordCapture(root, "TR", discovery, capture, true);
    expect(readPublicationLedger(root, "TR")[0]).toMatchObject({
      latestHash: newer.sha256,
      lastError: { stage: "capture" },
    });
    expect(pendingPublications(root, "TR")).toHaveLength(1);
  });

  it("records refusal/review/acceptance and detects a changed re-extraction", () => {
    recordCapture(root, "TR", discovery, capture);
    recordPublicationFailure(
      root,
      "TR",
      discovery,
      "extraction",
      "unreadable chart",
      at,
    );
    recordExtraction(root, "TR", "42", capture.sha256, draft, at);
    expect(readPublicationLedger(root, "TR")[0].lastError).toBeNull();
    recordAcceptance(root, draft, at);
    let entry = readPublicationLedger(root, "TR")[0].versions[0].drafts[0];
    expect(entry).toMatchObject({ acceptedAt: at, reviewedAt: at });
    expect(entry.acceptedDraftHash).toBe(entry.draftHash);
    recordExtraction(
      root,
      "TR",
      "42",
      capture.sha256,
      { ...draft, genre: "forecast" },
      at,
    );
    entry = readPublicationLedger(root, "TR")[0].versions[0].drafts[0];
    expect(entry.acceptedDraftHash).not.toBe(entry.draftHash);
  });

  it("reconciles newer saved evidence without clearing a later network failure", () => {
    recordCapture(root, "TR", discovery, capture, true);
    recordPublicationFailure(
      root,
      "TR",
      discovery,
      "capture",
      "timeout",
      "2026-09-29T00:00:00Z",
    );
    recordCapture(
      root,
      "TR",
      discovery,
      {
        ...capture,
        sha256: "b".repeat(64),
        capturedAt: "2026-09-28T00:00:00Z",
      },
      true,
    );
    expect(readPublicationLedger(root, "TR")[0]).toMatchObject({
      latestHash: "b".repeat(64),
      lastError: { message: "timeout" },
    });
    expect(pendingPublications(root, "TR")).toHaveLength(1);
  });

  it("does not treat one accepted race as acceptance of a joint release", () => {
    recordCapture(root, "TR", discovery, capture);
    recordExtraction(root, "TR", "42", capture.sha256, draft, at);
    recordExtraction(
      root,
      "TR",
      "42",
      capture.sha256,
      { ...draft, race: "presidential", details: [], runoffs: [] },
      at,
    );
    recordAcceptance(root, draft, at);
    const entries = readPublicationLedger(root, "TR")[0].versions[0].drafts;
    expect(entries).toHaveLength(2);
    expect(
      entries.find((entry) => entry.race === "presidential")?.acceptedAt,
    ).toBeUndefined();
  });

  it("preserves press discoveries for manual capture across unchanged checks", () => {
    rememberPollWatch(
      "polls_gallup",
      {
        site: null,
        press: {
          items: [
            {
              guid: "news-guid",
              link: "https://news.google.com/articles/42",
              title: "Poll",
              pubDate: at,
              sourceName: "Outlet",
            },
          ],
        },
      },
      at,
      root,
    );
    rememberPollWatch(
      "polls_gallup",
      { site: null, press: { items: [] } },
      at,
      root,
    );
    expect(pendingSiteTargets("GIB", root)).toEqual([]);
    const notices = pendingPressNotices(root);
    expect(notices).toHaveLength(1);
    expect(notices[0].pubId).toBeTruthy();
    const [entry] = readPublicationLedger(root, "GIB");
    recordCapture(root, "GIB", { ...discovery, pubId: entry.pubId }, capture);
    vi.mocked(readState).mockReturnValueOnce({
      fingerprint: "same",
      detail: "same",
      lastChecked: at,
      meta: {
        press: {
          items: [
            {
              guid: "news-guid",
              title: "Poll",
              pubDate: at,
              sourceName: "Outlet",
            },
          ],
        },
      },
    });
    expect(pendingPressNotices(root)).toEqual([]);
  });

  it("refuses concurrent writes without losing the existing file", () => {
    rememberPublications(root, "TR", [discovery], at);
    const file = path.join(root, "state/polls/TR.json");
    const before = fs.readFileSync(file, "utf8");
    fs.mkdirSync(file + ".lock");
    expect(() =>
      rememberPublications(
        root,
        "TR",
        [{ ...discovery, pubId: "other", url: "https://example.org/other" }],
        at,
      ),
    ).toThrow();
    expect(fs.readFileSync(file, "utf8")).toBe(before);
  });

  it("does not replace a corrupt ledger with an empty queue", () => {
    fs.mkdirSync(path.join(root, "state/polls"), { recursive: true });
    const file = path.join(root, "state/polls/TR.json");
    fs.writeFileSync(file, "{invalid");
    expect(() => rememberPublications(root, "TR", [discovery], at)).toThrow();
    expect(fs.readFileSync(file, "utf8")).toBe("{invalid");
    expect(fs.existsSync(file + ".lock")).toBe(false);
  });

  it("does not mark a draft accepted when its corpus write fails", () => {
    recordCapture(root, "TR", discovery, capture);
    recordExtraction(root, "TR", "42", capture.sha256, draft, at);
    expect(() =>
      recordAcceptance(root, draft, at, () => {
        throw new Error("corpus write failed");
      }),
    ).toThrow("corpus write failed");
    expect(
      readPublicationLedger(root, "TR")[0].versions[0].drafts[0].acceptedAt,
    ).toBeUndefined();
    expect(fs.existsSync(path.join(root, "state/polls/TR.json.lock"))).toBe(
      false,
    );
  });

  it("keeps capture retries pending while extraction failures are repaired", () => {
    recordCapture(root, "TR", discovery, capture);
    recordPublicationFailure(
      root,
      "TR",
      discovery,
      "capture",
      "network timeout",
      at,
    );
    recordPublicationFailure(
      root,
      "TR",
      discovery,
      "extraction",
      "chart unreadable",
      "2026-09-27T00:00:00Z",
    );
    expect(pendingPublications(root, "TR")).toHaveLength(1);
    recordExtraction(root, "TR", "42", capture.sha256, draft, at);
    expect(pendingPublications(root, "TR")).toHaveLength(1);
    expect(readPublicationLedger(root, "TR")[0].lastError?.message).toBe(
      "network timeout",
    );
  });
});
