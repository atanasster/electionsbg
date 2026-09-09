import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { QUESTION_DEFINITIONS } from "../../src/lib/questions/catalog";
import { buildEditorialDispositions } from "./build_editorial_dispositions";

const read = (relative: string) =>
  readFileSync(
    new URL(`../../docs/audits/${relative}`, import.meta.url),
    "utf8",
  );
const sourceText = read("bulgarian-civic-questions.json");
const decisionText = read("editorial-question-decisions.json");
const committed = JSON.parse(read("editorial-question-dispositions.json"));

describe("editorial question dispositions", () => {
  it("matches all 257 source records and independent decisions exactly", () => {
    const source = JSON.parse(sourceText) as {
      questions: Array<{ id: string }>;
    };
    expect(committed).toEqual(
      buildEditorialDispositions(sourceText, decisionText),
    );
    expect(committed.dispositions).toHaveLength(257);
    expect(committed.dispositions.map((row: { id: string }) => row.id)).toEqual(
      source.questions.map((row) => row.id),
    );
  });

  it("enforces the evidence and surface states for each outcome", () => {
    for (const row of committed.dispositions) {
      expect(row.questionBg.length, row.id).toBeGreaterThan(10);
      if (row.outcome === "promote_existing") {
        expect([row.chat, row.sql], row.id).toEqual(["ready", "ready"]);
        expect(row.capabilityId, row.id).toBeTruthy();
        expect(row.validationEvidence.length, row.id).toBeGreaterThan(80);
      } else if (row.outcome === "new_official_ingestion") {
        expect([row.chat, row.sql], row.id).toEqual(["review", "review"]);
        expect(row.ingestionContract.length, row.id).toBeGreaterThan(80);
      } else if (row.outcome === "unavailable") {
        expect([row.chat, row.sql], row.id).toEqual([
          "unavailable",
          "unavailable",
        ]);
        expect(row.blockingEvidence.length, row.id).toBeGreaterThan(80);
      } else {
        throw new Error(`Unhandled outcome for ${row.id}`);
      }
    }
  });

  it("maps promotions to validated dual-ready shared capabilities", () => {
    const promoted: Record<string, string> = {
      "elections.parliamentary.01": "nationalResults",
      "elections.presidential.01": "presidentialResults",
    };
    for (const row of committed.dispositions) {
      if (row.outcome !== "promote_existing") continue;
      expect(row.capabilityId, row.id).toBe(promoted[row.id]);
      const capability = QUESTION_DEFINITIONS.find(
        (question) => question.id === row.capabilityId,
      );
      expect(capability?.chat.status, row.id).toBe("ready");
      expect(capability?.sql.status, row.id).toBe("ready");
    }
    expect(
      committed.dispositions
        .filter(
          (row: { outcome: string }) => row.outcome === "promote_existing",
        )
        .map((row: { id: string }) => row.id),
    ).toEqual(Object.keys(promoted));
  });

  it("keeps unsupported editorial IDs out of ready starter actions", () => {
    const readyIds = new Set(
      QUESTION_DEFINITIONS.filter(
        (question) =>
          question.chat.status === "ready" || question.sql.status === "ready",
      ).map((question) => question.id),
    );
    for (const row of committed.dispositions)
      if (row.outcome !== "promote_existing")
        expect(readyIds.has(row.id), row.id).toBe(false);
  });

  it("enforces the dedicated news retrieval and citation contract per row", () => {
    const media = committed.dispositions.filter((row: { id: string }) =>
      row.id.startsWith("media-society.media."),
    );
    expect(media).toHaveLength(4);
    for (const row of media) {
      expect(row.outcome, row.id).toBe("unavailable");
      expect(row.newsContract, row.id).toEqual({
        retrievalCorpus: "news/",
        articleDate: true,
        sourceAttribution: true,
        claimVsVerifiedData: true,
        authoritativeSource: true,
        sqlAllowed: false,
      });
    }
  });

  it("pins named evidence cases to question-specific decisions", () => {
    const byId = new Map(
      committed.dispositions.map((row: { id: string }) => [row.id, row]),
    );
    const expectedTerms = {
      "health.access.01": "specialty",
      "education.access.01": "offered places",
      "water-environment.water.02": "start/end time",
      "water-environment.water.03": "tariff components",
      "transport-housing.rail.04": "exact requested measure",
      "transport-housing.housing.04": "permit number",
      "media-society.trust.03": "EU/euro question wording",
    };
    for (const [id, term] of Object.entries(expectedTerms)) {
      const row = byId.get(id) as Record<string, string>;
      expect(row.ingestionContract ?? row.blockingEvidence, id).toContain(term);
    }
  });
});
