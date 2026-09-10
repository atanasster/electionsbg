// Integration-flavored tests for the extract.ts CLI's own orchestration
// (argv parsing, agency/pub filtering, capture-directory enumeration,
// version-suffix handling, inbox-file writing). The extractors
// themselves (Trend, Alpha Research) are tested exhaustively against
// real captures in scripts/polls/extractors/*.test.ts; this file uses
// minimal synthetic captures throughout so it needs no real binaries.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __setExtractRootForTests, main, parseArgv } from "./extract";
import { assertCommitted } from "../lib/assert_committed";

// These path literals mirror the REAL committed corpus shape (extract.ts is
// redirected to a scratch root for every test below, so nothing here reads
// them) — asserted so a renamed/removed committed directory is caught here
// rather than only by a fixture silently drifting from reality.
assertCommitted("raw_data/polls", "data/polls/_inbox");

describe("parseArgv", () => {
  it("reads --agency and --pub", () => {
    expect(parseArgv(["--agency", "TR", "--pub", "212750"])).toEqual({
      agency: "TR",
      pub: "212750",
    });
  });

  it("defaults both to undefined", () => {
    expect(parseArgv([])).toEqual({ agency: undefined, pub: undefined });
  });

  it("does not swallow the next flag's name as a value", () => {
    expect(parseArgv(["--agency", "--pub"])).toEqual({
      agency: undefined,
      pub: undefined,
    });
  });
});

describe("main — orchestration (synthetic captures, real fs, redirected to a scratch dir)", () => {
  let scratchRoot: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  const writeSyntheticCapture = (
    agencyDirSlug: string,
    pubId: string,
    html: string,
  ) => {
    const dir = path.join(scratchRoot, "raw_data/polls", agencyDirSlug, pubId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "page.html"), html);
    fs.writeFileSync(
      path.join(dir, "SOURCE.json"),
      JSON.stringify({
        url: `https://example.test/${agencyDirSlug}/${pubId}`,
        fetchedAt: "2026-09-09T00:00:00.000Z",
        sha256: "c".repeat(64),
      }),
    );
    return dir;
  };

  const TR_HTML =
    "<html><head><title>Тест — ТРЕНД</title></head><body>" +
    '<div class="et_pb_text_inner">ГЕРБ-СДС е на 20,4% подкрепа.</div>' +
    "</body></html>";
  const AR_HTML =
    "<html><head><title>Тест</title></head><body>" +
    '<div id="content">ГЕРБ-СДС е на 20,4% подкрепа сред гласуващите. ' +
    "Обем на извадката: 1000 души. Период на провеждане: 1 - 5 март 2026г." +
    "</div></body></html>";

  const readInbox = (fileName: string): unknown =>
    JSON.parse(
      fs.readFileSync(
        path.join(scratchRoot, "data/polls/_inbox", fileName),
        "utf8",
      ),
    );

  beforeEach(() => {
    scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "polls-extract-test-"));
    __setExtractRootForTests(scratchRoot);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    __setExtractRootForTests(); // restore the real repo root
    fs.rmSync(scratchRoot, { recursive: true, force: true });
    logSpy.mockRestore();
    errorSpy.mockRestore();
    process.exitCode = undefined;
  });

  it("extracts every agency's every captured pubId when no filters are given", async () => {
    writeSyntheticCapture("trend", "111", TR_HTML);
    writeSyntheticCapture("alpha_research", "222", AR_HTML);

    await main([]);

    expect(readInbox("tr-pub-111.json")).toMatchObject({
      poll: { agencyId: "TR" },
    });
    expect(readInbox("ar-2026-03-05.json")).toMatchObject({
      poll: { agencyId: "AR" },
    });
  });

  it("--agency narrows to one agency", async () => {
    writeSyntheticCapture("trend", "111", TR_HTML);
    writeSyntheticCapture("alpha_research", "222", AR_HTML);

    await main(["--agency", "TR"]);

    expect(
      fs.existsSync(
        path.join(scratchRoot, "data/polls/_inbox/tr-pub-111.json"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(scratchRoot, "data/polls/_inbox/ar-2026-03-05.json"),
      ),
    ).toBe(false);
  });

  it("--pub (with --agency) narrows to one publication", async () => {
    writeSyntheticCapture("trend", "111", TR_HTML);
    writeSyntheticCapture("trend", "333", TR_HTML);

    await main(["--agency", "TR", "--pub", "111"]);

    expect(
      fs.existsSync(
        path.join(scratchRoot, "data/polls/_inbox/tr-pub-111.json"),
      ),
    ).toBe(true);
    // 333 was never even looked at — no error for a pubId that WOULD
    // have resolved fine, since --pub means "only this one".
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("refuses --pub without --agency", async () => {
    await main(["--pub", "111"]);
    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("--pub needs --agency"),
    );
  });

  it("refuses an unknown or unbuilt --agency", async () => {
    await main(["--agency", "ML"]); // ML has no built extractor yet
    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('unknown or unbuilt --agency "ML"'),
    );
  });

  it("reports a failure and sets a non-zero exit code without aborting other captures", async () => {
    writeSyntheticCapture("trend", "111", TR_HTML);
    // SOURCE.json present (so latestSuffixFor resolves this as a real
    // capture) but page.html missing — extractTrend throws; main must
    // still finish the OTHER capture.
    fs.mkdirSync(path.join(scratchRoot, "raw_data/polls/trend/444"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(scratchRoot, "raw_data/polls/trend/444/SOURCE.json"),
      JSON.stringify({
        url: "https://example.test/trend/444",
        fetchedAt: "2026-09-09T00:00:00.000Z",
        sha256: "c".repeat(64),
      }),
    );

    await main(["--agency", "TR"]);

    expect(process.exitCode).toBe(1);
    expect(
      fs.existsSync(
        path.join(scratchRoot, "data/polls/_inbox/tr-pub-111.json"),
      ),
    ).toBe(true);
    expect(
      errorSpy.mock.calls.some((c: unknown[]) =>
        String(c[0]).includes("FAILED TR 444"),
      ),
    ).toBe(true);
  });

  it("extracts a pubId's LATEST version only, and the draft's own filename carries the same version suffix", async () => {
    const base = writeSyntheticCapture("trend", "111", TR_HTML);
    // A re-fetch that changed content (decision 7) — captured as .v2.
    const v2 = `${base}.v2`;
    fs.mkdirSync(v2, { recursive: true });
    fs.writeFileSync(
      path.join(v2, "page.html"),
      TR_HTML.replace("20,4%", "21,0%"),
    );
    fs.writeFileSync(
      path.join(v2, "SOURCE.json"),
      JSON.stringify({
        url: "https://example.test/trend/111",
        fetchedAt: "2026-09-10T00:00:00.000Z",
        sha256: "d".repeat(64),
      }),
    );

    await main(["--agency", "TR", "--pub", "111"]);

    // The BASE draft (no version suffix) must NOT exist — only .v2's.
    expect(
      fs.existsSync(
        path.join(scratchRoot, "data/polls/_inbox/tr-pub-111.json"),
      ),
    ).toBe(false);
    const draft = readInbox("tr-pub-111.v2.json") as {
      poll: { provenance: { sha256: string } };
    };
    expect(draft.poll.provenance.sha256).toBe("d".repeat(64));
  });

  it("errors clearly when --pub names a pubId with no capture at all", async () => {
    await main(["--agency", "TR", "--pub", "999"]);
    expect(process.exitCode).toBe(1);
    expect(
      errorSpy.mock.calls.some((c: unknown[]) =>
        String(c[0]).includes("no capture found for TR 999"),
      ),
    ).toBe(true);
  });

  it("removes a stale provisional draft once a re-extraction resolves a real fieldwork date", async () => {
    // AR's passport lives in text (unlike Trend's, which is image-only and
    // needs real tesseract) — no "Период на провеждане" line at all means
    // extractAlphaResearch cannot resolve a fieldwork end, so this first
    // pass mints the provisional "ar-pub-555" id.
    const dir = writeSyntheticCapture(
      "alpha_research",
      "555",
      "<html><head><title>Тест</title></head><body>" +
        '<div id="content">ГЕРБ-СДС е на 20,4% подкрепа сред гласуващите. ' +
        "Обем на извадката: 1000 души.</div></body></html>",
    );
    await main(["--agency", "AR", "--pub", "555"]);
    expect(
      fs.existsSync(
        path.join(scratchRoot, "data/polls/_inbox/ar-pub-555.json"),
      ),
    ).toBe(true);

    // The passport now includes a resolvable fieldwork line — a real id
    // resolves this time.
    fs.writeFileSync(
      path.join(dir, "page.html"),
      "<html><head><title>Тест</title></head><body>" +
        '<div id="content">ГЕРБ-СДС е на 20,4% подкрепа сред гласуващите. ' +
        "Обем на извадката: 1000 души. Период на провеждане: 1 - 5 март 2026г." +
        "</div></body></html>",
    );
    await main(["--agency", "AR", "--pub", "555"]);

    expect(
      fs.existsSync(
        path.join(scratchRoot, "data/polls/_inbox/ar-2026-03-05.json"),
      ),
    ).toBe(true);
    // The stale provisional draft is gone — never a permanent second
    // identity for the same publication.
    expect(
      fs.existsSync(
        path.join(scratchRoot, "data/polls/_inbox/ar-pub-555.json"),
      ),
    ).toBe(false);
  });

  it("extracts the last COMPLETE version when the latest .vN directory has no SOURCE.json yet", async () => {
    const base = writeSyntheticCapture("trend", "111", TR_HTML);
    // A crashed --force re-fetch: page.html written, SOURCE.json never
    // reached (fetch.ts writes it last) — this version must not count as
    // "latest" or the good base capture becomes unreachable.
    const v2 = `${base}.v2`;
    fs.mkdirSync(v2, { recursive: true });
    fs.writeFileSync(path.join(v2, "page.html"), TR_HTML);

    await main(["--agency", "TR", "--pub", "111"]);

    expect(process.exitCode).toBeUndefined();
    expect(
      fs.existsSync(
        path.join(scratchRoot, "data/polls/_inbox/tr-pub-111.json"),
      ),
    ).toBe(true);
  });

  it("isolates a failure that occurs BEFORE a later successful capture in the same batch", async () => {
    // Named so the broken one sorts first — capturedPubIds returns pubIds
    // sorted lexicographically, and the try/catch is fully contained
    // inside extractOne's own loop iteration, so ordering provably
    // cannot matter; this demonstrates the reverse of the existing
    // "success then failure" case.
    fs.mkdirSync(path.join(scratchRoot, "raw_data/polls/trend/044"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(scratchRoot, "raw_data/polls/trend/044/SOURCE.json"),
      JSON.stringify({
        url: "https://example.test/trend/044",
        fetchedAt: "2026-09-09T00:00:00.000Z",
        sha256: "c".repeat(64),
      }),
    );
    writeSyntheticCapture("trend", "555", TR_HTML);

    await main(["--agency", "TR"]);

    expect(process.exitCode).toBe(1);
    expect(
      errorSpy.mock.calls.some((c: unknown[]) =>
        String(c[0]).includes("FAILED TR 044"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(scratchRoot, "data/polls/_inbox/tr-pub-555.json"),
      ),
    ).toBe(true);
  });

  it("routes a presidential-titled TR capture to extractTrendPresidential via the title-only fast path, and still extracts a parliamentary one in the same batch", async () => {
    // Tier 4b: `extractTrendDispatch`'s own title-only fast path
    // (`classifyTitle`, no OCR/PDF acquisition paid) routes a title that
    // states the race outright ("президентски избори") straight to
    // `extractTrendPresidential` — this used to be the refusal path
    // (presidential extraction "not built for TR yet"), and this test's
    // own name/assertions changed WITH that feature landing rather than
    // pinning the now-obsolete refusal behavior.
    const TR_PRESIDENTIAL_HTML =
      "<html><head><title>Президентски избори 2026 — ТРЕНД</title></head>" +
      '<body><div class="et_pb_text_inner">...</div></body></html>';
    writeSyntheticCapture("trend", "666", TR_PRESIDENTIAL_HTML);
    writeSyntheticCapture("trend", "555", TR_HTML);

    await main(["--agency", "TR"]);

    expect(
      errorSpy.mock.calls.some((c: unknown[]) =>
        String(c[0]).includes("FAILED TR 666"),
      ),
    ).toBe(false);
    expect(
      fs.existsSync(
        path.join(scratchRoot, "data/polls/_inbox/tr-pub-666.json"),
      ),
    ).toBe(true);
    const presidentialDraft = JSON.parse(
      fs.readFileSync(
        path.join(scratchRoot, "data/polls/_inbox/tr-pub-666.json"),
        "utf8",
      ),
    );
    expect(presidentialDraft.race).toBe("presidential");
    // The parliamentary capture in the same batch is unaffected.
    expect(
      fs.existsSync(
        path.join(scratchRoot, "data/polls/_inbox/tr-pub-555.json"),
      ),
    ).toBe(true);
  });

  it("routes a TITLE-ambiguous TR capture via the body-text-informed fallback (acquireText + classifyRace), not just the title-only fast path", async () => {
    // Neither classifyTitle branch fires for this title — the dispatcher's
    // THIRD branch (acquireText + classifyRace over the article body) is
    // what has to resolve this one, exercising a code path the two
    // title-only tests above never reach.
    const TR_AMBIGUOUS_TITLE_PRESIDENTIAL_HTML =
      "<html><head><title>Ноемврийско проучване — ТРЕНД</title></head><body>" +
      '<div class="et_pb_text_inner">Резултати от допитването за предстоящите президентски избори.</div>' +
      "</body></html>";
    writeSyntheticCapture("trend", "777", TR_AMBIGUOUS_TITLE_PRESIDENTIAL_HTML);

    await main(["--agency", "TR"]);

    expect(
      errorSpy.mock.calls.some((c: unknown[]) =>
        String(c[0]).includes("FAILED TR 777"),
      ),
    ).toBe(false);
    const draft = JSON.parse(
      fs.readFileSync(
        path.join(scratchRoot, "data/polls/_inbox/tr-pub-777.json"),
        "utf8",
      ),
    );
    expect(draft.race).toBe("presidential");
  });

  it("GM (Tier 4 T4.1, presidential-only) is wired into --agency dispatch, via its title-only fast path", async () => {
    // Title explicitly states "parliamentary" — extractGlobalMetrics's
    // OWN title-only fast path (classifyTitle(title) === "parliamentary")
    // fires before acquireText, so this synthetic capture needs no PDF
    // attachments at all and still proves two things at once: GM reaches
    // its real extractor through main()'s dispatch, and that fast path
    // itself is exercised somewhere (it otherwise has no coverage — a
    // capture whose title is merely AMBIGUOUS, like a bare agency name,
    // falls through to the slower classifyRace-default guard instead,
    // which is what global_metrics.test.ts's own "throws when classifyRace
    // resolves parliamentary" case covers).
    const GM_PARLIAMENTARY_HTML =
      "<html><head><title>Парламентарни избори 2026 — Global Metrics</title></head><body></body></html>";
    writeSyntheticCapture("global_metrics", "777", GM_PARLIAMENTARY_HTML);

    await main(["--agency", "GM"]);

    expect(process.exitCode).toBe(1);
    expect(
      errorSpy.mock.calls.some(
        (c: unknown[]) =>
          String(c[0]).includes("FAILED GM 777") &&
          String(c[0]).includes('title alone resolves to "parliamentary"'),
      ),
    ).toBe(true);
  });
});
