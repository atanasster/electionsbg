import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractGlobalMetrics, extractPlaceholderRows } from "./global_metrics";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const captureDir = (pubId: string): string =>
  path.join(REPO_ROOT, "raw_data/polls/global_metrics", pubId);

// extractGlobalMetrics reads real PDF text via the real `pdftotext` binary
// (through acquireText) — same hermeticity concern as
// text_acquisition.test.ts's real-binary suite, and the same fix: skip
// rather than fail when the binary is absent (e.g. a bare CI runner). GM
// carries no images, so tesseract is not a dependency here.
const hasBinary = (cmd: string, versionFlag: string): boolean => {
  try {
    execFileSync(cmd, [versionFlag], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};
const HAS_PDFTOTEXT = hasBinary("pdftotext", "-v");
if (!HAS_PDFTOTEXT) {
  console.warn(
    "[global_metrics.test] pdftotext not found on PATH — skipping the real-capture extractGlobalMetrics tests.",
  );
}
const run = HAS_PDFTOTEXT ? it : it.skip;

describe("extractGlobalMetrics — real capture (658, July 2026 presidential)", () => {
  run(
    "resolves the placeholder horse race, the named-candidate table, the passport, and the race/genre",
    async () => {
      const draft = await extractGlobalMetrics(captureDir("658"), "658");

      expect(draft.race).toBe("presidential");
      expect(draft.genre).toBe("raw_attitudes");
      expect(draft.poll.id).toBe("gm-2026-07-11");
      expect(draft.poll.respondents).toBe(1503);
      expect(draft.poll.fieldwork).toBe("Jun 23 - Jul 11 2026");
      expect(draft.poll.provenance?.fieldworkStart).toBe("2026-06-23");
      expect(draft.poll.provenance?.fieldworkEnd).toBe("2026-07-11");
      expect(draft.poll.provenance?.basePhrase).toBe(
        "сред заявилите, че ще гласуват",
      );
      // Decision 11: a presidential poll's electionDate is the current
      // best estimate from UPCOMING_ELECTIONS, not a literal here.
      expect(draft.poll.electionDate).toBe("2026-11-08");
      expect(draft.poll.cycle).toBeNull();
      expect(draft.runoffs).toEqual([]);
      expect(draft.residual).toBeNull();

      const byLabel = Object.fromEntries(
        draft.details.map((d) => [d.candidateName_bg, d.support]),
      );
      // The party-placeholder horse race ("Кандидат на <party>" +
      // "Друг кандидат") — sums to ~100%, and is the ONLY genuine
      // mutually-exclusive horse race in this capture.
      expect(byLabel["Прогресивна България"]).toBe(39.7);
      expect(byLabel["Продължаваме промяната"]).toBe(13.3);
      expect(byLabel["ГЕРБ-СДС"]).toBe(11.5);
      expect(byLabel["Възраждане"]).toBe(5.5);
      expect(byLabel["БСП – Обединена левица"]).toBe(4.8);
      expect(byLabel["Антикорупционен блок"]).toBe(4.4);
      expect(byLabel["ДПС"]).toBe(3.6);
      expect(byLabel["МЕЧ"]).toBe(2.2);
      expect(byLabel["Друг кандидат"]).toBe(14.9);
      // The named-candidate "would support" table — the "Със сигурност"
      // (definitely would support) column only, NEVER the Trust Index
      // table's larger-looking numbers for the same names (see this
      // extractor's own header for why 30.0, not 30.9, is Йотова's
      // number here).
      expect(byLabel["Илияна Йотова"]).toBe(30);
      expect(byLabel["Андрей Гюров"]).toBe(9.6);
      expect(byLabel["Даниел Вълчев"]).toBe(4.7);
      expect(byLabel["Иван Христанов"]).toBe(3.1);
      expect(draft.details).toHaveLength(13);

      // Zero refusals on this capture — every row is cleanly quotable.
      expect(draft.refused).toEqual([]);

      // Placeholder rows resolve real party keys via POLL_TO_ACTUAL/aliases.
      const placeholderKeyByName = Object.fromEntries(
        draft.details
          .filter((d) => d.placeholderFor !== null)
          .map((d) => [d.candidateName_bg, d.placeholderFor]),
      );
      expect(placeholderKeyByName).toEqual({
        "Прогресивна България": "ПрБ",
        "Продължаваме промяната": "ПП-ДБ",
        "ГЕРБ-СДС": "ГЕРБ-СДС",
        Възраждане: "Възраждане",
        "БСП – Обединена левица": "БСП-ОЛ",
        "Антикорупционен блок": "Антикорупционен блок",
        ДПС: "ДПС",
        МЕЧ: "МЕЧ",
        "Друг кандидат": "Друг кандидат",
      });

      // Named candidates: no tickets.json exists for the 2026 cycle yet,
      // so every one resolves as a provisional key (decision 16).
      const namedCandidates = draft.details.filter(
        (d) => d.placeholderFor === null,
      );
      expect(namedCandidates.map((d) => d.candidateKey).sort()).toEqual([
        "provisional:андрей-гюров",
        "provisional:даниел-вълчев",
        "provisional:иван-христанов",
        "provisional:илияна-йотова",
      ]);

      // Every detail carries a pollId matching the minted poll id, and
      // every accepted claim has its own grounding quote.
      for (const d of draft.details) {
        expect(d.pollId).toBe(draft.poll.id);
        expect(draft.evidence[`share:${d.candidateName_bg}`]).toBeTruthy();
      }
    },
  );

  run(
    "provenance carries the capture's own URL/hash, never a fabricated one",
    async () => {
      const draft = await extractGlobalMetrics(captureDir("658"), "658");
      expect(draft.poll.source).toBe(
        "https://globalmetrics.eu/obshtestveni-naglasi-prezidentski-izbori-yuli-2026/",
      );
      expect(draft.poll.provenance?.url).toBe(draft.poll.source);
      expect(draft.poll.provenance?.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(draft.poll.provenance?.extractor).toBe("GM");
    },
  );
});

describe("extractGlobalMetrics — synthetic captures (no real binaries needed, or fails before reaching them)", () => {
  let scratchRoot: string;

  beforeEach(() => {
    scratchRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "global-metrics-extract-test-"),
    );
  });
  afterEach(() => {
    fs.rmSync(scratchRoot, { recursive: true, force: true });
  });

  const writeCapture = (
    dir: string,
    { html, sourceJson }: { html?: string; sourceJson?: object | string },
  ) => {
    fs.mkdirSync(dir, { recursive: true });
    if (html !== undefined) fs.writeFileSync(path.join(dir, "page.html"), html);
    if (sourceJson !== undefined)
      fs.writeFileSync(
        path.join(dir, "SOURCE.json"),
        typeof sourceJson === "string"
          ? sourceJson
          : JSON.stringify(sourceJson),
      );
  };

  // A minimal parliamentary-shaped page — no "Президент"/"президентски"
  // phrase anywhere, so classifyRace defaults to "parliamentary" (decision
  // 11) and the extractor must refuse rather than silently building a
  // presidential-shaped draft from parliamentary content.
  const PARLIAMENTARY_HTML =
    "<html><head><title>Партийно проучване — Global Metrics</title></head><body></body></html>";
  const SYNTHETIC_STAMP = {
    url: "https://globalmetrics.eu/test/",
    fetchedAt: "2026-09-09T00:00:00.000Z",
    sha256: "a".repeat(64),
  };

  it("throws when classifyRace resolves parliamentary for this capture", async () => {
    const dir = path.join(scratchRoot, "999");
    writeCapture(dir, {
      html: PARLIAMENTARY_HTML,
      sourceJson: SYNTHETIC_STAMP,
    });

    await expect(extractGlobalMetrics(dir, "999")).rejects.toThrow(
      /extractGlobalMetrics\(999\): classifyRace resolved "parliamentary"/,
    );
  });

  it("throws a clear, capture-scoped error when SOURCE.json is missing", async () => {
    const dir = path.join(scratchRoot, "999");
    writeCapture(dir, { html: PARLIAMENTARY_HTML });

    await expect(extractGlobalMetrics(dir, "999")).rejects.toThrow(
      /extractGlobalMetrics\(999\): missing or unreadable SOURCE\.json/,
    );
  });

  it("throws a clear, capture-scoped error when page.html is missing", async () => {
    const dir = path.join(scratchRoot, "999");
    writeCapture(dir, { sourceJson: SYNTHETIC_STAMP });

    await expect(extractGlobalMetrics(dir, "999")).rejects.toThrow(
      /extractGlobalMetrics\(999\): missing or unreadable page\.html/,
    );
  });

  it("throws a clear error when SOURCE.json is missing a required field", async () => {
    const dir = path.join(scratchRoot, "999");
    writeCapture(dir, {
      html: PARLIAMENTARY_HTML,
      sourceJson: { url: "https://globalmetrics.eu/test/" }, // no sha256/fetchedAt
    });

    await expect(extractGlobalMetrics(dir, "999")).rejects.toThrow(
      /extractGlobalMetrics\(999\): SOURCE\.json .* is missing a required field/,
    );
  });
});

describe("extractPlaceholderRows — regex edge cases (no PDF/binary needed)", () => {
  it("refuses to merge two rows when the first party's percentage is missing, rather than garbling the label", () => {
    // The lazy `[\s\S]+?` span used to leech across an entire second row's
    // own marker + percentage when the first row states none — merging
    // both parties into one garbled label attached to the SECOND party's
    // real number. Bounded now: a percentage-less row simply produces no
    // match at all (correctly invisible), instead of corrupting its
    // neighbour.
    const section = "Кандидат на Партия А\n\nКандидат на Партия Б    5.0%\n";
    const rows = extractPlaceholderRows(section);
    expect(rows).toHaveLength(1);
    expect(rows[0].partyName).toBe("Партия Б");
    expect(rows[0].support).toBe(5);
  });

  it("does not match a lowercase 'кандидат на' occurring in running prose", () => {
    // Deliberately case-sensitive (no `i` flag) — the press release's own
    // narrative uses the lowercase phrase in passing ("...кандидат на
    // ПП–ДБ..."), and this locks in that a stray lowercase mention is
    // never read as a ballot row.
    const section = "както кандидат на ПП-ДБ обяви    5.0%\n";
    expect(extractPlaceholderRows(section)).toEqual([]);
  });
});
