// Every section on the /person profile is a real `<h2>`, or none of them is.
//
// `DashboardSection` renders its title as a `<span>` unless a caller opts into
// `headingLevel`, and its own doc says a page "whose sections ARE the top-level structure
// under its `<h1>` should pass 2, or its section titles are invisible to heading navigation
// and its outline skips a level". The person profile is that page.
//
// The gate exists because a PARTIAL outline is arguably worse than none: a screen-reader user
// rotoring by heading gets however many sections happened to opt in and reasonably concludes
// the page has that many. That is the state this page was in after two tiers of this plan
// added `headingLevel` to four of ~17 sections, and it is invisible in review — every section
// is still exposed as an `aria-labelledby` landmark, so nothing is unreachable and nothing
// looks wrong.
//
// A static scan rather than a render: the sections live in eleven components mounted
// conditionally on facets (a magistrate sees a different set than a councillor), so no single
// render reaches them all.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { SRC_DIR } from "@/../scripts/lib/module_graph";
import { stripComments } from "@/../scripts/lib/strip_comments";

/** The files whose `<DashboardSection id="person-…">` mounts on the /person profile.
 *
 *  ⚠️ NOT every file with a `person-` id. `FollowingScreen` is a different page (/following)
 *  and carries `person-events` / `person-watchlist` of its own, so its outline is its own
 *  decision and sweeping it from here would be a guess about a page this gate never checks. */
const PROFILE_FILES = [
  "screens/person/PersonProfileScreen.tsx",
  "screens/person/PersonSelfFunding.tsx",
  "screens/person/PersonAccumulationGap.tsx",
  "screens/person/PersonCohortBenchmark.tsx",
  "screens/person/PersonCompanies.tsx",
  "screens/person/PersonCouncilVoting.tsx",
  "screens/person/PersonDeclarationEvents.tsx",
  "screens/person/PersonMoneyTimeline.tsx",
  "screens/person/PersonNgoSeats.tsx",
  "screens/person/PersonProcurementSection.tsx",
  "screens/person/PersonStakeProcurement.tsx",
  "screens/person/PersonWealthTrajectory.tsx",
];

/** Opening `<DashboardSection …>` tags, with their `id` and whether they set headingLevel. */
const sections = (
  file: string,
): Array<{ id: string; headingLevel: boolean }> => {
  const src = stripComments(fs.readFileSync(path.join(SRC_DIR, file), "utf8"));
  const out: Array<{ id: string; headingLevel: boolean }> = [];
  const re = /<DashboardSection\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    // Walk to the end of the opening tag, ignoring `>` inside JSX expressions.
    let depth = 0;
    let i = m.index + m[0].length;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    const tag = src.slice(m.index, i);
    const id = /\bid=["{]?"?(person-[a-z-]+)"?/.exec(tag)?.[1];
    if (id) out.push({ id, headingLevel: /\bheadingLevel=/.test(tag) });
  }
  return out;
};

describe("the /person profile's heading outline", () => {
  const all = PROFILE_FILES.flatMap((f) =>
    sections(f).map((s) => ({ ...s, file: f })),
  );

  it("finds every profile section, so the assertion below is not vacuous", () => {
    // A parse that silently matched nothing would make the next test pass over an empty list.
    expect(all.length).toBeGreaterThanOrEqual(15);
    expect(new Set(all.map((s) => s.id)).size).toBeGreaterThanOrEqual(14);
  });

  it("gives every one of them a real heading level", () => {
    const spans = all.filter((s) => !s.headingLevel);
    expect(
      spans.map((s) => `${s.id} (${s.file})`),
      "these sections render their title as a <span>, so the page's heading outline lists only the others — see DashboardSection's headingLevel doc",
    ).toEqual([]);
  });
});
