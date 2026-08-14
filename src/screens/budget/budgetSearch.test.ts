// Gates for the /budget finder (dashboard-hub skill §4 „a hub needs a finder").
//
// The two rules that have shipped broken on other hubs:
//
//   * A „see all" must land on a page that can SERVE the query. `/votes?q=` was
//     discarded by a screen reading only `?topic`; `/officials/assets?q=`
//     entirely. Both advertised a filtered destination and delivered an
//     unfiltered one. Here both targets read `?q` — asserted against the
//     screens' source, not assumed.
//   * A failed fetch must THROW, not return []. HubSearch tells the two apart
//     and omits a failed group from its „searched in: …" sentence; swallowing
//     the error reports „no results" for a route that was never reached.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { budgetSearchSources } from "./budgetSearch";
import type { ServerSource } from "@/ux/search/hubSearchSources";

const sources = (fy: number | null = 2026, bg = true) =>
  budgetSearchSources({ fy, bg }) as ServerSource[];

const screenSrc = (f: string) => readFileSync(resolve(__dirname, f), "utf-8");

beforeEach(() => vi.restoreAllMocks());

describe("budget hub search", () => {
  it("declares one group per subject, each with its own cap", () => {
    const s = sources();
    expect(s.map((x) => x.id)).toEqual(["units", "municipalities"]);
    for (const src of s) {
      expect(src.kind).toBe("server");
      // Independent caps: a shared one lets the first group eat the second's
      // budget, which is how a narrower tier ends up permanently empty.
      expect(src.limit).toBe(6);
    }
  });

  it("sends every see-all to a page that READS ?q", () => {
    const s = sources();
    const targets = s.map((src) => src.seeAll!("отбрана")!);
    // Both groups must HAVE a see-all — a missing one is the same defect as a
    // wrong one, and `targets[i]` would otherwise be undefined silently.
    expect(targets).toHaveLength(2);
    expect(targets[0]!.to).toMatch(/^\/budget\/ministries\?q=/);
    expect(targets[1]!.to).toMatch(/^\/budget\/municipal\?q=/);
    // …and the destinations really do read it. Asserted against the screens'
    // source so deleting the param handling breaks this, not just a comment.
    expect(screenSrc("./BudgetMinistriesScreen.tsx")).toContain(
      'useSearchParam("q"',
    );
    expect(screenSrc("./BudgetMunicipalScreen.tsx")).toContain(
      'useSearchParam("q"',
    );
  });

  it("percent-encodes the query into both see-alls", () => {
    const [units, munis] = sources().map((s) => s.seeAll!("София & Ко")!);
    expect(units!.to).toContain(encodeURIComponent("София & Ко"));
    expect(munis!.to).toContain(encodeURIComponent("София & Ко"));
    expect(units!.to).not.toContain(" ");
  });

  it("throws on a failed fetch rather than reporting no results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500 })),
    );
    for (const src of sources()) {
      await expect(
        src.fetch("отбрана", new AbortController().signal),
      ).rejects.toThrow();
    }
  });

  it("passes the abort signal through to every request", async () => {
    const seen: (AbortSignal | undefined)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init?: RequestInit) => {
        seen.push(init?.signal ?? undefined);
        return { ok: true, json: async () => ({ rows: [] }) };
      }),
    );
    const signal = new AbortController().signal;
    for (const src of sources()) await src.fetch("x", signal);
    // An in-flight request for a superseded query resolving last would show
    // stale rows under a newer one.
    expect(seen).toHaveLength(2);
    for (const s of seen) expect(s).toBe(signal);
  });

  it("links a unit to its own page and a municipality to the filtered list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (u: string) => ({
        ok: true,
        json: async () =>
          String(u).includes("budget-ministries")
            ? {
                rows: [
                  {
                    nodeId: "admin-mo",
                    nameBg: "Министерство на отбраната",
                    nameEn: "MoD",
                    amount: 1,
                  },
                ],
              }
            : {
                rows: [
                  { obshtina: "PDV22", nameBg: "Пловдив", nameEn: "Plovdiv" },
                ],
              },
      })),
    );
    const [units, munis] = sources();
    const u = await units.fetch("отбрана", new AbortController().signal);
    expect(u[0].to).toBe("/budget/ministry/admin-mo");
    expect(u[0].primary).toBe("Министерство на отбраната");
    const m = await munis.fetch("Пловдив", new AbortController().signal);
    // No per-municipality page exists, so the row lands on the list filtered to
    // it — a destination that can serve the query.
    expect(m[0].to).toBe(
      `/budget/municipal?q=${encodeURIComponent("Пловдив")}`,
    );
  });

  it("labels in the reader's language", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          rows: [
            { nodeId: "n", nameBg: "Отбрана", nameEn: "Defence", amount: 1 },
          ],
        }),
      })),
    );
    const [bgUnits] = sources(2026, true);
    const [enUnits] = sources(2026, false);
    expect(
      (await bgUnits.fetch("x", new AbortController().signal))[0].primary,
    ).toBe("Отбрана");
    expect(
      (await enUnits.fetch("x", new AbortController().signal))[0].primary,
    ).toBe("Defence");
  });
});
