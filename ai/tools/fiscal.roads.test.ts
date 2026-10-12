// roadsSpending answers for the SAME buyer roll-up the /sector/roads page it links
// to does (АПИ + НКСИП, D5), on the engine's basis (no amendments, no €0 consortium
// member rows), and names the state in-house contractor as such (D7).
import { beforeEach, expect, it, vi } from "vitest";
import { roadsSpending } from "./fiscal";
import { fetchDb } from "./dataClient";
import type { ToolContext } from "./types";
import { ROADS_SECTOR_EIKS } from "@/lib/roadsReferenceData";

vi.mock("./dataClient", async (load) => ({
  ...(await load<object>()),
  fetchDb: vi.fn(),
}));

const row = (p: Record<string, unknown>) => ({
  key: String(Math.random()),
  tag: "contract",
  date: "2024-01-01",
  contractorEik: "1",
  contractorName: "Фирма",
  amountEur: 100,
  title: "Ремонт на път I-1",
  ...p,
});

const BY_EIK: Record<string, unknown[]> = {
  "000695089": [
    row({
      amountEur: 1000,
      contractorEik: "831646048",
      contractorName: "Автомагистрали ЕАД",
    }),
    row({ amountEur: 0, consortiumRole: "member" }),
    row({ amountEur: 50, tag: "contractAmendment" }),
  ],
  "202062287": [row({ amountEur: 300, title: "Струма Лот 3.1" })],
};

beforeEach(() =>
  vi.mocked(fetchDb).mockImplementation((async (
    _route: string,
    params?: Record<string, unknown>,
  ) => ({
    contracts: BY_EIK[String(params?.eik)] ?? [],
  })) as typeof fetchDb),
);

it("fetches every roll-up buyer and counts on the engine's basis", async () => {
  const r = await roadsSpending({}, { lang: "en" } as ToolContext);
  const asked = vi
    .mocked(fetchDb)
    .mock.calls.map(([, p]) => (p as { eik: string }).eik);
  expect(asked.sort()).toEqual([...ROADS_SECTOR_EIKS].sort());
  expect(r.facts.contracts).toBe("2"); // the member and the amendment drop
  expect(r.facts.total_value).toMatch(/1[.,]3/); // €1.3K — both buyers
});

it("names the in-house contractor and no capture fact", async () => {
  const r = await roadsSpending({}, { lang: "bg" } as ToolContext);
  expect(String(r.facts.top_contractor)).toContain("вътрешен изпълнител");
  expect(r.facts).not.toHaveProperty("most_captured_work");
  expect(String(r.facts.single_bid_note)).toContain("законови изключения");
});
