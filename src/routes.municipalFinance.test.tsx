// One route, one invariant: /governance/municipal-finance must resolve to the
// municipal-finance browse and NOT to the `governance/:id` place dashboard.
//
// The two compete. `governance/:id` is a catch-all over any single segment, so
// if it ever won, the URL would not 404 — it would render the place dashboard's
// „unknown place: municipal-finance" state at a 200, with the homepage's title.
// That is the failure this asserts against, and it is exactly the one that
// shipped once already (the /indicators/fiscal tile linked here before the page
// existed).
//
// React Router v7 ranks by specificity rather than declaration order, so the
// static path wins wherever it is written. The test asserts the OUTCOME rather
// than either mechanism, so a future flattening to a route array — which would
// make declaration order load-bearing — is covered too.

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

// Both screens are stubbed to a sentinel, so the assertion is about ROUTING and
// does not depend on either page's data, hooks or network.
vi.mock("@/screens/governance/GovernanceMunicipalFinanceScreen", () => ({
  GovernanceMunicipalFinanceScreen: () => <div>BROWSE</div>,
}));
vi.mock("@/screens/myarea/MyAreaScreen", () => ({
  MyAreaScreen: () => <div>PLACE DASHBOARD</div>,
}));

// A miniature of the two competing declarations in routes.tsx, in the order
// they appear there. Rendering the real <AuthRoutes> would drag in the whole
// app shell; what is under test is the pair.
const Browse = lazy(() =>
  import("@/screens/governance/GovernanceMunicipalFinanceScreen").then((m) => ({
    default: m.GovernanceMunicipalFinanceScreen,
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
          <Route path="governance/municipal-finance" element={<Browse />} />
          <Route path="governance/:id" element={<Place />} />
        </Routes>
      </Suspense>
    </MemoryRouter>,
  );

describe("/governance/municipal-finance", () => {
  it("renders the browse, not the place dashboard", async () => {
    renderAt("/governance/municipal-finance");
    await waitFor(() => expect(screen.getByText("BROWSE")).toBeVisible());
    expect(screen.queryByText("PLACE DASHBOARD")).toBeNull();
  });

  it("still routes a real município code to the place dashboard", async () => {
    // The other half: the static path must not have shadowed the catch-all.
    renderAt("/governance/SLV11");
    await waitFor(() =>
      expect(screen.getByText("PLACE DASHBOARD")).toBeVisible(),
    );
  });

  it("declares the static path BEFORE the catch-all in routes.tsx", async () => {
    // Specificity decides today, so this is belt-and-braces — but it is the
    // property that would keep the page working after a flattening refactor,
    // and it is one string comparison.
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync("src/routes.tsx", "utf8"),
    );
    const staticAt = src.indexOf('path="governance/municipal-finance"');
    const catchAt = src.indexOf('path="governance/:id"');
    expect(staticAt).toBeGreaterThan(-1);
    expect(catchAt).toBeGreaterThan(-1);
    expect(staticAt).toBeLessThan(catchAt);
  });
});
