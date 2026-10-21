import { describe, expect, it } from "vitest";
import type {
  LocalProblemNeighborhood,
  LocalProblemSectionsReport,
} from "@/data/local/useLocalProblemSections";
import { buildProblemPartyRows } from "./problemPartyRows";

const hood = (
  id: string,
  votes: Record<string, number>,
  obshtinaCode = "BGS04",
): LocalProblemNeighborhood => ({
  id,
  name_bg: id,
  name_en: id,
  city_bg: "Бургас",
  city_en: "Burgas",
  source_url: "",
  obshtinaCode,
  obshtinaName: "Бургас",
  rayonCode: "00",
  sectionCount: 1,
  numRegisteredVoters: 1000,
  totalActualVoters: 500,
  numValidVotes: 400,
  parties: Object.entries(votes).map(([id, v], i) => ({
    localPartyNum: i + 1,
    localPartyName: id,
    primaryCanonicalId: id,
    color: "#000",
    votes: v,
  })),
});

const report = (
  cycle: string,
  ...neighborhoods: LocalProblemNeighborhood[]
): LocalProblemSectionsReport => ({ cycle, neighborhoods });

const row = (rows: ReturnType<typeof buildProblemPartyRows>, id: string) =>
  rows.find((r) => r.canonicalId === id);

describe("buildProblemPartyRows", () => {
  it("shows every current neighbourhood but takes ΔPP over the ones both cycles have", () => {
    // Burgas 2015 vs 2011: Долно Езерово is placeable in 2015 only. It must count in the
    // shares, and must NOT move the change column.
    const prior = report("2011", hood("pobeda", { gerb: 50, bsp: 50 }));
    const current = report(
      "2015",
      hood("pobeda", { gerb: 60, bsp: 40 }),
      hood("dolno", { gerb: 100, bsp: 0 }),
    );
    const rows = buildProblemPartyRows(current, prior, "BGS04");
    // share over the whole current set: gerb 160 / 200
    expect(row(rows, "gerb")?.share).toBeCloseTo(80);
    // ΔPP over Победа only: 60% now vs 50% then
    expect(row(rows, "gerb")?.deltaPP).toBeCloseTo(10);
    expect(row(rows, "bsp")?.deltaPP).toBeCloseTo(-10);
  });

  it("…and a whole-município ΔPP would have been different, so the rule discriminates", () => {
    // With Долно Езерово compared against nothing, gerb would read 80 − 50 = +30.
    const prior = report("2011", hood("pobeda", { gerb: 50, bsp: 50 }));
    const current = report(
      "2015",
      hood("pobeda", { gerb: 60, bsp: 40 }),
      hood("dolno", { gerb: 100, bsp: 0 }),
    );
    expect(
      row(buildProblemPartyRows(current, prior, "BGS04"), "gerb")?.deltaPP,
    ).not.toBeCloseTo(30);
  });

  it("gives no ΔPP when the two cycles share no neighbourhood", () => {
    const prior = report("2011", hood("gorno", { gerb: 10 }));
    const current = report("2015", hood("dolno", { gerb: 10 }));
    const rows = buildProblemPartyRows(current, prior, "BGS04");
    expect(row(rows, "gerb")?.deltaPP).toBeUndefined();
  });

  it("gives no ΔPP without a prior cycle, and nothing for another município", () => {
    const current = report("2015", hood("pobeda", { gerb: 10 }));
    expect(
      row(buildProblemPartyRows(current, undefined, "BGS04"), "gerb")?.deltaPP,
    ).toBeUndefined();
    expect(buildProblemPartyRows(current, undefined, "SOF")).toEqual([]);
  });
});
