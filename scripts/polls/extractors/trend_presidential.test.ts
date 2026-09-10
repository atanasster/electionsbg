import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { latestVersionSuffix } from "../lib/capture";
import { assertCommitted } from "../../lib/assert_committed";
import { extractTrendPresidential } from "./trend_presidential";

// The real-capture suites below resolve their fixtures out of this tree with
// `existsSync`, so a missing tree does not fail them — `latestVersionSuffix`
// simply finds no version and the bare path is used. 31 files are tracked here,
// and CI does a full checkout, so absence is a broken working copy rather than
// a supported state. Asserted at module scope, OUTSIDE the tesseract gate, so
// it still runs on a machine that skips every OCR test.
assertCommitted("raw_data/polls/trend");

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
// Resolves the LATEST version of a real capture (`.v2`, `.v3`, …) rather
// than assuming the bare directory is current — exactly `extract.ts`'s own
// `latestSuffixFor` logic, reused here rather than a second copy. A prior
// version of this test hardcoded the bare pubId and silently kept testing
// against a STALE, incomplete capture (a63a09b7af8f2976, pre-`.v2`, had zero
// images) after `a63a09b7af8f2976.v2` was fetched with the missing "Други"
// chart image — this is the fix.
//
// Named distinctly from `lib/capture.ts`'s own EXPORTED `captureDir`
// (agencyId + pubId → base path, no version resolution) — the two do
// materially different things and sharing a name is a latent trap for a
// future edit that imports the real one alongside this local helper.
const latestTrendCaptureDir = (pubId: string): string => {
  const base = path.join(REPO_ROOT, "raw_data/polls/trend", pubId);
  const suffix = latestVersionSuffix((s) =>
    fs.existsSync(path.join(`${base}${s}`, "SOURCE.json")),
  );
  return `${base}${suffix ?? ""}`;
};

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
    "[trend_presidential.test] tesseract not found on PATH — skipping the OCR-dependent real-capture tests (2016's `.v2` chart images, 2021's passport slide).",
  );
}
// 2016 needs this too now: `a63a09b7af8f2976.v2` (fetched after the
// AGENCY_IMAGE_PATTERNS.TR widening) carries the zadl*.png chart images,
// and this extractor OCRs every image in a capture directory (via
// `acquireText`) regardless of whether it ends up using the result. Both
// real-capture tests share this one gate now — there is no case-specific
// difference between them any more.
const runOcr = HAS_TESSERACT ? it : it.skip;

describe("extractTrendPresidential — real captures", () => {
  runOcr(
    '2016 (a63a09b7af8f2976.v2): a presidential-only page whose candidate ranking is in PROSE, but whose chart image (zadl8.png) names a "Други" residual row the prose never states — resolves fieldwork, sample size, cycle and 9 candidates including 7 real ticket keys, and REFUSES the residual rather than guessing it',
    async () => {
      const draft = await extractTrendPresidential(
        latestTrendCaptureDir("a63a09b7af8f2976"),
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
      // The ONE expected refusal — a "Други" row the chart names but this
      // extractor cannot reliably read a value for (see trend_presidential.ts's
      // own header for why the OCR is not decodable without already knowing
      // the answer). Never a fabricated number.
      expect(draft.refused).toHaveLength(1);
      expect(draft.refused[0]).toMatchObject({
        field: "residual.otherNamedMinor",
      });
      expect(draft.refused[0].quote).toMatch(/Други/);
      expect(draft.residual).toBeNull();

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
    },
  );

  runOcr(
    "2021 (a19cfbc0c6dad528): a JOINT parliamentary+presidential page — reads candidate shares from clean article prose, never the OCR'd (and %-mangled) passport slide, and stays provisional when the OCR'd fieldwork can't be parsed",
    async () => {
      const draft = await extractTrendPresidential(
        latestTrendCaptureDir("a19cfbc0c6dad528"),
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
      // Slide4.png's own OCR names a "Други" row too (the article's 7
      // candidates alone sum to only 93.2%) — refused for the identical
      // reason 2016's chart is: not reliably decodable from this OCR
      // without already knowing the expected answer.
      //
      // This capture is the ONE fixture that can actually exercise the
      // per-image scoping fix: it has TWO "Други"-bearing images —
      // Slide3.png (the PARLIAMENTARY results chart, its own unrelated
      // small-party residual) and Slide4.png (presidential, the real one).
      // A regression to a bare cross-image substring search would produce
      // this exact SAME field name, just quoting Slide3's "5.99," instead
      // — so asserting field presence alone would not catch it; the quote
      // content is the only thing that actually pins which image won.
      const residualRefusal = draft.refused.find(
        (r) => r.field === "residual.otherNamedMinor",
      );
      expect(residualRefusal?.quote).toContain("6.896"); // Slide4's presidential row
      expect(residualRefusal?.quote).not.toMatch(/5[.,]99|ГЕРБ|БСП|ВМРО/); // never Slide3's parliamentary one
      expect(draft.residual).toBeNull();

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
      latestTrendCaptureDir("a63a09b7af8f2976"),
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
