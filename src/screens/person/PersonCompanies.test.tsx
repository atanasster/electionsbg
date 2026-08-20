// The declared-stakes remainder split (person-page-completeness-v1 T4b).
//
// What is under test is a REFUSAL. 096 declines to name a company for 84% of declared stakes,
// and this section is where that refusal is shown to a reader — so the failure mode is not a
// blank screen, it is a row that looks like a link when the register never confirmed one.
// Every case below is written against that: what is rendered as an anchor, and what is not.
//
// The status payload is stubbed rather than fetched — the SQL side is gated in
// scripts/db/tests/stake_procurement.data.test.ts, which asserts against the live register.

import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DeclaredStakeStatus } from "./useDeclaredStakeStatus";
import type { MpDeclaration } from "@/data/dataTypes";
import type { ProfileCompany } from "./usePersonProfile";

const statusRows = vi.hoisted(() => ({
  current: [] as DeclaredStakeStatus[] | undefined,
}));
const declRows = vi.hoisted(() => ({ current: [] as MpDeclaration[] }));

vi.mock("./useDeclaredStakeStatus", () => ({
  useDeclaredStakeStatus: () => statusRows.current,
}));
vi.mock("@/data/parliament/useMpDeclarations", () => ({
  useMpDeclarations: () => ({ declarations: declRows.current }),
}));

const { PersonCompanies } = await import("./PersonCompanies");

// One filing declaring one stake in `company`, held by `holder` when given.
/** `slug` defaults to null, as every pre-existing case here relies on. The two dead-link
 *  regression tests below pass a REAL one on purpose: with null, the retired
 *  /mp/company/{companySlug} branch never fired either, so the assertion would have been
 *  satisfied by the very code it exists to keep out. */
const filing = (
  company: string,
  holder?: string,
  slug: string | null = null,
): MpDeclaration =>
  ({
    declarationYear: 2023,
    fiscalYear: 2022,
    sourceUrl: `https://register.cacbg.bg/${encodeURIComponent(company)}`,
    ownershipStakes: [
      {
        table: "10",
        companyName: company,
        companySlug: slug,
        itemType: "Дялове",
        registeredOffice: null,
        holderName: holder ?? null,
        heldByOther: holder != null,
        shareSize: "100%",
        valueEur: null,
      },
    ],
  }) as unknown as MpDeclaration;

const status = (
  declaredName: string,
  reason: DeclaredStakeStatus["reason"],
  extra: Partial<DeclaredStakeStatus> = {},
): DeclaredStakeStatus => ({
  declaredName,
  holderName: null,
  holderIsDeclarant: true,
  reason,
  eik: null,
  companyName: null,
  candidates: [],
  ...extra,
});

const draw = (companies: ProfileCompany[] = [], foldPeopleN?: number | null) =>
  render(
    <MemoryRouter>
      <PersonCompanies
        companies={companies}
        name="Тест Тестов"
        mpId={1}
        slug="p-1"
        foldPeopleN={foldPeopleN}
      />
    </MemoryRouter>,
  );

/** A registry company on this person's page, defaulting to the name-matched basis. */
const company = (
  name: string,
  linkBasis?: ProfileCompany["linkBasis"],
): ProfileCompany =>
  ({
    eik: name === "ПЪРВА" ? "111" : "999",
    name,
    legalForm: "ЕООД",
    seat: null,
    status: "active",
    roles: ["manager"],
    linkBasis,
    procuredEur: null,
    contracts: null,
    fundsEur: null,
    fundsPaidEur: null,
    fundProjects: null,
    subsidiesEur: null,
  }) as ProfileCompany;

const allHrefs = (): string[] =>
  screen.queryAllByRole("link").map((a) => a.getAttribute("href") ?? "");

/** Company links only. ⚠️ The `/company/` prefix filter would ALSO hide a resurrected
 *  `/mp/company/…` href, so the dead-link tests assert over `allHrefs()` instead. */
const links = (): string[] =>
  allHrefs().filter((h) => h.startsWith("/company/"));

beforeEach(() => {
  statusRows.current = [];
  declRows.current = [];
});

describe("PersonCompanies — no stake row links to a declared-NAME page", () => {
  it("renders the company name as text and links only the EIK the register confirmed", () => {
    // StakeRow used to link every stake to /mp/company/{companySlug} — a page keyed on the
    // DECLARED NAME. The form carries no EIK, so that page attached one on a name-uniqueness
    // check alone; 096 refuses 1,751 of the 2,120 links it made. The row is text now, and the
    // ONLY company link on a stake is the one 096 resolved, rendered beneath it.
    declRows.current = [
      filing("Питстрой 13 ЕООД", undefined, "Питстрой-13-ЕООД"),
    ];
    statusRows.current = [
      status("ПИТСТРОЙ 13 ЕООД", "linked", {
        eik: "204361427",
        companyName: "ПИТСТРОЙ 13",
      }),
    ];
    draw();
    expect(allHrefs().some((h) => h.startsWith("/mp/company/"))).toBe(false);
    expect(links()).toEqual(["/company/204361427"]);
  });

  it("a REFUSED stake gets no company link at all", () => {
    // The other half. An unconfirmed row is precisely what the retired page linked anyway.
    declRows.current = [
      filing("Питстрой 13 ЕООД", undefined, "Питстрой-13-ЕООД"),
    ];
    statusRows.current = [status("ПИТСТРОЙ 13 ЕООД", "unconfirmed")];
    draw();
    expect(allHrefs().some((h) => h.startsWith("/mp/company/"))).toBe(false);
    expect(links()).toEqual([]);
  });
});

describe("PersonCompanies — the declared-stakes remainder", () => {
  it("links a family holding the register DID resolve", () => {
    // The whole reason the linked arm exists: a spouse's company is by definition absent from
    // the subject's own registry footprint, so the name match against that footprint cannot
    // find it and it lands in this remainder fully resolved.
    declRows.current = [filing("Питстрой 13 ЕООД", "Явор Петров Петров")];
    statusRows.current = [
      status("ПИТСТРОЙ 13 ЕООД", "linked", {
        eik: "204361427",
        companyName: "ПИТСТРОЙ 13",
        holderName: "Явор Петров Петров",
        holderIsDeclarant: false,
      }),
    ];
    draw();
    expect(links()).toEqual(["/company/204361427"]);
    // The attribution travels with it — this is not the subject's company.
    expect(screen.getAllByText(/Явор Петров Петров/).length).toBeGreaterThan(0);
  });

  it("keeps one company's two holders apart — a refusal must not borrow a resolution", () => {
    // THE DEFECT THIS KEY EXISTS FOR. 096 resolves per (name, holder), so one declared company
    // can be refused for the filer and resolved through their spouse. Keyed on the name alone,
    // the spouse's verdict landed on the filer's row and the profile anchored a company the
    // register does not place him in — 91 such groups in the corpus, 23 refusing the filer's
    // own claim. Modelled on mp-2647 / „АЛ И КО АД".
    declRows.current = [
      filing("Ал и Ко АД", "Димитър Крумов Александров"),
      filing("АЛ И КО АД", "Катя Георгиева Александрова"),
    ];
    statusRows.current = [
      status("Ал и Ко АД", "unconfirmed", {
        holderName: "Димитър Крумов Александров",
      }),
      status("АЛ И КО АД", "linked", {
        eik: "127003032",
        companyName: "АЛ И КО",
        holderName: "Катя Георгиева Александрова",
        holderIsDeclarant: false,
      }),
    ];
    draw();
    // Exactly one link, and it is the wife's row.
    expect(links()).toEqual(["/company/127003032"]);
    expect(screen.getByText(/pp_declared_reason_unconfirmed/)).toBeTruthy();
  });

  it("distinguishes a shared name from a name we hold nobody for", () => {
    // Gate C refuses on `n <> 1`, so a footprint that did not resolve was blocked either
    // because the name is shared (`n >= 2`) or because the person layer holds nobody by it
    // (`n = 0`, 35.5% of them). One sentence for both would claim something unsupported.
    declRows.current = [filing("Алфа ЕООД"), filing("Бета ЕООД")];
    statusRows.current = [
      status("АЛФА", "namesake"),
      status("БЕТА", "unverified"),
    ];
    draw();
    expect(screen.getByText(/pp_declared_reason_namesake/)).toBeTruthy();
    expect(screen.getByText(/pp_declared_reason_unverified/)).toBeTruthy();
  });

  it("names every candidate for an ambiguous stake and links none of them", () => {
    // Picking one of two same-named companies is the defect gate A′ was widened to avoid.
    // Naming both is the honest move; making either an anchor undoes it.
    declRows.current = [filing("Актив груп ЕООД")];
    statusRows.current = [
      status("АКТИВ ГРУП ЕООД", "ambiguous", {
        candidates: [
          { eik: "121891779", name: "АКТИВ ГРУП" },
          { eik: "125577092", name: "АКТИВ ГРУП" },
        ],
      }),
    ];
    draw();
    expect(links()).toEqual([]);
    // The NAME rides with the EIK: two bare numbers give a reader nothing to tell two
    // same-named companies apart with, which is the question the row is asking them.
    expect(
      screen.getByText(/АКТИВ ГРУП — 121891779; АКТИВ ГРУП — 125577092/),
    ).toBeTruthy();
  });

  it("says a company of that name exists rather than that none does", () => {
    // The distinction the split exists for: 41% of stakes name a company that IS in the
    // register. Reporting them under "no match in the register" states something false
    // about a named company.
    declRows.current = [filing("Интерактив комюникейшънс ЕООД")];
    statusRows.current = [status("ИНТЕРАКТИВ КОМЮНИКЕЙШЪНС", "unconfirmed")];
    draw();
    expect(links()).toEqual([]);
    expect(screen.getByText(/pp_declared_reason_unconfirmed/)).toBeTruthy();
    expect(screen.queryByText(/pp_declared_reason_absent/)).toBeNull();
  });

  it("keeps the namesake refusal distinct from an absent company", () => {
    declRows.current = [filing("Някаква Фирма ООД")];
    statusRows.current = [status("НЯКАКВА ФИРМА", "namesake")];
    draw();
    expect(links()).toEqual([]);
    expect(screen.getByText(/pp_declared_reason_namesake/)).toBeTruthy();
  });

  it("shows no remainder group until the verdicts land", () => {
    // `undefined` is "not answered yet"; `[]` is "answered, nothing". Rendering the rows
    // before the answer means one caption for everything and then a redistribution into up to
    // three headed groups — a reshuffle of a named person's holdings, plus the layout shift
    // under it. The call is ~14 ms, so waiting is cheaper than reserving a shape.
    declRows.current = [filing("Някаква ЕООД")];
    statusRows.current = undefined;
    draw();
    expect(screen.queryByText("pp_declared_only")).toBeNull();
    expect(screen.queryByText("pp_declared_linked")).toBeNull();
    expect(screen.queryByText("pp_declared_unmatched")).toBeNull();
  });

  it("renders a stake with no verdict exactly as before, never as a claim", () => {
    // The status call has not landed, failed, or the person is outside 096's public-figure
    // gate. The split is additive: an unreached server must not invent a reason.
    declRows.current = [filing("Непозната ЕООД")];
    statusRows.current = [];
    draw();
    expect(links()).toEqual([]);
    expect(screen.getByText("pp_declared_only")).toBeTruthy();
    expect(screen.queryByText(/pp_declared_reason_/)).toBeNull();
  });

  it("never captions a no-verdict row with the absent sentence", () => {
    // „Няма търговско дружество с това име" is a finding about the register. A row nothing was
    // determined for may sit in the same block — it has nowhere better to be — but not under
    // that sentence, which is the same false precision the split removes elsewhere.
    declRows.current = [filing("Изчезнала ЕООД"), filing("Неизвестна ЕООД")];
    statusRows.current = [status("ИЗЧЕЗНАЛА", "absent")];
    draw();
    const caption = screen.getByText(/pp_declared_reason_absent/);
    const captioned = caption.parentElement as HTMLElement;
    expect(captioned.textContent).toContain("Изчезнала ЕООД");
    expect(captioned.textContent).not.toContain("Неизвестна ЕООД");
  });

  it("puts each stake in exactly one group", () => {
    declRows.current = [
      filing("Първа ЕООД"),
      filing("Втора ЕООД"),
      filing("Трета ЕООД"),
    ];
    statusRows.current = [
      status("ПЪРВА", "linked", { eik: "111", companyName: "ПЪРВА" }),
      status("ВТОРА", "ambiguous", {
        candidates: [
          { eik: "222", name: "ВТОРА" },
          { eik: "333", name: "ВТОРА" },
        ],
      }),
      status("ТРЕТА", "absent"),
    ];
    draw();
    for (const n of ["Първа ЕООД", "Втора ЕООД", "Трета ЕООД"])
      expect(screen.getAllByText(n)).toHaveLength(1);
    expect(links()).toEqual(["/company/111"]);
  });
});

// ── The link BASIS (tr-attribution-basis-v1 §1.2) ────────────────────────────
//
// The defect these cover: the namesake caveat used to render for anyone with any company, so
// it said nothing about WHICH company rested on a name — and it told the ~340 people whose
// every holding is register-confirmed that their own declared interests might be somebody
// else's. Asserted on the words rather than on a class, per PersonMoneyCells.test.tsx.
describe("PersonCompanies — the link basis", () => {
  const NAMESAKE = /Лицата в Търговския регистър се идентифицират/;

  it("marks a name-matched company and caveats the card", () => {
    draw([company("ВТОРА")]);
    expect(screen.getAllByText("по име").length).toBe(1);
    expect(screen.getByText(NAMESAKE)).toBeTruthy();
  });

  it("leaves a fully declared footprint unmarked and uncaveated", () => {
    // The reassurance has to be earned: every contributing company is register-confirmed, so
    // there is nothing here for the namesake sentence to qualify.
    draw([company("ПЪРВА", "declared")]);
    expect(screen.queryByText("по име")).toBeNull();
    expect(screen.queryByText(NAMESAKE)).toBeNull();
  });

  it("marks only the name-matched half of a mixed footprint", () => {
    // 60 people are 'mixed'. A card-level caveat alone either over-qualifies the curated row
    // or under-qualifies the rest, which is why the mark is per company.
    draw([company("ПЪРВА", "declared"), company("ВТОРА", "name_match")]);
    expect(screen.getAllByText("по име").length).toBe(1);
    expect(screen.getByText(NAMESAKE)).toBeTruthy();
  });

  it("treats a MISSING linkBasis as a name match, never as declared", () => {
    // An older 082 (a cloud database mid-deploy) omits the field. The two ways to be wrong
    // are not symmetric: a needless caveat costs nothing, claiming a company is confirmed
    // when it is not is the failure this whole plan exists to end.
    draw([company("ВТОРА", undefined)]);
    expect(screen.getAllByText("по име").length).toBe(1);
  });

  it("states the registry's own people-count when it has one", () => {
    // Matched WITHOUT the numeral: i18next is not initialised in jsdom, so `t` returns the
    // defaultValue verbatim and {{n}} is not substituted here. The count itself rides on the
    // key in src/locales/*/translation.json; what this asserts is the rendering RULE — that
    // the sentence appears at all, and (below) only when the fold is measured and shared.
    draw([company("ВТОРА")], 3);
    expect(screen.getByText(/различни лица с това име/)).toBeTruthy();
  });

  it("says nothing when the fold is UNMEASURED — absence is not reassurance", () => {
    // null means the fold was never observed in the feed's window, which is 9.4% of folds and
    // growing. Rendering it as "1 person" would turn missing evidence into a clean bill.
    draw([company("ВТОРА")], null);
    expect(screen.queryByText(/различни лица с това име/)).toBeNull();
    draw([company("ВТОРА")], 1);
    expect(screen.queryByText(/различни лица с това име/)).toBeNull();
  });
});
