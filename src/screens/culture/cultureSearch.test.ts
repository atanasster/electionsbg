// The /culture finder's sources. A pure, dependency-light module — a fetch stub is all it
// needs — which is why it had accumulated three defects nobody could see from the page:
//
//   1. every contract row linked to `/funds/contract/:number`, the ИСУН PROJECT page, with a
//      PROCUREMENT contract hash. No procurement hash can ever be an ИСУН contract number, so
//      all of them rendered „договор … не е намерен" at a 200 — one click away from a row
//      that looked perfect;
//   2. the register-index rows and the server awarder rows landed on DIFFERENT windows of the
//      same page, so one dropdown could show one institution twice and disagree with itself;
//   3. a flat `limit: 5` over `[...awarders, ...contracts]` meant four matching buyers left
//      room for exactly one contract, under a label promising both.
//
//   npx vitest run src/screens/culture/cultureSearch.test.ts

import { describe, it, expect, vi, afterEach } from "vitest";
import { cultureRosterIndex, cultureSearchSources } from "./cultureSearch";
import { awarderAllTimeHref } from "@/screens/components/search/procurementSearchSource";
import { NFC_EIK } from "@/lib/kulturaReferenceData";

interface ServerLike {
  id: string;
  limit?: number;
  fetch: (q: string, s: AbortSignal) => Promise<{ id: string; to: string }[]>;
}

const procurementSource = (): ServerLike =>
  cultureSearchSources(true).find(
    (s) => (s as { id: string }).id === "procurement",
  ) as unknown as ServerLike;

const awarder = (eik: string, name: string) => ({
  eik,
  name,
  contracts: 1,
  contractsEur: 1_000,
});
const contract = (key: string) => ({
  key,
  title: "Ремонт на читалище",
  date: "2024-03-01",
  awarderName: "Министерство на културата",
  contractorName: "Строител ЕООД",
  amountEur: 100_000,
});

const stub = (body: unknown) =>
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(body),
  } as Response);

afterEach(() => vi.restoreAllMocks());

describe("the mixed procurement group", () => {
  it("routes a contract hit to /procurement/contract/:key, not the ИСУН page", async () => {
    stub({ awarders: [], contracts: [contract("a1b2c3")] });
    const rows = await procurementSource().fetch(
      "читалище",
      new AbortController().signal,
    );
    expect(rows.map((r) => r.to)).toEqual(["/procurement/contract/a1b2c3"]);
    expect(rows[0].to).not.toContain("/funds/contract/");
  });

  it("keeps a key with a separator in ONE path segment", async () => {
    // ⚠️ NOT a tautology. `expect(to).toBe(`/procurement/contract/${key}`)` passes with the
    // encode deleted; only a key carrying a separator discriminates.
    stub({ awarders: [], contracts: [contract("a/b")] });
    const [row] = await procurementSource().fetch(
      "x",
      new AbortController().signal,
    );
    expect(row.to).toBe("/procurement/contract/a%2Fb");
  });

  it("shows contract rows even when buyers fill the awarder arm", async () => {
    // The starvation case: `HubSearch` caps the group with `slice(0, limit)` over the
    // CONCATENATION, so without a per-kind quota a full awarder arm hides every contract.
    const source = procurementSource();
    stub({
      awarders: [
        awarder("000695160", "МК"),
        awarder("000695161", "МК 2"),
        awarder("000695162", "МК 3"),
      ],
      contracts: [contract("c1"), contract("c2"), contract("c3")],
    });
    const rows = await source.fetch("к", new AbortController().signal);
    const shown = rows.slice(0, source.limit);
    expect(shown.filter((r) => r.to.startsWith("/awarder/"))).toHaveLength(3);
    expect(
      shown.filter((r) => r.to.startsWith("/procurement/contract/")),
    ).toHaveLength(3);
  });

  it("gives its awarder rows the all-time window", async () => {
    stub({ awarders: [awarder("000695160", "МК")], contracts: [] });
    const [row] = await procurementSource().fetch(
      "мк",
      new AbortController().signal,
    );
    expect(row.to).toBe(awarderAllTimeHref("000695160"));
  });
});

describe("the register index", () => {
  it("lands on the SAME window as the server awarder rows — EVERY row", () => {
    // One dropdown can show the same institution twice — once from here, once from
    // „Поръчки и възложители". Two windows for one body is the reader-visible failure.
    const { rows } = cultureRosterIndex();
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.href).toBe(awarderAllTimeHref(r.id));
  });

  it("keeps НФЦ out — a row whose page cannot land does not ship", () => {
    // Pins the existing rule: НФЦ is a Bulstat entity with a zero procurement footprint,
    // so /awarder/000695833 renders „no company with this EIK".
    const { rows } = cultureRosterIndex();
    expect(rows.some((r) => r.id === NFC_EIK)).toBe(false);
  });
});
