import { describe, expect, it } from "vitest";
import { publicationStatus } from "./backlog";
import type { PublicationRecord } from "./lib/publication_ledger";
const record = (): PublicationRecord => ({
  agencyId: "MY",
  pubId: "1",
  pubIds: ["1"],
  url: "https://example.bg/1",
  title: "Poll",
  publishedAt: null,
  discoveredAt: "2026-09-26",
  latestHash: "a",
  versions: [
    {
      sha256: "a",
      capturePath: "raw_data/polls/myara/1",
      capturedAt: "2026-09-26",
      attachmentFailures: [],
      drafts: [],
    },
  ],
  failures: { capture: 0, extraction: 0 },
  errors: { capture: null, extraction: null },
  lastError: null,
});
describe("durable backlog reporting", () => {
  it("does not report capture as completed ingestion", () =>
    expect(publicationStatus(record())).toBe("pending_extraction"));
  it("requires every race in a joint publication to be accepted", () => {
    const r = record();
    r.versions[0].drafts = [
      {
        pollId: "p",
        race: "parliamentary",
        extractedAt: "today",
        draftHash: "1",
        refused: [],
        acceptedAt: "today",
        acceptedDraftHash: "1",
      },
      {
        pollId: "r",
        race: "presidential",
        extractedAt: "today",
        draftHash: "2",
        refused: ["base"],
      },
    ];
    expect(publicationStatus(r)).toBe("pending_review");
    r.versions[0].drafts[1].acceptedAt = "today";
    r.versions[0].drafts[1].acceptedDraftHash = "2";
    expect(publicationStatus(r)).toBe("accepted");
    r.versions[0].drafts[1].draftHash = "3";
    expect(publicationStatus(r)).toBe("pending_review");
  });
});
