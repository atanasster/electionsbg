// Component guard for „Участие в обединения".
//
// This tile is the ONLY procurement surface a consortium-member-only entity has — 1,172
// companies and 731 person name folds, party to €7.48bn of joint awards that their pages
// used to render as nothing (plan: docs/plans/consortium-member-visibility-v1.md).
//
// Its failure mode is not a wrong number. It is a CLAIM ABOUT A NAMED FIRM: the euro figure
// is the FULL value of each joint contract, because ЦАИС publishes the award and not the
// split, so a tile that presents it as the firm's own money says „МЛГ ЕООД won €69.2m" about
// a firm that was one of three parties. Everything locked below is there to stop that
// sentence being readable off the page.
//
// 1. THE CAVEAT IS IN THE BODY, NOT A TOOLTIP. A reader on a phone never hovers, and
//    „€69,2 млн." beside a company name reads as revenue unless something adjacent says
//    otherwise. Three claims have to be present in visible text: the sum is the contracts'
//    full value, the share is not public, and it is not revenue.
// 2. THE HEADING IS NEVER „Обществени поръчки". That heading is what the solo section uses,
//    and it would assert the firm won these contracts.
// 3. AN ANNEX IS THE CARRIER'S, NOT A FILING BY THIS FIRM. „договорът е изменян N пъти",
//    never „подадени N анекса" — the amendments sit on the carrier row (087), and
//    `amendmentCount` is the different, firm-owned figure.
// 4. IT SELF-SUPPRESSES AT ZERO. `count === 0` must render nothing rather than „0
//    обединения", which would be a claim on every one of the ~29k solo contractors.
//
// Hermetic: no fetch (vitest.setup throws on an unstubbed one), and the tile renders `<Link>`
// + AwarderLink/CompanyLink, so every render goes through a MemoryRouter.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  ConsortiumParticipationTile,
  type ConsortiumContract,
} from "./ConsortiumParticipationTile";

// The reference case: МЛГ ЕООД (113581389) in the АПИ guardrail framework, whose two
// contracts carry 4 + 1 carrier annexes and took РД-37-45 from 42,598,403 to 93,065,069.67
// BGN (+118%).
const CONTRACTS: ConsortiumContract[] = [
  {
    key: "ae8d824eb32c",
    date: "2022-10-14",
    amountEur: 47583414.54,
    partyEik: "000695089",
    partyName: 'Агенция "Пътна инфраструктура"',
    title: "ВЪЗСТАНОВЯВАНЕ, РЕМОНТ, ДОСТАВКА И МОНТАЖ НА ОГРАНИЧИТЕЛНИ СИСТЕМИ",
    consortiumEik: "obed-3653b19cc364",
    consortiumName: "Обединение: Безопасност запад, КМВ-системи, МЛГ ЕООД",
    carrierKey: "obed-abf3a70ed9bb",
    annexCount: 4,
  },
  {
    key: "669288540780",
    date: "2022-10-14",
    amountEur: 21602081.97,
    partyEik: "000695089",
    partyName: 'Агенция "Пътна инфраструктура"',
    title:
      "ВЪЗСТАНОВЯВАНЕ, РЕМОНТ, ДОСТАВКА И МОНТАЖ НА ОГРАНИЧИТЕЛНИ СИСТЕМИ — лот 2",
    consortiumEik: "obed-3653b19cc364",
    consortiumName: "Обединение: Безопасност запад, КМВ-системи, МЛГ ЕООД",
    carrierKey: "obed-e577e14118e1",
    annexCount: 1,
  },
];

/** Intl puts a NO-BREAK SPACE inside „€69,2 млн." and the group separators, so a literal
 *  regex written with an ordinary space silently never matches. Normalise every readback. */
const flat = (el: HTMLElement | null): string =>
  (el?.textContent ?? "").replace(/[\u00a0\u202f\u2009]/g, " ");

const renderTile = (
  props: Partial<Parameters<typeof ConsortiumParticipationTile>[0]> = {},
) =>
  render(
    <MemoryRouter>
      <ConsortiumParticipationTile
        count={2}
        eur={69185496.51}
        annexCount={5}
        contracts={CONTRACTS}
        {...props}
      />
    </MemoryRouter>,
  );

describe("ConsortiumParticipationTile", () => {
  it("names the participation, never the winning", () => {
    renderTile();
    expect(screen.getByText(/Участие в обединения/)).toBeInTheDocument();
    // The solo section's heading must not appear here.
    expect(screen.queryByText(/^Обществени поръчки$/)).not.toBeInTheDocument();
  });

  it("states in VISIBLE text that the sum is not the firm's money", () => {
    const { container } = renderTile();
    const text = flat(container);
    // All three claims, in the body rather than a title attribute.
    expect(text).toMatch(/пълната стойност на договорите/);
    expect(text).toMatch(/дялът на всеки участник не е публичен/);
    expect(text).toMatch(/не е приход/);
  });

  it("renders the joint total and the carrier annex count", () => {
    const { container } = renderTile();
    const text = flat(container);
    expect(text).toMatch(/€69,2 млн\./);
    expect(text).toMatch(/общо по 2 договора/);
    expect(text).toMatch(/5 анекса по тези договори/);
  });

  it("calls an annex an amendment OF THE CONTRACT, not a filing by the firm", () => {
    const { container } = renderTile();
    const text = flat(container);
    expect(text).toMatch(/договорът е изменян 4 пъти/);
    expect(text).toMatch(/договорът е изменян 1 път/);
    // The firm-owned wording must not appear — that is `amendmentCount`, a different figure.
    expect(text).not.toMatch(/подадени|подал/);
  });

  it("links each contract at the CARRIER's key, where the money and annexes are", () => {
    renderTile();
    const hrefs = screen
      .getAllByRole("link")
      .map((a) => a.getAttribute("href") ?? "");
    expect(hrefs).toContain("/procurement/contract/obed-abf3a70ed9bb");
    expect(hrefs).toContain("/procurement/contract/obed-e577e14118e1");
    // NOT the member row's own key — it carries €0 and no annexes.
    expect(hrefs).not.toContain("/procurement/contract/ae8d824eb32c");
    // And NEVER the ИСУН EU-funds family, which is a different corpus keyed by
    // fund_projects.contract_number — a `contracts.key` there is a „not found" page.
    expect(hrefs.some((h) => h.startsWith("/funds/contract/"))).toBe(false);
  });

  it("falls back to the member key when no carrier resolved", () => {
    // `carrierKey` is a LEFT JOIN and can be null; the row must still be reachable.
    renderTile({
      contracts: [{ ...CONTRACTS[0], carrierKey: null }],
      count: 1,
    });
    const hrefs = screen
      .getAllByRole("link")
      .map((a) => a.getAttribute("href") ?? "");
    expect(hrefs).toContain("/procurement/contract/ae8d824eb32c");
  });

  it("renders NOTHING at zero participation", () => {
    const { container } = renderTile({ count: 0, eur: 0, contracts: [] });
    expect(container.textContent).toBe("");
  });

  it("names the member company on the person arm only", () => {
    const withContractor = [
      {
        ...CONTRACTS[0],
        contractorEik: "113581389",
        contractorName: "МЛГ ЕООД",
      },
    ];
    // Person arm: a portfolio spans several companies, so each row says which one.
    const person = render(
      <MemoryRouter>
        <ConsortiumParticipationTile
          count={1}
          eur={47583414.54}
          contracts={withContractor}
          showContractor
        />
      </MemoryRouter>,
    );
    expect(flat(person.container)).toMatch(/чрез\s*МЛГ ЕООД/);
    // …and the copy addresses the person's companies, not "the firm".
    expect(flat(person.container)).toMatch(/фирмите на лицето участват/);
    person.unmount();

    // Company arm: there is only one firm, so naming it on every row is noise.
    const { container } = renderTile({ contracts: withContractor, count: 1 });
    expect(flat(container)).not.toMatch(/чрез/);
    expect(flat(container)).toMatch(/фирмата участва/);
  });

  it("discloses a truncated list rather than cutting it silently", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      ...CONTRACTS[0],
      key: `k${i}`,
      carrierKey: `c${i}`,
    }));
    const { container } = renderTile({ contracts: many, count: 12 });
    expect(flat(container)).toMatch(/и още 4 договора/);
  });

  it("counts the hidden rows against `count`, not the delivered array", () => {
    // The payload itself is capped at `conslist`'s LIMIT 25 while `consortiumCount` is
    // unbounded, so the array arrives pre-truncated. Subtracting it would under-disclose:
    // measured on EIK 206331450 — count 40, 25 delivered, 8 shown — the array form says
    // „и още 17" and loses 15 contracts under a heading that says 40.
    const delivered = Array.from({ length: 25 }, (_, i) => ({
      ...CONTRACTS[0],
      key: `k${i}`,
      carrierKey: `c${i}`,
    }));
    const { container } = renderTile({ contracts: delivered, count: 40 });
    expect(flat(container)).toMatch(/Участие в обединения \(40\)/);
    expect(flat(container)).toMatch(/и още 32 договора/);
  });

  it("never prints Infinity or NaN when the euro figure is absent", () => {
    // `amountEur` is nullable in the payload; a division or a bare template would leak.
    const { container } = renderTile({
      eur: 0,
      count: 1,
      annexCount: 0,
      contracts: [{ ...CONTRACTS[0], amountEur: null }],
    });
    expect(flat(container)).not.toMatch(/Infinity|NaN/);
  });
});
