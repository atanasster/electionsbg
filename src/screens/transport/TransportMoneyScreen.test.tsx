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
        new RegExp(
          `capital transfers for ${gap} .*are not set out in the State Budget Law`,
        ),
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

// TEST-007 (review 2026-10-17): the deploy-order case. A function deployed before
// ?exclude= ignores it and answers WITH the RRP broadband project; the hook must
// notice (no `excluded` echo) and the tile must say the figure still includes it.
describe("TransportMoneyScreen — the EU-funds exclusion", () => {
  const fundsStub = (echo: boolean) => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = String(input);
        urls.push(url);
        if (url.includes("/api/db/awarder-funds-rollup"))
          return {
            ok: true,
            status: 200,
            json: async () => ({
              basis: "grant",
              ...(echo ? { excluded: ["BG-RRP-7.001-0001"] } : {}),
              operators: [
                {
                  eik: "130823243",
                  grantEur: 1.5e9,
                  paidEur: 1e9,
                  projectCount: 40,
                },
                {
                  eik: "000695388",
                  grantEur: 0.5e9,
                  paidEur: 0.3e9,
                  projectCount: 9,
                },
              ],
            }),
          };
        if (url.includes("rail_subsidy.json"))
          return { ok: true, status: 200, json: async () => subsidy };
        if (url.includes("rail_ridership.json"))
          return { ok: true, status: 200, json: async () => ridership };
        return { ok: false, status: 404, json: async () => null };
      }),
    );
    return urls;
  };

  it("asks the route to drop the project, and says it is excluded when the route confirms", async () => {
    const urls = fundsStub(true);
    mount("/sector/transport/money");
    expect(
      await screen.findByText(/Without the digital-infrastructure project/),
    ).toBeTruthy();
    const req = urls.find((u) => u.includes("awarder-funds-rollup"))!;
    expect(new URL(req, "http://x").searchParams.get("exclude")).toBe(
      "BG-RRP-7.001-0001",
    );
  });

  it("says the figure still includes it when an older function ignores ?exclude=", async () => {
    fundsStub(false);
    mount("/sector/transport/money");
    expect(
      await screen.findByText(
        /still includes the digital-infrastructure project/,
      ),
    ).toBeTruthy();
    expect(
      screen.queryByText(/Without the digital-infrastructure project/),
    ).toBeNull();
  });
});
