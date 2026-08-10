import { describe, expect, it } from "vitest";
import {
  officeTermPhrase,
  officeTermPhrases,
  type OfficeDates,
} from "./officeTerm";
import bg from "@/locales/bg/translation.json";
import en from "@/locales/en/translation.json";

describe("officeTermPhrase", () => {
  it("phrases a closed mandate as a range", () => {
    const p = officeTermPhrase(
      { start: "2021-04-15", end: "2021-09-16", dateBasis: "term" },
      "bg",
    );
    expect(p).toEqual({
      key: "pp_period_term_range",
      params: { start: "15.04.2021 г.", end: "16.09.2021 г." },
      titleKey: "pp_period_term_note",
    });
  });

  it("phrases an open mandate as 'since' and a start-less one as 'until'", () => {
    expect(
      officeTermPhrase({ start: "2023-10-29", dateBasis: "election" }, "en")
        ?.key,
    ).toBe("pp_period_election_since");
    expect(
      officeTermPhrase({ end: "2025-07-08", dateBasis: "filing" }, "en")?.key,
    ).toBe("pp_period_filing_until");
  });

  it("keys the phrase off the BASIS, so the three sources cannot render alike", () => {
    const dates = { start: "2023-10-29", end: "2025-10-12" };
    const keys = (["term", "election", "filing"] as const).map(
      (dateBasis) => officeTermPhrase({ ...dates, dateBasis }, "bg")?.key,
    );
    expect(new Set(keys).size).toBe(3);
  });

  it("localizes the dates it interpolates", () => {
    const bg = officeTermPhrase(
      { start: "2023-10-29", dateBasis: "term" },
      "bg",
    );
    const en = officeTermPhrase(
      { start: "2023-10-29", dateBasis: "term" },
      "en",
    );
    expect(bg?.params.start).not.toBe(en?.params.start);
  });

  it("omits the absent bound from params rather than passing an empty string", () => {
    const p = officeTermPhrase(
      { start: "2023-10-29", dateBasis: "term" },
      "bg",
    );
    expect(p?.params).not.toHaveProperty("end");
  });

  // The two silences, both deliberate. A date with no basis is a writer that filled a date
  // and did not say what it measures; rendering it as a mandate is the exact mislabelling
  // the basis column exists to prevent, so it renders as nothing instead.
  it("says nothing when the basis is missing, even with dates present", () => {
    expect(
      officeTermPhrase({ start: "2021-04-15", end: "2021-09-16" }, "bg"),
    ).toBeNull();
    expect(
      officeTermPhrase(
        { start: "2021-04-15", end: "2021-09-16", dateBasis: null },
        "bg",
      ),
    ).toBeNull();
  });

  it("says nothing when the basis is declared but no date is", () => {
    expect(officeTermPhrase({ dateBasis: "term" }, "bg")).toBeNull();
    expect(
      officeTermPhrase({ start: null, end: null, dateBasis: "filing" }, "bg"),
    ).toBeNull();
  });

  // The screen renders t(key) / t(titleKey), so a key with no string ships the raw key to
  // the reader ("pp_period_filing_note") — visible only to someone who opens that exact
  // page in that exact language. Enumerating every reachable key here means a basis added
  // later without its four strings fails the build instead.
  it("every phrase it can emit has a string in BOTH locales", () => {
    const bases = ["term", "election", "filing"] as const;
    const shapes: OfficeDates[] = [
      { start: "2023-10-29", end: "2025-10-12" }, // range
      { start: "2023-10-29" }, // since
      { end: "2025-10-12" }, // until
    ];
    const keys = new Set<string>();
    for (const dateBasis of bases)
      for (const s of shapes) {
        const p = officeTermPhrase({ ...s, dateBasis }, "bg");
        expect(p).not.toBeNull();
        keys.add(p!.key);
        keys.add(p!.titleKey);
      }
    // 3 bases x (3 shapes + 1 shared note) — a guard on the guard: if the key builder
    // stopped varying, the loop above would silently assert almost nothing.
    expect(keys.size).toBe(12);

    const missing = [...keys].flatMap((k) => [
      ...(k in bg ? [] : [`bg:${k}`]),
      ...(k in en ? [] : [`en:${k}`]),
    ]);
    expect(missing).toEqual([]);
  });

  it("keeps the {{start}}/{{end}} placeholders each phrase interpolates", () => {
    // A translation that drops a placeholder renders a period with no dates in it, which
    // reads as a shorter fact rather than a broken one.
    for (const dateBasis of ["term", "election", "filing"] as const) {
      const range = officeTermPhrase(
        { start: "2023-10-29", end: "2025-10-12", dateBasis },
        "bg",
      )!;
      for (const dict of [bg, en] as Record<string, string>[]) {
        expect(dict[range.key]).toContain("{{start}}");
        expect(dict[range.key]).toContain("{{end}}");
      }
      const since = officeTermPhrase({ start: "2023-10-29", dateBasis }, "bg")!;
      const until = officeTermPhrase({ end: "2025-10-12", dateBasis }, "bg")!;
      for (const dict of [bg, en] as Record<string, string>[]) {
        expect(dict[since.key]).toContain("{{start}}");
        expect(dict[until.key]).toContain("{{end}}");
        // …and NOT the bound it will never be given: officeTermPhrase omits the absent
        // one from params, and i18next leaves an uninterpolated placeholder in the output
        // verbatim — so "от {{start}} до {{end}}" ships a literal "{{end}}" to the reader.
        expect(dict[since.key]).not.toContain("{{end}}");
        expect(dict[until.key]).not.toContain("{{start}}");
      }
    }
  });
});

describe("officeTermPhrases", () => {
  it("phrases each stretch separately, newest first", () => {
    // A seat lost and regained. Rendering the outer bounds as one range would claim a
    // tenure the person did not have — the defect this plural form exists for.
    const out = officeTermPhrases(
      {
        dateBasis: "election",
        spans: [
          { start: "2007-10-28", end: "2011-10-23" },
          { start: "2025-06-15", end: null },
        ],
      },
      "bg",
    );
    expect(out.map((p) => p.key)).toEqual([
      "pp_period_election_since",
      "pp_period_election_range",
    ]);
    expect(out[0].params.start).toContain("2025");
  });

  it("says nothing without a basis, however many spans there are", () => {
    expect(
      officeTermPhrases({ spans: [{ start: "2007-10-28", end: null }] }, "bg"),
    ).toEqual([]);
  });

  it("says nothing when there are no spans at all", () => {
    expect(officeTermPhrases({ dateBasis: "term" }, "bg")).toEqual([]);
    expect(officeTermPhrases({ dateBasis: "term", spans: [] }, "bg")).toEqual(
      [],
    );
  });

  it("does not mutate the caller's spans while reversing", () => {
    const spans = [
      { start: "2007-10-28", end: "2011-10-23" },
      { start: "2025-06-15", end: null },
    ];
    officeTermPhrases({ dateBasis: "election", spans }, "bg");
    expect(spans[0].start).toBe("2007-10-28");
  });
});
