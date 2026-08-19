// Component guards for two things the expanded filing must say and did not.
//
// 1. WHOSE company a declared stake is. Unmarked, the row reads as this person's company
//    on their own profile: Николай Копринков's page showed „Дийонима ЕООД · 1/1" for a
//    company his filing puts in his wife's name, directly under a companies block listing
//    a different firm. The asset rows have carried the marker all along; the stake rows
//    had no is_spouse column and nobody derived one. For how often it fires, see the
//    measured split on `isSpouseHolder` — do not restate it here.
//
// 2. WHAT the property holding is. The € stat cards answer „how much", and for property
//    they frequently answer €0 — 38.6% of declared properties carry no stated price — so
//    nine ниви and a house can headline as almost nothing owned. The count and the kind are
//    known regardless, so they sit in the KPI row beside the money.
//
// Hermetic: fetch stubbed, i18n keyed through.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  clearDeclarationDetailCache,
  type DeclarationListItem,
} from "./usePersonDeclarations";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: { count?: number }) =>
      o?.count != null ? `${k}:${o.count}` : k,
    i18n: { language: "bg" },
  }),
}));

import { PersonDeclarations } from "./PersonDeclarations";

const DECLARANT = "Николай Иванов Копринков";
const SPOUSE = "Теодора Стоянова Копринкова";

const row: DeclarationListItem = {
  id: 1,
  tier: "exec",
  year: 2026,
  fiscalYear: null,
  periodYear: 2026,
  type: "Entry",
  institution: "Министерски съвет",
  positionTitle: "Началник на политическия кабинет",
  filedAt: "2026-05-28",
  sourceUrl: "https://register.cacbg.bg/2026/x.xml",
  assetsEur: 193_000,
  debtsEur: 3_000,
  netEur: 190_000,
  assetCount: 19,
  stakeCount: 1,
  eventCount: 0,
  excludedAssetRows: 0,
  cryptoCount: 0,
  cryptoEur: 0,
  usedAssetRows: 0,
  usedContractEur: 0,
} as DeclarationListItem;

const prop = (description: string) => ({
  category: "real_estate",
  description,
  detail: null,
  location: null,
  municipality: null,
  areaSqm: null,
  acquiredYear: null,
  share: null,
  valueEur: 0,
  holderName: null,
  isSpouse: false,
  isHolding: true,
  tableNum: "1",
  legalBasis: null,
  fundsOrigin: null,
  unitRaw: null,
  currency: null,
  amount: null,
  valueBasis: null,
});

const stake = (companyName: string, holderName: string | null) => ({
  tableNum: "10",
  companyName,
  stakeKind: "share",
  itemType: "Дялове",
  companySlug: null,
  holderName,
  transfereeName: null,
  shareSize: "1/1",
  valueEur: 104_814,
  registeredOffice: "с. Труд",
});

const stubWith = (detail: Record<string, unknown>) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      json: async () =>
        String(url).includes("declaration-detail") ? detail : [row],
    })) as unknown as typeof fetch,
  );

const baseDetail = (o: Record<string, unknown>) => ({
  id: 1,
  declarantName: DECLARANT,
  type: "Entry",
  institution: "Министерски съвет",
  positionTitle: "Началник на политическия кабинет",
  filedAt: "2026-05-28",
  entryNumber: "В2202",
  controlHash: null,
  sourceUrl: "https://register.cacbg.bg/2026/x.xml",
  year: 2026,
  fiscalYear: null,
  assets: [],
  income: [],
  stakes: [],
  events: [],
  ...o,
});

const expand = async () => {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /Началник/ }));
};

afterEach(() => {
  vi.unstubAllGlobals();
  // useDeclarationDetail caches per filing id at MODULE scope, so without this every
  // case after the first would read the first case's payload for id 1.
  clearDeclarationDetailCache();
});

describe("expanded filing — whose stake it is", () => {
  it("names the holder when the stake is not the declarant's", async () => {
    stubWith(baseDetail({ stakes: [stake("Дийонима ЕООД", SPOUSE)] }));
    render(<PersonDeclarations slug="x" />);
    await expand();
    // The company still renders; what changes is that it no longer reads as HIS.
    expect(await screen.findByText(/Дийонима ЕООД/)).toBeInTheDocument();
    expect(await screen.findByText(SPOUSE)).toBeInTheDocument();
  });

  it("adds nothing when the declarant holds it themselves", async () => {
    stubWith(baseDetail({ stakes: [stake("Дийонима ЕООД", DECLARANT)] }));
    render(<PersonDeclarations slug="x" />);
    await expand();
    expect(await screen.findByText(/Дийонима ЕООД/)).toBeInTheDocument();
    // Marking every row would make the marker meaningless — it has to discriminate.
    expect(screen.queryByText(DECLARANT)).not.toBeInTheDocument();
  });

  it("treats a name that differs only by spacing or case as the declarant's", async () => {
    // The fold is shared with the parser (isSpouseHolder). If the renderer compared raw
    // strings, a filing that writes the holder in caps would mark the declarant's own
    // company as somebody else's.
    stubWith(
      baseDetail({
        stakes: [stake("Дийонима ЕООД", "  николай  иванов копринков ")],
      }),
    );
    render(<PersonDeclarations slug="x" />);
    await expand();
    await screen.findByText(/Дийонима ЕООД/);
    expect(
      screen.queryByText(/николай\s+иванов\s+копринков/i),
    ).not.toBeInTheDocument();
  });
});

describe("expanded filing — property summary", () => {
  it("counts the declared properties by kind, without expanding anything", async () => {
    stubWith(
      baseDetail({
        assets: [
          ...Array.from({ length: 9 }, () => prop("нива")),
          prop("къща с двор, гараж, стопански"),
        ],
      }),
    );
    render(<PersonDeclarations slug="x" />);
    // The card sits in the KPI row: a reader must not have to open a year to learn this.
    expect(await screen.findByText("pp_decl_prop_card")).toBeInTheDocument();
    expect(await screen.findByText("10")).toBeInTheDocument();
    // 10 rows, folded: 9 farmland + 1 house. Bulgarian counting form, not the plural.
    // Through `t`, not PROPERTY_KIND_LABEL: the mock echoes keys, so a Bulgarian literal
    // here would mean the /en render is Bulgarian too (it was).
    expect(
      await screen.findByText("pp_prop_kind_farmland:9 · pp_prop_kind_house:1"),
    ).toBeInTheDocument();
  });

  it("shows a single property rather than hiding it", async () => {
    // In the KPI row a lone „1 апартамент" is the answer, not noise — unlike the
    // per-filing line this replaced, where it merely restated the row underneath.
    stubWith(baseDetail({ assets: [prop("апартамент")] }));
    render(<PersonDeclarations slug="x" />);
    expect(
      await screen.findByText("pp_prop_kind_apartment:1"),
    ).toBeInTheDocument();
  });

  it("renders no card at all when nothing is declared", async () => {
    stubWith(baseDetail({ assets: [] }));
    render(<PersonDeclarations slug="x" />);
    await screen.findByRole("button", { name: /Началник/ });
    await waitFor(() =>
      expect(screen.queryByText("pp_decl_prop_card")).not.toBeInTheDocument(),
    );
  });

  it("excludes rented property from the count", async () => {
    // A чуждо flat is not a holding. Counting it would inflate „N декларирани имота" with
    // property the declarant does not own — the same error the totals were just fixed for.
    stubWith(
      baseDetail({
        assets: [
          prop("апартамент"),
          prop("къща"),
          { ...prop("къща"), isHolding: false, tableNum: "1.2" },
        ],
      }),
    );
    render(<PersonDeclarations slug="x" />);
    expect(
      await screen.findByText(
        "pp_prop_kind_apartment:1 · pp_prop_kind_house:1",
      ),
    ).toBeInTheDocument();
  });
});

describe("structure, not just presence", () => {
  it("keeps the holder outside the truncating run", async () => {
    // `findByText` passes on content clipped by overflow:hidden, so the visual property
    // has to be pinned structurally. The holder chip is the LAST child and the longest
    // thing on the line; inside a `truncate` span it is the first thing to disappear —
    // the marker saying „this is not his company" gone, on mobile.
    stubWith(
      baseDetail({
        stakes: [stake("Многосрично дружество за строителство ЕООД", SPOUSE)],
      }),
    );
    render(<PersonDeclarations slug="x" />);
    await expand();
    const chip = await screen.findByText(SPOUSE);
    expect(chip.closest(".truncate")).toBeNull();
  });

  it("bare mode renders no property card and issues no detail fetch", async () => {
    // Both halves matter: the MP path has its own KPI row (MpAssetsSummary), and the gate
    // must also not pay for a request whose result nothing renders.
    stubWith(baseDetail({ assets: [prop("апартамент")] }));
    render(<PersonDeclarations slug="x" bare />);
    await screen.findByRole("button", { name: /Началник/ });
    expect(screen.queryByText("pp_decl_prop_card")).not.toBeInTheDocument();
    const calls = (
      globalThis.fetch as unknown as { mock: { calls: [string][] } }
    ).mock.calls;
    expect(calls.filter(([u]) => u.includes("declaration-detail"))).toEqual([]);
  });
});
