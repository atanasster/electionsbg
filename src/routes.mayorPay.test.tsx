// One route, one invariant: /governance/mayor-pay must resolve to the
// mayor-pay ranking page and NOT to the `governance/:id` place dashboard.
//
// Same trap as routes.municipalFinance.test.tsx (that file's header explains
// it in full): `governance/:id` is a catch-all over any single segment, so if
// it ever won this URL would not 404 — it would render the place dashboard's
// "unknown place: mayor-pay" state at a 200.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { Suspense, lazy } from "react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: "bg" },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/screens/governance/GovernanceMayorPayScreen", () => ({
  GovernanceMayorPayScreen: () => <div>MAYOR PAY</div>,
}));
vi.mock("@/screens/myarea/MyAreaScreen", () => ({
  MyAreaScreen: () => <div>PLACE DASHBOARD</div>,
}));

const MayorPay = lazy(() =>
  import("@/screens/governance/GovernanceMayorPayScreen").then((m) => ({
    default: m.GovernanceMayorPayScreen,
  })),
);
const Place = lazy(() =>
  import("@/screens/myarea/MyAreaScreen").then((m) => ({
    default: m.MyAreaScreen,
  })),
);

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Suspense fallback={null}>
        <Routes>
          <Route path="governance/mayor-pay" element={<MayorPay />} />
          <Route path="governance/:id" element={<Place />} />
        </Routes>
      </Suspense>
    </MemoryRouter>,
  );

describe("/governance/mayor-pay", () => {
  it("renders the ranking, not the place dashboard", async () => {
    renderAt("/governance/mayor-pay");
    await waitFor(() => expect(screen.getByText("MAYOR PAY")).toBeVisible());
    expect(screen.queryByText("PLACE DASHBOARD")).toBeNull();
  });

  it("still routes a real município code to the place dashboard", async () => {
    renderAt("/governance/SLV11");
    await waitFor(() =>
      expect(screen.getByText("PLACE DASHBOARD")).toBeVisible(),
    );
  });

  it("declares the static path BEFORE the catch-all in routes.tsx", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync("src/routes.tsx", "utf8"),
    );
    const staticAt = src.indexOf('path="governance/mayor-pay"');
    const catchAt = src.indexOf('path="governance/:id"');
    expect(staticAt).toBeGreaterThan(-1);
    expect(catchAt).toBeGreaterThan(-1);
    expect(staticAt).toBeLessThan(catchAt);
  });
});
