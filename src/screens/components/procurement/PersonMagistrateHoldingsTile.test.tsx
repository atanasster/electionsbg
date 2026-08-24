// Component guard for the ИВСС magistrate tile.
//
// What it locks is the distinction that makes the real-estate figure honest. The
// ИВСС annual declaration mixes two bases in one form: Таблица 1 („Недвижимо
// имущество") is a FLOW — property ACQUIRED during the declared period — while
// Таблици 10/11 (парични средства, банкови сметки) are STOCKS, balances at the
// period end. The tile renders one figure from each, side by side, so without an
// explicit caveat „4 недвижими имота" beside a cash balance reads as „owns four
// properties". It is not: Сотир Цацаров's 2026 filing lists exactly the four he
// bought in 2025, and he owns considerably more.
//
// The second lock is the period. `decl_year` is the year the declaration was
// FILED, not the calendar year it covers — that filing is stamped
// „01.01–31.12.2025" — so „за 2026 г." names the wrong year for every figure on
// the card. Until the parser reads the period off the form itself, the tile may
// only claim the filing year.
//
// BOTH languages are exercised. The tile carries two independent string literals
// per claim (an inline `bg ? …` helper, the dominant convention in this codebase),
// and `/en/person/*` is prerendered and indexed — so an EN-only regression is what
// a crawler and an English-reading journalist would see, with a BG-pinned suite
// still green.
//
// Hermetic: the data hook is mocked (vitest.setup throws on an unstubbed fetch).

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type {
  MagistrateHolding,
  usePersonMagistrateHoldings,
} from "@/data/judiciary/useMagistrateHoldings";

// The language is a knob rather than a constant so the EN branch is reachable.
const langMock = vi.hoisted(() => ({ current: "bg" }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: langMock.current },
  }),
}));

// Derived from the hook itself, never restated: a `vi.mock` factory is not checked
// against the real module, so a hand-copied shape keeps compiling (and the suite keeps
// passing) after production has moved on. Every assignment goes through
// `satisfies HookResult`, so a change to the hook's return type fails here.
type HookResult = ReturnType<typeof usePersonMagistrateHoldings>;

const holdingMock = vi.hoisted(() => ({
  current: { holding: null, year: null } as HookResult,
}));

vi.mock("@/data/judiciary/useMagistrateHoldings", () => ({
  usePersonMagistrateHoldings: () => holdingMock.current,
}));

// Imported after the mocks so the component picks them up.
const { PersonMagistrateHoldingsTile } =
  await import("./PersonMagistrateHoldingsTile");

const holding = (over: Partial<MagistrateHolding> = {}): MagistrateHolding => ({
  name: "Сотир Стефанов Цацаров",
  position: "прокурор",
  court: "Върховна касационна прокуратура",
  companies: [],
  financials: { bankCashLv: 18268, securitiesLv: 0, realEstateCount: 4 },
  ...over,
});

const renderTile = (
  h: MagistrateHolding | null,
  year: number | null = 2026,
  name = "Сотир Стефанов Цацаров",
) => {
  holdingMock.current = { holding: h, year } satisfies HookResult;
  return render(
    <MemoryRouter>
      <PersonMagistrateHoldingsTile name={name} />
    </MemoryRouter>,
  );
};

// Ordering must not leak the language between tests.
afterEach(() => {
  langMock.current = "bg";
});

describe("PersonMagistrateHoldingsTile", () => {
  it("does not present the real-estate count as a holdings count", () => {
    renderTile(holding());
    // The count is still shown — it is a real figure off the filing.
    expect(screen.getByText("4")).toBeInTheDocument();
    // …but never as a bare „недвижими имота", which asserts ownership of four
    // properties. This is the exact string the tile shipped before 2026-08-24.
    expect(screen.queryByText(/^недвижими имота$/)).not.toBeInTheDocument();
    expect(screen.getByText(/имота в декларацията/)).toBeInTheDocument();
  });

  it("states the flow caveat in words, so the count cannot be read as an estate", () => {
    renderTile(holding());
    // The caveat has to name what Table 1 actually contains. Without it the two
    // figures on the card (a flow and a stock) look like one kind of fact.
    expect(
      screen.getByText(/ПРИДОБИТИ през декларирания период/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/не е броят на притежаваните имоти/),
    ).toBeInTheDocument();
  });

  it("makes the same two claims in English", () => {
    // Half the shipped copy, and the half a crawler reads on /en.
    langMock.current = "en";
    renderTile(holding());
    expect(screen.getByText(/properties in this filing/)).toBeInTheDocument();
    expect(screen.queryByText(/^properties$/)).not.toBeInTheDocument();
    expect(
      screen.getByText(/ACQUIRED during the declared period/),
    ).toBeInTheDocument();
    expect(screen.getByText(/filed in 2026/)).toBeInTheDocument();
  });

  it("claims the filing year, never the covered period", () => {
    renderTile(holding(), 2026);
    expect(screen.getByText(/подадена през 2026 г\./)).toBeInTheDocument();
    // „за 2026 г." would attribute the 2025 figures to 2026.
    expect(screen.queryByText(/ЗСВ за 2026 г\./)).not.toBeInTheDocument();
  });

  it("leaves a well-formed sentence when the year is absent", () => {
    // The old copy interpolated `year ?? ""`, rendering „…ЗСВ за  г.".
    renderTile(holding(), null);
    // NB the absence of „подадена през" does NOT discriminate on its own — the old
    // copy never contained that phrase either. The two assertions below are the
    // load-bearing ones: the first catches the old „за  г." (the default normalizer
    // collapses the double space), the second catches a terminator left inside the
    // conditional, which fuses „…ЗСВ" onto „Таблица 1…" as one run-on sentence.
    expect(screen.queryByText(/за\s+г\./)).not.toBeInTheDocument();
    expect(screen.getByText(/ЗСВ\. Таблица 1/)).toBeInTheDocument();
  });

  it("renders nothing when the match carries nothing displayable", () => {
    // The table holds the FULL roster, so a matched magistrate may have no court,
    // no company and no non-zero figure. An all-but-empty card is worse than none.
    const { container } = renderTile(
      holding({
        court: null,
        position: null,
        companies: [],
        financials: { bankCashLv: 0, securitiesLv: 0, realEstateCount: 0 },
      }),
      2026,
      "Никой",
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a pre-ingest record carrying no financials at all", () => {
    // `financials` is OPTIONAL on the type — "present for records written after the
    // financials ingest; may be absent". The component's only protection is the
    // `!!f &&` in hasFinancials; without it `f.bankCashLv` throws and takes the whole
    // /person page down. Nothing else in this suite pins that guard.
    const { container } = renderTile(
      holding({
        financials: undefined,
        court: null,
        position: null,
        companies: [],
      }),
      2026,
      "Никой",
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when there is no magistrate match at all", () => {
    const { container } = renderTile(null, null, "Никой");
    expect(container).toBeEmptyDOMElement();
  });

  it("links a company only when the EIK resolved, and never invents one", () => {
    // This is the one place the tile turns a NAME match into a navigable claim about
    // a specific registry entity — the same class of risk the rest of this file
    // exists to contain, and the reason the component needs a router at all.
    renderTile(
      holding({
        companies: [
          {
            name: "АЛФА ЕООД",
            stakePct: 50,
            eik: "831234567",
            eikAmbiguous: false,
          },
          { name: "БЕТА ООД", stakePct: null, eik: null, eikAmbiguous: true },
        ],
      }),
    );
    expect(screen.getByRole("link", { name: /АЛФА ЕООД/ })).toHaveAttribute(
      "href",
      "/company/831234567",
    );
    // An ambiguous name must stay inert — a link asserts we pinned the entity.
    expect(
      screen.queryByRole("link", { name: /БЕТА ООД/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/БЕТА ООД/)).toBeInTheDocument();
  });
});
