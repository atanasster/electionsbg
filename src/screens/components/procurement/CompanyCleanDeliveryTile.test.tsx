// Component guard for the ИСУН clean-delivery tile.
//
// TWO properties are locked here, and both exist because this dataset's failure
// mode is an ACCUSATION against a named company rather than a wrong number.
//
// 1. THE TILE MUST NEVER RENDER A ZERO. ИСУН publishes who delivered WITHOUT a
//    financial correction; it publishes no complement, and OLAF's IMS — where
//    individual irregularities actually go — is confidential. So „0 clean
//    contracts" would assert something no source supports.
//
// 2. THE TWO FIGURES MUST NEVER READ AS SUBTRACTABLE. They come from two
//    different ИСУН reports — „приключени в срок" (the beneficiary report) and
//    „без наложена финансова корекция" (the contract report) — and „в срок" is a
//    stricter, orthogonal test. Stacked bare, a reader concludes the difference
//    were corrected, which inverts what the register says. So: each figure names
//    its list, the difference is disclaimed in words, and the clean contracts are
//    listed as evidence.
//
// ⚠️ `on_time_contracts` arrives NULL — never 0 — for the 956 EIKs (17.5% of the
// register) present only in the CONTRACT report. The corpus cannot distinguish
// „not listed as a correction-free beneficiary" from „listed with zero on-time
// contracts" — 0 of 32,420 rows carry a literal 0 — so the null is the only
// carrier of that distinction, and it is the reachable state a regression breaks.
//
// Hermetic: `t` is not needed (the tile uses an inline BG/EN helper), and fetch is
// never reached (vitest.setup throws on an unstubbed one). The tile renders
// `<Link>`, so every render goes through a MemoryRouter.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  ABSENCE_MEANING_BG_FALLBACK,
  CompanyCleanDeliveryTile,
  type CleanDeliveryInfo,
  type CleanContractRow,
} from "./CompanyCleanDeliveryTile";

// The tile picks its copy from i18n.language directly (inline BG/EN helper), so
// the language must be pinned or the assertions test whichever branch happens to
// be default.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "bg" } }),
}));

// ⚠️ THE SERVER'S SENTENCE MUST BE DISTINGUISHABLE FROM THE MODULE'S FALLBACK, or
// nothing here can tell a tile that RENDERS `absence_meaning` from one that ignores
// it: `a ?? b` where `a === b` is an identity. A fixture equal to
// ABSENCE_MEANING_BG_FALLBACK — which is what this file briefly used, in the name
// of removing a copy — makes both renders reducible to a bare constant with every
// test still green, on the one property this whole surface rests on.
const SERVER_MARK = "[от ИСУН]";
const CAVEAT = `${SERVER_MARK} ${ABSENCE_MEANING_BG_FALLBACK}`;

const contract = (over: Partial<CleanContractRow> = {}): CleanContractRow => ({
  contract_number: "BG-RRP-3.008-0282",
  title: "Подкрепа за прехода към кръгова икономика",
  programme: "Национален план за възстановяване и устойчивост",
  procedure: "Подкрепа за прехода към кръгова икономика в предприятията",
  signed_on: "2024-06-17",
  original_end_on: "2025-12-17",
  closed_on: "2025-03-05",
  duration_months: 8,
  ...over,
});

const info = (over: Partial<CleanDeliveryInfo> = {}): CleanDeliveryInfo => ({
  eik: "812013273",
  name: "ДИНГ-ПАВЛОВИ И СИЕ СД",
  on_time_contracts: 16,
  clean_contracts: 9,
  programmes: ["Програма за морско дело и рибарство"],
  beneficiary_listed: true,
  contracts: null,
  absence_meaning: CAVEAT,
  ...over,
});

const draw = (over: Partial<CleanDeliveryInfo> = {}) =>
  render(
    <MemoryRouter>
      <CompanyCleanDeliveryTile info={info(over)} />
    </MemoryRouter>,
  );

describe("CompanyCleanDeliveryTile", () => {
  it("renders both counts, which are allowed to differ", () => {
    // 16 on-time vs 9 uncorrected is the real shape: „в срок" is a stricter test
    // than „no correction", so the two populations do not reconcile.
    draw();
    expect(screen.getByText("16")).toBeInTheDocument();
    expect(screen.getByText("9")).toBeInTheDocument();
    // Each figure names the list it came from, so neither can be read as a
    // statement about the other's population.
    expect(
      screen.getByText(/Проекти без наложени финансови корекции/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/отделно преброяване на ИСУН за бенефициента/),
    ).toBeInTheDocument();
  });

  it("renders the caveat verbatim from the server, not the local mirror", () => {
    // Rendered, not restated: the page and the database must not drift on what
    // absence means. The marker is a string no module can supply, so this fails on
    // a tile that stopped reading `absence_meaning`.
    draw();
    expect(
      screen.getByText(new RegExp("НЕ означава наложена финансова корекция")),
    ).toBeInTheDocument();
    expect(screen.getByText(new RegExp("\\[от ИСУН\\]"))).toBeInTheDocument();
  });

  it("bounds the figures even when the coverage row is missing", () => {
    // The state this tile's unconditional caveat exists for. `absence_meaning` is
    // NOT NULL server-side, so a null means no coverage row at all — and a number
    // with no sentence beneath it is the reading the whole surface prevents.
    // Re-adding the old `{info.absence_meaning && …}` gate fails here.
    draw({ absence_meaning: null });
    expect(
      screen.getByText(/НЕ означава наложена финансова корекция/),
    ).toBeInTheDocument();
    expect(screen.getByText(/IMS на OLAF/)).toBeInTheDocument();
    // …and it is the FALLBACK, not a stale server value left on screen.
    expect(screen.queryByText(/\[от ИСУН\]/)).not.toBeInTheDocument();
  });

  // ── property 1: never a zero ───────────────────────────────────────────────

  it("NEVER renders a zero — the safety property", () => {
    // A row with no clean delivery and no beneficiary listing produces no tile at
    // all, not a „0".
    const { container } = render(
      <MemoryRouter>
        <CompanyCleanDeliveryTile
          info={info({
            on_time_contracts: 0,
            clean_contracts: 0,
            beneficiary_listed: false,
          })}
        />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("suppresses the on-time line rather than printing a 0 beside a real listing", () => {
    // Non-vacuity for the guard above: it must suppress only the no-claim case.
    // A beneficiary with a zero on-time count still has the register's own
    // statement about it — which carries no number, so no zero can reach the page.
    draw({ on_time_contracts: 0, clean_contracts: 0, contracts: [] });
    expect(
      screen.getByText(/ИСУН изброява фирмата сред бенефициентите/),
    ).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(screen.queryByText(/приключени в срок/)).not.toBeInTheDocument();
  });

  it("a NULL on-time count renders no figure and no zero — the contract-only shape", () => {
    // ⚠️ THE REACHABLE STATE, and the one a `?? 0` regression breaks: 956 EIKs are
    // in the contract register only, so `on_time_contracts` is NULL. „Not listed
    // as a correction-free beneficiary" is not „listed with zero on-time
    // contracts", and the corpus holds no literal 0 to tell them apart.
    draw({
      on_time_contracts: null,
      clean_contracts: 2,
      beneficiary_listed: false,
      contracts: [
        contract(),
        contract({ contract_number: "BG16RFOP002-2.077-0541" }),
      ],
    });
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(screen.queryByText(/приключени в срок/)).not.toBeInTheDocument();
    // …and the claim it is NOT entitled to make is absent, while the one it is
    // entitled to make — the named clean contracts — renders.
    expect(
      screen.queryByText(/ИСУН изброява фирмата сред бенефициентите/),
    ).not.toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  // ── property 2: the two figures are not subtractable ───────────────────────

  it("states, in words, that the difference is NOT a set of corrected projects", () => {
    // The entire point of the rewrite. Without this sentence the reader does the
    // only arithmetic on offer — 16 − 9 = 7 corrected — which inverts the source.
    draw();
    expect(
      screen.getByText(/Разликата между тях НЕ са проекти с наложена корекция/),
    ).toBeInTheDocument();
  });

  it("omits the disclaimer when only ONE figure is on screen", () => {
    // Non-vacuity for the test above: with nothing to subtract, the sentence would
    // raise a question the page has not posed.
    draw({
      on_time_contracts: null,
      clean_contracts: 2,
      beneficiary_listed: false,
    });
    expect(
      screen.queryByText(/Разликата между тях НЕ са проекти/),
    ).not.toBeInTheDocument();
  });

  it("states the beneficiary claim when the register makes it", () => {
    // Presence in isun_clean_beneficiary IS „no correction was imposed on this
    // company" — the strongest claim available about the company itself, and the
    // one the old tile never made: it published only a count WITHIN that claim.
    const { container } = draw();
    expect(container.textContent).toMatch(
      /ИСУН изброява фирмата сред бенефициентите без наложена финансова корекция/,
    );
  });

  it("withholds that claim for a company the beneficiary register does not list", () => {
    // Non-vacuity for the test above, and the harm it prevents: 956 EIKs reach
    // this tile through the CONTRACT register alone, and ИСУН makes no
    // correction-free statement about those companies.
    const { container } = draw({ beneficiary_listed: false });
    expect(container.textContent).not.toMatch(/ИСУН изброява фирмата/);
  });

  // ── the evidence: the named contracts ──────────────────────────────────────

  it("lists the named clean contracts, each linking to its own page", () => {
    draw({
      clean_contracts: 2,
      contracts: [
        contract(),
        contract({
          contract_number: "BG16RFOP002-2.077-0541",
          title: "Подкрепа за средни предприятия",
          programme: "Иновации и конкурентоспособност",
          closed_on: "2021-04-06",
          original_end_on: "2021-04-14",
        }),
      ],
    });
    const first = screen.getByRole("link", {
      name: /Подкрепа за прехода към кръгова икономика/,
    });
    expect(first).toHaveAttribute("href", "/funds/contract/BG-RRP-3.008-0282");
    expect(
      screen.getByRole("link", { name: /Подкрепа за средни предприятия/ }),
    ).toHaveAttribute("href", "/funds/contract/BG16RFOP002-2.077-0541");
    // The closing date and the declared deadline sit side by side. The tile must
    // NOT derive an on-time/late verdict from them — that is the register's
    // determination, published as the separate count — so the row carries the two
    // dates and no adjective. Scoped to the row: the disclaimer prose below
    // legitimately contains „със закъснение".
    expect(screen.getByText(/приключен 5\.03\.2025/)).toBeInTheDocument();
    expect(screen.getByText(/срок 17\.12\.2025/)).toBeInTheDocument();
    const row = first.closest("li") as HTMLElement;
    expect(row.textContent).toMatch(/приключен .*· срок /);
    expect(row.textContent).not.toMatch(/закъснение|в срок|навреме|просрочен/);
  });

  it("drops the separator for a row with no programme", () => {
    // Every column on the row is nullable; a meta line must not open with „ · ".
    draw({
      clean_contracts: 1,
      contracts: [contract({ programme: null, original_end_on: null })],
    });
    expect(screen.getByText("приключен 5.03.2025 г.")).toBeInTheDocument();
  });

  it("shows the residue when the list is shorter than the count", () => {
    // Server-side these are one payload and cannot disagree; a truncation added
    // later must show what it left out rather than leave the number unexplained.
    draw({ clean_contracts: 9, contracts: [contract()] });
    expect(screen.getByText("+8 още")).toBeInTheDocument();
  });

  // ── the chips, which are now a FALLBACK ────────────────────────────────────

  it("suppresses the programme chips once the contracts are listed", () => {
    // The chips ARE the clean contracts' programmes, and they used to sit under
    // the on-time figure they do not describe. With the rows present each carries
    // its own programme, so the chips are a duplicate.
    draw({
      clean_contracts: 1,
      programmes: ["Програма за морско дело и рибарство"],
      contracts: [contract()],
    });
    expect(
      screen.queryAllByText("Програма за морско дело и рибарство"),
    ).toHaveLength(0);
  });

  it("still shows the chips for a payload with no contract rows", () => {
    // The pre-175 shape, and any database whose function predates the rewrite.
    draw({ contracts: null });
    expect(
      screen.getByText("Програма за морско дело и рибарство"),
    ).toBeInTheDocument();
  });

  it("survives a null programmes array and a null caveat", () => {
    // Both are nullable in the payload; neither may crash the page.
    draw({ programmes: null, absence_meaning: null });
    expect(screen.getByText("16")).toBeInTheDocument();
  });

  it("caps the programme chips and says how many are hidden", () => {
    draw({ programmes: ["a", "b", "c", "d", "e", "f"] });
    expect(screen.getByText("+2")).toBeInTheDocument();
  });
});
