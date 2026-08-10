import { describe, it, expect } from "vitest";
import { summariseNatoEditions } from "./eu_policy_anchors";

// No network: fingerprint() closes over fetchText, so the pure
// html → Fingerprint step is extracted and tested here instead.
//
// The links below are the real set served by NATO_DEFEXP_PAGE on 2026-08-10.
// Note the TWO path shapes and the uppercase ".PDF" — NATO moved the compendium
// from legacy-wcm to webready, which is why this watcher discovers editions from
// the page instead of probing a fixed URL.
const LEGACY_2021 =
  '<a href="/content/dam/nato/legacy-wcm/media_pdf/2022/3/pdf/220331-def-exp-2021-en.PDF">';
const LEGACY_2022 =
  '<a href="/content/dam/nato/legacy-wcm/media_pdf/2023/3/pdf/230321-def-exp-2022-en.pdf">';
const LEGACY_2024 =
  '<a href="/content/dam/nato/legacy-wcm/media_pdf/2024/6/pdf/240617-def-exp-2024-en.pdf">';
const WEBREADY = (y: number) =>
  `<a href="/content/dam/nato/webready/documents/finance/def-exp-${y}-en.pdf">`;

const PAGE = [
  LEGACY_2021,
  LEGACY_2022,
  LEGACY_2024,
  WEBREADY(2025),
  WEBREADY(2026),
].join("\n");

describe("summariseNatoEditions", () => {
  it("tracks the editions the comparators ship with", () => {
    const f = summariseNatoEditions(PAGE);
    expect(f.value).toBe("2025,2026");
    expect(f.meta).toEqual({ years: [2025, 2026] });
  });

  // The legacy path encodes the PUBLICATION date, which runs ahead of the
  // edition it carries: the 2024 edition was published under /2024/6/, so once
  // NATO is publishing in 2027 a legacy-shaped link reads /2027/N/…-def-exp-
  // 2026-en.pdf. A bare \b20\d{2}\b would harvest that path segment and invent
  // a 2027 edition that was never published — flipping the fingerprint and
  // sending someone to re-derive the defence options from a nonexistent PDF.
  it("reads the edition off the filename, not the archive path", () => {
    const publishedLate =
      '<a href="/content/dam/nato/legacy-wcm/media_pdf/2027/3/pdf/270321-def-exp-2026-en.pdf">';
    const f = summariseNatoEditions([WEBREADY(2025), publishedLate].join("\n"));
    expect(f.meta).toEqual({ years: [2025, 2026] });
    expect(f.value).toBe("2025,2026");
  });

  it("flips the fingerprint when the next edition lands", () => {
    const before = summariseNatoEditions(PAGE);
    const after = summariseNatoEditions([PAGE, WEBREADY(2027)].join("\n"));
    expect(after.value).not.toBe(before.value);
    expect(after.meta).toEqual({ years: [2025, 2026, 2027] });
  });

  // A page re-render that reorders or repeats links is not an upstream change.
  it("is stable against link order and duplication", () => {
    const shuffled = [
      WEBREADY(2026),
      LEGACY_2024,
      WEBREADY(2025),
      WEBREADY(2026),
      LEGACY_2021,
      LEGACY_2022,
    ].join("\n");
    expect(summariseNatoEditions(shuffled).value).toBe(
      summariseNatoEditions(PAGE).value,
    );
  });

  // The lower bound exists so the set only ever GROWS. Old editions staying on
  // the page must not enter the fingerprint, or every New Year would flip it.
  it("ignores editions below the tracked floor", () => {
    const f = summariseNatoEditions(
      [LEGACY_2021, LEGACY_2022, LEGACY_2024].join("\n"),
    );
    expect(f.value).toBe("");
    expect(f.meta).toEqual({ years: [] });
  });

  // Distinguishes "layout changed" from "edition not out yet" — the conflation
  // that made a refusal read as a broken URL pattern.
  it("throws only when the page carries no def-exp link at all", () => {
    expect(() =>
      summariseNatoEditions("<html><body>Defence expenditure</body></html>"),
    ).toThrow(/no def-exp-YYYY-en\.pdf link/);
  });
});
