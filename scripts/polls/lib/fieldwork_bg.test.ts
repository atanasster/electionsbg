import { describe, expect, it } from "vitest";
import { parseBgFieldworkRange } from "./fieldwork_bg";

describe("parseBgFieldworkRange", () => {
  it("parses a same-month day range (real Trend passport text)", () => {
    expect(parseBgFieldworkRange("12-18 февруари 2026")).toEqual({
      startIso: "2026-02-12",
      endIso: "2026-02-18",
      fieldwork: "Feb 12-18 2026",
    });
    expect(parseBgFieldworkRange("13-16 април 2026")).toEqual({
      startIso: "2026-04-13",
      endIso: "2026-04-16",
      fieldwork: "Apr 13-16 2026",
    });
  });

  it("tolerates a trailing 'г.' / 'г' (Bulgarian 'year' abbreviation) — real OCR'd passport text", () => {
    // Trend's own passport slides always carry it ("13-19 март 2026 г.",
    // measured across all 3 real captures), and tesseract routinely drops
    // the trailing period.
    expect(parseBgFieldworkRange("12-18 февруари 2026 г.")).toEqual({
      startIso: "2026-02-12",
      endIso: "2026-02-18",
      fieldwork: "Feb 12-18 2026",
    });
    expect(parseBgFieldworkRange("13-19 март 2026 г")).toEqual({
      startIso: "2026-03-13",
      endIso: "2026-03-19",
      fieldwork: "Mar 13-19 2026",
    });
    expect(parseBgFieldworkRange("30 март – 5 април 2026 г.")).toEqual({
      startIso: "2026-03-30",
      endIso: "2026-04-05",
      fieldwork: "Mar 30 - Apr 5 2026",
    });
  });

  it("parses a same-month range with a spelled-out en dash and NBSP", () => {
    expect(parseBgFieldworkRange("7 – 14 април 2026")).toEqual({
      startIso: "2026-04-07",
      endIso: "2026-04-14",
      fieldwork: "Apr 7-14 2026",
    });
  });

  it("parses a cross-month range", () => {
    expect(parseBgFieldworkRange("30 март – 5 април 2026")).toEqual({
      startIso: "2026-03-30",
      endIso: "2026-04-05",
      fieldwork: "Mar 30 - Apr 5 2026",
    });
  });

  it("parses a single day", () => {
    expect(parseBgFieldworkRange("19 април 2026")).toEqual({
      startIso: "2026-04-19",
      endIso: "2026-04-19",
      fieldwork: "Apr 19 2026",
    });
  });

  it("returns null for text matching none of the three shapes", () => {
    expect(parseBgFieldworkRange("garbage")).toBeNull();
    expect(parseBgFieldworkRange("")).toBeNull();
  });

  it("returns null for an unrecognised month name rather than throwing", () => {
    expect(parseBgFieldworkRange("12-18 невалиден 2026")).toBeNull();
  });

  it("returns null (not a throw) for an unrepresentable date — formatFieldwork's own guard", () => {
    // 31 April does not exist.
    expect(parseBgFieldworkRange("31 април 2026")).toBeNull();
  });
});
