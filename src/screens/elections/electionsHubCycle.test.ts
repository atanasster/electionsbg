// Which election the hub is about, and what it says when it cannot tell.

import { describe, expect, it } from "vitest";
import {
  ELECTION_EVENTS,
  LATEST_ELECTION_EVENT,
  resolveHubCycle,
} from "./electionsHubCycle";
import allElections from "@/data/json/elections.json";
import allLocal from "@/data/json/local_elections.json";
import { formatDate } from "@/lib/formatDate";

describe("the event catalogue", () => {
  it("carries every cycle from BOTH files", () => {
    // ⚠ THE PARAM IS VALIDATED AGAINST BOTH (§3.2 rule 1). Validating against the
    // parliamentary catalogue alone makes every local cycle "unknown", so a reader arriving
    // from `/local/2019_10_27_mi` is told their selection could not be read.
    expect(ELECTION_EVENTS).toHaveLength(allElections.length + allLocal.length);
    for (const e of allElections)
      expect(ELECTION_EVENTS.find((x) => x.id === e.name)?.kind).toBe(
        "parliamentary",
      );
    for (const l of allLocal)
      expect(ELECTION_EVENTS.find((x) => x.id === l.name)?.kind).toBe("local");
  });

  it("is sorted newest-first by DATE, not by file order", () => {
    // Both files are newest-first today, so `[0]` reads correctly — and would go on reading
    // correctly right up until a cycle is appended rather than prepended.
    const dates = ELECTION_EVENTS.map((e) => e.date);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(LATEST_ELECTION_EVENT.id).toBe("2026_04_19");
  });

  it("dates a local cycle from its round-1 date, not from its id", () => {
    // The id carries `_mi`, so `id.split("_").join("-")` would produce `2023-10-29-mi` — an
    // unparseable date that `formatDate` passes through VERBATIM rather than rejecting, i.e.
    // the folder id on the page.
    const l = ELECTION_EVENTS.find((e) => e.id === "2023_10_29_mi")!;
    expect(l.date).toBe("2023-10-29");
    expect(formatDate(l.date, "bg")).not.toContain("mi");
    expect(formatDate(l.date, "bg")).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("never offers an id as a label", () => {
    // ⚠ A CYCLE IDENTIFIER IS A KEY. Every entry carries a formattable ISO date beside it, so
    // no caller has to reach for the id — the defect that put „2026-04-19" on 31 surfaces.
    for (const e of ELECTION_EVENTS) {
      expect(e.date, e.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(formatDate(e.date, "bg"), e.id).not.toBe(e.date);
      expect(formatDate(e.date, "en"), e.id).not.toBe(e.date);
    }
  });
});

describe("resolution", () => {
  it("prefers the param over the latest event", () => {
    // The whole point: a reader arriving from `/elections/2013_05_12` carries
    // `?elections=2013_05_12`, and a hub that ignores it renders 2026 while everything else on
    // the page resolves 2013.
    const r = resolveHubCycle("2013_05_12");
    expect(r.id).toBe("2013_05_12");
    expect(r.fellBack).toBe(false);
  });

  it("resolves a LOCAL cycle from the param too", () => {
    const r = resolveHubCycle("2019_10_27_mi");
    expect(r.kind).toBe("local");
    expect(r.date).toBe("2019-10-27");
  });

  it("falls back to the latest event and SAYS SO", () => {
    // Rule 3. A silent fallback renders a first screen the reader cannot account for.
    const r = resolveHubCycle("not-a-cycle");
    expect(r.id).toBe(LATEST_ELECTION_EVENT.id);
    expect(r.fellBack).toBe(true);
    expect(r.requested).toBe("not-a-cycle");
  });

  it("does NOT report an absent param as a fallback", () => {
    // ⚠ ARRIVING WITH NO PARAM IS THE ORDINARY CASE. Reporting it would put „we could not read
    // your selection" on the page on every first visit.
    for (const v of [undefined, null, ""]) {
      const r = resolveHubCycle(v);
      expect(r.fellBack, JSON.stringify(v)).toBe(false);
      expect(r.requested, JSON.stringify(v)).toBeUndefined();
    }
  });
});
