// `law_html.ts` had no tests at all until the programme-hierarchy fix, and its
// highest-risk export is still `detectLawCurrency`: the "Сума" header carries no
// unit, so the "(хил. лв.)" / "(хил. евро)" marker beside each table is the ONLY
// signal for whether a figure is leva or euro. Its own comment says getting it
// wrong "is silent and halves (or doubles) every figure" — which is why
// `parseLawHtml` throws rather than defaulting when no marker is present at all.

import { describe, it, expect } from "vitest";
import { detectLawCurrency, parseLawHtml } from "./law_html";

describe("detectLawCurrency", () => {
  it("picks EUR only on a majority of евро markers", () => {
    expect(detectLawCurrency("(хил. евро) (хил. евро) (хил. лв.)")).toEqual({
      currency: "EUR",
      leva: 1,
      euro: 2,
    });
    expect(detectLawCurrency("(хил. лв.)").currency).toBe("BGN");
  });

  it("ties resolve to BGN — every pre-euro law is leva", () => {
    expect(detectLawCurrency("(хил. евро) (хил. лв.)").currency).toBe("BGN");
  });

  it("tolerates the NBSP-free and NBSP forms of each marker", () => {
    expect(detectLawCurrency("(хил.лв.)").leva).toBe(1);
    expect(detectLawCurrency("(хил.евро)").euro).toBe(1);
  });

  it("reports zero of both for an unmarked document (the caller's throw case)", () => {
    expect(detectLawCurrency("<html><body>нищо</body></html>")).toEqual({
      currency: "BGN",
      leva: 0,
      euro: 0,
    });
  });
});

describe("parseLawHtml — the two structural guards", () => {
  // Both exist because the failure they prevent is silent: a wrong denomination
  // halves every figure, and a ДВ layout change would otherwise yield an empty
  // but successful parse that overwrites a good corpus with nothing. They fire
  // in order, and the messages must stay distinguishable — a maintainer facing
  // a red ingest needs to know which of the two broke.

  it("throws on the denomination FIRST, before looking for units", () => {
    expect(() => parseLawHtml("<html><body>нищо</body></html>", 2026)).toThrow(
      /denomination/,
    );
  });

  it("throws on a missing unit marker once the denomination is known", () => {
    expect(() =>
      parseLawHtml("<html><body><p>Сума (хил. евро)</p></body></html>", 2026),
    ).toThrow(/page structure likely changed/);
  });

  it("distinguishes a wrong-year document from a marker-less one", () => {
    // The unit filter is `m.year === fiscalYear`, so a cached ДВ page read for
    // the wrong year does not parse to an empty corpus — it hits the SAME
    // no-units guard as a layout change. Asked for its own year the marker is
    // found, and it falls through to the third guard (no appropriation table),
    // which is how the two are told apart.
    const html =
      "<html><body><p>Сума (хил. евро)</p>" +
      "<p>Приема бюджета на Министерството на финансите за 2025 г.</p>" +
      "</body></html>";
    expect(() => parseLawHtml(html, 2026)).toThrow(
      /page structure likely changed/,
    );
    expect(() => parseLawHtml(html, 2025)).toThrow(
      /none had a parseable appropriation table/,
    );
  });
});
