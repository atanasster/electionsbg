// /sector/transport/money carries no scope control, but it RESOLVES an inbound
// `pscope=y:YYYY` (the /subsidies hub forwards one onto its rail tile): the
// subsidy anchors on that year, and on the newest covered year otherwise.

import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import path from "node:path";
import { TransportMoneyScreen } from "./TransportMoneyScreen";

const file = (rel: string) =>
  JSON.parse(readFileSync(path.resolve(process.cwd(), rel), "utf8"));
const subsidy = file("data/transport/rail_subsidy.json");
const ridership = file("data/transport/rail_ridership.json");

const mount = (url: string) =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={[url]}>
        <TransportMoneyScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );

afterEach(() => vi.unstubAllGlobals());

const stub = () =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("rail_subsidy.json"))
        return { ok: true, status: 200, json: async () => subsidy };
      if (u.includes("rail_ridership.json"))
        return { ok: true, status: 200, json: async () => ridership };
      return { ok: false, status: 404, json: async () => null };
    }),
  );

/** The newest year both files carry, i.e. the default anchor. */
const newestCovered = (): number => {
  const pax = new Set<number>(
    ridership.series
      .filter((s: { passengers: number | null }) => s.passengers)
      .map((s: { year: number }) => s.year),
  );
  return Math.max(
    ...subsidy.years
      .filter(
        (y: { fiscalYear: number; bdzPassengerPsoEur: number | null }) =>
          y.bdzPassengerPsoEur != null && pax.has(y.fiscalYear),
      )
      .map((y: { fiscalYear: number }) => y.fiscalYear),
  );
};

describe("TransportMoneyScreen", () => {
  it("anchors the rail subsidy on a forwarded pscope year", async () => {
    stub();
    const year = newestCovered() - 1;
    mount(`/sector/transport/money?pscope=y:${year}`);
    expect(
      await screen.findByText(`state subsidy per passenger (PSO), ${year}`),
    ).toBeTruthy();
  });

  it("shows the newest covered year without a scope", async () => {
    stub();
    mount("/sector/transport/money");
    expect(
      await screen.findByText(
        `state subsidy per passenger (PSO), ${newestCovered()}`,
      ),
    ).toBeTruthy();
  });

  it("prints no total for a year whose capital transfers are unpublished, and names the year (F3, F4)", async () => {
    stub();
    const gap = subsidy.years.find(
      (y: { bdzCapitalEur: number | null; nkzhiCapitalEur: number | null }) =>
        y.bdzCapitalEur == null || y.nkzhiCapitalEur == null,
    )?.fiscalYear as number | undefined;
    // The committed files carry such a year (2024 today). If a later law fills it
    // in, this fails loudly rather than passing with nothing asserted — replace the
    // committed row with a fixture then.
    expect(gap, "no capital-missing year in rail_subsidy.json").toBeDefined();
    mount(`/sector/transport/money?pscope=y:${gap}`);
    expect(
      await screen.findByText(
        new RegExp(`capital transfers for ${gap} .*are not published`),
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Total rail subsidy")).toBeNull();
    expect(
      screen.getByText(new RegExp(`The rail subsidy is shown for ${gap}`)),
    ).toBeTruthy();
  });

  it("renders every §3 section and no scope control", async () => {
    stub();
    const { container } = mount("/sector/transport/money");
    await screen.findByText(/No period/);
    for (const id of ["budget", "subsidy", "funds", "peers", "road-safety"])
      expect(container.querySelector(`#${id}`), id).toBeTruthy();
  });
});
