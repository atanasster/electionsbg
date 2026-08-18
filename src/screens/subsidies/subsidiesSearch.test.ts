// Gates for the /subsidies finder (dashboard-hub skill §4 „a hub needs a finder").
//
// The rules that have shipped broken on other hubs, and the one that is specific to this one:
//
//   * A „see all" must land on a page that can SERVE the query. `/votes?q=` was discarded by a
//     screen reading only `?topic`; `/officials/assets?q=` entirely. Both advertised a filtered
//     destination and delivered an unfiltered one. Asserted here against the screen's SOURCE,
//     not assumed — and /subsidies/recipients is the wrong target for exactly this reason: it
//     does not read `?q`, only /subsidies/browse does.
//   * A failed fetch must THROW, not return []. HubSearch tells the two apart and omits a
//     failed group from its „searched in: …" sentence; swallowing the error reports „no
//     results" for a route that was never reached.
//   * THE SEARCH IS ALL-TIME AND THE SCOPE MUST NOT REACH IT. Every other surface in this
//     module is `?pscope`-scoped; this one is deliberately not, because „вашата фирма не
//     съществува" is a far worse answer than „вашата фирма няма плащания през 2025". The
//     request must therefore carry no scope, and the route must read the all-time rollup.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { subsidiesSearchSources } from "./subsidiesSearch";
import type { ServerSource } from "@/ux/search/hubSearchSources";

const sources = (bg = true) => subsidiesSearchSources(bg) as ServerSource[];
const src = (f: string) => readFileSync(resolve(__dirname, f), "utf-8");

beforeEach(() => vi.restoreAllMocks());

describe("subsidies hub search", () => {
  it("declares one server group with its own cap", () => {
    const s = sources();
    expect(s).toHaveLength(1);
    expect(s[0]!.kind).toBe("server");
    expect(s[0]!.id).toBe("farm");
    // A cap, so the box cannot be flooded by a common prefix like „агро".
    expect(s[0]!.limit).toBe(8);
  });

  it("sends the see-all to a page that READS ?q", () => {
    const target = sources()[0]!.seeAll!("агро")!;
    expect(target.to).toMatch(/^\/subsidies\/browse\?q=/);
    // …and the destination really does read it. Asserted against the screen's source, so
    // deleting the param handling breaks this rather than only a comment.
    expect(src("../dev/SubsidiesBrowserDbScreen.tsx")).toContain(
      'params.get("q")',
    );
  });

  it("does NOT send the see-all to the recipients ranking, which ignores ?q", () => {
    // The near-miss: /subsidies/recipients is the obvious-looking target and is the wrong
    // one. Its DbDataTable takes no `initialSearch`, so the query would be dropped silently.
    expect(sources()[0]!.seeAll!("агро")!.to).not.toContain("/recipients");
    expect(src("./SubsidiesRecipientsScreen.tsx")).not.toContain(
      'params.get("q")',
    );
  });

  it("percent-encodes the query into the see-all", () => {
    const to = sources()[0]!.seeAll!("агро & co")!.to;
    expect(to).toContain(encodeURIComponent("агро & co"));
    expect(to).not.toContain(" ");
  });

  it("labels the see-all in the reader's language", () => {
    // The reason the module exports a FACTORY rather than a constant: `seeAll` is called with
    // the query alone, so a module-level source could only ever carry one language's label.
    expect(sources(true)[0]!.seeAll!("x")!.label).toBe("Виж всички плащания");
    expect(sources(false)[0]!.seeAll!("x")!.label).toBe("See all payments");
  });

  it("throws on a failed fetch rather than reporting no results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500 }) as unknown as Response),
    );
    await expect(
      sources()[0]!.fetch("агро", new AbortController().signal),
    ).rejects.toThrow();
  });

  it("passes the abort signal through to the request", async () => {
    const spy = vi.fn(async () => ({
      ok: true,
      json: async () => [],
    }) as unknown as Response);
    vi.stubGlobal("fetch", spy);
    const ctl = new AbortController();
    await sources()[0]!.fetch("агро", ctl.signal);
    expect(spy.mock.calls[0]![1]).toMatchObject({ signal: ctl.signal });
  });

  it("asks the ALL-TIME route, carrying no scope", async () => {
    const spy = vi.fn(async () => ({
      ok: true,
      json: async () => [],
    }) as unknown as Response);
    vi.stubGlobal("fetch", spy);
    await sources()[0]!.fetch("агро", new AbortController().signal);
    const url = String(spy.mock.calls[0]![0]);
    expect(url).toContain("/api/db/agri-search");
    // No scope of any kind reaches the request. A `?pscope`/`?scope`/`?year` here would turn
    // the ranking into a filter and answer „no such company" to a real one.
    expect(url).not.toMatch(/pscope|scope=|year=/);
  });

  it("reads the all-time rollup, not the scoped one", () => {
    // The route's own SQL. `agri_beneficiary` is all-time; `agri_beneficiary_year` is the
    // scope-keyed rollup the RANKINGS read, and pointing the finder at it is the same defect
    // as passing a scope on the query string, one layer down.
    const sql = readFileSync(
      resolve(__dirname, "../../../scripts/db/schema/pg/046_agri_subsidies.sql"),
      "utf-8",
    );
    const fn = sql.slice(sql.indexOf("agri_beneficiary_search"));
    const body = fn.slice(0, fn.indexOf("$$;") + 3);
    expect(body).toContain("FROM agri_beneficiary");
    expect(body).not.toContain("agri_beneficiary_year");
  });

  it("maps a row to a farm page, keeping its all-time total", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => [
          {
            eik: "111560777",
            name: "Златия Агро ЕООД",
            oblast: "Монтана",
            totalEur: 38_600_000,
          },
        ],
      }) as unknown as Response),
    );
    const [item] = await sources()[0]!.fetch(
      "агро",
      new AbortController().signal,
    );
    expect(item!.to).toBe("/farm/111560777");
    expect(item!.primary).toBe("Златия Агро ЕООД");
    expect(item!.secondary).toBe("Монтана");
    // The ALL-TIME figure, matching the corpus the query ran against. A scoped number beside
    // an unscoped result set is the filter this source refuses, wearing a number.
    expect(item!.amountEur).toBe(38_600_000);
  });

  it("survives a route that answers with something other than an array", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ error: "x" }) }) as unknown as Response),
    );
    await expect(
      sources()[0]!.fetch("агро", new AbortController().signal),
    ).resolves.toEqual([]);
  });
});
