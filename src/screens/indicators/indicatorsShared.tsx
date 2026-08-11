// Shared building blocks for the /indicators/* domain pages — split out so
// each sub-screen file stays focused on its section layout.

import { FC } from "react";
import { Title } from "@/ux/Title";
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
