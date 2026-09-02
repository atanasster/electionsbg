// The /procurement search box. Four behaviours that are DECISIONS here and silent when
// they break — and three of them were broken when this file was written, because the tile
// runs its OWN request and hand-rolled its OWN entity mapping instead of using the shared
// builders every other consumer of `/api/db/procurement-search` goes through:
//
//   1. an entity row lands on the window its euro figure was measured over (all-time);
//   2. a synthetic contractor key (`ph-`, `np-`, the empty string) is NOT linked — the
//      one rule `companyItems` owns and a local `.map` silently drops;
//   3. the group guard tests the BUILT list, so a needle matching only synthetic keys
//      renders no empty „Изпълнители" header;
//   4. a 500 says the search is unavailable rather than „Няма резултати" — an outage is a
//      claim about us, an empty result is a claim about the data.
//
//   npx vitest run src/screens/components/procurement/ProcurementSearchTile.test.tsx

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "bg" } }),
}));

import { ProcurementSearchTile } from "./ProcurementSearchTile";

const EMPTY_BODY = {
  companies: [],
  awarders: [],
  contracts: [],
  tenders: [],
  funds: [],
  interreg: [],
  contractsTotal: 0,
  tendersTotal: 0,
  altQuery: null,
};

/** Answers procurement-search with `body` and person-search with an empty payload. */
const stubSearch = (body: Record<string, unknown>, ok = true) =>
  vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = String(input);
    if (url.includes("person-search"))
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ exact: [], fuzzy: [], people: [] }),
      } as Response);
    return Promise.resolve({
      ok,
      json: () =>
        Promise.resolve(
          ok ? { ...EMPTY_BODY, ...body } : { error: "db error" },
        ),
    } as Response);
  });

const type = async (term: string) => {
  render(
    <MemoryRouter>
      <ProcurementSearchTile />
    </MemoryRouter>,
  );
  await userEvent.type(screen.getByRole("combobox"), term);
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  if (!Element.prototype.scrollIntoView)
    Element.prototype.scrollIntoView = () => {};
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const linkFor = async (name: RegExp) =>
  (await screen.findByRole("option", { name })).getAttribute("href");

describe("ProcurementSearchTile entity rows", () => {
  it("links a real EIK on the all-time window", async () => {
    stubSearch({
      companies: [
        {
          eik: "130878827",
          name: "Клет България ООД",
          contractsEur: 22_424_885,
        },
      ],
      awarders: [
        { eik: "000689061", name: "Пета МБАЛ", contractsEur: 62_620_984 },
      ],
    });
    await type("клет");
    await vi.advanceTimersByTimeAsync(300);
    expect(await linkFor(/Клет България/)).toBe(
      "/company/130878827?pscope=all",
    );
    expect(await linkFor(/Пета МБАЛ/)).toBe("/awarder/000689061?pscope=all");
  });

  it("does not link a ph-/np-/empty synthetic contractor key", async () => {
    // The whole reason the mapping moved to the shared builder: these render a page but
    // name nothing checkable against a register, and the empty key produces
    // „/company/?pscope=all", which matches no route at all.
    stubSearch({
      companies: [
        { eik: "130878827", name: "Реална фирма", contractsEur: 1_000 },
        { eik: "ph-1", name: "Филър ООД", contractsEur: 1_000 },
        { eik: "np-2", name: "Физическо лице", contractsEur: 1_000 },
        { eik: "", name: "Празен ключ", contractsEur: 1_000 },
      ],
    });
    await type("фирма");
    await vi.advanceTimersByTimeAsync(300);
    await screen.findByRole("option", { name: /Реална фирма/ });
    for (const gone of [/Филър/, /Физическо лице/, /Празен ключ/])
      expect(screen.queryByRole("option", { name: gone })).toBeNull();
  });

  it("renders no empty contractors header when every hit is synthetic", async () => {
    // The guard must test the BUILT list, not the raw row count.
    stubSearch({
      companies: [{ eik: "ph-1", name: "Филър ООД", contractsEur: 1_000 }],
      awarders: [{ eik: "000689061", name: "Пета МБАЛ", contractsEur: 1 }],
    });
    await type("филър");
    await vi.advanceTimersByTimeAsync(300);
    await screen.findByRole("option", { name: /Пета МБАЛ/ });
    expect(screen.queryByText("procurement_search_group_companies")).toBeNull();
  });

  it("says the search is unavailable, not an empty result, when the route 500s", async () => {
    stubSearch({}, false);
    await type("клет");
    await vi.advanceTimersByTimeAsync(300);
    await waitFor(() =>
      expect(screen.getByText("search_unavailable")).toBeTruthy(),
    );
    expect(screen.queryByText("no_results")).toBeNull();
  });
});
