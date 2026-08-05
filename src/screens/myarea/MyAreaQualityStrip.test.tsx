// The schools column of this strip and the education card below it show two
// DIFFERENT numbers for the same place — an unweighted per-school mean of ДЗИ
// subjects here, the cohort-weighted ДЗИ БЕЛ average there (measured 4.37 vs
// 4.69 for Столична община). Both are correct; unlabelled they read as a
// contradiction. These cases pin the labels that keep them apart, and the
// disclosure a Sofia район page needs because the schools shown there are the
// whole city's.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { initTestI18n } from "@/screens/dashboard/testI18n";
import { MyAreaQualityStrip } from "./MyAreaQualityStrip";

beforeAll(() => initTestI18n());

const school = (id: string, dziBel: number, dziMath?: number) => ({
  id,
  name: `Училище ${id}`,
  scoresByYear: {
    "2026": dziMath
      ? { dzi_bel: dziBel, dzi_math: dziMath }
      : { dzi_bel: dziBel },
  },
});

/** The strip hides itself below two populated columns, so every case needs a
 *  second one alongside schools — air is the cheapest to stub. Its hook falls
 *  back from a Sofia район to SOF00 exactly as the schools one does, so a
 *  station keyed to the city covers the район cases too. */
const stubFetches = (schoolsByObshtina: Record<string, unknown[]>) => {
  vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = String(input);
    const body = url.includes("/schools/index.json")
      ? { latestYear: 2026, schoolsByObshtina }
      : url.includes("services")
        ? { servicesByObshtina: {} }
        : {
            pollutants: { pm10: { unit: "µg/m³" } },
            stations: Object.keys(schoolsByObshtina).map((ob) => ({
              obshtina: ob,
              latestReadings: { pm10: 30 },
            })),
          };
    return Promise.resolve({ ok: true, json: async () => body } as Response);
  });
};

const renderStrip = (obshtina: string) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <MyAreaQualityStrip obshtina={obshtina} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
};

describe("MyAreaQualityStrip — the schools column", () => {
  it("names its basis, so it can't be read as the education card's number", async () => {
    stubFetches({
      SML10: [school("a", 4.0), school("b", 5.0)],
      SOF00: [school("c", 4.5)],
    });
    renderStrip("SML10");
    // Unweighted mean of per-school means: (4.00 + 5.00) / 2.
    await waitFor(() => expect(screen.getByText("4.50")).toBeInTheDocument());
    expect(screen.getByText(/средно за училище/)).toBeInTheDocument();
    expect(screen.getByText(/2 училища/)).toBeInTheDocument();
  });

  it("averages a school's own subjects before averaging schools", async () => {
    // One school with БЕЛ 4.00 and maths 6.00 is a 5.00 school, not two
    // schools — the composite is per school, then across schools.
    stubFetches({ SML10: [school("a", 4.0, 6.0), school("b", 3.0)] });
    renderStrip("SML10");
    await waitFor(() => expect(screen.getByText("4.00")).toBeInTheDocument());
  });

  it("says whose schools these are on a Sofia район page", async () => {
    // useSchools falls back to the city — МОН publishes no район separately —
    // and the education card below discloses it, so this must too.
    stubFetches({ SOF00: [school("a", 4.5), school("b", 4.7)] });
    renderStrip("S2309");
    await waitFor(() =>
      expect(screen.getByText(/в Столична община/)).toBeInTheDocument(),
    );
  });

  it("does not claim the city on an ordinary município", async () => {
    stubFetches({ SML10: [school("a", 4.5), school("b", 4.7)] });
    renderStrip("SML10");
    await waitFor(() =>
      expect(screen.getByText(/средно за училище/)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/в Столична община/)).not.toBeInTheDocument();
  });

  it("gets the Bulgarian singular right for a one-school place", async () => {
    stubFetches({ SML10: [school("a", 4.33)] });
    renderStrip("SML10");
    await waitFor(() =>
      expect(screen.getByText(/· 1 училище$/)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/1 училища/)).not.toBeInTheDocument();
  });
});
