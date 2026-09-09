import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractAlphaResearch } from "./alpha_research";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const captureDir = (pubId: string): string =>
  path.join(REPO_ROOT, "raw_data/polls/alpha_research", pubId);

// extractAlphaResearch OCRs every discovered chart image via the real
// tesseract binary (through acquireText, even though this extractor does
// not trust that OCR for shares — see its own header) — same hermeticity
// concern as text_acquisition.test.ts's real-binary suite.
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
    "[alpha_research.test] tesseract not found on PATH — skipping the real-capture extractAlphaResearch tests.",
  );
}
const run = HAS_TESSERACT ? it : it.skip;

describe("extractAlphaResearch — real captures", () => {
  run(
    "1043: a full-narrative post resolves passport, shares, race and genre from text alone",
    async () => {
      const draft = await extractAlphaResearch(captureDir("1043"), "1043");

      expect(draft.race).toBe("parliamentary");
      expect(draft.genre).toBe("raw_attitudes");
      expect(draft.poll.id).toBe("ar-2026-03-02");
      expect(draft.poll.respondents).toBe(1000);
      expect(draft.poll.fieldwork).toBe("Feb 23 - Mar 2 2026");

      const byLabel = Object.fromEntries(
        draft.details.map((d) => [d.nickName_bg, d.support]),
      );
      // МЕЧ (3.5%) is refused — the same short-label-at-clause-end
      // residual limitation trend.test.ts documents for TR.
      expect(byLabel).toEqual({
        ГЕРБ: 19.7,
        "ПП-ДБ": 12.6,
        "ДПС-ново начало": 9.6,
        Възраждане: 6.4,
        БСП: 3.6,
        "Прогресивна България": 32.6,
      });
      expect(draft.refused.some((r) => r.field === "share:МЕЧ")).toBe(true);
      // No chart-only flag — the text yielded well above the threshold.
      expect(draft.refused.some((r) => r.field === "shares")).toBe(false);
    },
  );

  run("1047: a full-narrative post at the end of the campaign", async () => {
    const draft = await extractAlphaResearch(captureDir("1047"), "1047");

    expect(draft.genre).toBe("raw_attitudes");
    expect(draft.poll.id).toBe("ar-2026-04-15");
    expect(draft.poll.respondents).toBe(1000);
    expect(draft.poll.fieldwork).toBe("Apr 13-15 2026");

    const byLabel = Object.fromEntries(
      draft.details.map((d) => [d.nickName_bg, d.support]),
    );
    expect(byLabel).toEqual({
      "Прогресивна България": 34.2,
      "ГЕРБ-СДС": 19.5,
      "ПП-ДБ": 11.6,
      Възраждане: 5.8,
      БСП: 4,
      Сияние: 3.2,
      Величие: 2.9,
      ИТН: 1.7,
      АПС: 1.3,
    });
    expect(draft.refused.some((r) => r.field === "shares")).toBe(false);
  });

  run(
    "1044: a chart-only post resolves the passport from text but flags shares as needing the Vision fallback",
    async () => {
      const draft = await extractAlphaResearch(captureDir("1044"), "1044");

      // The passport IS in text for AR (unlike Trend) — resolved even
      // though the shares are not.
      expect(draft.poll.id).toBe("ar-2026-03-20");
      expect(draft.poll.respondents).toBe(1000);
      expect(draft.poll.fieldwork).toBe("Mar 12-20 2026");

      expect(draft.details).toEqual([]);
      expect(draft.genre).toBe("unclear"); // no base phrase in text either
      expect(
        draft.refused.some(
          (r) =>
            r.field === "shares" &&
            /chart-only post/.test(r.reason) &&
            /Vision fallback/.test(r.reason),
        ),
      ).toBe(true);
    },
  );

  run("1045: a second chart-only post, same shape as 1044", async () => {
    const draft = await extractAlphaResearch(captureDir("1045"), "1045");

    expect(draft.poll.id).toBe("ar-2026-03-26");
    expect(draft.poll.respondents).toBe(1000);
    expect(draft.poll.fieldwork).toBe("Mar 19-26 2026");
    expect(draft.details).toEqual([]);
    expect(draft.refused.some((r) => r.field === "shares")).toBe(true);
  });

  run(
    "provenance carries the capture's own URL/hash, never a fabricated one",
    async () => {
      const draft = await extractAlphaResearch(captureDir("1047"), "1047");
      expect(draft.poll.source).toMatch(/^https:\/\/alpharesearch\.bg\//);
      expect(draft.poll.provenance?.url).toBe(draft.poll.source);
      expect(draft.poll.provenance?.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(draft.poll.provenance?.extractor).toBe("AR");
    },
  );
});

describe("extractAlphaResearch — synthetic captures (no real binaries needed)", () => {
  let scratchRoot: string;

  beforeEach(() => {
    scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ar-extract-test-"));
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

  const SYNTHETIC_STAMP = {
    url: "https://alpharesearch.bg/post/test.html",
    fetchedAt: "2026-09-09T00:00:00.000Z",
    sha256: "b".repeat(64),
  };

  it("mints a provisional pubId-keyed id when no fieldwork date resolves", async () => {
    const dir = path.join(scratchRoot, "999");
    writeCapture(dir, {
      html:
        "<html><head><title>Тест — Алфа Рисърч</title></head><body>" +
        '<div id="content">ГЕРБ-СДС е на 20,4% подкрепа сред гласуващите.</div>' +
        "</body></html>",
      sourceJson: SYNTHETIC_STAMP,
    });

    const draft = await extractAlphaResearch(dir, "999");

    expect(draft.poll.id).toBe("ar-pub-999");
    expect(draft.refused).toContainEqual({
      field: "poll.id",
      reason:
        "no fieldwork end date resolved from the text — using a provisional pubId-keyed id",
      quote: "",
    });
  });

  it("classifies forecast genre when the text says 'прогноза'", async () => {
    const dir = path.join(scratchRoot, "999");
    writeCapture(dir, {
      html:
        "<html><head><title>Тест</title></head><body>" +
        '<div id="content">Прогноза за резултата: ГЕРБ-СДС е на 20,4% подкрепа сред гласуващите.</div>' +
        "</body></html>",
      sourceJson: SYNTHETIC_STAMP,
    });

    const draft = await extractAlphaResearch(dir, "999");
    expect(draft.genre).toBe("forecast");
  });

  it("throws a clear, capture-scoped error when SOURCE.json is missing", async () => {
    const dir = path.join(scratchRoot, "999");
    writeCapture(dir, { html: "<html><body>x</body></html>" });

    await expect(extractAlphaResearch(dir, "999")).rejects.toThrow(
      /extractAlphaResearch\(999\): missing or unreadable SOURCE\.json/,
    );
  });

  it("does NOT classify as forecast genre merely because 'прогноза' appears in an unrelated sentence", async () => {
    const dir = path.join(scratchRoot, "997");
    writeCapture(dir, {
      html:
        "<html><head><title>Тест</title></head><body>" +
        '<div id="content">ГЕРБ-СДС е на 20,4% подкрепа сред гласуващите. ' +
        "Икономическата прогноза на МВФ за страната остава положителна.</div>" +
        "</body></html>",
      sourceJson: SYNTHETIC_STAMP,
    });

    const draft = await extractAlphaResearch(dir, "997");
    // The forecast mention is a different, unrelated sentence — genre
    // stays raw_attitudes, the correctly-found base phrase.
    expect(draft.genre).toBe("raw_attitudes");
    expect(draft.poll.provenance?.quotes.forecastPhrase).toBeUndefined();
  });

  it("still classifies forecast genre when 'прогноза' shares the SAME sentence as the base phrase", async () => {
    const dir = path.join(scratchRoot, "996");
    writeCapture(dir, {
      html:
        "<html><head><title>Тест</title></head><body>" +
        '<div id="content">Прогнозата на агенцията сочи ГЕРБ-СДС с 20,4% сред гласуващите.</div>' +
        "</body></html>",
      sourceJson: SYNTHETIC_STAMP,
    });

    const draft = await extractAlphaResearch(dir, "996");
    expect(draft.genre).toBe("forecast");
    expect(draft.poll.provenance?.quotes.forecastPhrase).toContain(
      "Прогнозата",
    );
  });

  it("refuses — rather than guessing — when two different candidate sample sizes are found", async () => {
    const dir = path.join(scratchRoot, "995");
    writeCapture(dir, {
      html:
        "<html><head><title>Тест</title></head><body>" +
        '<div id="content">Отделно допитване сред 500 пълнолетни столичани показва различна картина. ' +
        "Изследването е проведено сред 1000 пълнолетни граждани от цялата страна. " +
        "Проучването е проведено в периода 1 - 5 март 2026г. " +
        "ГЕРБ-СДС е на 20,4% подкрепа сред гласуващите.</div>" +
        "</body></html>",
      sourceJson: SYNTHETIC_STAMP,
    });

    const draft = await extractAlphaResearch(dir, "995");
    expect(draft.poll.respondents).toBeNull();
    expect(draft.refused.some((r) => r.field === "sampleSize")).toBe(true);
  });

  it("still resolves the real fieldwork date when an earlier, unrelated 'в периода ...' phrase fails to parse", async () => {
    const dir = path.join(scratchRoot, "994");
    writeCapture(dir, {
      html:
        "<html><head><title>Тест</title></head><body>" +
        '<div id="content">Нестабилността в периода на предизборната кампания расте. ' +
        "Обем на извадката: 1000 души. " +
        "Проучването е проведено в периода 1 - 5 март 2026г. " +
        "ГЕРБ-СДС е на 20,4% подкрепа сред гласуващите.</div>" +
        "</body></html>",
      sourceJson: SYNTHETIC_STAMP,
    });

    const draft = await extractAlphaResearch(dir, "994");
    // The decoy phrase fails to parse and is skipped; the real, later
    // fieldwork statement is still found and used.
    expect(draft.poll.fieldwork).toBe("Mar 1-5 2026");
  });

  it("records a refusal when no sample-size pattern matches at all", async () => {
    const dir = path.join(scratchRoot, "993");
    writeCapture(dir, {
      html:
        "<html><head><title>Тест</title></head><body>" +
        '<div id="content">ГЕРБ-СДС е на 20,4% подкрепа сред гласуващите. Период на провеждане: 1 - 5 март 2026г.</div>' +
        "</body></html>",
      sourceJson: SYNTHETIC_STAMP,
    });

    const draft = await extractAlphaResearch(dir, "993");
    expect(draft.poll.respondents).toBeNull();
    expect(draft.refused.some((r) => r.field === "sampleSize")).toBe(true);
  });

  it("resolves the passport from text even when zero shares are found and an (undecodable) image is present", async () => {
    // Deliberately NOT asserting the "shares" chart-only refusal here:
    // that refusal now requires `looksLikeTable` (text_acquisition.ts),
    // which — correctly — needs a REAL OCR pass to ever be true (see
    // FINDING-004's fix), so a bogus, non-decodable image cannot prove
    // that branch fires. The real-capture tests (1044, 1045, above) are
    // what exercise it, gated on `tesseract` actually being present. This
    // test instead confirms the failure of one signal (shares) never
    // corrupts an unrelated one (the passport, resolved from text alone).
    const dir = path.join(scratchRoot, "992");
    writeCapture(dir, {
      html:
        "<html><head><title>Тест</title></head><body>" +
        '<div id="content">Обем на извадката: 1000 души. Период на провеждане: 1 - 5 март 2026г.</div>' +
        "</body></html>",
      sourceJson: SYNTHETIC_STAMP,
    });
    fs.writeFileSync(path.join(dir, "Graph1.jpg"), "not a real jpg");

    const draft = await extractAlphaResearch(dir, "992");
    expect(draft.details).toEqual([]);
    expect(draft.poll.respondents).toBe(1000);
    expect(draft.poll.fieldwork).toBe("Mar 1-5 2026");
  });
});
