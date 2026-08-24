// Component guard for the two-register career timeline.
//
// The thing worth locking is what this block REFUSES to do. The Сметна палата corpus is a
// stock-basis estate and the ИВСС annual's Таблица 1 is a FLOW (property acquired in the
// period); 090 already picks one declaration per (person, period_year). So interleaving the
// two is a chronology and must never become an arithmetic: no total, no merged figure, no
// implication that a year covered by both is one filing. Every row is labelled with the body
// that published it.
//
// The second lock is the self-hide. 59 people of ~3,594 magistrates file in both registers;
// for everyone else this block must not appear, because a "timeline" of one source is a
// second copy of a block the page already has.
//
// Hermetic: both data hooks are mocked (vitest.setup throws on an unstubbed fetch).

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { DeclarationListItem } from "./usePersonDeclarations";
import type { MagistrateFiling } from "@/data/judiciary/useMagistrateHoldings";

const langMock = vi.hoisted(() => ({ current: "bg" }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: langMock.current },
  }),
}));

const cacMock = vi.hoisted(() => ({
  current: undefined as DeclarationListItem[] | undefined,
}));
const ivssMock = vi.hoisted(() => ({
  current: { holding: null, year: null } as {
    holding: {
      filings?: MagistrateFiling[];
      filingsNameAmbiguous?: boolean;
    } | null;
    year: number | null;
  },
}));

vi.mock("./usePersonDeclarations", () => ({
  usePersonDeclarations: () => cacMock.current,
}));
vi.mock("@/data/judiciary/useMagistrateHoldings", () => ({
  usePersonMagistrateHoldings: () => ivssMock.current,
}));

const { PersonDeclarationTimeline } =
  await import("./PersonDeclarationTimeline");

const cac = (year: number, institution: string): DeclarationListItem =>
  ({
    id: year * 10 + institution.length,
    tier: "mp",
    year,
    fiscalYear: year - 1,
    periodYear: year - 1,
    type: "Annualy",
    institution,
    positionTitle: null,
    filedAt: null,
    sourceUrl: `https://register.cacbg.bg/${year}.xml`,
    assetsEur: 0,
    debtsEur: 0,
    netEur: 0,
    assetCount: 0,
    stakeCount: 0,
    eventCount: 0,
    excludedAssetRows: 0,
    cryptoCount: 0,
    cryptoEur: 0,
    usedAssetRows: 0,
    usedContractEur: 0,
  }) as DeclarationListItem;

const ivss = (year: number, ref: string): MagistrateFiling => ({
  year,
  registerDir: "annual",
  ref,
  sourceUrl: `http://62.176.124.194/images/declaracii/${year}/f.pdf`,
});

const renderTimeline = (
  cacRows: DeclarationListItem[] | undefined,
  ivssRows: MagistrateFiling[],
) => {
  cacMock.current = cacRows;
  ivssMock.current = { holding: { filings: ivssRows }, year: 2026 };
  return render(<PersonDeclarationTimeline slug="mp-3631" name="Дани" />);
};

afterEach(() => {
  langMock.current = "bg";
});

describe("PersonDeclarationTimeline", () => {
  it("interleaves both registers newest-first and labels every row", () => {
    // Каназирева's real shape: областен управител, then an MP, now a judge.
    renderTimeline(
      [
        cac(2022, "47-МО НАРОДНО СЪБРАНИЕ"),
        cac(2020, "ОБЛАСТНА АДМИНИСТРАЦИЯ"),
      ],
      [ivss(2026, "7004/12.05.2026"), ivss(2025, "14750/25.09.2025")],
    );
    const years = screen
      .getAllByText(/^(2020|2022|2025|2026)$/)
      .map((n) => n.textContent);
    expect(years).toEqual(["2026", "2025", "2022", "2020"]);
    // Each row names the body that published it — the two are not interchangeable.
    expect(screen.getAllByText("ИВСС")).toHaveLength(2);
    expect(screen.getAllByText("Сметна палата")).toHaveLength(2);
  });

  it("states that the two registers are not summed", () => {
    // The load-bearing sentence. A chronology of two incommensurable bases invites a reader
    // to add them; the ИВСС real-estate table is a FLOW and the Сметна палата corpus a
    // stock-basis estate.
    renderTimeline([cac(2022, "47 НС")], [ivss(2026, "1/01.01.2026")]);
    expect(screen.getByText(/НЕ се сумират/)).toBeInTheDocument();
    // …and it counts each register separately rather than publishing a combined figure.
    expect(
      screen.getByText(/1 декларации пред Сметната палата и 1 пред ИВСС/),
    ).toBeInTheDocument();
  });

  it("renders nothing when the person filed with only one body", () => {
    // The common case by far — 3,535 of ~3,594 magistrates.
    const { container: onlyIvss } = renderTimeline(
      [],
      [ivss(2026, "1/1.1.26")],
    );
    expect(onlyIvss).toBeEmptyDOMElement();
    const { container: onlyCac } = renderTimeline([cac(2022, "47 НС")], []);
    expect(onlyCac).toBeEmptyDOMElement();
  });

  it("renders nothing while the Court-of-Audit list is still loading", () => {
    // `usePersonDeclarations` returns undefined before it resolves. Treating that as "no
    // filings" would flash the single-register state, then hide it.
    const { container } = renderTimeline(undefined, [ivss(2026, "1/1.1.26")]);
    expect(container).toBeEmptyDOMElement();
  });

  it("drops an ИВСС row that is not on the register's own origin", () => {
    cacMock.current = [cac(2022, "47 НС")];
    ivssMock.current = {
      holding: {
        filings: [
          ivss(2026, "1/01.01.2026"),
          {
            ...ivss(2020, "9/09.09.2020"),
            sourceUrl: "https://evil.test/x.pdf",
          },
        ],
      },
      year: 2026,
    };
    render(<PersonDeclarationTimeline slug="mp-3631" name="Дани" />);
    expect(screen.queryByText("2020")).not.toBeInTheDocument();
    for (const a of screen.getAllByRole("link"))
      expect(a.getAttribute("href")).not.toMatch(/evil\.test/);
  });

  it("says the ИВСС rows are name-matched when the name covers several people", () => {
    // ⚠️ This block makes a STRONGER claim than either source does alone: one column is
    // keyed on a person_id and the other on a NAME, and putting them under one heading
    // asserts a single career. Where the register provably folds namesakes that is not
    // safe — 10 of the 59 people who see this block, including Десислава Ахладова-Атанасова,
    // a former Minister of Justice. The sibling tile 200px above says so; without this the
    // page contradicts itself.
    cacMock.current = [cac(2022, "47 НС")];
    ivssMock.current = {
      holding: {
        filings: [ivss(2026, "1/01.01.2026")],
        filingsNameAmbiguous: true,
      },
      year: 2026,
    };
    render(<PersonDeclarationTimeline slug="mp-3180" name="Десислава" />);
    expect(screen.getByText(/подбрани по ИМЕ/)).toBeInTheDocument();
    expect(
      screen.getByText(/не е непременно една биография/),
    ).toBeInTheDocument();
  });

  it("does not raise the namesake caveat when the name is unambiguous", () => {
    renderTimeline([cac(2022, "47 НС")], [ivss(2026, "1/01.01.2026")]);
    expect(screen.queryByText(/подбрани по ИМЕ/)).not.toBeInTheDocument();
  });

  it("renders the same block in English", () => {
    langMock.current = "en";
    renderTimeline([cac(2022, "47 НС")], [ivss(2026, "1/01.01.2026")]);
    expect(
      screen.getByText(/Declarations across the whole career/),
    ).toBeInTheDocument();
    expect(screen.getByText(/are NOT summed/)).toBeInTheDocument();
    expect(screen.getByText("Court of Audit")).toBeInTheDocument();
  });
});
