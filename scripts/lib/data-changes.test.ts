// Gate on the reader-facing /data/updates feed: ONE row per underlying data
// change, no matter how many processes report it or when.
//
// Every case here is drawn from a real duplicate that reached the committed
// data/data-changes.json — a self-reporting ingest runs twice per publish cycle
// (once locally, once against Cloud SQL via its `:cloud` twin), and those two
// runs straddled UTC midnight three times: 2026-07-28, 2026-08-28, 2026-08-31.
// The first two shipped; the third was caught by hand.
//
// The file seam matters: without it these tests would rewrite the real
// committed log.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const isServingDatabase = vi.hoisted(() => vi.fn(() => false));
vi.mock("../db/lib/pg", () => ({
  isServingDatabase,
  connectionUrl: () => "postgres://postgres@127.0.0.1:5434/electionsbg",
  redactUrl: (u: string) => u,
}));

const { appendDataChange, isNoChangeSummary, readDataChanges } =
  await import("./data-changes");

let file = "";
beforeEach(() => {
  file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "data-changes-")),
    "data-changes.json",
  );
  isServingDatabase.mockReturnValue(false);
});
afterEach(() => {
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
  vi.restoreAllMocks();
});

const PRICES = {
  skill: "update-prices",
  source: "КЗП Колко струва (retail prices)",
};
const rows = () => readDataChanges(file).entries;

describe("dedupeKey — the payload, not the wall clock", () => {
  it("collapses the local ingest and the cloud publish across UTC midnight", () => {
    // The 2026-08-31 pair, verbatim: local at 23:57:57Z, cloud at 00:55:49Z the
    // next calendar day. dedupeSameDay saw two dates and published two rows.
    appendDataChange({
      ...PRICES,
      summary:
        "КЗП retail prices refreshed through 2026-08-30 (+1 daily archive)",
      dedupeKey: "2026-08-30",
      at: "2026-08-30T23:57:57.478Z",
      file,
    });
    appendDataChange({
      ...PRICES,
      summary:
        "КЗП retail prices refreshed through 2026-08-30 (+1 daily archive)",
      dedupeKey: "2026-08-30",
      at: "2026-08-31T00:55:49.000Z",
      file,
    });

    expect(rows()).toHaveLength(1);
    expect(rows()[0].key).toBe("2026-08-30");
  });

  it("collapses them even when the two runs did DIFFERENT amounts of work", () => {
    // The 2026-07-28 pair. The cloud database was further behind, so it loaded
    // two archives where local loaded one — the summaries differ, which is
    // precisely why deduping on `summary` equality would not have caught it.
    appendDataChange({
      ...PRICES,
      summary:
        "КЗП retail prices refreshed through 2026-07-28 (+2 daily archives)",
      dedupeKey: "2026-07-28",
      at: "2026-07-28T23:14:01.692Z",
      file,
    });
    appendDataChange({
      ...PRICES,
      summary:
        "КЗП retail prices refreshed through 2026-07-28 (+1 daily archive)",
      dedupeKey: "2026-07-28",
      at: "2026-07-29T01:57:16.360Z",
      file,
    });

    expect(rows()).toHaveLength(1);
  });

  it("keeps genuine consecutive-day refreshes — the reason a time WINDOW is wrong", () => {
    // Prices publishes daily. Any 24/48 h dedupe window swallows this pair,
    // which is two real data changes.
    for (const day of ["2026-08-29", "2026-08-30"])
      appendDataChange({
        ...PRICES,
        summary: `КЗП retail prices refreshed through ${day}`,
        dedupeKey: day,
        at: `${day}T23:30:00.000Z`,
        file,
      });

    expect(rows().map((e) => e.key)).toEqual(["2026-08-30", "2026-08-29"]);
  });

  it("keeps two DIFFERENT data days reported on one calendar day", () => {
    // dedupeSameDay would drop the earlier one — a real refresh lost. Key
    // identity subsumes the date, so it must not also filter by date.
    appendDataChange({
      ...PRICES,
      summary: "through 2026-08-29",
      dedupeKey: "2026-08-29",
      at: "2026-08-31T02:00:00.000Z",
      file,
    });
    appendDataChange({
      ...PRICES,
      summary: "through 2026-08-30",
      dedupeKey: "2026-08-30",
      at: "2026-08-31T23:00:00.000Z",
      file,
    });

    expect(rows()).toHaveLength(2);
  });

  it("does not collapse across skills that happen to share a key", () => {
    for (const skill of ["update-prices", "update-agri"])
      appendDataChange({
        skill,
        summary: `${skill} through 2026-08-30`,
        dedupeKey: "2026-08-30",
        at: "2026-08-30T23:00:00.000Z",
        file,
      });

    expect(rows()).toHaveLength(2);
  });

  it("mutation check: without the key the same pair duplicates", () => {
    // Pins that the assertions above are satisfied by the dedupe and not by
    // something incidental — this is the pre-fix behaviour, reproduced.
    for (const at of ["2026-08-30T23:57:57.478Z", "2026-08-31T00:55:49.000Z"])
      appendDataChange({
        ...PRICES,
        summary: "КЗП retail prices refreshed through 2026-08-30",
        dedupeSameDay: true,
        at,
        file,
      });

    expect(rows()).toHaveLength(2);
  });
});

describe("a publish is not a data change", () => {
  it("refuses to append while pointed at the serving database", () => {
    expect(
      appendDataChange({
        ...PRICES,
        summary: "through 2026-08-30",
        dedupeKey: "2026-08-30",
        file,
      }),
    ).not.toBeNull();

    isServingDatabase.mockReturnValue(true);
    const published = appendDataChange({
      ...PRICES,
      summary: "through 2026-08-31",
      dedupeKey: "2026-08-31",
      file,
    });

    // Returns null AND writes nothing — a caller ignoring the result (all four
    // self-reporters do) must still not add a row.
    expect(published).toBeNull();
    expect(rows()).toHaveLength(1);
    expect(rows()[0].key).toBe("2026-08-30");
  });

  it("guards the FIRST write too, so it cannot be mistaken for the dedupe", () => {
    isServingDatabase.mockReturnValue(true);
    appendDataChange({ ...PRICES, summary: "through 2026-08-30", file });
    expect(fs.existsSync(file)).toBe(false);
  });
});

describe("the no-op filter is unchanged", () => {
  // The fix must not start (or stop) dropping bootstrap stamps and
  // fetchedAt-only churn. The filter stays where it was — in the CLI, applied
  // before appendDataChange — so appendDataChange itself still writes whatever
  // it is handed.
  it("still recognises every no-op phrase", () => {
    for (const s of [
      "bootstrap: marker seeded, no run",
      "…no data changes (timestamp-only diff reverted)",
      "all Eurostat tails unchanged, only fetchedAt diff",
      "otcheti: 15 years (2011-2025), unchanged",
    ])
      expect(isNoChangeSummary(s)).toBe(true);
  });

  it("still passes real ingests, including ones that say 'no new'", () => {
    for (const s of [
      "first-run backfill: 1 indicator, 265 munis",
      "first real ingest — refreshed 70 entries, no new declarations",
      "КЗП retail prices refreshed through 2026-08-30 (+1 daily archive)",
    ])
      expect(isNoChangeSummary(s)).toBe(false);
  });

  it("appendDataChange does not silently apply it — the CLI owns that gate", () => {
    appendDataChange({
      skill: "update-nzok",
      summary:
        "НЗОК hospital payments restated: 3 row(s) unchanged in the month",
      dedupeSameDay: true,
      file,
    });
    expect(rows()).toHaveLength(1);
  });
});
