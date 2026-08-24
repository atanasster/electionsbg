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
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type {
  MagistrateFiling,
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
  // The tile now renders MagistrateFilingProperties per filing row, which calls this. A
  // partial module mock leaves it undefined and every render throws — so it is stubbed to
  // the "nothing yet" state, which is what an unexpanded row sees anyway. The block's own
  // behaviour is covered by MagistrateFilingProperties.test.tsx.
  useMagistrateFilingAssets: () => undefined,
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

// ---------------------------------------------------------------- filings --

const filing = (
  year: number,
  ref: string | null,
  registerDir = "annual",
): MagistrateFiling => ({
  year,
  registerDir,
  ref,
  sourceUrl: `http://62.176.124.194/images/declaracii/${year}/f${year}${registerDir}.pdf`,
});

const SEVEN = [
  filing(2026, "4352/22.04.2026"),
  filing(2025, "4013/24.04.2025", "change"),
  filing(2024, "2991/01.04.2024"),
  filing(2023, "4449/26.04.2023"),
  filing(2022, "2947/24.03.2022"),
  filing(2019, "5190/23.04.2019"),
  filing(2017, null),
];

describe("PersonMagistrateHoldingsTile — filing history", () => {
  it("links the declaration the figures were actually parsed from", () => {
    renderTile(
      holding({ sourceUrl: "http://62.176.124.194/images/declaracii/x.pdf" }),
    );
    expect(
      screen.getByRole("link", { name: /Виж декларацията/ }),
    ).toHaveAttribute("href", "http://62.176.124.194/images/declaracii/x.pdf");
  });

  it("lists the filings newest-first, capped, with a see-all toggle", () => {
    renderTile(holding({ filings: SEVEN }));
    // Capped at 5 of 7 — a magistrate can have 72.
    expect(screen.getByText("2026")).toBeInTheDocument();
    expect(screen.getByText("2022")).toBeInTheDocument();
    expect(screen.queryByText("2019")).not.toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: /Виж всички \(7\)/ });
    fireEvent.click(toggle);
    expect(screen.getByText("2019")).toBeInTheDocument();
    expect(screen.getByText("2017")).toBeInTheDocument();
  });

  it("never renders registerDir as a declaration type", () => {
    // `registerDir` is the register's DIRECTORY. The ИВСС files some ANNUAL declarations
    // into the `-1` ("change") one — the 2025 fixture above is exactly that case — so
    // „За промяна" would state something the document contradicts. The plan's own first
    // draft told the UI to render it; this is the assertion that stops it coming back.
    renderTile(holding({ filings: SEVEN }));
    expect(screen.queryByText(/За промяна/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Годишна/)).not.toBeInTheDocument();
  });

  it("attributes the list to the PERSON only when the name is unambiguous", () => {
    renderTile(holding({ filings: SEVEN, filingsNameAmbiguous: false }));
    expect(
      screen.getByText(/Декларации в регистъра на ИВСС/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/подадени под това име/)).not.toBeInTheDocument();
  });

  it("heads the list as filed-under-this-name when it covers several people", () => {
    // 262 of 3,594 rostered names provably do: two annual declarations filed on the SAME
    // DAY (257) or four-plus in one year (15). Publishing one judge's declarations as
    // another's is the harm this caveat exists to prevent.
    renderTile(holding({ filings: SEVEN, filingsNameAmbiguous: true }));
    expect(
      screen.getByText(/Декларации, подадени под това име/),
    ).toBeInTheDocument();
    // The caveat must state the EVIDENCE, not just assert doubt — that is what makes it
    // checkable by the reader rather than a hedge. WHICH evidence, and why it is worded to
    // cover both arms of the flag, is pinned separately below.
    expect(screen.getByText(/съименниците се сливат/)).toBeInTheDocument();
  });

  it("shows a history even when there are no figures and no company", () => {
    // The filings are displayable content in their own right — a magistrate whose PDF
    // never parsed still has declarations a reader can open, which is the point.
    renderTile(
      holding({
        court: null,
        position: null,
        companies: [],
        financials: { bankCashLv: 0, securitiesLv: 0, realEstateCount: 0 },
        filings: SEVEN,
      }),
    );
    expect(
      screen.getByText(/Декларации в регистъра на ИВСС/),
    ).toBeInTheDocument();
  });

  it("renders no history section at all when the register lists nothing", () => {
    renderTile(holding({ filings: [] }));
    expect(screen.queryByText(/Декларации/)).not.toBeInTheDocument();
  });

  it("marks which listed filing the figures actually came from", () => {
    // NOT always the newest: on 421 of 3,594 records the parsed filing sits further down,
    // because a magistrate off the current bench keeps a parse the pipeline does not
    // refresh. Without the marker a reader cannot tell which document backs the numbers.
    renderTile(holding({ filings: SEVEN, sourceUrl: SEVEN[2].sourceUrl }));
    const marks = screen.getAllByText(/данните тук/);
    expect(marks).toHaveLength(1);
    // …and it is on the 2024 row, not the 2026 one at the top.
    expect(marks[0].closest("a")).toHaveAttribute("href", SEVEN[2].sourceUrl);
  });

  it("renders the whole history block in English too", () => {
    // /en/person/* is prerendered and indexed. The block carries four independent EN
    // literals plus a translated entry-number string; a BG-pinned suite would let any of
    // them rot unnoticed.
    langMock.current = "en";
    renderTile(holding({ filings: SEVEN, sourceUrl: SEVEN[0].sourceUrl }));
    expect(
      screen.getByRole("link", { name: /View the declaration/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Declarations in the ИВСС register/),
    ).toBeInTheDocument();
    expect(screen.getByText(/figures shown/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /View all \(7\)/ }),
    ).toBeInTheDocument();
    // „вх. №" was hard-coded once; the house key renders "entry no." on /en.
    expect(screen.queryByText(/вх\. №/)).not.toBeInTheDocument();
  });

  it("states the shared evidence, never the same-day arm alone", () => {
    // The flag is set by EITHER two same-day annuals OR four-plus in one year. Naming only
    // the first made the caveat FALSE for the 5 magistrates flagged solely by the second.
    renderTile(holding({ filings: SEVEN, filingsNameAmbiguous: true }));
    expect(screen.queryByText(/в един и същи ден/)).not.toBeInTheDocument();
    expect(
      screen.getByText(/повече годишни декларации в една и съща година/),
    ).toBeInTheDocument();
  });

  it("renders a filing that carries no входящ номер", () => {
    // 334 filings corpus-wide have none — the register published no ref. The row must still
    // be a working link, not a blank or a crash.
    renderTile(holding({ filings: [filing(2017, null)] }));
    expect(screen.getByText("2017").closest("a")).toHaveAttribute(
      "href",
      SEVEN[6].sourceUrl,
    );
  });

  it("opens every register link safely and drops anything off-origin", () => {
    // The register is plain HTTP on a bare IP with a documented trust boundary. Missing
    // `noopener` on a target=_blank link hands the opened page a handle on this one.
    renderTile(
      holding({
        sourceUrl: SEVEN[0].sourceUrl,
        filings: [
          SEVEN[0],
          {
            ...filing(2020, "1/01.01.2020"),
            sourceUrl: "https://evil.test/x.pdf",
          },
        ],
      }),
    );
    for (const a of screen.getAllByRole("link")) {
      expect(a).toHaveAttribute("target", "_blank");
      expect(a).toHaveAttribute("rel", expect.stringContaining("noopener"));
      expect(a.getAttribute("href")).toMatch(/^http:\/\/62\.176\.124\.194\//);
    }
    // The off-origin row is dropped, and the heading count follows the filtered list.
    expect(screen.queryByText("2020")).not.toBeInTheDocument();
    expect(
      screen.getByText(/Декларации в регистъра на ИВСС \(1\)/),
    ).toBeInTheDocument();
  });

  it("collapses the list again, and does not carry the toggle to the next person", () => {
    const { rerender } = renderTile(holding({ filings: SEVEN }));
    fireEvent.click(screen.getByRole("button", { name: /Виж всички \(7\)/ }));
    expect(screen.getByText("2017")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Покажи по-малко/ }));
    expect(screen.queryByText("2017")).not.toBeInTheDocument();

    // The tile has no `key` in PersonProfileScreen, so a new person re-renders this same
    // instance. An expanded 72-row list must not follow them there.
    fireEvent.click(screen.getByRole("button", { name: /Виж всички \(7\)/ }));
    expect(screen.getByText("2017")).toBeInTheDocument();
    rerender(
      <MemoryRouter>
        <PersonMagistrateHoldingsTile name="Друг Магистрат" />
      </MemoryRouter>,
    );
    expect(screen.queryByText("2017")).not.toBeInTheDocument();
  });
});
