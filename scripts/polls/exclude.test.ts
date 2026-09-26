import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publicationStatus } from "./backlog";
import { applyReconciliation, main, reconciledRaces } from "./exclude";
import {
  readPublicationLedger,
  recordAcceptance,
  recordCapture,
  recordExtraction,
} from "./lib/publication_ledger";
import type { ParliamentaryInboxDraft } from "./lib/draft";

const at = "2026-09-26T00:00:00Z";
const capture = (pubId: string) => ({
  sha256: pubId.repeat(64).slice(0, 64),
  capturePath: `raw_data/polls/alpha_research/${pubId}`,
  capturedAt: at,
  attachmentFailures: [],
});
const discover = (pubId: string) => ({
  pubId,
  url: `https://example.org/${pubId}`,
  title: null,
  publishedAt: null,
});
const parliamentary = (pubId: string): ParliamentaryInboxDraft => ({
  race: "parliamentary",
  poll: {
    id: `ar-${pubId}`,
    agencyId: "AR",
    provenance: {
      url: `https://example.org/${pubId}`,
      sha256: capture(pubId).sha256,
      fetchedAt: at,
      extractor: "AR",
      fieldworkStart: null,
      fieldworkEnd: null,
      basePhrase: null,
      quotes: {},
    },
  },
  details: [],
  genre: "unclear",
  residual: null,
  extractor: "AR",
  evidence: {},
  refused: [],
});

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "poll-exclude-"));
  process.exitCode = undefined;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

const status = (pubId: string) =>
  publicationStatus(
    readPublicationLedger(root, "AR").find((r) => r.pubId === pubId)!,
  );

describe("reviewed exclusions", () => {
  it("maps reconciliation statuses to the races they resolve", () => {
    expect(reconciledRaces("excluded")).toEqual([
      "parliamentary",
      "presidential",
    ]);
    expect(reconciledRaces("other_race")).toEqual(["presidential"]);
    expect(reconciledRaces("other_question")).toEqual(["presidential"]);
    expect(reconciledRaces("missing_metadata")).toEqual([]);
    expect(reconciledRaces("accepted")).toEqual([]);
  });

  it("migrates the historical reconciliation without hiding parliamentary work", () => {
    for (const id of ["1", "2", "3"])
      recordCapture(root, "AR", discover(id), capture(id));
    // "2" is a joint publication with a parliamentary draft the presidential review does not settle.
    recordExtraction(
      root,
      "AR",
      "2",
      capture("2").sha256,
      parliamentary("2"),
      at,
    );
    fs.mkdirSync(path.join(root, "state/polls"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "state/polls/historical-reconciliation.json"),
      JSON.stringify({
        reviewedAt: "2026-09-26",
        publications: [
          {
            agencyId: "AR",
            pubId: "1",
            status: "excluded",
            reason: "Exit poll",
          },
          {
            agencyId: "AR",
            pubId: "2",
            status: "other_race",
            reason: "Parliamentary only",
          },
          {
            agencyId: "AR",
            pubId: "3",
            status: "missing_metadata",
            reason: "No base",
          },
          {
            agencyId: "AR",
            pubId: "9",
            status: "excluded",
            reason: "Never captured",
          },
        ],
      }),
    );
    const first = applyReconciliation(root);
    expect(first.tally).toEqual({ recorded: 3, missing: 2 });
    expect(first.problems).toEqual([
      "AR/9/parliamentary: missing",
      "AR/9/presidential: missing",
    ]);
    expect(status("1")).toBe("excluded");
    expect(status("2")).toBe("pending_review");
    expect(status("3")).toBe("pending_extraction");
    // Idempotent: a re-run records nothing new.
    expect(applyReconciliation(root).tally).toEqual({
      unchanged: 3,
      missing: 2,
    });
  });

  it("refuses to exclude an accepted race and requires every argument", () => {
    recordCapture(root, "AR", discover("4"), capture("4"));
    const draft = parliamentary("4");
    recordExtraction(root, "AR", "4", capture("4").sha256, draft, at);
    recordAcceptance(root, draft, at);
    main(
      [
        "--agency",
        "AR",
        "--pub",
        "4",
        "--race",
        "parliamentary",
        "--reason",
        "x",
      ],
      root,
    );
    expect(process.exitCode).toBe(1);
    expect(status("4")).toBe("accepted");
    process.exitCode = undefined;
    main(["--agency", "AR", "--pub", "4", "--race", "local"], root);
    expect(process.exitCode).toBe(1);
  });

  it("records a manual exclusion on the current source version", () => {
    recordCapture(root, "AR", discover("5"), capture("5"));
    for (const race of ["parliamentary", "presidential"])
      main(
        [
          "--agency",
          "AR",
          "--pub",
          "5",
          "--race",
          race,
          "--reason",
          "Statement",
        ],
        root,
      );
    expect(process.exitCode).toBeUndefined();
    expect(status("5")).toBe("excluded");
  });
});
