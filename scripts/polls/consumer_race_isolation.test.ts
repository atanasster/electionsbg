// Tier 4 T4.5 — the exhaustiveness gate the plan names: every PARLIAMENTARY consumer of
// `data/polls/*.json` reads that corpus only, never decision 10's separate presidential
// family (`data/polls/presidential/*.json`, `@/data/presidential/usePresidentialPolls`) —
// and, symmetrically, every presidential-only consumer never reads the parliamentary one.
//
// ⚠ THE TWO CORPORA SHARE TYPES AND A REGISTRY, which is exactly what makes a wrong import
// invisible to every other check. `Poll` and `PollLock` are one type covering both races
// (`pollsTypes.ts`'s `Race = "parliamentary" | "presidential"`), and `agencies.json` is ONE
// shared file both corpora key against — so a consumer accidentally wired to
// `usePresidentialPollsAccuracy` instead of `usePollsAccuracy` compiles cleanly, renders a
// real-looking table, and attributes a presidential poll's numbers to the parliamentary
// scoreboard (or the reverse) with nothing red anywhere else. This is the one place that
// checks it.
//
// ⚠ `agencies.json`-ONLY READERS ARE DELIBERATELY OUT OF SCOPE. The registry (and code that
// merely enumerates/links agencies, e.g. the sitemap) is race-neutral by design — it carries
// no poll numbers of its own — so a file that reads only `agencies.json` attributes nothing
// to either race and earns no spot on either list below. Only readers of a race-SPECIFIC
// file (`accuracy.json`, `polls.json`, `polls_details.json`, `analysis.json`, `runoffs.json`)
// are in scope.
//
// ⚠ SCANS CODE, NOT PROSE. `stripComments` first, matching `entryGraph.test.ts`'s own
// reasoning: a comment EXPLAINING that a file is parliamentary-only ("unlike the
// presidential corpus, ...") is not an occurrence of the thing it explains, and a naive
// scan would make writing that explanation a way to fail this gate. `{trailing: true}` is
// safe here specifically because the scan target ("presidential") is a rare English word
// that never needs to follow a `//` on the same line as code this file cares about — unlike
// the i18n key scanner's own `pp_reg_seat_${seat}`-shaped risk, which is why that gate keeps
// the default.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../lib/module_graph";
import { stripComments } from "../lib/strip_comments";

const read = (relPath: string): string =>
  fs.readFileSync(path.join(REPO_ROOT, relPath), "utf-8");

/** Every consumer the plan names by name (T4.5) or its own kind ("the four screens/tiles"),
 *  the two risk-composite files, the AI chat's poll-reading tools, and the three build-time
 *  script consumers of `polls/accuracy.json` (a video data feed, an LLM prompt builder, and
 *  a reports-hub stat) found by auditing every direct reader of that file. Each must
 *  reference ONLY the parliamentary corpus. */
const PARLIAMENTARY_ONLY_CONSUMERS = [
  "src/screens/dashboard/PollsTile.tsx",
  "src/screens/dashboard/PartyPollingDeltaTile.tsx",
  "src/screens/dashboard/PartyAgencyForecastsTile.tsx",
  "src/screens/dashboard/AccuracyTrendsTile.tsx",
  "src/screens/polls/AccuracyTrendsChart.tsx",
  "src/screens/polls/AgencyPollsList.tsx",
  "src/screens/polls/AgencyProfileCard.tsx",
  "src/screens/polls/PollsHeadlinesTile.tsx",
  "src/screens/polls/PollsLeaderboardTile.tsx",
  "src/screens/polls/PollsLatestElectionTile.tsx",
  "src/screens/polls/PollsMethodologyTile.tsx",
  "src/screens/components/riskAnalysis/PollsExpectationCard.tsx",
  "src/data/polls/usePolls.tsx",
  "src/data/riskScore/computeRiskComposite.ts",
  "src/data/riskScore/useRiskComposite.ts",
  "ai/tools/pollsDepth.ts",
  "ai/tools/people.ts",
  "ai/tools/integrity.ts",
  "scripts/video/build_risk.ts",
  "scripts/parties/bundle_party_data.ts",
  "scripts/reports/analysis_stats.ts",
];

/** The presidential-only side of the same isolation — every current consumer of decision
 *  10's separate file family. Each must reference ONLY the presidential corpus, never the
 *  parliamentary hooks/paths. Smaller than the list above because the presidential family
 *  is new (this tier) and every consumer of it was built with the split already in mind —
 *  but "new" is exactly when a gate like this earns its keep, before drift has a chance to
 *  start. */
const PRESIDENTIAL_ONLY_CONSUMERS = [
  "src/data/presidential/usePresidentialPolls.ts",
  "src/screens/presidential/PresidentialPollsTile.tsx",
  "src/screens/presidential/PresidentialCycleScreen.tsx",
  "src/screens/polls/PresidentialPollsSection.tsx",
  "src/screens/polls/AgencyPresidentialPollsList.tsx",
  "scripts/prerender/presidentialRoutes.ts",
  "ai/tools/presidentialPollsDepth.ts",
];

/** The deliberate exception: pages/builders that compose BOTH corpora's bands side by side
 *  on purpose (a parliamentary section and a presidential section, never one payload). Each
 *  keeps its own dedicated tests proving the two fetches stay separate; this gate only
 *  asserts the exemption is still load-bearing, i.e. the file still genuinely reads both. */
const MIXED_COMPOSERS = [
  "src/screens/PollsScreen.tsx",
  "src/screens/PollsAgencyScreen.tsx",
  "scripts/prerender/bodyBuilders.ts",
  "scripts/prerender/dynamicRoutes.ts",
];

/** Loose — ANY mention, comments included via the strip above but nothing narrower. Safe
 *  for the "must NEVER mention" direction (a false positive only makes the gate stricter
 *  than it needs to be); wrong for staleness-checking an exemption, which wants the
 *  stronger form below. */
const mentionsPresidential = (code: string): boolean =>
  /presidential/i.test(stripComments(code, { trailing: true }));

const mentionsParliamentaryPolls = (code: string): boolean =>
  /\busePolls(?:Accuracy|Details|Analysis)?\b|["'`][^"'`]*\/polls\/(?:polls|accuracy|analysis|polls_details)(?:\.json)?["'`]/.test(
    stripComments(code, { trailing: true }),
  );

/** STRICTER than `mentionsPresidential` — a real import specifier or a quoted path
 *  SEGMENT, never a bare keyword floating in prose. Used only for `MIXED_COMPOSERS`'
 *  reverse check, whose entire job is catching a STALE exemption: a leftover comment
 *  surviving the strip would keep the loose check green after the real presidential-
 *  reading code is gone. Matches both real shapes this file's own composers use —
 *  `from "./polls/PresidentialPollsSection"` (a component import) and
 *  `path.join(..., "presidential", ...)` (a bare path-segment literal, `bodyBuilders.ts`'s
 *  own style) — while still requiring the word to sit inside quotes, which plain
 *  explanatory prose does not. A dead but still-imported reference is a separate risk this
 *  does not close; that class is `@typescript-eslint/no-unused-vars`'s job, already
 *  enforced elsewhere in this repo's lint gate. */
const reallyReadsPresidential = (code: string): boolean =>
  /from\s+["'][^"']*presidential[^"']*["']|["']presidential["']/i.test(
    stripComments(code, { trailing: true }),
  );

describe("parliamentary poll consumers read the parliamentary corpus only", () => {
  it.each(PARLIAMENTARY_ONLY_CONSUMERS)("%s exists on disk", (relPath) => {
    expect(fs.existsSync(path.join(REPO_ROOT, relPath)), relPath).toBe(true);
  });

  it.each(PARLIAMENTARY_ONLY_CONSUMERS)(
    "%s never references the presidential corpus",
    (relPath) => {
      expect(
        mentionsPresidential(read(relPath)),
        `${relPath} references "presidential" in code (not a comment) — ` +
          `it should read data/polls/*.json only, never data/polls/presidential/*.json`,
      ).toBe(false);
    },
  );
});

describe("presidential poll consumers read the presidential corpus only", () => {
  it.each(PRESIDENTIAL_ONLY_CONSUMERS)("%s exists on disk", (relPath) => {
    expect(fs.existsSync(path.join(REPO_ROOT, relPath)), relPath).toBe(true);
  });

  it.each(PRESIDENTIAL_ONLY_CONSUMERS)(
    "%s never references the parliamentary polls hooks or paths",
    (relPath) => {
      expect(
        mentionsParliamentaryPolls(read(relPath)),
        `${relPath} references a parliamentary polls hook or path — ` +
          `it should read data/polls/presidential/*.json only`,
      ).toBe(false);
    },
  );
});

describe("the mixed-composer exemption stays honest", () => {
  it.each(MIXED_COMPOSERS)("%s exists on disk", (relPath) => {
    expect(fs.existsSync(path.join(REPO_ROOT, relPath)), relPath).toBe(true);
  });

  // ⚠ THE OTHER DIRECTION OF THE SAME MISTAKE. If one of these stops referencing the
  // presidential corpus (a refactor moved the presidential band out, or behind a lazy
  // import this scan cannot see), it no longer needs the exemption — and leaving it here
  // would let a FUTURE accidental presidential import in this file pass silently, since the
  // file is presumed mixed rather than checked. Uses `reallyReadsPresidential`, not the
  // loose `mentionsPresidential`, so a leftover comment or dead import cannot keep this
  // green after the real presidential-reading code is gone.
  it.each(MIXED_COMPOSERS)(
    "%s still genuinely reads the presidential corpus (or the exemption is stale)",
    (relPath) => {
      expect(
        reallyReadsPresidential(read(relPath)),
        `${relPath} no longer imports from a presidential/ path — move it out of ` +
          `MIXED_COMPOSERS and into PARLIAMENTARY_ONLY_CONSUMERS or PRESIDENTIAL_ONLY_CONSUMERS`,
      ).toBe(true);
    },
  );
});

describe("the allowlists stay non-trivial", () => {
  it("every list has real members", () => {
    expect(PARLIAMENTARY_ONLY_CONSUMERS.length).toBeGreaterThan(10);
    expect(PRESIDENTIAL_ONLY_CONSUMERS.length).toBeGreaterThan(0);
    expect(MIXED_COMPOSERS.length).toBeGreaterThan(0);
  });
});
