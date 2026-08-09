// The fit resolver tile's render branching.
//
// Every case here is a SENTENCE the tile must not be able to say. This is the one surface on the
// site whose output is a decision — „is it worth me spending three months on an application" — so
// the failures that matter are not layout:
//
//   1. A FAILED FETCH RENDERED AS „НЕ ОТКРИХМЕ ПОДОБНИ ПРОЕКТИ". A 500 presented as a substantive
//      „no" is the answer that stops someone applying, and it is indistinguishable from the real
//      thing unless the error branch exists.
//   2. AN APPROVAL RATE. The corpus holds only SIGNED contracts — ИСУН publishes no rejected
//      applications — so „N of M paid" is disbursement and must never be worded as approval.
//   3. AN UNEXPLAINED ENGLISH LIST. keep.eu publishes 86% of Interreg titles in English only, so a
//      Bulgarian query is bridged to an English topic; if the tile does not say so, the reader
//      cannot tell the bridge picked the wrong one.
//   4. A SCHEME NAME THAT IS ACTUALLY ONE PROJECT'S TITLE. 59% of procedures publish no name.

import { describe, expect, it, vi, beforeAll, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import bg from "@/locales/bg/translation.json";
import type { ReactNode } from "react";
import type {
  FundsFitIsunRow,
  FundsFitInterregRow,
  FundsFitResponse,
} from "@/data/funds/useFundsFit";

const hook = vi.hoisted(() => ({
  mode: "ok" as "ok" | "loading" | "error",
  data: null as FundsFitResponse | null,
}));

vi.mock("@/data/funds/useFundsFit", async (orig) => ({
  ...(await orig<typeof import("@/data/funds/useFundsFit")>()),
  useFundsFit: () => ({
    data: hook.mode === "ok" ? hook.data : undefined,
    isFetching: hook.mode === "loading",
    isError: hook.mode === "error",
  }),
}));

const { FitResolverTile } = await import("./FitResolverTile");

// The SHIPPED bundle. Without it `t()` returns the key, which is truthy — so `t(k) || "fallback"`
// never fires and every assertion below would be checking „fit_paid" rather than the sentence.
beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: "bg",
    fallbackLng: "bg",
    resources: { bg: { translation: bg } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
});

const isun = (over: Partial<FundsFitIsunRow> = {}): FundsFitIsunRow => ({
  procedureCode: "BG16RFPR001-1.004",
  procedureName: "Подкрепа за семейно предприятие",
  sampleTitle: "Ремонт на къща за гости",
  programName: "Програма „Конкурентоспособност“",
  projectCount: 1869,
  beneficiaryCount: 1800,
  paidProjectCount: 42,
  totalEur: 100_000_000,
  grantMedian: 56_564,
  grantP25: 28_286,
  grantP75: 75_933,
  orgKinds: [
    { label: "ЕООД", n: 1067 },
    { label: "ООД", n: 729 },
  ],
  oblasti: { BGS: 107, SOFIA_CITY: 240 },
  localCount: 0,
  score: 0.8,
  ...over,
});

const interreg = (
  over: Partial<FundsFitInterregRow> = {},
): FundsFitInterregRow => ({
  keepId: 7,
  title: "Green Smiles: sustainable tourism",
  titleIsEnglish: true,
  programmeName: "Interreg Bulgaria–Turkey",
  period: "2014-2020",
  bgBudgetEur: 559_890,
  partnerCount: 2,
  oblast: "BGS",
  obshtina: "BGS04",
  isLocal: false,
  score: 0.7,
  ...over,
});

const payload = (over: Partial<FundsFitResponse> = {}): FundsFitResponse => ({
  q: "къща за гости",
  oblast: null,
  isun: [isun()],
  interreg: [],
  interregQuery: null,
  basis: {
    isunProjects: 82011,
    isunProcedures: 2206,
    interregOperations: 1115,
    interregPartners: 1469,
    interregWithEik: 330,
  },
  ...over,
});

const mount = () =>
  render(<FitResolverTile />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={["/funds"]}>{children}</MemoryRouter>
    ),
  });

/** Type into the resolver's box — the tile renders nothing until a query is long enough. */
const type = async (q: string) => {
  const box = document.querySelector<HTMLInputElement>('input[type="search"]')!;
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )!.set!;
  const { act } = await import("react");
  await act(async () => {
    setter.call(box, q);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

beforeEach(() => {
  hook.mode = "ok";
  hook.data = payload();
});

describe("a failure is not an answer", () => {
  it("renders an ERROR, never the nothing-found sentence", async () => {
    hook.mode = "error";
    mount();
    await type("къща за гости");
    expect(screen.getByText(/Търсенето не сработи/u)).toBeTruthy();
    expect(screen.queryByText(/Не открихме подобни проекти/u)).toBeNull();
  });

  it("still says nothing-found when the search genuinely found nothing", async () => {
    // The distinction the error branch protects — a real empty result is a fact worth stating.
    hook.data = payload({ isun: [], interreg: [] });
    mount();
    await type("зззз няма");
    expect(screen.getByText(/Не открихме подобни проекти/u)).toBeTruthy();
  });

  it("says nothing at all before a query is long enough", async () => {
    mount();
    expect(screen.getByText(/Напиши поне три букви/u)).toBeTruthy();
    expect(screen.queryByText(/Не открихме подобни проекти/u)).toBeNull();
  });
});

describe("the numbers say what they are", () => {
  it("labels the paid figure as DISBURSEMENT, never approval", async () => {
    mount();
    await type("къща за гости");
    // The whole body, because the sentence is assembled from sibling spans.
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/42 от 1 ?869 с изплатени средства/u);
    // The corpus cannot support any of these words.
    expect(body).not.toMatch(/одобрен/iu);
    expect(body).not.toMatch(/успеваемост|шанс|вероятност/iu);
  });

  it("shows the quartile SPREAD beside the median, not a lone number", async () => {
    mount();
    await type("къща за гости");
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/Медиана:/u);
    // Non-breaking or regular space, whichever Intl chose for this locale/runtime.
    expect(body).toMatch(/28[\s\u00a0\u202f]286/u);
    expect(body).toMatch(/75[\s\u00a0\u202f]933/u);
  });

  it("marks a name that is really an EXAMPLE project's title", async () => {
    hook.data = payload({ isun: [isun({ procedureName: null })] });
    mount();
    await type("къща за гости");
    expect(screen.getByText(/Заглавие на примерен проект/u)).toBeTruthy();
  });

  it("does not mark it when the procedure has its own name", async () => {
    mount();
    await type("къща за гости");
    expect(screen.queryByText(/Заглавие на примерен проект/u)).toBeNull();
  });
});

describe("the declared basis", () => {
  it("renders the corpus counts and the Interreg EIK share", async () => {
    mount();
    await type("къща за гости");
    // 330 of 1,469 = 22%. Computed from the payload, so the caption cannot drift from the data.
    expect(screen.getByText(/покрива само 22% от партньорите/u)).toBeTruthy();
    expect(screen.getByText(/82 011 договора/u)).toBeTruthy();
  });

  it("states that this is not an eligibility check", async () => {
    mount();
    await type("къща за гости");
    expect(
      screen.getByText(
        /не е проверка за допустимост|а не проверка за допустимост/u,
      ),
    ).toBeTruthy();
  });
});

describe("the Interreg arm explains itself", () => {
  it("names the English term the bridge used", async () => {
    hook.data = payload({
      isun: [isun()],
      interreg: [interreg()],
      interregQuery: "tourism",
    });
    mount();
    await type("туризъм");
    expect(
      screen.getByText(/Търсено на английски като „tourism“/u),
    ).toBeTruthy();
  });

  it("marks each English title", async () => {
    hook.data = payload({ interreg: [interreg()], interregQuery: "tourism" });
    mount();
    await type("туризъм");
    expect(screen.getByText("EN")).toBeTruthy();
  });

  it("says the arm was NOT SEARCHED when nothing bridged", async () => {
    // Otherwise an empty Interreg section reads as „no cross-border project like this exists",
    // which is a vocabulary gap on our side, not a fact about the corpus.
    hook.data = payload({ isun: [isun()], interreg: [], interregQuery: null });
    mount();
    await type("къща за гости");
    expect(
      screen.getByText(/трансграничните проекти по Interreg не са претърсени/u),
    ).toBeTruthy();
  });

  it("says in-your-province rather than a raw obshtina code", async () => {
    // `isLocal` is true when ANY partner is in the asker's oblast, while `obshtina` is the mode
    // over all of them — so the code could name a place in a different oblast entirely.
    hook.data = payload({
      interreg: [interreg({ isLocal: true, obshtina: "BGS04" })],
      interregQuery: "tourism",
    });
    mount();
    await type("туризъм");
    expect(screen.getByText(/в твоята област/u)).toBeTruthy();
    expect(screen.queryByText("BGS04")).toBeNull();
  });
});
