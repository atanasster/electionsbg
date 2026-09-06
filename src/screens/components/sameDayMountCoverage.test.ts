// Both halves of the same-day pair are mounted, and on the pages the other half links TO.
//
// ⚠⚠ THE COMPONENT TESTS CANNOT SEE THIS. They render each pill in isolation and both pass with
// one of them mounted nowhere — which is how the first cut shipped: `ToPresidentialSameDay` sat
// in `MunicipalityResults` (`/local/:cycle/:obshtinaCode`) while the presidential pill links to
// `/local/:cycle`, so the round trip was one-way and three comment blocks said otherwise.
//
// ⚠ A SOURCE SCAN, in the idiom of `entryGraph.test.ts` — the alternative is mounting two large
// screens with their whole data layer to assert one anchor.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (rel: string): string =>
  fs.readFileSync(path.join(process.cwd(), rel), "utf8");

/** The body of a named `const X: FC<…> = (…) => …` up to the next top-level `const`. */
const component = (src: string, name: string): string => {
  const start = src.indexOf(`const ${name}: FC`);
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  const next = src.indexOf("\nconst ", start + 1);
  return src.slice(start, next === -1 ? src.length : next);
};

describe("the same-day cross-link is mounted on both destinations", () => {
  const local = read("src/screens/LocalElectionScreen.tsx");
  const presidential = read(
    "src/screens/presidential/PresidentialCycleScreen.tsx",
  );

  it("puts the return pill on /local/:cycle, which is where the presidential one lands", () => {
    // `ToLocalSameDay` links to `/local/${name}` — no obshtina — which `LocalElectionScreen`
    // dispatches to `CountryDashboard`. That component, and not the município view, is the
    // destination that owes a way back.
    // The destination is built in the pill itself, so that is where the `/local/:cycle` shape
    // is asserted — the screen only mounts the component.
    expect(read("src/screens/components/SameDayElectionLink.tsx")).toContain(
      "`/local/${local.name}`",
    );
    expect(component(local, "CountryDashboard")).toContain(
      "<ToPresidentialSameDay",
    );
  });

  it("keeps the place on the município page rather than dropping to the country", () => {
    // 261 of the 262 local 2011 codes have a published presidential municipality page; sending
    // a reader from Девин to the national result throws away the place they were reading about.
    expect(component(local, "MunicipalityResults")).toMatch(
      /<ToPresidentialSameDay[^>]*obshtina=\{obshtinaCode\}/s,
    );
  });

  it("mounts the presidential half on the cycle page", () => {
    expect(presidential).toContain("<ToLocalSameDay");
  });
});
