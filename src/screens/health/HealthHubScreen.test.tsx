// The hub finder's LAZY-FETCH gate. Two regressions are
// invisible everywhere else:
//
//   1. dropping `armed` from the two hook calls adds two НЗОК payload requests
//      to EVERY hub load — no test of the finder's output can see a request
//      made too early;
//   2. dropping `armed &&` from the loading flags leaves the box saying
//      „Зареждане…" for ever before focus, because a DISABLED React Query v5
//      query reports `isPending: true`.
//
// HubSearch is replaced by a stub that captures its props, so the test reads
// what the screen hands the box rather than what the box renders.

import { act, render } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "bg" } }),
}));
vi.mock("@/i18n", () => ({ isBg: (l: string) => l === "bg" }));

const hookCalls = { payments: [] as boolean[], quarterly: [] as boolean[] };
// Disabled-and-unresolved: exactly what React Query v5 returns before arming.
const pending = { data: undefined, isPending: true };
vi.mock("@/data/budget/useBudget", () => ({
  useNzokHospitalPayments: (enabled: boolean) => {
    hookCalls.payments.push(enabled);
    return pending;
  },
  useNzokDrugQuarterly: (enabled: boolean) => {
    hookCalls.quarterly.push(enabled);
    return pending;
  },
}));
vi.mock("@/data/health/hubStats", () => ({
  useHealthHubStats: () => ({
    data: undefined,
    isPending: true,
    isError: false,
  }),
}));
vi.mock("@/screens/components/procurement/SectorBreadcrumb", () => ({
  SectorBreadcrumb: () => null,
}));
vi.mock("@/ux/infographic", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ux/infographic")>()),
  HubHead: ({ search }: { search: ReactNode }) => <>{search}</>,
  TileHubGrid: () => null,
}));

type Source = { id: string; loading?: boolean };
const box: { sources: Source[]; onArm?: () => void } = { sources: [] };
vi.mock("@/ux/search/HubSearch", () => ({
  HubSearch: (p: { sources: Source[]; onArm: () => void }) => {
    box.sources = p.sources;
    box.onArm = p.onArm;
    return null;
  },
}));

import { HealthHubScreen } from "./HealthHubScreen";

const loading = (id: string) => box.sources.find((s) => s.id === id)?.loading;

beforeEach(() => {
  hookCalls.payments = [];
  hookCalls.quarterly = [];
  box.sources = [];
  box.onArm = undefined;
});

describe("the health hub finder's lazy fetch", () => {
  it("does not enable either НЗОК payload before the box is armed", () => {
    render(<HealthHubScreen />);
    expect(hookCalls.payments.length).toBeGreaterThan(0);
    expect(hookCalls.payments.every((e) => e === false)).toBe(true);
    expect(hookCalls.quarterly.every((e) => e === false)).toBe(true);
  });

  it("does not report a disabled query as loading", () => {
    render(<HealthHubScreen />);
    expect(loading("hospitals")).toBe(false);
    expect(loading("molecules")).toBe(false);
  });

  it("enables both payloads and shows them loading once armed", () => {
    render(<HealthHubScreen />);
    expect(box.onArm).toBeTypeOf("function");
    act(() => box.onArm!());
    expect(hookCalls.payments.at(-1)).toBe(true);
    expect(hookCalls.quarterly.at(-1)).toBe(true);
    expect(loading("hospitals")).toBe(true);
    expect(loading("molecules")).toBe(true);
  });
});
