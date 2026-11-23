// The curated season files (vaccines-flow-v1 §0 D5, §7.8): every row cites a
// source, and a later announcement supersedes rather than overwrites.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const load = <T>(f: string): { rows: T[] } =>
  JSON.parse(readFileSync(`data/health/vaccines/${f}`, "utf8"));

interface PlanRow {
  id: string;
  season: number;
  channel: string;
  doses: number;
  basis: string;
  within?: string;
  doses_qualifier?: string;
  scope?: string;
  source_url: string;
  source_date: string;
  superseded_by: string | null;
}

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const isUrl = (s: string) => /^https:\/\/\S+$/.test(s);

describe("season_plan.json", () => {
  const { rows } = load<PlanRow>("season_plan.json");
  const ids = new Set(rows.map((r) => r.id));

  it("cites a source and a date on every row", () => {
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(isUrl(r.source_url), r.id).toBe(true);
      expect(isDate(r.source_date), r.id).toBe(true);
      expect(["planned", "contracted", "announced"]).toContain(r.basis);
      expect(Number.isInteger(r.doses) && r.doses > 0, r.id).toBe(true);
      if (r.doses_qualifier !== undefined)
        expect(["over"], r.id).toContain(r.doses_qualifier);
      if (r.scope !== undefined) expect(["delivery"], r.id).toContain(r.scope);
    }
  });

  // §7.5: nothing measures the free market, so it is never a derived remainder —
  // only a ministry's own statement of it.
  it("states the free market only as an announcement", () => {
    for (const r of rows.filter((x) => x.channel === "free_market"))
      expect(r.basis, r.id).toBe("announced");
  });

  it("keeps a floor („над“) distinct from an exact figure", () => {
    const floors = rows.filter((r) => r.doses_qualifier === "over");
    expect(floors.length).toBeGreaterThan(0);
  });

  it("has unique ids and supersedes only rows that exist, on the same channel and later", () => {
    expect(ids.size).toBe(rows.length);
    for (const r of rows) {
      if (!r.superseded_by) continue;
      const next = rows.find((x) => x.id === r.superseded_by);
      expect(next, r.id).toBeDefined();
      expect(next?.channel).toBe(r.channel);
      expect((next?.source_date ?? "") >= r.source_date, r.id).toBe(true);
    }
  });

  it("names only channels of the same season as a `within` parent", () => {
    for (const r of rows)
      if (r.within)
        expect(
          rows.some((x) => x.season === r.season && x.channel === r.within),
          r.id,
        ).toBe(true);
  });
});

describe("season_events.json / tender_doses.json", () => {
  it("cites a source on every event", () => {
    const { rows } = load<{
      event_date: string;
      kind: string;
      source_url: string;
      text_bg: string;
      text_en: string;
    }>("season_events.json");
    for (const r of rows) {
      expect(isDate(r.event_date)).toBe(true);
      expect(isUrl(r.source_url)).toBe(true);
      expect(["plan", "delay", "delivery"]).toContain(r.kind);
      expect(r.text_bg && r.text_en).toBeTruthy();
    }
  });

  it("cites a document on every tender-dose row", () => {
    const { rows } = load<{
      unp: string;
      lot_id: string;
      doses: number;
      source_url: string;
    }>("tender_doses.json");
    for (const r of rows) {
      expect(r.unp && r.lot_id).toBeTruthy();
      expect(isUrl(r.source_url)).toBe(true);
    }
  });
});
