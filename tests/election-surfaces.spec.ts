// §9.0 rule 2 and the second half of rule 3 — the anti-vacuity gate for every migrated level.
//
// ⚠⚠ WITHOUT THIS FILE EVERY BROWSER GATE OVER THESE PAGES IS SATISFIED BY THE LEGACY BODY.
// `ElectionSurfaceBoundary`'s fallback is the DEFAULT rather than the error path — an
// unpublished cycle, a CORS refusal, a schema bump and a malformed file all render the page's
// existing composition at a 200 — and CI reads election data from the LIVE PRODUCTION BUCKET
// (`VITE_DATA_BASE_URL` on the Build step; `public/` carries no election symlink). So the suite
// tests whatever is in the bucket at that moment, not what is on the branch, and until an
// artifact is published every ordering and layout assertion passes while the shell is nowhere
// on the page. The plan says it outright: "Nothing is red. Nothing has been tested."
//
// The marker is `data-surface-shell="<level>"` on `ElectionResultsShell`'s root. It is asserted
// VISIBLE, asserted to carry the RIGHT LEVEL, and asserted to sit INSIDE a boundary in the
// expected state — "the page rendered something", "some shell rendered" and "some boundary
// somewhere is ready" are each satisfiable by the wrong thing.
//
// ⚠ THE LEVEL IS NOT THE ROUTE'S NOUN, and three of these read as though they were mislabelled.
// `/municipality/:id` lists the municipalities OF an oblast, so its surface is the REGION;
// `/settlement/:id` lists the settlements of a município, so its surface is the MUNICIPALITY;
// `/sections/:id` lists the polling stations of a settlement, so its surface is the SETTLEMENT.
// Fixing the "off by one" would break every one of them.
//
// ⚠ AND ONE CALL SITE EMITS TWO LEVELS, which is how `abroad` came to be missed on the first
// cut of this file. `MunicipalitiesScreen` chooses `isDiasporaRegion(region) ? "abroad" :
// "region"`, so `/municipality/BGS` and `/municipality/32` are the same component at different
// levels — ELEVEN (kind, level) pairs across NINE call sites. Counting call sites undercounts
// the table, and the level it undercounted is the one whose mislabelling the source calls "the
// one thing the level split exists to prevent" (a turnout МИР 32's protocol cannot support).
//
//   npm run build && npx playwright test --project=surfaces

import { test, expect, type Page } from "@playwright/test";
import { DIASPORA_REGION } from "../src/data/diaspora/diasporaFaq";

// ⚠ TWO 25 s WAITS AND A REAL CROSS-ORIGIN BUCKET FETCH DO NOT FIT PLAYWRIGHT'S 30 s DEFAULT,
// and this file's whole value is its failure MESSAGES — „the page is on its LEGACY body" is
// what turns a red build into a diagnosis, and `Test timeout of 30000ms exceeded` says nothing
// about surfaces at all. The config sets no `timeout`, so the budget is set here.
test.describe.configure({ timeout: 70_000 });

/** A warning this boundary emits when it falls back. One per process per reason — see
 *  `warnOnce` in `useElectionSurface.ts`. Matched on the shared prefix rather than on each
 *  message, so a NEW fallback reason is caught the day it is added rather than the day someone
 *  remembers to extend a list. */
const SURFACE_WARNING = /^election surface /;

type Case = {
  level: string;
  route: string;
  /** Which of the three surface-bearing boundary states this level is expected to reach.
   *  `ready` fetched an artifact; `canonical` derived it from the shard the page already
   *  loads; `embedded` read it out of that shard. §5.0 assigns these per kind × level, and
   *  asserting the SPECIFIC one is what stops a level quietly changing how it is served.
   *
   *  ⚠ THE STATE ALONE IS NOT EVIDENCE OF SUCCESS FOR TWO OF THE THREE. The boundary stamps
   *  `data-surface-boundary={state.status}` on the FALLBACK branch too, and `rendersSurface`
   *  is `ready`-only — so a `canonical` level whose `providedSurface` never arrived renders
   *  the legacy body under `data-surface-boundary="canonical"`. That is why the selector
   *  below carries `:not([data-surface-fallback])` rather than matching the status alone. */
  status: "ready" | "canonical" | "embedded";
};

// ⚠ THE IDS ARE CHOSEN, NOT ARBITRARY, and two of them carry a precondition that is invisible
// from the URL. `local/settlement` suppresses the shell where a later кметство by-election
// superseded the cycle (216 of 4,910 pages), and `local/municipality` does the same for its 8;
// on such a page an ABSENT shell is correct, so a gate pointed at one would be red for a reason
// that is not a defect. Both were verified against `data/local_chmi_history.json` for cycle
// 2023_10_29_mi: с. Абланица (ekatte 00014, кметство in обшина BLG52 — BLG52's only later event
// is кметство Теплен, and supersession keys on the кметство NAME), and община Айтос (BGS01,
// whose only later events are `kmetstvo_mayor`, while município supersession needs
// `obshtina_mayor`/`rayon_mayor`). BGS01 is Айтос, not Бургас — Бургас is BGS04.
const PARLIAMENTARY: Case[] = [
  // ⚠ `/parliamentary`, NOT `/`. §3.1 makes `/parliamentary` canonical for the parliamentary
  // country result; the bare `/` is the site homepage and mounts no boundary at all. Probed:
  // `/` and `/elections` render zero `data-surface-boundary` elements.
  { level: "country", route: "/parliamentary", status: "canonical" },
  { level: "region", route: "/municipality/BGS", status: "ready" },
  {
    level: "abroad",
    route: `/municipality/${DIASPORA_REGION}`,
    status: "ready",
  },
  { level: "municipality", route: "/settlement/BGS01", status: "canonical" },
  { level: "settlement", route: "/sections/00014", status: "ready" },
  { level: "section", route: "/section/020100001", status: "ready" },
];

// ⚠ PINNED, AND IT HAS A SHELF LIFE. v1 publishes the latest TWO local cycles — verified: of
// the five local cycles on disk only 2019_10_27_mi and 2023_10_29_mi carry a `surface/` tree.
// A new local cycle rotates 2019 out first, so this constant survives one rotation and goes red
// at the second, for a reason that is not a defect. The parliamentary cases need no such pin:
// they ride `ElectionContext`'s default.
const CYCLE = "2023_10_29_mi";
const LOCAL: Case[] = [
  { level: "country", route: `/local/${CYCLE}`, status: "ready" },
  { level: "region", route: `/local/${CYCLE}/region/BGS`, status: "ready" },
  { level: "municipality", route: `/local/${CYCLE}/BGS01`, status: "ready" },
  {
    level: "settlement",
    route: `/local/${CYCLE}/settlement/00014`,
    status: "ready",
  },
  {
    level: "section",
    route: `/local/${CYCLE}/BGS01/section/020100001`,
    status: "embedded",
  },
];

/** Console warnings the page emitted, collected from before the first navigation. */
const captureWarnings = (page: Page): string[] => {
  const out: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "warning" && SURFACE_WARNING.test(m.text()))
      out.push(m.text());
  });
  return out;
};

const assertShell = async (page: Page, c: Case) => {
  // ⚠ THE SHELL IS LOCATED *INSIDE* THE BOUNDARY, not beside it. Two independent `.first()`
  // locators would let one boundary's state vouch for another boundary's shell — no page nests
  // them today, but the claim this gate makes is about a specific boundary, so it is scoped to
  // one. `:not([data-surface-fallback])` is what makes the state discriminate at all for
  // `canonical` and `embedded`; see the `status` doc above.
  const boundary = page.locator(
    `[data-surface-boundary="${c.status}"]:not([data-surface-fallback])`,
  );
  const shell = boundary.locator("[data-surface-shell]").first();
  // ⚠ `toBeVisible`, NOT `toBeAttached` — `ElectionResultsShell`'s root always has content, so
  // the stronger assertion is free here. The DISCRIMINATION test below deliberately keeps
  // `toBeAttached` for `[data-surface-fallback]`, whose div is legitimately EMPTY on the four
  // call sites that pass `fallback={null}`. Do not harmonise the two.
  await expect(
    shell,
    `${c.route} rendered no shared shell in a "${c.status}" boundary — the page is on its ` +
      `LEGACY body, which is what a missing bucket artifact looks like at a 200`,
  ).toBeVisible({ timeout: 25_000 });
  await expect(
    shell,
    `${c.route} mounted a shell for the wrong level`,
  ).toHaveAttribute("data-surface-shell", c.level);
};

for (const [kind, cases] of [
  ["parliamentary", PARLIAMENTARY],
  ["local", LOCAL],
] as const) {
  test.describe(`${kind} surfaces are served, not fallen back from`, () => {
    for (const c of cases) {
      test(`${kind}/${c.level} — ${c.route}`, async ({ page }) => {
        const warnings = captureWarnings(page);
        await page.goto(c.route);
        await assertShell(page, c);

        // §9.0 rule 3's second half: a fallback is logged, and a migrated level logging one is
        // a failure rather than a note. This is what turns "the sync never ran" from a silent
        // 200 into a red build.
        //
        // ⚠ IT CANNOT FAIL FOR `canonical` AND `embedded`, and that is a property of the
        // SOURCE rather than of this assertion. Those levels issue no request — `locateSurface`
        // returns a null path, so `useQuery` is disabled and `fetchSurface`, the only caller of
        // `warnOnce`, never runs. Their fallback is genuinely unlogged today and the shell
        // assertion above is the only thing guarding them. Kept uniform so a level flipping to
        // `artifact` is covered the day it flips.
        //
        // ⚠ POLLED, NOT SNAPSHOTTED. `warnings` fills from a `page.on("console")` listener on
        // a channel with no ordering guarantee against locator queries, so reading it at one
        // instant is a race. On the passing path the poll returns immediately.
        await expect
          .poll(() => warnings, {
            message:
              `${c.route} logged a surface fallback — the artifact is missing, unreadable ` +
              `or a schema this build cannot parse`,
            timeout: 5_000,
          })
          .toEqual([]);
      });
    }
  });
}

test.describe("the gate discriminates", () => {
  // ⚠⚠ WITHOUT THESE TWO EVERY ASSERTION ABOVE IS SATISFIABLE BY A SELECTOR THAT MATCHES
  // ANYTHING AND A WARNING FILTER THAT MATCHES NOTHING.

  test("an unpublished cycle falls back, marks it, and says so", async ({
    page,
  }) => {
    // An unpublished cycle is the one state that exercises the marker and the warning filter in
    // the FAILING direction, and this corpus has real ones: v1 publishes the latest
    // parliamentary cycle only, so 2021_04_04's surfaces are genuinely 404 in the bucket.
    const warnings = captureWarnings(page);
    await page.goto("/municipality/BGS?elections=2021_04_04");

    // ⚠ `toBeAttached`, deliberately — four call sites pass `fallback={null}`, so this div is
    // legitimately empty and `toBeVisible` would fail it. The shell assertions above are the
    // opposite case; see `assertShell`.
    const fallback = page.locator("[data-surface-fallback]").first();
    await expect(
      fallback,
      "an unpublished cycle did not reach the fallback — either it has since been published " +
        "(pick another) or the boundary stopped marking it",
    ).toBeAttached({ timeout: 25_000 });

    // The marker the tests above assert PRESENT must be absent here, or its presence proves
    // nothing about whether the surface was served.
    await expect(
      page.locator("[data-surface-shell]"),
      "the legacy body rendered a shell marker — the anti-vacuity assertion above is vacuous",
    ).toHaveCount(0);

    await expect
      .poll(() => warnings.filter((w) => /not published/.test(w)).length, {
        message: "an unpublished cycle logged no reason",
        timeout: 10_000,
      })
      .toBeGreaterThan(0);
  });

  test("the level marker separates abroad from region", async ({ page }) => {
    // ⚠ THE TEST ABOVE ONLY PROVES THE MARKER CAN BE ABSENT. Nothing there shows
    // `toHaveAttribute` would reject a marker that is PRESENT AND WRONG — which is exactly the
    // defect the abroad row was added for. МИР 32's artifact lives UNDER `surface/region/` and
    // declares `place.level: "abroad"`, so this is the one place in the corpus where the two
    // levels meet and only the declared level separates them: a path assertion passes on either.
    await page.goto(`/municipality/${DIASPORA_REGION}`);
    const shell = page.locator("[data-surface-shell]").first();
    await expect(shell).toHaveAttribute("data-surface-shell", "abroad");
    await expect(
      page.locator('[data-surface-shell="region"]'),
      "the diaspora page mounted a REGION shell — the level split is what stops a turnout " +
        "МИР 32's protocol cannot support",
    ).toHaveCount(0);
  });
});
