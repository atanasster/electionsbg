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

// Pre-2017 AR posts are an empty page linking one Word attachment that
// carries every figure (measured: 871, 890, 918). These feed the converted
// attachment text in through `preAcquired`, so no Word converter is needed.
describe("extractAlphaResearch — attachment text", () => {
  let scratchRoot: string;
  beforeEach(() => {
    scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ar-attach-test-"));
  });
  afterEach(() => {
    fs.rmSync(scratchRoot, { recursive: true, force: true });
  });

  const EMPTY_PAGE =
    '<html><head><title>ЕЛЕКТОРАЛНИ НАГЛАСИ НА ФИНАЛА НА ПРЕДИЗБОРНАТА КАМПАНИЯ — Алфа Рисърч</title></head><body><div id="content">За повече информация от проучването, натиснете следния линк: report.doc</div></body></html>';
  const capture = (pubId: string): string => {
    const dir = path.join(scratchRoot, pubId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "page.html"), EMPTY_PAGE);
    fs.writeFileSync(
      path.join(dir, "SOURCE.json"),
      JSON.stringify({
        url: `https://alpharesearch.bg/post/${pubId}.html`,
        fetchedAt: "2026-09-27T00:00:00.000Z",
        sha256: "c".repeat(64),
      }),
    );
    return dir;
  };
  const acquired = (articleText: string, docText: string) => ({
    articleText,
    pdfTexts: [{ file: "report.doc", text: docText }],
    imageTexts: [],
  });

  it("reads shares and the passport from the attachment when the page carries none", async () => {
    const doc =
      "Изследването е проведено в периода 28–30.09. 2014г. сред 1100 пълнолетни граждани от цялата страна. " +
      // The real 890 table: share, then the projected seat range.
      "Прогноза за Парламентарни избори 2014 % от твърдо решилите да гласуват мандати " +
      "ГЕРБ 34.1% 98-100 БСП 19.1% 53-55 ДПС 15.4% 44-46";
    const draft = await extractAlphaResearch(
      capture("890"),
      "890",
      acquired("За повече информация от проучването", doc),
    );
    expect(draft.poll.id).toBe("ar-2014-09-30");
    expect(draft.poll.fieldwork).toBe("Sep 28-30 2014");
    expect(draft.poll.respondents).toBe(1100);
    expect(
      Object.fromEntries(draft.details.map((d) => [d.nickName_bg, d.support])),
    ).toEqual({ ГЕРБ: 34.1, БСП: 19.1, ДПС: 15.4 });
    // Every quote names the document it came from.
    expect(draft.poll.provenance?.quoteSources).toMatchObject({
      "share:ГЕРБ": "report.doc",
      sampleSize: "report.doc",
      fieldwork: "report.doc",
    });
  });

  it("keeps the article as the share source when it already carries enough shares", async () => {
    const article =
      "Проучването е проведено в периода 1 - 5 март 2026г. сред 1000 пълнолетни граждани. " +
      "ГЕРБ-СДС е с 20,4%. ПП-ДБ е с 12,6%. Възраждане е с 6,4%.";
    const draft = await extractAlphaResearch(
      capture("1050"),
      "1050",
      acquired(article, "ГЕРБ-СДС 99.9% ДПС 50.5% БСП 40.4%"),
    );
    expect(draft.details.map((d) => d.support).sort()).toEqual([
      12.6, 20.4, 6.4,
    ]);
    expect(draft.poll.provenance?.quoteSources).toBeUndefined();
  });

  it("refuses a number far from the party name, and an approximate figure", async () => {
    const doc =
      "Изследването е проведено в периода 20 – 22 март 2017г. сред 1033 пълнолетни граждани. " +
      "ГЕРБ (31.7%) и БСП (29.1%) водят. " +
      "ДПС, за която мнозина политици и анализатори сочеха, че ще е големият печеливш от изборите, губи ореола си (48% я виждат като губеща влияние). " +
      "Воля е с около 6.8% подкрепа.";
    const draft = await extractAlphaResearch(
      capture("918"),
      "918",
      acquired("", doc),
    );
    const labels = draft.details.map((d) => d.nickName_bg);
    expect(labels).toEqual(expect.arrayContaining(["ГЕРБ", "БСП"]));
    expect(labels).not.toContain("ДПС");
    expect(labels).not.toContain("Воля");
    expect(draft.refused.map((r) => r.reason).join("\n")).toMatch(
      /characters from the party name/,
    );
    expect(draft.refused.map((r) => r.reason).join("\n")).toMatch(
      /approximate or ranged figure/,
    );
  });

  it("refuses a party whose other mention was refused with a different number, rather than keeping the survivor", async () => {
    // Without the conflict rule, refusing the ranged "19-20%" left the
    // stray "80%" looking like БСП's only — uncontested — share.
    const doc =
      "Изследването е проведено в периода 28–30.09. 2014г. сред 1100 пълнолетни граждани. " +
      "ГЕРБ 34.1% ДПС 15.4% БСП остава втора политическа сила с около 19-20% от твърдо решилите. " +
      "Реформаторски блок 6.0% БСП 80% от симпатизантите й.";
    const draft = await extractAlphaResearch(
      capture("890"),
      "890",
      acquired("", doc),
    );
    expect(draft.details.map((d) => d.nickName_bg)).not.toContain("БСП");
  });
});

// Real Word attachment, converted the way production converts it
// (`textutil` on macOS, `antiword` elsewhere) — skipped where neither exists.
const HAS_DOC_CONVERTER =
  hasBinary("textutil", "-help") || hasBinary("antiword", "-h");
const runDoc = HAS_TESSERACT && HAS_DOC_CONVERTER ? it : it.skip;

describe("extractAlphaResearch — real Word attachment", () => {
  runDoc(
    "918: the March 2017 finals resolve from the .doc linked by an otherwise empty page",
    async () => {
      const draft = await extractAlphaResearch(captureDir("918"), "918");
      expect(draft.poll.id).toBe("ar-2017-03-22");
      expect(draft.poll.respondents).toBe(1033);
      expect(draft.poll.fieldwork).toBe("Mar 20-22 2017");
      const byLabel = Object.fromEntries(
        draft.details.map((d) => [d.nickName_bg, d.support]),
      );
      expect(byLabel).toMatchObject({ ГЕРБ: 31.7, БСП: 29.1 });
      expect(draft.poll.provenance?.quoteSources?.["share:ГЕРБ"]).toBe(
        "0317-Public_Opinion_Alpha_Research.doc",
      );
    },
  );
});
