import { describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const SCREENS = ["Economy", "Fiscal", "Governance", "Society"] as const;
const DIR = path.dirname(fileURLToPath(import.meta.url));

const sourceOf = (name: string) =>
  fs.readFileSync(path.join(DIR, `Indicators${name}Screen.tsx`), "utf-8");

// The /indicators/* screens each render twice — a loading return while
// governments.json is in flight, and the loaded page. Those two headers used to
// differ (the loading one was a bare <Title> with no description, no nav and no
// toggle), so the swap between them replaced the whole top of the page.
//
// Being precise about what this did and did NOT cost, because it was measured:
// the swap contributed **no** layout shift, since at that moment the body below
// it was still empty and nothing had a position to move from. The page's CLS
// (0.1536 on /indicators/economy) came from somewhere else entirely — the
// charts collapsing to a line of text until macro.json arrived, fixed in
// GovernmentTimeline/InflationBreakdownChart. This consolidation stands on its
// own merits: one definition instead of two that must be kept identical by
// hand.
//
// These are source-level assertions rather than render assertions because the
// property being protected is "there is exactly ONE header definition per
// screen". A render test can only compare two trees the component actually
// produces; it cannot see a second copy re-introduced by a future edit, which
// is precisely how the divergence arose.
describe("indicators screens render one header in both loading and loaded states", () => {
  it.each(SCREENS)("%s declares the header exactly once", (name) => {
    const src = sourceOf(name);
    expect(
      src.match(/const header = \(/g)?.length,
      `${name} should build its header once`,
    ).toBe(1);
    expect(
      src.match(/<IndicatorsPageHeader/g)?.length,
      `${name} should instantiate IndicatorsPageHeader once`,
    ).toBe(1);
  });

  it.each(SCREENS)("%s uses that header in both returns", (name) => {
    const src = sourceOf(name);
    expect(src.match(/\{header\}/g)?.length, `${name}`).toBe(2);
    // The loading return must be the shared header and nothing else — a bare
    // <Title> here is the exact shape that caused the shift.
    expect(src).toContain('return <div className="pb-12">{header}</div>;');
  });

  // Reintroducing any of these in a screen means the header was inlined again
  // rather than taken from the shared component.
  it.each(SCREENS)("%s does not re-inline the header pieces", (name) => {
    const src = sourceOf(name);
    for (const banned of [
      "<IndicatorsNav />",
      "<CompareToggleButton",
      "<Title",
    ]) {
      expect(src.includes(banned), `${name} re-inlines ${banned}`).toBe(false);
    }
  });
});

describe("IndicatorsPageHeader", () => {
  it("renders no data-dependent prop, so both states can render it", async () => {
    const src = fs.readFileSync(
      path.join(DIR, "indicatorsShared.tsx"),
      "utf-8",
    );
    const declAt = src.indexOf("export const IndicatorsPageHeader");
    expect(
      declAt,
      "IndicatorsPageHeader declaration not found",
    ).toBeGreaterThan(-1);
    const decl = src.slice(declAt);
    const end = decl.indexOf("}> =");
    // Without this, a renamed signature slices to -1, yields "" and the
    // banned-word scan below passes against nothing.
    expect(end, "could not delimit the prop list").toBeGreaterThan(0);
    const props = decl.slice(0, end);
    // `governments`/`macro`/`peers` would make the loading state unable to
    // render the same header, which is the whole defect.
    for (const banned of ["governments", "macro", "peers", "xDomain"]) {
      expect(props.includes(banned), `prop list mentions ${banned}`).toBe(
        false,
      );
    }
  });

  it("renders title, description and the optional toggle", async () => {
    vi.resetModules();
    vi.doMock("./indicatorsNav", () => ({
      IndicatorsNav: () => <nav data-testid="nav" />,
    }));
    vi.doMock("@/screens/components/macro/CompareToggleButton", () => ({
      CompareToggleButton: () => <button data-testid="toggle" />,
    }));
    vi.doMock("@/ux/Title", () => ({
      Title: ({
        children,
        description,
      }: {
        children: React.ReactNode;
        description?: string;
      }) => (
        <div>
          <h1>{children}</h1>
          <p data-testid="desc">{description}</p>
        </div>
      ),
    }));
    const { render, screen } = await import("@testing-library/react");
    const { IndicatorsPageHeader } = await import("./indicatorsShared");

    const { unmount } = render(
      <IndicatorsPageHeader
        title="T"
        description="D"
        compare={{ enabled: false, onToggle: () => {} }}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("T");
    expect(screen.getByTestId("desc").textContent).toBe("D");
    expect(screen.getByTestId("nav")).toBeTruthy();
    expect(screen.getByTestId("toggle")).toBeTruthy();
    unmount();

    // /indicators/governance has no EU comparison to toggle.
    render(<IndicatorsPageHeader title="T" description="D" />);
    expect(screen.queryByTestId("toggle")).toBeNull();
  });
});
