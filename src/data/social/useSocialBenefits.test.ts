// data/social/benefits.json stores every money figure in LEVA, because that is what
// the АСП годишен отчет publishes. The site has been euro-only since 2026-01-01, so
// the hook is the single conversion point and every numeric field has to pass
// through it — a field that does not is a leva figure rendered beside euro totals,
// which is exactly what „121,34 лв." was doing inside a card headlined „€110 млн."
// until the 2026-08-15 audit (§8).
//
// These tests pin the CONVERSION CONTRACT rather than today's amounts.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { useSocialBenefits } from "./useSocialBenefits";

const RATE = 1.95583;

const payload = {
  fetchedAt: "2026-07-16",
  source: { publisher: "АСП", description: "", reports: {}, landing: "" },
  latestYear: 2025,
  eurRate: RATE,
  families: [
    {
      id: "child",
      label: { bg: "Деца", en: "Child" },
      law: "чл. 7 ЗСПД",
      recipientNoun: { bg: "деца", en: "children" },
      unit: "annual",
      meansTestBgn: 760,
      note: { bg: "", en: "" },
      series: [{ year: 2025, recipients: 416687, amountBgn: 266686943 }],
    },
    {
      id: "heating",
      label: { bg: "Отопление", en: "Heating" },
      law: "Наредба РД-07-5",
      recipientNoun: { bg: "домакинства", en: "households" },
      unit: "season",
      note: { bg: "", en: "" },
      series: [
        {
          year: 2025,
          season: "2025/2026",
          households: 357271,
          amountBgn: 215098559,
          perHouseholdMonthlyBgn: 121.34,
        },
      ],
    },
  ],
};

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(
    QueryClientProvider,
    {
      client: new QueryClient({
        defaultOptions: { queries: { retry: false } },
      }),
    },
    children,
  );

const load = async (body: unknown = payload) => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => body }),
  );
  const { result } = renderHook(() => useSocialBenefits(), { wrapper });
  await waitFor(() => expect(result.current.data).toBeTruthy());
  return result.current.data!;
};

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("useSocialBenefits converts every money field to euro", () => {
  it("derives amountEur from amountBgn", async () => {
    const d = await load();
    const heating = d.families.find((f) => f.id === "heating")!;
    expect(heating.series[0].amountEur).toBe(Math.round(215098559 / RATE));
  });

  // The field the audit found: it rendered „121,34 лв." beside a euro total.
  it("derives perHouseholdMonthlyEur, unrounded", async () => {
    const d = await load();
    const heating = d.families.find((f) => f.id === "heating")!;
    expect(heating.series[0].perHouseholdMonthlyEur).toBeCloseTo(
      121.34 / RATE,
      6,
    );
    // Unrounded on purpose: it is a statutory monthly RATE (€62,04) rendered at
    // two decimals, not an aggregate a compact formatter will truncate anyway.
    expect(heating.series[0].perHouseholdMonthlyEur).not.toBe(62);
  });

  // Same class, not yet rendered anywhere — derived so the first surface that
  // wants it cannot reach for the leva field instead.
  it("derives meansTestEur from meansTestBgn", async () => {
    const d = await load();
    const child = d.families.find((f) => f.id === "child")!;
    expect(child.meansTestEur).toBeCloseTo(760 / RATE, 6);
  });

  it("leaves the euro fields undefined when the leva source is absent", async () => {
    const d = await load();
    const child = d.families.find((f) => f.id === "child")!;
    const heating = d.families.find((f) => f.id === "heating")!;
    // child has no per-household rate; heating has no means test.
    expect(child.series[0].perHouseholdMonthlyEur).toBeUndefined();
    expect(heating.meansTestEur).toBeUndefined();
  });

  it("falls back to the fixed rate when the payload declares none", async () => {
    const d = await load({ ...payload, eurRate: 0 });
    const heating = d.families.find((f) => f.id === "heating")!;
    expect(heating.series[0].perHouseholdMonthlyEur).toBeCloseTo(
      121.34 / 1.95583,
      6,
    );
  });

  // Every consumer guards on `!data`, so the contract that matters is that a
  // failed fetch leaves `data` undefined and the query SETTLED — the tile then
  // renders nothing rather than half a card. (React Query v5 rejects an
  // undefined resolution, so the query settles as an error; the hook's callers
  // never read the status, only the data.)
  it("leaves data undefined when the fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    const { result } = renderHook(() => useSocialBenefits(), { wrapper });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.data).toBeUndefined();
  });
});
