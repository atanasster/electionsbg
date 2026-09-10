import { describe, expect, it } from "vitest";
import {
  fieldworkEndMs,
  formatFieldwork,
  isFuzzyFieldwork,
  isRealIsoDate,
  localizeFieldwork,
  parseFieldworkEnd,
  pollId,
} from "./fieldwork";

// The two halves of the contract must agree: anything the WRITER emits, the
// READER must resolve to the same end date. A drift here mints a poll id from a
// string the parser reads differently, which is how one poll lands twice.
describe("formatFieldwork ↔ parseFieldworkEnd round-trip", () => {
  const cases: [string | null, string, string][] = [
    // start, end, expected canonical string
    ["2026-03-12", "2026-03-20", "Mar 12-20 2026"],
    ["2026-02-23", "2026-03-02", "Feb 23 - Mar 2 2026"],
    ["2026-03-19", "2026-03-19", "Mar 19 2026"],
    // ⚠️ The "through" form pads its day and the other three do not. That is the
    // committed corpus's asymmetry (`through Jul 05 2021` beside
    // `Feb 27 - Mar 3 2024`), pinned here and re-asserted over the real data in
    // polls_corpus.test.ts.
    [null, "2026-03-02", "through Mar 02 2026"],
    [null, "2026-03-19", "through Mar 19 2026"],
    // Boundary days — a January 1 and a December 31 must not fall out of the
    // month table's ends.
    ["2026-01-01", "2026-01-01", "Jan 1 2026"],
    ["2026-12-01", "2026-12-31", "Dec 1-31 2026"],
    // A leap day is a real date and must survive both halves.
    ["2024-02-28", "2024-02-29", "Feb 28-29 2024"],
  ];

  it.each(cases)("writes (%s → %s) as %s and reads it back", (s, e, want) => {
    const written = formatFieldwork(s, e);
    expect(written).toBe(want);
    expect(parseFieldworkEnd(written)).toBe(e);
  });

  it("never emits a form the reader can only resolve fuzzily", () => {
    for (const [s, e] of cases) {
      expect(isFuzzyFieldwork(formatFieldwork(s, e))).toBe(false);
    }
  });

  it("normalises padded inputs rather than refusing them", () => {
    expect(formatFieldwork("  2026-03-12 ", " 2026-03-20 ")).toBe(
      "Mar 12-20 2026",
    );
  });
});

describe("parseFieldworkEnd", () => {
  it("reads every form the corpus contains", () => {
    expect(parseFieldworkEnd("Mar 12-20 2026")).toBe("2026-03-20");
    expect(parseFieldworkEnd("Feb 23 - Mar 2 2026")).toBe("2026-03-02");
    expect(parseFieldworkEnd("Mar 19 2026")).toBe("2026-03-19");
    expect(parseFieldworkEnd("through Mar 2 2026")).toBe("2026-03-02");
    expect(parseFieldworkEnd("through Jul 05 2021")).toBe("2021-07-05");
  });

  // The `through` branch carries /i and the other three do not; they survive a
  // case variant only because [A-Za-z]{3} is already case-blind. Nothing pinned
  // that before.
  it("is case-blind on the month across every exact form", () => {
    expect(parseFieldworkEnd("MAR 19 2026")).toBe("2026-03-19");
    expect(parseFieldworkEnd("mar 19 2026")).toBe("2026-03-19");
    expect(parseFieldworkEnd("THROUGH Mar 2 2026")).toBe("2026-03-02");
    expect(parseFieldworkEnd("FEB 23 - MAR 2 2026")).toBe("2026-03-02");
  });

  // Widened deliberately: the upstream sources use en/em dashes, scrape_polls
  // has always folded them before writing, and the UI's own parser accepted
  // them. A reader stricter than both writers drops the poll from scoring
  // while it still renders — the silent failure the module exists to prevent.
  it("folds en/em dashes to ASCII, as the writers do", () => {
    expect(parseFieldworkEnd("Feb 23 – Mar 2 2026")).toBe("2026-03-02");
    expect(parseFieldworkEnd("Mar 12–20 2026")).toBe("2026-03-20");
    expect(parseFieldworkEnd("Mar 12—20 2026")).toBe("2026-03-20");
  });

  it("classifies as fuzzy exactly what it could not read exactly", () => {
    // Mutation-resistant: EXACT_FORMS is one array read by both the parser and
    // isFuzzyFieldwork, so a fifth exact form cannot be reported as fuzzy. The
    // round-trip test above cannot cover this — it only exercises the forms
    // formatFieldwork emits.
    for (const s of [
      "through Mar 2 2026",
      "through Jul 05 2021",
      "Feb 23 - Mar 2 2026",
      "Mar 12-20 2026",
      "Mar 19 2026",
      "MAR 19 2026",
    ]) {
      expect(parseFieldworkEnd(s)).not.toBeNull();
      expect(isFuzzyFieldwork(s)).toBe(false);
    }
  });

  // The mid-month fallback is inherited history (a re-imported seed), not a
  // form any writer may produce — see the module header.
  it("resolves a month-only string to mid-month and marks it fuzzy", () => {
    expect(parseFieldworkEnd("Mar 2024")).toBe("2024-03-15");
    expect(isFuzzyFieldwork("Mar 2024")).toBe(true);
    expect(parseFieldworkEnd("March 2024")).toBe("2024-03-15");
    expect(parseFieldworkEnd("Early Jul 2019")).toBe("2019-07-15");
    expect(isFuzzyFieldwork("Early Jul 2019")).toBe(true);
  });

  // The fuzzy branch used to be unanchored and leftmost-matching, so a function
  // named …End returned a range's START, non-null, and the row stayed in
  // scoring with a fabricated daysBefore.
  it("refuses a spelled-out range rather than returning its start", () => {
    expect(parseFieldworkEnd("Dec 2025 - Jan 2026")).toBeNull();
    expect(parseFieldworkEnd("Mar 2025 and Apr 2026")).toBeNull();
    expect(parseFieldworkEnd("fieldwork ran Mar 2026 sometime")).toBeNull();
  });

  it("refuses a month name it only matched as a substring", () => {
    // "Mayor 2026" resolved to May while [a-z]* accepted any suffix.
    expect(parseFieldworkEnd("Mayor 2026")).toBeNull();
    expect(parseFieldworkEnd("Augment 2026")).toBeNull();
  });

  it("returns null rather than guessing at an unreadable string", () => {
    expect(parseFieldworkEnd("")).toBeNull();
    expect(parseFieldworkEnd("някога през пролетта")).toBeNull();
    expect(parseFieldworkEnd("Foo 12 2026")).toBeNull();
    // An unparseable string is not fuzzy — it is absent. The distinction
    // matters: a gate that conflated them would let an unreadable fieldwork
    // through as "inherited".
    expect(isFuzzyFieldwork("Foo 12 2026")).toBe(false);
  });

  it("keeps the trailing-note form UNREADABLE, as the corpus's md-2013-05-10 is", () => {
    // `data/polls/polls.json` carries exactly one such string. It parses to
    // null today, which is why that poll is not scored — asserted here so a
    // future loosening of the parser is a deliberate decision with a visible
    // consequence (the 2013 election gains an agency row) rather than a
    // side effect.
    expect(
      parseFieldworkEnd("May 8 2013 (per Wikipedia table — single-date entry)"),
    ).toBeNull();
  });
});

describe("formatFieldwork refusals", () => {
  it("refuses a date that is not real", () => {
    expect(() => formatFieldwork("2026-02-30", "2026-03-02")).toThrow(
      /not a real date/,
    );
    expect(() => formatFieldwork(null, "2026-13-01")).toThrow(
      /not a real date/,
    );
    expect(() => formatFieldwork(null, "19 Mar 2026")).toThrow(
      /not a real date/,
    );
  });

  it("refuses fieldwork that ends before it starts", () => {
    expect(() => formatFieldwork("2026-03-20", "2026-03-12")).toThrow(
      /ends before it starts/,
    );
  });

  it("refuses a range spanning two years, which no accepted form can carry", () => {
    expect(() => formatFieldwork("2025-12-28", "2026-01-04")).toThrow(
      /spans two years/,
    );
  });
});

describe("isRealIsoDate", () => {
  it("accepts real days and rejects impossible ones", () => {
    expect(isRealIsoDate("2026-03-19")).toBe(true);
    expect(isRealIsoDate("2024-02-29")).toBe(true);
    expect(isRealIsoDate("2025-02-29")).toBe(false);
    expect(isRealIsoDate("2026-02-30")).toBe(false);
    expect(isRealIsoDate("2026-00-10")).toBe(false);
    expect(isRealIsoDate("2026-3-19")).toBe(false);
  });

  // Strict on whitespace on purpose: it guards pollId, and a predicate that
  // accepted a padded string while the caller interpolated the raw one is
  // exactly how an unmatched key gets minted.
  it("does not accept a padded string", () => {
    expect(isRealIsoDate("  2026-03-19  ")).toBe(false);
  });
});

describe("pollId", () => {
  it("lowercases the agency and pins the end date", () => {
    expect(pollId("ML", "2026-07-19")).toBe("ml-2026-07-19");
    expect(pollId("GIB", "2021-11-09")).toBe("gib-2021-11-09");
  });

  it("normalises its inputs rather than baking whitespace into the key", () => {
    // The guard trims — so the id must be built from the trimmed value too, or
    // a padded input passes validation and mints a key that no dedupe check
    // can match against the stored one.
    expect(pollId("  ML  ", "  2026-07-19 ")).toBe("ml-2026-07-19");
  });

  it("refuses an agency id that would make the key unsplittable", () => {
    expect(() => pollId("", "2026-07-19")).toThrow(/not a usable agency id/);
    expect(() => pollId("ML-X", "2026-07-19")).toThrow(
      /not a usable agency id/,
    );
    expect(() => pollId("M L", "2026-07-19")).toThrow(/not a usable agency id/);
  });

  it("refuses to mint an id from a date that is not real", () => {
    expect(() => pollId("ML", "2026-02-30")).toThrow(/not a real date/);
  });
});

describe("fieldworkEndMs", () => {
  it("returns the end as UTC epoch ms for every readable form", () => {
    expect(fieldworkEndMs("Mar 12-20 2026")).toBe(
      Date.parse("2026-03-20T00:00:00Z"),
    );
    expect(fieldworkEndMs("through Jul 05 2021")).toBe(
      Date.parse("2021-07-05T00:00:00Z"),
    );
  });

  it("returns null — not 0 — for an unreadable string", () => {
    // The `0` sentinel this replaced meant 1970, which a newest-first sort put
    // last by accident and a "which election" lookup read as falsy by accident.
    // Only one of those two survives an ascending sort.
    expect(
      fieldworkEndMs("May 8 2013 (per Wikipedia table — single-date entry)"),
    ).toBeNull();
    expect(fieldworkEndMs("никаква дата")).toBeNull();
  });

  it("orders polls newest-first with unreadable rows last", () => {
    // The comparator AgencyPollsList uses, asserted here because the component
    // has no render test and this is the whole of its logic.
    const rows = [
      "Mar 19 2026",
      "May 8 2013 (per Wikipedia table — single-date entry)",
      "Oct 11-17 2024",
    ];
    const sorted = [...rows].sort(
      (a, b) =>
        (fieldworkEndMs(b) ?? -Infinity) - (fieldworkEndMs(a) ?? -Infinity),
    );
    expect(sorted).toEqual([
      "Mar 19 2026",
      "Oct 11-17 2024",
      "May 8 2013 (per Wikipedia table — single-date entry)",
    ]);
  });
});

describe("localizeFieldwork", () => {
  it("returns the stored EN-month string unchanged for an English reader", () => {
    expect(localizeFieldwork("through Jul 05 2021", false)).toBe(
      "through Jul 05 2021",
    );
    expect(localizeFieldwork("Mar 12-20 2026", false)).toBe("Mar 12-20 2026");
  });

  it("translates only the leading 'through' for a Bulgarian reader", () => {
    expect(localizeFieldwork("through Jul 05 2021", true)).toBe(
      "до Jul 05 2021",
    );
    // No leading "through" — nothing to translate, the range stays as-is.
    expect(localizeFieldwork("Mar 12-20 2026", true)).toBe("Mar 12-20 2026");
  });
});
