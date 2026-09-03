// The CEC evidence links (§Phase 6 item 7) — reconciled against the corpus, not against
// themselves.
//
// ⚠ THESE HAD NO TEST AT ALL, on the one family where a wrong URL is invisible from here.
// Both links leave the site: a malformed one is a 404 on evideo.bg or results.cik.bg, which
// this repo cannot see, on 12,721 pages, next to a chip that promises the official protocol.
// The page renders perfectly either way and no count moves.
//
// ⚠ AND ASSERTING THE URL SHAPE AGAINST ITSELF WOULD BE VACUOUS — the builder is four string
// concatenations, so a test that rebuilds them proves only that the author typed the same
// thing twice. What is actually checkable offline is the CLAIM the builder rests on, which the
// module states in prose and nothing verified: "the path is grouped by the 2-digit electoral
// region". If a section's code does not begin with its own zero-padded region, the scan link
// points into another region's directory. Measured over all 12,721 stations of 2026-04-19:
// **0 violations**, so the claim holds — and the gate is what keeps it true through the next
// ingest.
//
// ⚠ THE ZERO PAD IS THE LOAD-BEARING PART. The corpus stores the region UNPADDED (`"1"`, not
// `"01"`) while the station code is padded, so a future "simplification" that used the region
// field directly would emit `/1/` and 404 every station in regions 1–9 — **4,120 of 12,721,
// 32.4% of the country** — while leaving regions 10–31 working, i.e. a failure that looks
// regional rather than systematic.
//
//   npm run test:unit

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { countVideoUrl, protocolScanUrl } from "./auditLinks";

const CYCLE = "2026_04_19";
const BY_OBLAST = path.join(
  process.cwd(),
  "data",
  CYCLE,
  "sections",
  "by-oblast",
);

type Station = { region?: string | number };
const corpus = (): Map<string, string> => {
  const out = new Map<string, string>();
  if (!fs.existsSync(BY_OBLAST)) return out;
  for (const f of fs
    .readdirSync(BY_OBLAST)
    .filter((f) => f.endsWith(".json"))) {
    const blob = JSON.parse(
      fs.readFileSync(path.join(BY_OBLAST, f), "utf8"),
    ) as Record<string, Station>;
    for (const [code, v] of Object.entries(blob))
      out.set(code, String(v?.region ?? ""));
  }
  return out;
};

const stations = corpus();
const haveCorpus = stations.size > 0;

describe("the region prefix the scan URL is built from", () => {
  it.skipIf(!haveCorpus)(
    "every station code begins with its own ZERO-PADDED electoral region",
    () => {
      // The one claim `auditLinks.ts` makes about the corpus rather than about itself.
      const wrong = [...stations].filter(
        ([code, region]) => code.slice(0, 2) !== region.padStart(2, "0"),
      );
      expect(wrong.slice(0, 5)).toEqual([]);
      expect(stations.size).toBeGreaterThan(10_000);
    },
  );

  it.skipIf(!haveCorpus)(
    "and a third of them are in a region the corpus stores UNPADDED",
    () => {
      // ⚠ WITHOUT THIS THE TEST ABOVE PASSES ON A CORPUS THAT PADS ITS OWN REGION FIELD, where
      // `region` and `code.slice(0,2)` are the same string and the pad is untested decoration.
      // It is not: 4,120 stations carry a one-character region, so the pad is what stands
      // between them and another directory.
      const single = [...stations.values()].filter((r) => r.length === 1);
      expect(single.length).toBeGreaterThan(1_000);
    },
  );

  it.skipIf(!haveCorpus)(
    "builds a scan URL for every real station code",
    () => {
      // Reconciles the GUARD against the corpus: `/^\d{9}$/` must admit the codes that exist,
      // not merely the ones the author had in mind. A guard that is too strict drops the
      // evidence chip silently — the same 200-with-less-on-it failure as an absent link.
      const missing = [...stations.keys()].filter(
        (code) => !protocolScanUrl(CYCLE, code) || !countVideoUrl(CYCLE, code),
      );
      expect(missing.slice(0, 5)).toEqual([]);
    },
  );

  it.skipIf(!haveCorpus)(
    "points each station at its own region's directory",
    () => {
      for (const [code, region] of [...stations].slice(0, 200)) {
        const url = protocolScanUrl(CYCLE, code)!;
        expect(url, code).toContain(
          `/${region.padStart(2, "0")}/${code}.0.pdf`,
        );
        expect(countVideoUrl(CYCLE, code), code).toContain(
          `/${region.padStart(2, "0")}.html#${code}`,
        );
      }
    },
  );
});

describe("an election the sources do not cover yields NO link", () => {
  it("omits both rather than guessing a portal", () => {
    // ⚠ A FABRICATED EVIDENCE LINK IS WORSE THAN NO CHIP. „Сканиран протокол" pointing at a
    // 404 asserts the state published a protocol we cannot actually show.
    expect(countVideoUrl("2021_04_04", "131900001")).toBeUndefined();
    expect(protocolScanUrl("2021_04_04", "131900001")).toBeUndefined();
  });

  it("omits the SCAN but keeps the video when only the scan id is unknown", () => {
    // 2024-10-27 has a portal and no `scanId`. The two links are independent sources and the
    // builder must not drop the one it can serve — nor invent an id for the one it cannot.
    expect(countVideoUrl("2024_10_27", "131900001")).toBe(
      "https://evideo.bg/pe202410/13.html#131900001",
    );
    expect(protocolScanUrl("2024_10_27", "131900001")).toBeUndefined();
  });

  it("refuses a code that is not a 9-digit station", () => {
    // The values a route param actually delivers: a settlement EKATTE, a composite Sofia
    // район id, an empty string. Each would otherwise build a plausible URL to nothing.
    for (const bad of [
      "55155",
      "68134-2401",
      "",
      "13190000",
      "1319000011",
      "abcdefghi",
    ]) {
      expect(countVideoUrl(CYCLE, bad), bad).toBeUndefined();
      expect(protocolScanUrl(CYCLE, bad), bad).toBeUndefined();
    }
  });
});
