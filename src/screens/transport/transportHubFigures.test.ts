// The transport head's figures over the COMMITTED blob — the shape every visitor
// receives. The numbers themselves are gated against Postgres in
// scripts/db/tests/transport_hub_figures.data.test.ts; this holds the sentences.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { TransportHubStats } from "@/data/transport/hubStats";
import {
  TRANSPORT_BAND_TILES,
  eur2,
  railPair,
  transportHubEvidence,
  transportHubKpis,
  transportKpiNote,
  transportTileMetric,
} from "./transportHubFigures";
import { TRANSPORT_TILES } from "./transportRegistry";
import { transportEntityByEik } from "@/lib/transportReferenceData";

const blob = JSON.parse(
  readFileSync(
    path.resolve(process.cwd(), "data/transport/derived/hub_stats.json"),
    "utf8",
  ),
) as TransportHubStats;

describe("transport hub figures", () => {
  it("renders nothing — never a zero — without a blob", () => {
    expect(transportHubKpis(null, "bg", true)).toEqual([]);
    expect(transportHubEvidence(undefined, "bg", true)).toBeUndefined();
    for (const t of TRANSPORT_TILES)
      expect(transportTileMetric(t.id, null, "bg", true)).toBeUndefined();
  });

  it("renders four KPI cells, each with a basis and a destination", () => {
    const kpis = transportHubKpis(blob, "bg", true);
    expect(kpis).toHaveLength(4);
    for (const k of kpis) {
      expect(k.basis.length).toBeGreaterThan(10);
      expect(k.to).toBeTruthy();
    }
  });

  it("states KPI 1 at two decimals with its body count and window (D2, C7)", () => {
    const k = transportHubKpis(blob, "bg", true)[0];
    expect(k.value).toBe(eur2(blob.procurement.eur, "bg"));
    expect(k.value).toMatch(/^€\d+,\d{2}\sмлрд\.$/);
    expect(k.basis).toContain(`${blob.bodyIndex.length} структури на МТС`);
    expect(k.basis).toContain(blob.procurement.firstDate!.slice(0, 4));
    expect(k.basis).toContain(blob.procurement.lastDate!.slice(0, 4));
    expect(k.basis).toMatch(/след анекси/);
  });

  it("re-attributes the ministry's rail contracts in KPI 2, and the modes still sum to KPI 1 (D8)", () => {
    const { rail, rawRail, total } = railPair(blob);
    expect(rail).toBeGreaterThan(rawRail);
    // Money only moves between modes.
    expect(Math.abs(total - blob.procurement.eur)).toBeLessThan(10);
    const k = transportHubKpis(blob, "bg", true)[1];
    expect(k.value).toBe(`${Math.round((rail / total) * 100)}%`);
    expect(k.value).not.toBe(`${Math.round((rawRail / total) * 100)}%`);
    expect(k.basis).toMatch(/подвижен състав/);
  });

  it("puts the national ex-member rate and the bid-known coverage beside KPI 3", () => {
    const k = transportHubKpis(blob, "bg", true)[2];
    expect(k.label).toBe("с една оферта");
    expect(k.basis).toMatch(/средно за всички възложители/);
    expect(k.basis).toMatch(/известен брой оферти за \d+% от договорите/);
  });

  it("says KPI 4 is a subset of the total, not subtracted from it (D4/D5)", () => {
    const k = transportHubKpis(blob, "bg", true)[3];
    expect(k.value).toBe(eur2(blob.inGroup.eur, "bg"));
    expect(k.basis).toMatch(/ТСВ ЕАД/);
    expect(k.basis).toMatch(/не се изваждат/);
  });

  it("says the four figures are never summed", () => {
    expect(transportKpiNote(true)).toMatch(/не се събират/);
    expect(transportKpiNote(false)).toMatch(/do not add up/);
  });

  it("keeps band-owned tiles descriptor-only", () => {
    for (const id of TRANSPORT_BAND_TILES)
      expect(transportTileMetric(id, blob, "bg", true), id).toBeUndefined();
  });

  it("ranks only sector bodies on the rail, scoped to the whole corpus", () => {
    const ev = transportHubEvidence(blob, "bg", true)!;
    expect(ev.rows.length).toBe(5);
    for (const r of ev.rows) {
      expect(transportEntityByEik(String(r.id)), String(r.id)).toBeTruthy();
      expect(String(r.to)).toContain("pscope=all");
    }
  });

  it("captions the PSO estimate as multi-year, not annual spend (G2)", () => {
    const m = transportTileMetric("top", blob, "bg", true)!;
    expect(m.metricCaption).toMatch(
      /многогодишни договора за обществена услуга/,
    );
    expect(m.metricSecondary).toMatch(/не годишен разход/);
  });

  it("states the direct share over method-known value with its coverage (A4)", () => {
    const m = transportTileMetric("direct", blob, "en", false)!;
    expect(m.metric).toBe(
      `${Math.round((blob.direct.directEur / blob.direct.knownEur) * 100)}%`,
    );
    expect(m.metricSecondary).toMatch(/known procedure/);
  });

  it("puts EU funds on the grant basis (D6)", () => {
    const m = transportTileMetric("funds", blob, "bg", true)!;
    expect(m.metricCaption).toMatch(/безвъзмездна помощ/);
  });
});

describe("EN copy carries no Cyrillic names (page audit 2026-10-17, F7)", () => {
  it("states the head, the note and the rail in English", () => {
    const cyr = /[Ѐ-ӿ]/;
    for (const k of transportHubKpis(blob, "en", false)) {
      expect(k.label, k.label).not.toMatch(cyr);
      expect(k.basis, k.basis).not.toMatch(cyr);
    }
    expect(transportKpiNote(false)).not.toMatch(cyr);
    for (const r of transportHubEvidence(blob, "en", false)!.rows)
      expect(r.label, r.label).not.toMatch(cyr);
  });
});
