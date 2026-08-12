import { describe, test, expect } from "vitest";
import {
  computeDossierSignals,
  dossierSignalSummary,
  SHORT_WINDOW_DAYS,
  type DossierSignalInput,
  type DossierSignalKey,
} from "./dossierSignals";

const base: DossierSignalInput = {
  documents: [],
  notices: [],
  announcements: [],
  offerPhaseStart: null,
  offerPhaseEnd: null,
  isCancelled: false,
  specText: null,
};

const get = (i: Partial<DossierSignalInput>, key: DossierSignalKey) =>
  computeDossierSignals({ ...base, ...i }).find((s) => s.key === key)!;

const doc = (o: Partial<DossierSignalInput["documents"][0]> = {}) => ({
  source: "attachment",
  kind: null,
  created_at: null,
  ...o,
});

// ⚠️ The single most important property of this module. Every signal must be able
// to say "I cannot answer", because a boolean forces "unanswerable" into "checked
// and clear" — a claim about a procurement we never made.
describe("tri-state: an empty dossier answers nothing rather than answering clear", () => {
  test("every signal is null on an empty input", () => {
    const all = computeDossierSignals(base);
    expect(all).toHaveLength(6);
    expect(all.every((s) => s.verdict === null)).toBe(true);
    // …and each says WHY.
    expect(all.every((s) => !!s.unavailable)).toBe(true);
  });

  test("unanswerable signals are RETURNED, not omitted", () => {
    // A shorter list would read as "these are the checks", hiding the ones we
    // could not run.
    expect(computeDossierSignals(base).map((s) => s.key)).toEqual([
      "noSpecNamed",
      "documentDuringOfferPhase",
      "priceOnlyCriterion",
      "shortOfferWindow",
      "cancelledAfterCommittee",
      "brandWithoutEquivalent",
    ]);
  });
});

describe("noSpecNamed", () => {
  test("fires when attachments exist but none is spec-named", () => {
    const s = get(
      { documents: [doc({ kind: "documentation" })] },
      "noSpecNamed",
    );
    expect(s.verdict).toBe(true);
  });

  test("clear when a spec-named file is present", () => {
    const s = get(
      { documents: [doc({ kind: "spec" }), doc({ kind: "form" })] },
      "noSpecNamed",
    );
    expect(s.verdict).toBe(false);
  });

  // The narrowest honest form: with no attachments we are looking at a crawl gap,
  // not at the buyer.
  test("null when no attachments were captured at all", () => {
    expect(get({ documents: [] }, "noSpecNamed").verdict).toBeNull();
    expect(
      get({ documents: [doc({ source: "announcement" })] }, "noSpecNamed")
        .verdict,
    ).toBeNull();
  });
});

describe("documentDuringOfferPhase", () => {
  const start = "2026-01-10T00:00:00Z";

  test("fires when a document post-dates the offer-phase opening", () => {
    const s = get(
      {
        offerPhaseStart: start,
        documents: [doc({ created_at: "2026-01-20T00:00:00Z" })],
      },
      "documentDuringOfferPhase",
    );
    expect(s.verdict).toBe(true);
  });

  test("clear when every document predates it", () => {
    const s = get(
      {
        offerPhaseStart: start,
        documents: [doc({ created_at: "2026-01-01T00:00:00Z" })],
      },
      "documentDuringOfferPhase",
    );
    expect(s.verdict).toBe(false);
  });

  // ⚠️ The 19x inflation. Award-stage documents post-date the offer phase BY
  // DEFINITION (measured 6,515 of 6,523), so counting them fires on 79.4% of
  // procedures instead of 4.1% and says only "the committee met after bids closed".
  test("award-stage documents are ignored — only attachments count", () => {
    const s = get(
      {
        offerPhaseStart: start,
        documents: [
          doc({ source: "announcement", created_at: "2026-02-01T00:00:00Z" }),
        ],
      },
      "documentDuringOfferPhase",
    );
    expect(s.verdict).toBeNull(); // no dated ATTACHMENT to judge
  });

  // Date.parse → NaN makes every comparison false, so an unreadable start used to
  // return "checked and clear" for a date it could not read at all.
  test("an unparseable start is null, NOT clear", () => {
    expect(
      get(
        {
          offerPhaseStart: "not a date",
          documents: [doc({ created_at: "2026-02-01T00:00:00Z" })],
        },
        "documentDuringOfferPhase",
      ).verdict,
    ).toBeNull();
  });

  test("an unparseable document date is excluded rather than treated as early", () => {
    expect(
      get(
        { offerPhaseStart: start, documents: [doc({ created_at: "garbage" })] },
        "documentDuringOfferPhase",
      ).verdict,
    ).toBeNull();
  });

  test("null without a start, or without any dated document", () => {
    expect(
      get(
        { documents: [doc({ created_at: start })] },
        "documentDuringOfferPhase",
      ).verdict,
    ).toBeNull();
    expect(
      get(
        { offerPhaseStart: start, documents: [doc()] },
        "documentDuringOfferPhase",
      ).verdict,
    ).toBeNull();
  });
});

describe("priceOnlyCriterion", () => {
  test("fires when every criterion is price", () => {
    expect(
      get({ notices: [{ award_criteria: ["Цена"] }] }, "priceOnlyCriterion")
        .verdict,
    ).toBe(true);
  });

  test("clear when any other criterion is present", () => {
    expect(
      get(
        { notices: [{ award_criteria: ["Цена", "Качество"] }] },
        "priceOnlyCriterion",
      ).verdict,
    ).toBe(false);
  });

  // An unrecognised token used to fall through `every(=== цена)` to FALSE, i.e. to
  // "multi-criteria" — asserting a richer evaluation than the notice described.
  test("an unrecognised criterion is null, not 'multi-criteria'", () => {
    const r = get(
      { notices: [{ award_criteria: ["Цена", "Нещо непознато"] }] },
      "priceOnlyCriterion",
    );
    expect(r.verdict).toBeNull();
    expect(r.unavailable).toMatch(/unrecognised/);
  });

  test("the pinned vocabulary covers what the corpus actually uses", () => {
    // Measured: BT-539-Lot carries exactly {Цена, Качество, Разходи}.
    for (const c of ["Качество", "Разходи"])
      expect(
        get(
          { notices: [{ award_criteria: ["Цена", c] }] },
          "priceOnlyCriterion",
        ).verdict,
      ).toBe(false);
  });

  // ⚠️ The 2020–2023 tier. `false` here would assert multi-criteria evaluation for
  // three years of procurements the notice never described.
  test("null when the notice exposes no criteria (pre-eForms)", () => {
    expect(
      get({ notices: [{ award_criteria: null }] }, "priceOnlyCriterion")
        .verdict,
    ).toBeNull();
    expect(
      get({ notices: [{ award_criteria: [] }] }, "priceOnlyCriterion").verdict,
    ).toBeNull();
  });
});

describe("shortOfferWindow", () => {
  const start = "2026-01-01T00:00:00Z";
  const plus = (d: number) =>
    new Date(Date.parse(start) + d * 86_400_000).toISOString();

  test("fires below the EU reference and is clear above it", () => {
    expect(
      get(
        { offerPhaseStart: start, offerPhaseEnd: plus(SHORT_WINDOW_DAYS - 1) },
        "shortOfferWindow",
      ).verdict,
    ).toBe(true);
    expect(
      get(
        { offerPhaseStart: start, offerPhaseEnd: plus(SHORT_WINDOW_DAYS + 1) },
        "shortOfferWindow",
      ).verdict,
    ).toBe(false);
  });

  test("exactly the reference is NOT short", () => {
    expect(
      get(
        { offerPhaseStart: start, offerPhaseEnd: plus(SHORT_WINDOW_DAYS) },
        "shortOfferWindow",
      ).verdict,
    ).toBe(false);
  });

  // A window that ends before it starts is corrupt data, not a very short deadline
  // — one real row is -61.8 days. Reporting it as "fires" makes a claim about the
  // buyer out of a claim about the register.
  test("a reversed window is null, not a very short one", () => {
    const r = get(
      { offerPhaseStart: start, offerPhaseEnd: plus(-30) },
      "shortOfferWindow",
    );
    expect(r.verdict).toBeNull();
    expect(r.unavailable).toMatch(/ends before it starts/);
  });

  // Math.round printed "14 day window" for the 27 real procedures in [13.5, 14)
  // that it simultaneously flagged as under 14.
  test("the printed window never contradicts the verdict", () => {
    const r = get(
      { offerPhaseStart: start, offerPhaseEnd: plus(13.7) },
      "shortOfferWindow",
    );
    expect(r.verdict).toBe(true);
    expect(r.detail).toBe("13 day window");
  });

  test("null on a missing or unparseable bound", () => {
    expect(
      get({ offerPhaseStart: start }, "shortOfferWindow").verdict,
    ).toBeNull();
    expect(
      get(
        { offerPhaseStart: "not a date", offerPhaseEnd: plus(1) },
        "shortOfferWindow",
      ).verdict,
    ).toBeNull();
  });
});

describe("cancelledAfterCommittee", () => {
  const protocol = [
    { title: "Протокол № 1 от работата на комисията", created_at: null },
  ];

  test("fires only when a committee met AND the procedure was cancelled", () => {
    expect(
      get(
        { announcements: protocol, isCancelled: true },
        "cancelledAfterCommittee",
      ).verdict,
    ).toBe(true);
    expect(
      get(
        { announcements: protocol, isCancelled: false },
        "cancelledAfterCommittee",
      ).verdict,
    ).toBe(false);
  });

  // A cancellation with no committee record is a different (and ordinary) event —
  // saying "clear" would imply we checked the committee stage and it was fine.
  test("null when the record holds no protocol or доклад", () => {
    expect(
      get(
        {
          announcements: [{ title: "Решение за откриване", created_at: null }],
          isCancelled: true,
        },
        "cancelledAfterCommittee",
      ).verdict,
    ).toBeNull();
    expect(
      get({ announcements: [], isCancelled: true }, "cancelledAfterCommittee")
        .verdict,
    ).toBeNull();
  });
});

describe("brandWithoutEquivalent", () => {
  const long = (s: string) => s + " ".padEnd(220, "х");

  // ⚠️ WITHHELD ON PURPOSE. Measured against all 142 extracted specifications the
  // "product-like token" heuristic matched 87.6% — Roman numerals from „Част III",
  // an entire German-language spec, PVC/SN8/D400, USB/LED/HDMI, EU programme codes.
  // A false positive here asserts a named buyer breached ЗОП чл. 49 ал. 2, so at
  // 1-in-8 precision it is not publishable.
  test("publishes NO verdict, whatever the text says", () => {
    for (const t of [
      long("Доставка на Corpuls3 дефибрилатор"),
      long("Доставка на Corpuls3 или еквивалент"),
      long("Част III от документацията, тръби PVC SN8"),
      long("Доставка на хартия за принтер"),
    ]) {
      const r = get({ specText: t }, "brandWithoutEquivalent");
      expect(r.verdict).toBeNull();
      expect(r.unavailable).toMatch(/not reliable enough/);
    }
  });

  test("it is still RETURNED, so the check-list stays honest about what was skipped", () => {
    expect(
      computeDossierSignals({ ...base, specText: long("x") }).map((s) => s.key),
    ).toContain("brandWithoutEquivalent");
  });
});

describe("dossierSignalSummary", () => {
  test("reports fired AND evaluated, so a short check-list is visible", () => {
    // 6 signals, but only some are answerable — "2 signals" alone would hide that.
    const signals = computeDossierSignals({
      ...base,
      documents: [doc({ kind: "documentation" })],
      notices: [{ award_criteria: ["Цена"] }],
    });
    const s = dossierSignalSummary(signals);
    expect(s.fired).toBe(2);
    expect(s.evaluated).toBe(2);
    expect(signals.length).toBe(6); // …of six
  });

  test("an all-null dossier evaluates nothing rather than scoring clean", () => {
    expect(dossierSignalSummary(computeDossierSignals(base))).toEqual({
      fired: 0,
      evaluated: 0,
    });
  });
});
