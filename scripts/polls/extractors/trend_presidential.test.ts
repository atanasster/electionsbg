import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractTrendPresidential } from "./trend_presidential";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const captureDir = (pubId: string): string =>
  path.join(REPO_ROOT, "raw_data/polls/trend", pubId);

// Same hermeticity concern (and the same fix) as trend.test.ts's own real-
// capture suite: 2021's capture OCRs a real passport image via the real
// tesseract binary through `acquireText`.
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
    "[trend_presidential.test] tesseract not found on PATH — skipping the 2021 real-capture test.",
  );
}
const run2021 = HAS_TESSERACT ? it : it.skip;

describe("extractTrendPresidential — real captures", () => {
  it("2016 (a63a09b7af8f2976): a presidential-only, prose-only page — resolves fieldwork, sample size, cycle and 9 candidates including 7 real ticket keys", async () => {
    const draft = await extractTrendPresidential(
      captureDir("a63a09b7af8f2976"),
      "a63a09b7af8f2976",
    );

    expect(draft.race).toBe("presidential");
    expect(draft.genre).toBe("raw_attitudes");
    expect(draft.poll.id).toBe("tr-2016-10-26");
    expect(draft.poll.respondents).toBe(1004);
    expect(draft.poll.fieldwork).toBe("Oct 19-26 2016");
    expect(draft.poll.provenance?.fieldworkStart).toBe("2016-10-19");
    expect(draft.poll.provenance?.fieldworkEnd).toBe("2016-10-26");
    expect(draft.poll.cycle).toBe("2016_11_06_pvr");
    expect(draft.poll.electionDate).toBe("2016-11-06");
    expect(draft.refused).toEqual([]);

    const byName = Object.fromEntries(
      draft.details.map((d) => [d.candidateName_bg, d]),
    );
    expect(Object.keys(byName)).toHaveLength(9);
    expect(byName["Цецка Цачева"].support).toBe(27.3);
    expect(byName["Румен Радев"].support).toBe(24);
    expect(byName["Не подкрепям никого"]).toMatchObject({
      candidateKey: "none",
      support: 7.1,
    });

    // Resolved against the real 2016_11_06_pvr/tickets.json — a REAL
    // canonicalKey, not a disposable `provisional:` slug, for every
    // candidate whose article-printed name matches their registered
    // name's outer two tokens.
    expect(byName["Румен Радев"].candidateKey).toBe("румен георгиев радев");
    expect(byName["Красимир Каракачанов"].candidateKey).toBe(
      "красимир дончев каракачанов",
    );
    // "Цецка Цачева" and "Татяна Дончева" stay provisional — both are
    // publicly known by a PATRONYMIC used as if it were a surname
    // ("Цецка Цачева Данговска", "Татяна Дончева Тотева" — the real
    // surname is the THIRD word), which `candidate_resolver.ts`'s
    // documented first+last-token rule cannot bridge. Refusing rather
    // than guessing here is that module's own intended behavior, not a
    // gap in this extractor.
    expect(byName["Цецка Цачева"].candidateKey).toMatch(/^provisional:/);
    expect(byName["Татяна Дончева"].candidateKey).toMatch(/^provisional:/);

    for (const d of draft.details) {
      expect(draft.evidence[`share:${d.candidateName_bg}`]).toBeTruthy();
    }
  });

  run2021(
    "2021 (a19cfbc0c6dad528): a JOINT parliamentary+presidential page — reads candidate shares from clean article prose, never the OCR'd (and %-mangled) passport slide, and stays provisional when the OCR'd fieldwork can't be parsed",
    async () => {
      const draft = await extractTrendPresidential(
        captureDir("a19cfbc0c6dad528"),
        "a19cfbc0c6dad528",
      );

      expect(draft.race).toBe("presidential");
      expect(draft.genre).toBe("raw_attitudes");
      expect(draft.poll.respondents).toBe(1013);
      // The OCR'd passport line is garbled beyond parsing on this real
      // capture — the honest degrade is a provisional id, never a guess.
      expect(draft.poll.id).toBe("tr-pub-a19cfbc0c6dad528");
      expect(draft.poll.cycle).toBeNull();
      expect(
        draft.refused.some(
          (r) =>
            r.field === "fieldwork" && r.reason.includes("could not parse"),
        ),
      ).toBe(true);

      const byName = Object.fromEntries(
        draft.details.map((d) => [d.candidateName_bg, d]),
      );
      expect(Object.keys(byName)).toHaveLength(7);
      // Values match the ARTICLE's clean prose, not the OCR'd slide's
      // mangled "46.896" / "24.49" / etc.
      expect(byName["Румен Радев"].support).toBe(46.8);
      expect(byName["Анастас Герджиков"].support).toBe(24.4);
      expect(byName["Мустафа Карадайъ"].support).toBe(9.9);
      expect(byName["Лозан Панов"].support).toBe(6.4);
      expect(byName["Костадин Костадинов"].support).toBe(3.1);
      expect(byName["Милен Михов"].support).toBe(1.6);
      expect(byName["Луна Йорданова"].support).toBe(1);

      // The VP half of every hyphen-joined pair must never leak in as its
      // own row, and neither must a PARLIAMENTARY figure from earlier in
      // the same joint release (both real, measured false-positive risks
      // this extractor's own `presidentialSection` sectioning exists to
      // rule out).
      expect(byName["Илияна Йотова"]).toBeUndefined();
      expect(byName["Демократична България"]).toBeUndefined();
      expect(byName["Красимир Каракачанов"]).toBeUndefined();

      // No 2021_11_14_pvr tickets to resolve against (cycle unresolved),
      // so every candidate stays provisional.
      for (const d of draft.details) {
        expect(d.candidateKey).toMatch(/^provisional:/);
      }
    },
  );

  it("provenance carries the capture's own URL/hash, never a fabricated one", async () => {
    const draft = await extractTrendPresidential(
      captureDir("a63a09b7af8f2976"),
      "a63a09b7af8f2976",
    );
    expect(draft.poll.source).toMatch(/^https:\/\/rctrend\.bg\//);
    expect(draft.poll.provenance?.url).toBe(draft.poll.source);
    expect(draft.poll.provenance?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(draft.poll.provenance?.extractor).toBe("TR");
  });
});

describe("extractTrendPresidential — synthetic captures (no real binaries needed)", () => {
  let scratchRoot: string;

  beforeEach(() => {
    scratchRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "trend-presidential-extract-test-"),
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

  const SYNTHETIC_STAMP = {
    url: "https://rctrend.bg/project/test/",
    fetchedAt: "2026-09-09T00:00:00.000Z",
    sha256: "a".repeat(64),
  };

  it("throws when the title alone resolves to parliamentary", async () => {
    const dir = path.join(scratchRoot, "999");
    writeCapture(dir, {
      html:
        "<html><head><title>Парламентарни избори — ТРЕНД</title></head>" +
        '<body><div class="et_pb_text_inner">нищо</div></body></html>',
      sourceJson: SYNTHETIC_STAMP,
    });

    await expect(extractTrendPresidential(dir, "999")).rejects.toThrow(
      /title alone resolves to "parliamentary"/,
    );
  });

  it("throws when classifyRace resolves to parliamentary from the body text", async () => {
    const dir = path.join(scratchRoot, "999");
    writeCapture(dir, {
      html:
        "<html><head><title>Проучване — ТРЕНД</title></head><body>" +
        '<div class="et_pb_text_inner">Резултати за предстоящите парламентарни избори.</div>' +
        "</body></html>",
      sourceJson: SYNTHETIC_STAMP,
    });

    await expect(extractTrendPresidential(dir, "999")).rejects.toThrow(
      /classifyRace resolved "parliamentary"/,
    );
  });

  it("throws a clear, capture-scoped error when SOURCE.json is missing", async () => {
    const dir = path.join(scratchRoot, "999");
    writeCapture(dir, {
      html:
        "<html><head><title>Президентски избори — ТРЕНД</title></head>" +
        "<body></body></html>",
    });

    await expect(extractTrendPresidential(dir, "999")).rejects.toThrow(
      /extractTrendPresidential\(999\): missing or unreadable SOURCE\.json/,
    );
  });

  it("mints a provisional pubId-keyed id when no fieldwork resolves at all", async () => {
    const dir = path.join(scratchRoot, "999");
    writeCapture(dir, {
      html:
        "<html><head><title>Президентски избори — ТРЕНД</title></head><body>" +
        '<div class="et_pb_text_inner">Цецка Цачева с 27,3% от заявилите, че ще гласуват.</div>' +
        "</body></html>",
      sourceJson: SYNTHETIC_STAMP,
    });

    const draft = await extractTrendPresidential(dir, "999");
    expect(draft.poll.id).toBe("tr-pub-999");
    expect(draft.poll.cycle).toBeNull();
    expect(draft.details).toHaveLength(1);
    expect(draft.details[0]).toMatchObject({
      candidateName_bg: "Цецка Цачева",
      support: 27.3,
    });
    expect(draft.refused).toContainEqual({
      field: "poll.id",
      reason:
        "no fieldwork end date resolved — using a provisional pubId-keyed id",
      quote: "",
    });
  });
});
