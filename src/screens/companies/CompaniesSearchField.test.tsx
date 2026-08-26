// The /companies wrapper's WIRING — the half neither existing suite can see.
//
// `RegistrySearchField.test.tsx` proves the shared component honours whatever `labels` and
// `idPrefix` it is handed, using synthetic strings. `PersonsSearchField.test.tsx` proves the
// /persons wrapper hands it /persons' strings. Neither can see a /companies wrapper that hands
// it /persons' — and that is the exact failure the extraction created the opportunity for:
// „Търси име или институция…" over a corpus of a million companies, rendering correctly, with
// every other test green.
//
// There is no i18n instance in unit tests, so every `t(key, { defaultValue })` renders its
// fallback — which is what makes the strings assertable here.

import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { CompaniesSearchField } from "./CompaniesSearchField";
import { PersonsSearchField } from "@/screens/persons/PersonsSearchField";

const base = { minChars: 3, tableVisible: false, onChange: () => {} };

afterEach(cleanup);

describe("CompaniesSearchField", () => {
  it("renders the COMPANIES strings, not the persons ones", () => {
    render(<CompaniesSearchField {...base} value="" examples={["Софарма"]} />);
    expect(
      screen.getByLabelText("Търсене на фирма или организация"),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Търси фирма, организация или ЕИК…"),
    ).toBeInTheDocument();
    // The leak this file exists for. „институция" appears in every /persons string and in none
    // of these, so it is the single cheapest tell that the wrong label set was passed.
    expect(document.body.textContent).not.toMatch(/институция/);
  });

  it("⚠️ says organisation as well as company, never company alone", () => {
    // 33,948 rows of the corpus are сдружения, читалища, фондации, кооперации, клонове and
    // държавни предприятия. The pre-existing `companies_browse_search` key — still used by the
    // table toolbar — says „Търси фирма или ЕИК…", and reusing it here would have made the
    // most-read string in this component contradict its own file.
    render(<CompaniesSearchField {...base} value="" />);
    const ph = screen.getByRole("searchbox").getAttribute("placeholder")!;
    expect(ph).toMatch(/организация/);
  });

  it("names ONLY the dimensions the resource searches", () => {
    // The `companies` resource searches `name` (through its fold) and `uic` (exact, routed by
    // shape) — and nothing else. Advertising the seat, the oblast or the legal form would teach
    // a query the engine answers with nothing; those are pickers.
    render(<CompaniesSearchField {...base} value="" />);
    // getAllByText: the sentence renders TWICE by design — once visibly and once in the
    // permanent sr-only description — and both must say the same thing.
    const hints = screen.getAllByText(/Търсете по/);
    expect(hints.length).toBeGreaterThan(1);
    for (const hint of hints) {
      expect(hint.textContent).toMatch(/ЕИК/);
      expect(hint.textContent).not.toMatch(/град|област|община/);
    }
  });

  it("gives the clear button an accessible name", () => {
    render(<CompaniesSearchField {...base} value="Софарма" />);
    expect(
      screen.getByRole("button", { name: "Изчисти търсенето" }),
    ).toBeInTheDocument();
  });

  it("⚠️ does not share an id prefix with the persons wrapper", () => {
    // Both wrappers hard-code their prefix, so a copy-paste leaving `idPrefix="persons"` in the
    // companies file passes every other test in the repo. It becomes visible only if both mount
    // in one tree — and then `htmlFor` and `aria-describedby` break on BOTH, silently.
    const { container } = render(
      <>
        <PersonsSearchField {...base} value="" />
        <CompaniesSearchField {...base} value="" />
      </>,
    );
    const [a, b] = Array.from(container.querySelectorAll("input"));
    expect(a.id.split("-search-")[0]).not.toBe(b.id.split("-search-")[0]);
    // …and each label still resolves to its own input.
    for (const el of [a, b])
      expect(
        container.querySelector(`label[for="${CSS.escape(el.id)}"]`),
      ).not.toBeNull();
  });
});
