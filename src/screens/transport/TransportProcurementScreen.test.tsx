// /sector/transport/procurement mounted with stubbed requests. Three contracts:
//   (a) every §3 section OWNS its id even when every request fails — the hub links
//       all eight, so an error page must not drop them;
//   (b) under ?mode= the mode note renders, yet the #modes split is still the
//       WHOLE sector and its re-attributed modes sum to the whole total (D8);
//   (c) the PSO note on #spine appears only when the window's bars hold the
//       ministry's PSO lots — never under a mode that leaves the ministry out.

import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TransportProcurementScreen } from "./TransportProcurementScreen";
import { TRANSPORT_EIK } from "@/lib/transportReferenceData";

const NKZHI = "130823243"; // rail
const BULATSA = "000697179"; // aviation

const SECTIONS = [
  "spine",
  "modes",
  "categories",
  "competition",
  "contractors",
  "top-contracts",
  "direct",
  "risk",
];

type Unit = { eik: string; totalEur: number };
const payload = (
  byUnit: Unit[],
  byCpv: { cpv: string; totalEur: number }[],
) => {
  const totalEur = byUnit.reduce((a, u) => a + u.totalEur, 0);
  const agg = { contractCount: 1, bidKnownN: 1, singleBidN: 0 };
  return {
    totalEur,
    ...agg,
    suppliers: [],
    byCpv: byCpv.map((c) => ({ ...c, ...agg })),
    byCpvContractor: [],
    byMethod: [{ method: "Открита процедура", totalEur }],
    byYear: [{ year: 2026, totalEur, contractCount: byUnit.length }],
    byUnit: byUnit.map((u) => ({ ...u, ...agg })),
  };
};

// Whole sector: МТС €1.5bn (€1bn of it PSO), НКЖИ €2bn, БУЛАТСА €0.5bn → €4bn.
const MINISTRY = payload(
  [{ eik: TRANSPORT_EIK, totalEur: 1.5e9 }],
  [
    { cpv: "60210000", totalEur: 1e9 },
    { cpv: "79000000", totalEur: 0.5e9 },
  ],
);
const eiksOf = (url: string) =>
  (new URL(url, "http://x").searchParams.get("eiks") ?? "").split(",");

const stubOk = () =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = String(input);
      const ok = (body: unknown) => ({
        ok: true,
        status: 200,
        json: async () => body,
      });
      if (url.includes("/api/db/awarder-group-model")) {
        const eiks = eiksOf(url);
        if (eiks.length === 1 && eiks[0] === TRANSPORT_EIK) return ok(MINISTRY);
        const units: Unit[] = [
          { eik: TRANSPORT_EIK, totalEur: 1.5e9 },
          { eik: NKZHI, totalEur: 2e9 },
          { eik: BULATSA, totalEur: 0.5e9 },
        ].filter((u) => eiks.includes(u.eik));
        return ok(
          payload(units, eiks.includes(TRANSPORT_EIK) ? MINISTRY.byCpv : []),
        );
      }
      if (url.includes("/api/db/awarder-group-rollup"))
        return ok({ operators: [], exMembers: true });
      return { ok: false, status: 404, json: async () => null };
    }),
  );

const mount = (url: string) =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={[url]}>
        <TransportProcurementScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );

afterEach(() => vi.unstubAllGlobals());

describe("TransportProcurementScreen", () => {
  it("keeps all eight section ids when every request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, json: async () => null })),
    );
    const { container } = mount("/sector/transport/procurement");
    await waitFor(() =>
      expect(screen.getAllByText(/could not be loaded/).length).toBeGreaterThan(
        0,
      ),
    );
    for (const id of SECTIONS)
      expect(container.querySelector(`#${id}`), id).toBeTruthy();
  });

  it("re-attributes the whole sector on #modes, even under ?mode", async () => {
    stubOk();
    const { container } = mount("/sector/transport/procurement?mode=aviation");
    expect(
      await screen.findByText(/Showing the procurement of the Aviation bodies/),
    ).toBeTruthy();
    await waitFor(() =>
      expect(container.querySelector("#modes")?.textContent).toMatch(
        /Railways/,
      ),
    );
    const modes = container.querySelector("#modes")!.textContent!;
    // Rail €2bn + the ministry's €1bn PSO = €3bn; ministry €0.5bn; aviation
    // €0.5bn — Σ €4bn, the whole-sector total, not the aviation slice.
    // The compact unit follows the test locale (B / млрд.), so match either.
    const bn = "(?:B|\\s?млрд\\.)";
    const mn = "(?:M|\\s?млн\\.)";
    expect(modes).toMatch(new RegExp(`Railways€3${bn}`));
    expect(modes).toMatch(new RegExp(`Ministry \\(HQ\\)€500${mn}`));
    expect(modes).toMatch(new RegExp(`Aviation€500${mn}`));
    expect(modes).toMatch(new RegExp(`by awarder: €2${bn}`));
  });

  it("shows the PSO note only when the ministry's lots are in the bars", async () => {
    stubOk();
    const whole = mount("/sector/transport/procurement");
    expect(
      await screen.findByText(/rail public-service contracts in the window/),
    ).toBeTruthy();
    whole.unmount();

    stubOk();
    const { container } = mount("/sector/transport/procurement?mode=aviation");
    await waitFor(() =>
      expect(container.querySelector("#spine")?.textContent).toMatch(
        /Procurement by year/,
      ),
    );
    expect(container.querySelector("#spine")!.textContent).not.toMatch(
      /public-service/,
    );
  });

  it("never carries ?mode onto the contracts browser", async () => {
    stubOk();
    const { container } = mount(
      "/sector/transport/procurement?mode=aviation&pscope=all",
    );
    await waitFor(() =>
      expect(container.querySelector("#risk a")).toBeTruthy(),
    );
    const href = container.querySelector("#risk a")!.getAttribute("href")!;
    const p = new URL(href, "http://x").searchParams;
    expect(p.get("mode")).toBeNull();
    expect(p.get("sector")).toBeNull();
    expect(p.get("awarder")?.split(",")).toContain(BULATSA);
    expect(p.get("awarder")?.split(",")).not.toContain(NKZHI);
    expect(p.get("pscope")).toBe("all");
  });
});
