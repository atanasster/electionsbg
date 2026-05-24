# Code Review Report

**Date**: 2026-05-24
**Reviewed by**: AI Code Review Skill (high effort)
**Project**: electionsbg
**Scope**: PR #3 — commit `7a81f27a6` "ux: unify governments + indicators around a global cabinet anchor"

## Executive Summary

Overall code health: ⚠️ **Needs Attention** (one critical HTML bug, a handful of warnings, mostly cleanup suggestions otherwise)

The PR successfully ships all five planned phases: global cabinet anchor, header pill, cabinet-detail route, verdict chips + term-delta footers, hover-aware bands + hero chart, and small-multiples WGI radar. The architecture is sound — the `CabinetAnchorProvider` lift is genuinely clean, the URL-state design is shareable, and the context override flows transparently through existing `useElectionAsOf` / `useElectionYear` hooks. New components have good top-of-file documentation and follow project conventions (no tabs, `MpAvatar` for portraits, no max-width cap on the dashboard layout).

The **one critical issue** is invalid nested `<Link>` elements in `KpiTile.tsx` — the new anchor-aware footer is wrapped inside the existing outer tile-link, producing nested `<a>` tags. Browsers will silently break the inner link, so the "Под [Cabinet]" footer never actually navigates to the detail page. Easy fix (swap the inner Link for a `<button onClick={navigate}>` or restructure the tile to put the footer outside the outer anchor).

Other notable misses: the **detail page chart isn't actually zoomed** to the cabinet's term despite the screen claiming it is (xDomain is computed but unused), and the **18 new `/governments/:slug` pages are not in the prerender list** (SEO regression — search engines won't index them). Both fixable in a follow-up.

The `/indicators` landing screen has a UX inconsistency: its multi-select cabinet cards don't follow the URL anchor, so an anchored cabinet from `/compare` shows highlighted in the strip but a different cabinet's card shows below. Solvable by re-defaulting the multi-select to include the anchor.

**Quick Stats**:
- Files reviewed: 20 (7 new, 12 modified, 1 deleted)
- Critical issues: 1
- Warnings: 6
- Suggestions: 9
- Duplications: 2
- Testing gaps: out-of-scope (project has no test infra per CLAUDE.md)
- Documentation gaps: 3

---

## 🔴 Critical Findings

### [FINDING-001] Nested `<Link>` in KpiTile produces invalid HTML

- **File(s)**: `src/screens/components/macro/KpiTile.tsx` (lines 152–166 inside `lines 175–236`)
- **Category**: Bug / HTML validity
- **Problem**: The whole tile is wrapped in `<Link to={href}>` (line 175). The new `anchorFooter` IIFE (line 138) renders another `<Link>` *inside* that outer link (line 153). HTML5 forbids nested `<a>` elements; the React Router `Link` component resolves to an `<a>`. Browsers will reject the inner anchor at parse time, so the footer text renders but **clicking it does not navigate to `/governments/{id}#kpi-{indicator}`** — it falls through to the outer tile's domain-page link instead. `e.stopPropagation()` (line 155) prevents React's synthetic bubble but cannot fix the invalid DOM.
- **Suggestion**: Restructure so the footer is not nested. Two clean options:

  **Option A** — make the footer a button that calls `navigate()`:

  ```tsx
  import { useNavigate } from "react-router-dom";
  // …
  const navigate = useNavigate();
  // …
  <button
    type="button"
    onClick={(e) => {
      e.preventDefault();
      e.stopPropagation();
      navigate(
        `/governments/${encodeURIComponent(anchor.cabinet.id)}#kpi-${indicatorKey}`,
      );
    }}
    className="block w-full text-left text-[10px] tabular-nums text-muted-foreground hover:text-foreground hover:underline"
  >
    {t("kpi_under_cabinet", { … })}
  </button>
  ```

  **Option B** — drop the outer `<Link>` wrapper, render the tile as a `<div>`, and put the title row inside a normal `<Link>` so only the top of the tile is the primary navigation target. The footer can then be its own `<Link>`. This is a bigger refactor but yields cleaner semantics.

  Either fix takes <30 minutes. The current code may also fail Lighthouse / HTML-validator runs.

---

## 🟡 Warnings

### [FINDING-002] GovernmentDetailScreen advertises term-zoom but renders full timeline

- **File(s)**: `src/screens/GovernmentDetailScreen.tsx` (lines 56–62, 258, 308–311)
- **Category**: Bug / Feature incomplete
- **Problem**: `termDomain()` (lines 56–62) computes a zoomed x-domain (`term ± padding`) and the screen explicitly says *"GDP growth, inflation (HICP) and unemployment in a ±1y window around the term"* in `cabinet_detail_chart_explainer`. But `GovernmentTimeline` doesn't accept an `xDomain` prop — it always derives one from `xDomainFor(governments)`, i.e. 2005 → now. The computed `xDomain` is dropped into a `<span className="sr-only">{xDomain.join(",")}</span>` (line 310) purely to satisfy the linter. **The chart renders the full 21-year span on every cabinet detail page.** Term-only event markers do work (good), but the visual zoom is missing.
- **Suggestion**: Either:
  1. Extend `GovernmentTimeline` with an optional `xDomain?: [number, number]` prop and thread it through to the Recharts `XAxis domain={xDomain ?? xDomainFor(governments)}`. ~15 lines.
  2. Remove the `xDomain` calc + sr-only hack and soften the screen explainer copy to *"…over the cabinet's coloured band on the full 2005–present timeline"*.

  Option 1 matches the original plan and what the screen promises. Drop the dead code regardless.

### [FINDING-003] New `/governments/:slug` pages not prerendered (SEO regression)

- **File(s)**: `scripts/prerender/routes.ts` (no change made)
- **Category**: SEO / Build pipeline
- **Problem**: The prerender output line from the build shows `49942 routes (54 static + 49888 dynamic + 27389 English mirrors)` — exactly the same as before this PR. The 18 new cabinet detail pages are **not** in the prerender list, so search engines crawling `electionsbg.com/governments/borisov-3` see only the SPA shell with no SEO content. The CLAUDE.md memory pinned `[SEO needs prerendered HTML]` explicitly for this reason. The plan also called for sitemap + prerender updates and they didn't land.
- **Suggestion**: Add a `staticPage`-style entry per cabinet in `scripts/prerender/routes.ts`. 18 cabinets × 2 locales = 36 routes; well under the Firebase deploy ceiling. Use `useGovernments` data shape to generate them dynamically:

  ```ts
  // scripts/prerender/routes.ts
  import governmentsData from "../../data/governments.json";

  ...governmentsData.governments.map((g) =>
    staticPage({
      path: `governments/${g.id}`,
      title: `Кабинет ${g.pmBg} — електронbg.com`,
      description: `Профил на мандата: ...`,
      breadcrumbName: g.pmBg,
      bodyHtml: `<h1>Кабинет ${g.pmBg}</h1>...`,
      english: { title: `${g.pmEn} cabinet`, ... },
    })
  )
  ```

### [FINDING-004] `/indicators` landing multi-select decoupled from URL anchor

- **File(s)**: `src/screens/indicators/IndicatorsLandingScreen.tsx` (lines 134–162)
- **Category**: UX inconsistency
- **Problem**: When the user arrives on `/indicators?cabinet=denkov` from `/compare` or the header pill, the strip correctly highlights `denkov` in amber (the new `anchoredId` visual). But the `selectedCabinetIds` state still defaults to `[defaultCabinetId]` (= the cabinet matching the election date), so the bottom `CabinetScoreDetail` cards show the *election-default* cabinet, not the anchored one. KpiTile footers correctly read the anchor. Result: three different "selected" semantics on one screen pointing at two different cabinets.
- **Suggestion**: Seed `selectedCabinetIds` with the anchor's cabinet id when an anchor is set on first mount. Roughly:

  ```ts
  const initialSelection = useMemo<string[]>(() => {
    if (anchor) return [anchor.cabinet.id];
    return defaultCabinetId ? [defaultCabinetId] : [];
  }, [anchor, defaultCabinetId]);

  useEffect(() => {
    if (userTouched) return;
    setSelectedCabinetIds(initialSelection);
  }, [initialSelection, userTouched]);
  ```

### [FINDING-005] Small-multiples mini-radars have no tooltip

- **File(s)**: `src/screens/components/euCompare/EuCompareWgiSmallMultiples.tsx` (lines 56–123)
- **Category**: Regression vs. previous UX
- **Problem**: The replaced `EuCompareWgiRadar` had a custom `WgiTooltip` that showed exact per-country values sorted descending with flag chips. The new mini-radars in the small-multiples grid have **no `<Tooltip>` at all** — hovering shows nothing. With six WGI axes per panel and three polygons stacked, the reader can eyeball relative shape but cannot read exact values. This is an accessibility regression.
- **Suggestion**: Add a minimal Recharts `<Tooltip>` per panel showing the three values (BG, peer, EU27) for the hovered axis. Can mostly reuse the `WgiTooltip` component from the old radar — just filter the payload to the three series in scope per panel.

### [FINDING-006] VerdictChip claims "near average" when there is no underlying data

- **File(s)**: `src/screens/components/macro/VerdictChip.tsx` (lines 35–56)
- **Category**: Misleading UI
- **Problem**: When `direction !== "none"` but both `rank` and `yoyDelta` are unavailable, `deriveVerdict` falls through to `return "neutral"` — which renders a chip labelled *"близо до средното"* / *"near EU average"*. The chip is making a positive factual claim ("we are near the EU average") with zero supporting evidence. For an indicator like `consumerConfidence` (not peer-eligible, no YoY at series start) this triggers immediately on stale tiles.
- **Suggestion**: Return `"none"` (which already hides the chip) when both inputs are missing:

  ```ts
  if (rank) { ... }
  if (yoyDelta == null) return "none"; // was: "neutral"
  ```

  Or split "neutral with rank evidence" from "no evidence at all" into separate verdicts.

### [FINDING-007] Invalid-slug redirect flashes empty Title before bouncing

- **File(s)**: `src/screens/GovernmentDetailScreen.tsx` (lines 233–238, 249–255)
- **Category**: UX polish / Loading state
- **Problem**: When the user lands on `/governments/typo`, the redirect `useEffect` fires only after `governments` loads. Between paint 1 (governments null → early return shows just `<Title>`) and paint 3 (after redirect), there's a brief flash of an empty page with a generic title. Same applies to deliberately-crafted bad URLs.
- **Suggestion**: Show a small 404-style message instead of the bare Title when `governments` is loaded but `government` is null and the redirect is pending:

  ```tsx
  if (governments && !government) {
    return (
      <div className="pb-12">
        <Title>{t("cabinet_detail_not_found_title")}</Title>
        <p className="text-sm text-muted-foreground">
          {t("cabinet_detail_not_found_explainer")}
        </p>
      </div>
    );
  }
  if (!governments) {
    return <div className="pb-12"><Title>{t("governments_title")}</Title></div>;
  }
  ```

  Even better: keep the redirect but show a one-line "Cabinet not found — redirecting" message in the interim.

---

## 🟢 Suggestions

### [FINDING-008] EU milestone array duplicated three times

- **File(s)**:
  - `src/screens/GovernmentsScreen.tsx` (lines 42–74 — `eventMarkers` useMemo)
  - `src/screens/indicators/IndicatorsLandingScreen.tsx` (lines 83–113 — `heroEvents` useMemo)
  - `src/screens/GovernmentDetailScreen.tsx` (lines 67–95 — `useEuMilestones` hook)
- **Category**: DRY / Maintainability
- **Problem**: The same six EU integration events (accession, ERM2, Schengen air, Schengen land, convergence report, eurozone) are redefined in three places. Adding a 7th event (e.g. an OECD accession milestone) means touching all three files; any divergence creates inconsistent timelines across screens.
- **Suggestion**: Extract `useEuMilestones` (already a clean hook in the detail screen) into a shared module at `src/data/macro/useEuMilestones.ts` (or `src/screens/components/governments/euMilestones.ts`). Import it from all three screens. ~20 lines net reduction.

### [FINDING-009] Default-cabinet-from-election logic duplicated

- **File(s)**:
  - `src/screens/indicators/IndicatorsLandingScreen.tsx` (lines 134–157)
  - `src/screens/indicators/IndicatorsCompareScreen.tsx` (lines 78–88)
- **Category**: DRY
- **Problem**: Both screens compute "the cabinet whose tenure contains the selected election date" with subtly different fallback logic (Landing falls back to nearest cabinet by start delta; Compare falls back to last cabinet). The divergence is probably not intentional.
- **Suggestion**: Extract `useDefaultCabinetForElection()` hook returning `string | null`. Pick one fallback rule and use it everywhere.

### [FINDING-010] Detail page lacks a CabinetStrip for quick switching

- **File(s)**: `src/screens/GovernmentDetailScreen.tsx`
- **Category**: UX completeness
- **Problem**: Once on `/governments/borisov-3`, switching to look at `denkov` requires either using the header pill popover (which is a dropdown, not a strip) or navigating back to `/governments`. Adding a `CabinetStrip` with `anchoredId={government.id}` and `onAnchor={(id) => navigate(\`/governments/${id}\`)}` near the top would give one-click switching plus visual orientation.
- **Suggestion**: Wire it after the breadcrumb, before the Title:

  ```tsx
  {governments && xDomain ? (
    <section className="mb-3">
      <CabinetStrip
        governments={governments}
        xDomain={xDomainFor(governments)}
        lang={lang}
        mobileScrollable
        fullWidth
        anchoredId={government.id}
        onAnchor={(id) => navigate(`/governments/${encodeURIComponent(id)}`)}
      />
    </section>
  ) : null}
  ```

### [FINDING-011] KpiTile top-of-file comment is now outdated

- **File(s)**: `src/screens/components/macro/KpiTile.tsx` (lines 1–5)
- **Category**: Documentation drift
- **Problem**: The comment still describes the pre-PR behavior: "renders the indicator's name, the latest value..., an EU27 rank badge..., a YoY arrow, a cabinet-shaded sparkline, and a source/period footer". Missing: the new verdict chip, the new anchor-aware footer.
- **Suggestion**: Update the comment to describe the current behavior including the verdict chip + the anchor-aware "Под [Cabinet]" footer that drills to `/governments/{slug}#kpi-{indicator}`.

### [FINDING-012] Inconsistent minimum-points thresholds for sparklines

- **File(s)**:
  - `src/screens/components/macro/KpiTile.tsx` (line 32 — `SPARKLINE_MIN_POINTS = 4`)
  - `src/screens/components/macro/CabinetKpiTile.tsx` (line 142 — `windowPoints.length >= 2`)
- **Category**: Inconsistency
- **Problem**: KpiTile requires 4 points before showing a sparkline; CabinetKpiTile only requires 2. The rationale isn't documented. For very short caretaker tenures (Bliznashki ~3 months), 2 points might be the maximum available, but the visual ends up reading as a tiny segment of two dots.
- **Suggestion**: Use the same constant or document why they differ. Probably `>= 3` for both is a better floor.

### [FINDING-013] Dead `xDomain` + `Government` import in detail screen

- **File(s)**: `src/screens/GovernmentDetailScreen.tsx` (lines 256, 258, 308–311)
- **Category**: Dead code
- **Problem**: Connected to [FINDING-002]. The `xDomain = termDomain(government)` calc and the `sr-only` span exist only to suppress an unused-variable lint warning. The plan was to use them for chart zoom; that never landed.
- **Suggestion**: When [FINDING-002] is fixed (chart actually zoomed), the calc + import become live. Until then, remove both and the sr-only span.

### [FINDING-014] CabinetAnchorPill body button has no aria-label

- **File(s)**: `src/layout/header/CabinetAnchorPill.tsx` (lines 47–66)
- **Category**: Accessibility nice-to-have
- **Problem**: The pill body button has visible text ("Анкер · Денков") which is fine for sighted users and screen readers using accessible name from content. But it does navigate to a different page, which the visible text alone doesn't communicate. Screen readers will announce it as "button" without indicating "navigate to cabinet detail".
- **Suggestion**: Either add `aria-label={t("cabinet_anchor_pill_aria", { name: surname })}` resolving to e.g. *"Open Денков cabinet detail"*, or change the button to a `<Link>` (which makes the navigation semantics explicit).

### [FINDING-015] Persistent multi-select even when underlying election changes

- **File(s)**: `src/screens/indicators/IndicatorsLandingScreen.tsx` (lines 159–162)
- **Category**: UX edge case
- **Problem**: `userTouched` stays `true` for the page-lifetime once any pill is clicked. If the user then changes the election in the header, the strip pills auto-update via the new `defaultCabinetId` derivation — but `selectedCabinetIds` is frozen at whatever the user picked. Probably intentional ("respect user's manual selection"), but worth a sanity check: changing election while a "stale" cabinet is selected could leave the bottom cards in an unexpected state. No fix needed; just verify the behavior aligns with intent.

### [FINDING-016] CabinetStrip click ALWAYS calls both handlers

- **File(s)**: `src/screens/components/governments/GovernmentTimeline.tsx` (around the new `handleClick` helper)
- **Category**: Tiny semantic clarification
- **Problem**: `handleClick` calls `onToggle?.(id)` then `onAnchor?.(id)` unconditionally. On `/indicators` and `/governments`, clicking a multi-selected pill calls `onToggle` (which REMOVES it from selection) but ALSO calls `onAnchor` (which SETS it as the anchor). Net effect: removing a cabinet from the comparison stack still anchors it. Probably not what the user wants — if I'm explicitly de-selecting, I likely don't want it to become the focus.
- **Suggestion**: Only set the anchor when the click *adds* to selection, not when it removes. Would need to plumb the "was it added or removed" signal into the click handler, or change `onToggle` to return the new state.

  Alternative: leave as-is and just document the behavior. The amber ring stays on a non-selected pill which is visually weird but technically consistent with "anchor is most-recently-clicked".

---

## 🔁 Duplication Report

### [DUP-001] EU milestone definitions

See [FINDING-008] above. Three definitions, identical contents.

### [DUP-002] "Pick cabinet from election date" derivations

See [FINDING-009] above. Two derivations, divergent fallbacks.

---

## 🧪 Testing Gaps

The project has no test infrastructure (per `CLAUDE.md`: *"There are no tests configured."*), so this section is informational only — adding tests is out of scope for this PR. If tests are ever added:

- `cabinetAnchorContext.tsx`: `anchorForCabinet` is a pure function with branches for incumbent vs. finished cabinet — easy unit test target.
- `VerdictChip.tsx`: `deriveVerdict` is pure with 4 distinct branches (good/concern/neutral/none × rank-present vs. rank-absent). Currently has the bug from [FINDING-006] that a test would catch immediately.
- `CabinetKpiTile.tsx` `cabinetWindowAnchors`: quarter-of-year derivation has edge cases at month boundaries (e.g. April = Q2, December = Q4).

---

## 📚 Documentation Gaps

### [DOC-001] KpiTile header comment outdated

See [FINDING-011].

### [DOC-002] CabinetAnchorProvider URL contract not documented in CLAUDE.md

- **File**: `CLAUDE.md`
- **Problem**: The new `?cabinet=<id>` URL parameter is now a first-class part of the app's URL contract on `/governments` and `/indicators` routes. It belongs in the project memory alongside `?elections=YYYY_MM_DD` and `?peers=RO,GR,…`.
- **Suggestion**: Add a one-liner to CLAUDE.md's URL/state section (or create one) noting:
  > `?cabinet=<id>` — global cabinet anchor on `/governments*` and `/indicators*` routes. Re-anchors every quarterly/annual snapshot to the cabinet's tenure-end. Provider in `src/data/macro/cabinetAnchorContext.tsx`.

### [DOC-003] Auto-anchor side effect on detail page is non-obvious

- **File**: `src/screens/GovernmentDetailScreen.tsx` (lines 221–229)
- **Problem**: Visiting `/governments/borisov-3` writes `?cabinet=borisov-3` to the URL automatically. This means: navigating away to e.g. `/indicators` *carries the anchor*. That's intentional but surprising. The inline comment explains the mechanism but not the cross-page consequence.
- **Suggestion**: Extend the comment:
  > "...so the header pill and every downstream snapshot tile re-anchor consistently. Side effect: the anchor persists when the user navigates away to /indicators, /indicators/compare, or any other governance route — clearing requires the header pill ×."

---

## 🏆 Top 3 Priority Fixes

1. **[FINDING-001]** — Nested `<Link>` in `KpiTile`. Fix first because it silently breaks a documented user flow (footer drill-in). 15–30 min, no design decisions.
2. **[FINDING-003]** — Add cabinet detail pages to the prerender pipeline. SEO regression on 18 new pages (× 2 locales). 30–60 min; uses existing `staticPage` helper pattern.
3. **[FINDING-002]** — Either make the chart actually zoom to the term or soften the screen explainer copy. Lying-by-omission on a flagship "world-class" feature. 30 min for option-1, 5 min for option-2.

---

## Summary Table

| Priority | Finding | File(s) | Category | Effort |
| --- | --- | --- | --- | --- |
| 🔴 P0 | [FINDING-001] Nested `<Link>` in KpiTile | `KpiTile.tsx` | Bug / HTML | Low |
| 🟡 P1 | [FINDING-002] Detail chart not actually zoomed | `GovernmentDetailScreen.tsx` | Bug / Incomplete | Low |
| 🟡 P1 | [FINDING-003] Cabinet detail pages not prerendered | `scripts/prerender/routes.ts` | SEO | Med |
| 🟡 P1 | [FINDING-004] Landing multi-select decoupled from anchor | `IndicatorsLandingScreen.tsx` | UX | Low |
| 🟡 P1 | [FINDING-005] Mini-radars have no tooltip | `EuCompareWgiSmallMultiples.tsx` | Regression | Low |
| 🟡 P1 | [FINDING-006] Verdict claims "near average" with no data | `VerdictChip.tsx` | UI claim | Low |
| 🟡 P1 | [FINDING-007] Invalid-slug flash before redirect | `GovernmentDetailScreen.tsx` | UX polish | Low |
| 🟢 P2 | [FINDING-008] EU milestone array duplicated 3× | 3 screens | DRY | Low |
| 🟢 P2 | [FINDING-009] Default-cabinet logic duplicated | 2 screens | DRY | Low |
| 🟢 P2 | [FINDING-010] No CabinetStrip on detail page | `GovernmentDetailScreen.tsx` | UX | Low |
| 🟢 P2 | [FINDING-011] KpiTile comment outdated | `KpiTile.tsx` | Docs | Low |
| 🟢 P2 | [FINDING-012] Sparkline min-points inconsistent | KpiTile + CabinetKpiTile | Inconsistency | Low |
| 🟢 P2 | [FINDING-013] Dead xDomain calc | `GovernmentDetailScreen.tsx` | Cleanup | Low |
| 🟢 P2 | [FINDING-014] Anchor-pill body button needs aria-label | `CabinetAnchorPill.tsx` | a11y | Low |
| 🟢 P2 | [FINDING-015] userTouched + election-change interaction | `IndicatorsLandingScreen.tsx` | Edge case | Low |
| 🟢 P2 | [FINDING-016] Click always anchors, even on de-select | `GovernmentTimeline.tsx` | Semantics | Low |
| 🟢 P2 | [DOC-002] CLAUDE.md missing cabinet URL contract | `CLAUDE.md` | Docs | Low |
| 🟢 P2 | [DOC-003] Auto-anchor cross-page consequence unmentioned | `GovernmentDetailScreen.tsx` | Docs | Low |
