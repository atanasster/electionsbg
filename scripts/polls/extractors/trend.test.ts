import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractTrend } from "./trend";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const captureDir = (pubId: string): string =>
  path.join(REPO_ROOT, "raw_data/polls/trend", pubId);

// extractTrend OCRs real passport images via the real tesseract binary
// (through acquireText) — same hermeticity concern as
// text_acquisition.test.ts's real-binary suite, and the same fix: skip
// rather than fail when tesseract is absent (e.g. a bare CI runner).
const hasBinary = (cmd: string, versionFlag: string): boolean => {
  try {
    execFileSync(cmd, [versionFlag], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};
const HAS_TESSERACT = hasBinary("tesseract", "--version");
if (!HAS_TESSERACT) {
  console.warn(
    "[trend.test] tesseract not found on PATH — skipping the real-capture extractTrend tests.",
  );
}
const run = HAS_TESSERACT ? it : it.skip;

describe("extractTrend — real captures", () => {
  run(
    "212637: resolves the passport, shares, race and genre from real OCR + text",
    async () => {
      const draft = await extractTrend(captureDir("212637"), "212637");

      expect(draft.race).toBe("parliamentary");
      expect(draft.genre).toBe("raw_attitudes");
      expect(draft.poll.id).toBe("tr-2026-02-18");
      expect(draft.poll.respondents).toBe(1002);
      expect(draft.poll.fieldwork).toBe("Feb 12-18 2026");
      expect(draft.poll.provenance?.fieldworkStart).toBe("2026-02-12");
      expect(draft.poll.provenance?.fieldworkEnd).toBe("2026-02-18");
      expect(draft.poll.provenance?.basePhrase).toContain("гласуващите");

      const byLabel = Object.fromEntries(
        draft.details.map((d) => [d.nickName_bg, d.support]),
      );
      // МЕЧ (3.6%) is refused — a real, known residual limitation (see
      // trend.ts's own header): the last party before its sentence ends,
      // with nothing left in the clause to extend the quote into.
      expect(byLabel).toEqual({
        "ГЕРБ-СДС": 20.4,
        "ПП-ДБ": 10.9,
        "ДПС-Ново начало": 10.5,
        Възраждане: 7.8,
        БСП: 3.8,
        "Има такъв народ": 2.5,
        "Алиансът за права и свободи": 1.7,
        Величие: 1.6,
      });
      expect(draft.refused).toEqual([
        {
          field: "share:МЕЧ",
          reason:
            "quote too short to be evidence (<12 chars after normalisation)",
          quote: "МЕЧ (3,6%)",
        },
      ]);

      // Every accepted detail carries its own grounding quote.
      for (const d of draft.details) {
        expect(draft.evidence[`share:${d.nickName_bg}`]).toBeTruthy();
      }
    },
  );

  run(
    "212732: same party under two label spellings, deliberately both kept",
    async () => {
      const draft = await extractTrend(captureDir("212732"), "212732");

      expect(draft.poll.id).toBe("tr-2026-03-19");
      expect(draft.poll.respondents).toBe(1001);
      expect(draft.poll.fieldwork).toBe("Mar 13-19 2026");

      const byLabel = Object.fromEntries(
        draft.details.map((d) => [d.nickName_bg, d.support]),
      );
      expect(byLabel["БСП"]).toBe(4);
      expect(byLabel["БСП-ОЛ"]).toBe(4);
    },
  );

  run("212750: resolves the passport, shares, race and genre", async () => {
    const draft = await extractTrend(captureDir("212750"), "212750");

    expect(draft.poll.id).toBe("tr-2026-04-16");
    expect(draft.poll.respondents).toBe(1004);
    expect(draft.poll.fieldwork).toBe("Apr 13-16 2026");

    const byLabel = Object.fromEntries(
      draft.details.map((d) => [d.nickName_bg, d.support]),
    );
    expect(byLabel).toEqual({
      "Прогресивна България": 33.2,
      "ГЕРБ-СДС": 19.1,
      "ПП-ДБ": 11.2,
      Възраждане: 7.1,
      БСП: 4,
      Сияние: 3.9,
      МЕЧ: 3.7,
      "Има такъв народ": 2.1,
      Величие: 1.7,
      "Алианс за права и свободи": 1.6,
      "Синя България": 1,
    });
    // ДПС (10.2%) is refused for the same reason МЕЧ is in 212637.
    expect(draft.refused.some((r) => r.field === "share:ДПС")).toBe(true);
  });

  run(
    "provenance carries the capture's own URL/hash, never a fabricated one",
    async () => {
      const draft = await extractTrend(captureDir("212750"), "212750");
      expect(draft.poll.source).toMatch(/^https:\/\/rctrend\.bg\//);
      expect(draft.poll.provenance?.url).toBe(draft.poll.source);
      expect(draft.poll.provenance?.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(draft.poll.provenance?.extractor).toBe("TR");
    },
  );
});

describe("extractTrend — synthetic captures (no real binaries needed: no images to OCR, or fails before reaching them)", () => {
  let scratchRoot: string;

  beforeEach(() => {
    scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "trend-extract-test-"));
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

  const SYNTHETIC_HTML =
    "<html><head><title>Тест — ТРЕНД</title></head><body>" +
    '<div class="et_pb_text_inner">ГЕРБ-СДС е на 20,4% подкрепа.</div>' +
    "</body></html>";
  const SYNTHETIC_STAMP = {
    url: "https://rctrend.bg/project/test/",
    fetchedAt: "2026-09-09T00:00:00.000Z",
    sha256: "a".repeat(64),
  };

  it("mints a provisional pubId-keyed id and flags it when NO passport images exist", async () => {
    const dir = path.join(scratchRoot, "999");
    writeCapture(dir, { html: SYNTHETIC_HTML, sourceJson: SYNTHETIC_STAMP });

    const draft = await extractTrend(dir, "999");

    expect(draft.poll.id).toBe("tr-pub-999");
    expect(draft.poll.respondents).toBeNull();
    expect(draft.poll.fieldwork).toBeUndefined();
    expect(draft.refused).toContainEqual({
      field: "poll.id",
      reason:
        "no fieldwork end date resolved from the passport — using a provisional pubId-keyed id",
      quote: "",
    });
    // The one real party mention still extracts correctly — only the
    // passport (image-only, decision 18) is unresolved, not the shares.
    const byLabel = Object.fromEntries(
      draft.details.map((d) => [d.nickName_bg, d.support]),
    );
    expect(byLabel).toEqual({ "ГЕРБ-СДС": 20.4 });
  });

  it("throws a clear, capture-scoped error when SOURCE.json is missing", async () => {
    const dir = path.join(scratchRoot, "999");
    writeCapture(dir, { html: SYNTHETIC_HTML });

    await expect(extractTrend(dir, "999")).rejects.toThrow(
      /extractTrend\(999\): missing or unreadable SOURCE\.json/,
    );
  });

  it("throws a clear, capture-scoped error when page.html is missing", async () => {
    const dir = path.join(scratchRoot, "999");
    writeCapture(dir, { sourceJson: SYNTHETIC_STAMP });

    await expect(extractTrend(dir, "999")).rejects.toThrow(
      /extractTrend\(999\): missing or unreadable page\.html/,
    );
  });

  it("throws a clear error when SOURCE.json is missing a required field", async () => {
    const dir = path.join(scratchRoot, "999");
    writeCapture(dir, {
      html: SYNTHETIC_HTML,
      sourceJson: { url: "https://rctrend.bg/project/test/" }, // no sha256/fetchedAt
    });

    await expect(extractTrend(dir, "999")).rejects.toThrow(
      /extractTrend\(999\): SOURCE\.json .* is missing a required field/,
    );
  });
});
