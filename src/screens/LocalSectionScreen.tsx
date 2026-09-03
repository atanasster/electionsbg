// Per-polling-station (section) local-elections page.
// Route: /local/:cycle/:obshtinaCode/section/:sectionCode
//
// Local section data is council-only (the per-station mayor ballot isn't in the
// ingested bundle), so this is a focused page: turnout + the full council
// party-vote breakdown for one station. No parliamentary cross-link — section
// numbering isn't stable across local↔parliamentary cycles, so the same code
// wouldn't reliably resolve to the matching parliamentary station.

import { FC } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useLocalSection } from "@/data/local/useLocalSection";
import { friendlyCycleDate } from "@/data/local/cycleDate";
import { PlaceHeader } from "@/screens/components/PlaceHeader";
import { ElectionSurfaceBoundary } from "@/screens/elections/ElectionSurfaceBoundary";
import { ElectionResultsShell } from "@/screens/elections/ElectionResultsShell";
import { ElectionScopeBar } from "@/screens/elections/ElectionScopeBar";
import { ElectionSurfaceSkeleton } from "@/screens/elections/ElectionSurfaceSkeleton";

export const LocalSectionScreen: FC = () => {
  const { cycle, obshtinaCode, sectionCode } = useParams<{
    cycle: string;
    obshtinaCode: string;
    sectionCode: string;
  }>();
  const { t } = useTranslation();
  // The per-station detail file carries this one section's full breakdown — a
  // tiny fetch, not the whole município shard.
  const { detail, isLoading } = useLocalSection(
    obshtinaCode,
    sectionCode,
    cycle,
  );

  if (!cycle || !obshtinaCode || !sectionCode) return null;

  const section = detail?.section;
  // The local section bundle stores EKATTE with leading zeros stripped
  // ("151"), but settlements.json — and every other view's URL — keys on the
  // 5-digit padded form ("00151"). Pad it so the breadcrumb resolves the parent
  // settlement (and its município) and the up-links land on real pages.
  const ekatte = section?.ekatte
    ? section.ekatte.includes("-")
      ? section.ekatte
      : section.ekatte.padStart(5, "0")
    : undefined;

  const header = (
    <PlaceHeader
      active="local"
      level="section"
      sectionCode={sectionCode}
      ekatte={ekatte}
      obshtina={obshtinaCode}
      cycle={cycle}
      eyebrowTo={`/local/${cycle}`}
      eyebrowSuffix={friendlyCycleDate(cycle)}
      extra={
        section?.isMobile ? (
          <span className="inline-flex rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            {t("local_sections_mobile_badge")}
          </span>
        ) : undefined
      }
      className="mb-4"
      // ⚠ THE STATUS ONLY, by design rather than by omission. The eyebrow already states this
      // cycle's date through `friendlyCycleDate` — the local tree's own convention — so a second
      // date here would be the duplication §4 rules out. `ElectionScopeBar` prints nothing for a
      // cycle it cannot parse as a date, and a local folder id (`2023_10_29_mi`) is exactly
      // that; the alternative — `formatDate` passing an unparseable string through VERBATIM —
      // is the folder-id-as-label defect.
      scope={<ElectionScopeBar cycle={cycle} status="final" />}
    />
  );

  if (!isLoading && !section) {
    return (
      <section className="my-4">
        {header}
        <p className="text-sm text-muted-foreground">
          {t("local_section_not_found")}
        </p>
      </section>
    );
  }

  return (
    <section className="my-4">
      {header}

      {/* ⚠ THE SHELL REPLACES THE STAT HEADER AND THE COUNCIL BARS, which is everything this
          page had. It is council-only by construction — the per-station mayor ballot is not in
          the ingested bundle — so §Phase 6 item 4's "separate compact panels … only when each
          vote array/denominator exists" resolves to ONE panel here, and item 5's "do not infer
          zeros for absent arrays" is satisfied by the mayor ballot simply not being emitted.

          ⚠ THE SURFACE IS EMBEDDED ON THE STATION FILE (§5.0), not fetched: its own file is
          6.1 KB against an 8 KiB budget, and there are 24,443 of them — a second artifact would
          be a second fetch of the same bytes at the object count §5.0 exists to refuse.

          ⚠ NO DIGEST AND NO MAP, for the two reasons the parliamentary section has neither:
          three of the four views do not resolve at a polling station, and one station has no
          geography to answer a question about. */}
      <ElectionSurfaceBoundary
        kind="local"
        level="section"
        cycle={cycle}
        id={sectionCode}
        providedSurface={detail?.surface}
        skeleton={<ElectionSurfaceSkeleton facts={3} withMap={false} />}
        fallback={
          <p className="text-sm text-muted-foreground">{t("loading")}</p>
        }
      >
        {(surface) => (
          <ElectionResultsShell
            surface={surface}
            scope="header"
            currentView="local"
          />
        )}
      </ElectionSurfaceBoundary>
    </section>
  );
};
