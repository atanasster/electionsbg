// Shared building blocks for the /indicators/* domain pages — split out so
// each sub-screen file stays focused on its section layout.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { formatPeriod } from "@/screens/components/macro/formatPeriod";
import { IndicatorsNav } from "./indicatorsNav";
import { CompareToggleButton } from "@/screens/components/macro/CompareToggleButton";

export type ChartSource = { href: string; label: string };

/**
 * The furniture above the first chart on every /indicators/* page.
 *
 * This exists as ONE component because each of those screens renders it twice —
 * once in its `if (!governments)` loading return and once in the loaded page.
 * They were not identical: the loading return rendered a bare `<Title>` with no
 * description, no nav and no toggle, so the whole top of the page was replaced
 * when governments.json arrived.
 *
 * That swap was NOT the page's layout shift, and the distinction is worth
 * keeping: at that moment the body below was still empty, so nothing had a
 * position to move from. /indicators/economy's CLS of 0.1536 came from the
 * charts collapsing to a line of text until macro.json landed — see the
 * reserved-height branch in GovernmentTimeline. This component is a
 * consolidation, not that fix.
 *
 * Nothing here depends on fetched data — the title and description are
 * translation keys, the nav is static, and `useCompareToggle` is URL/local
 * state — which is why the loading state can render the real thing rather than
 * a placeholder sized to approximate it. Content that arrives later is appended
 * BELOW this block, and appending below shifts nothing above.
 *
 * Keep it that way: giving this component a data-dependent prop would reopen
 * the defect by making the two renders diverge again.
 */
export const IndicatorsPageHeader: FC<{
  title: string;
  description: string;
  // Omitted by /indicators/governance, which has no EU comparison to toggle.
  compare?: { enabled: boolean; onToggle: () => void };
}> = ({ title, description, compare }) => (
  <>
    <Title description={description}>{title}</Title>

    <IndicatorsNav />

    {compare ? (
      <div className="mb-4 flex justify-end">
        <CompareToggleButton
          enabled={compare.enabled}
          onToggle={compare.onToggle}
        />
      </div>
    ) : null}
  </>
);

export const ChartSources: FC<{
  sources: ChartSource[];
  prefix: string;
}> = ({ sources, prefix }) => (
  <p className="text-[11px] text-muted-foreground mb-3">
    {prefix}{" "}
    {sources.map((s, i) => (
      <span key={s.href}>
        {i > 0 ? " · " : null}
        <a
          href={s.href}
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          {s.label}
        </a>
      </span>
    ))}
  </p>
);

/**
 * „последна точка: 2 тр. 2026" under a section a KPI links into.
 *
 * ⚠️ IT EXISTS BECAUSE THE ARRIVAL HAS TO CONFIRM THE FIGURE, NOT JUST GET NEAR IT. The home
 * head states a very specific observation — value, comparison, adjustment AND period — and a
 * reader who clicks „+4,4% ХИПЦ, юли 2026" lands next to a QUARTERLY line whose newest point is
 * 5,83% for 2026-Q2. Both numbers are true and they are 1.4 points apart; without the period
 * stated on arrival the reader has no way to know they are looking at a different frequency.
 *
 * ⚠️ DERIVED FROM THE SERIES THE SECTION ITSELF PLOTS, never from anything the link carried. A
 * figure passed through a URL is a claim the destination did not compute: on a stale home
 * artifact the page would render a number it contradicts one chart lower. The destination
 * states its own period, and agreement is then something a reader can check rather than
 * something we assert.
 */
export const SectionAsOf: FC<{
  /** The raw source period („2026-Q2" / „2026-07"), from the plotted series. */
  period: string | undefined;
  year: number | undefined;
  quarter: 1 | 2 | 3 | 4 | undefined;
  lang: "bg" | "en";
}> = ({ period, year, quarter, lang }) => {
  const { t } = useTranslation();
  // No point, no claim — a section whose series has not loaded says nothing rather than
  // rendering an empty „последна точка:".
  if (!period && year === undefined) return null;
  return (
    <p className="text-xs text-muted-foreground mb-3">
      {t("indicators_section_as_of", {
        period: formatPeriod(period, year ?? 0, quarter, lang),
      })}
    </p>
  );
};
