import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireLedgerLock } from "./ledger_lock";
import { recordAcceptance, rememberPublications } from "./publication_ledger";
import type { PresidentialInboxDraft } from "./draft";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "poll-lock-"));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});
describe("ledger writer ownership", () => {
  it("recovers after a process exits while committing accepted data", () => {
    const module = pathToFileURL(
      path.resolve("scripts/polls/lib/publication_ledger.ts"),
    ).href;
    const child = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `import {recordAcceptance} from ${JSON.stringify(module)}; recordAcceptance(${JSON.stringify(root)}, {poll:{agencyId:'TR',provenance:{url:'https://example.test',sha256:'abc'}}}, '2026-09-26',()=>process.exit(9));`,
      ],
      { encoding: "utf8" },
    );
    expect(child.status, child.stderr).toBe(9);
    const discovery = {
      pubId: "1",
      url: "https://example.test",
      title: null,
      publishedAt: null,
    };
    expect(() =>
      rememberPublications(root, "TR", [discovery], "2026-09-26"),
    ).not.toThrow();
    expect(
      JSON.parse(
        fs.readFileSync(path.join(root, "state/polls/TR.json"), "utf8"),
      ),
    ).toHaveLength(1);
  });
  it("refuses a second writer while the owner is live and releases after errors", () => {
    const draft: PresidentialInboxDraft = {
      race: "presidential",
      poll: {
        id: "tr-1",
        agencyId: "TR",
        provenance: {
          url: "https://example.test",
          sha256: "abc",
          fetchedAt: "today",
          extractor: "TR",
          fieldworkStart: null,
          fieldworkEnd: null,
          basePhrase: null,
          quotes: {},
        },
      },
      details: [],
      runoffs: [],
      genre: "unclear",
      residual: null,
      extractor: "TR",
      evidence: {},
      refused: [],
    };
    expect(() =>
      recordAcceptance(root, draft, "today", () => {
        expect(() =>
          rememberPublications(
            root,
            "TR",
            [
              {
                pubId: "1",
                url: "https://example.test",
                title: null,
                publishedAt: null,
              },
            ],
            "today",
          ),
        ).toThrow("Ledger writer is active");
        throw new Error("commit failed");
      }),
    ).toThrow("commit failed");
    const release = acquireLedgerLock(
      path.join(root, "state/polls/TR.json.lock"),
    );
    release();
  });
  it("names a legacy directory lock instead of failing with a bare EINVAL", () => {
    const file = path.join(root, "legacy.lock");
    fs.mkdirSync(file);
    expect(() => acquireLedgerLock(file)).toThrow("predates owner records");
    expect(fs.statSync(file).isDirectory()).toBe(true);
  });
  it("recovers an interrupted recovery without stealing a live primary owner", () => {
    const module = pathToFileURL(
      path.resolve("scripts/polls/lib/ledger_lock.ts"),
    ).href;
    const file = path.join(root, "agency.lock");
    const child = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `import {acquireLedgerLock} from ${JSON.stringify(module)}; acquireLedgerLock(${JSON.stringify(file)}); acquireLedgerLock(${JSON.stringify(file + ".recovery")}); process.exit(9);`,
      ],
      { encoding: "utf8" },
    );
    expect(child.status, child.stderr).toBe(9);
    const release = acquireLedgerLock(file);
    expect(() => acquireLedgerLock(file)).toThrow("Ledger writer is active");
    release();
  });
});
