// Static stacked spectrum bar for cards and listings (the interactive,
// click-to-filter version on the story page is the shared src/ux/MixBar).
// Segments render in the fixed left→right order from labels.ts; zero-count
// segments are omitted except when the whole distribution is empty, which
// renders a muted placeholder strip so card rows stay aligned.

import {
  LEANING_META,
  LEANING_META_EN,
  LEANING_ORDER,
  RUSSIA_META,
  RUSSIA_META_EN,
  RUSSIA_ORDER,
} from "../labels";
import type { Leaning, RussiaStance } from "../data";
import { useNewsLocale } from "../i18n";

type LeanCounts = Partial<Record<Leaning, number>>;
type StanceCounts = Partial<Record<RussiaStance, number>>;

// Text list of the non-zero entries of a distribution — the labeled companion
// to the bars above, for contexts where counts matter more than proportions.
export const SpectrumLegend = ({
  counts,
  labels,
}: {
  counts: Record<string, number>;
  labels: { [key: string]: { label: string; color: string } };
}) => {
  const entries = Object.entries(counts).filter(([, n]) => n > 0);
  if (!entries.length)
    return <p className="text-xs text-muted-foreground">—</p>;
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
      {entries
        .sort((a, b) => b[1] - a[1])
        .map(([key, n]) => (
          <span
            key={key}
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
          >
            <span
              aria-hidden
              className="inline-block size-2 rounded-sm"
              style={{ backgroundColor: labels[key]?.color ?? "#71717a" }}
            />
            {labels[key]?.label ?? key} · {n}
          </span>
        ))}
    </div>
  );
};

const Segments = ({
  segments,
  empty,
}: {
  segments: { key: string; label: string; count: number; color: string }[];
  empty: string;
}) => {
  const total = segments.reduce((s, x) => s + x.count, 0);
  if (!total) {
    return (
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-secondary">
        <span className="sr-only">{empty}</span>
      </div>
    );
  }
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full">
      {/* Counts are hover-only per segment; this line keeps them accessible to
          screen readers and touch (the interactive MixBar covers filtering). */}
      <span className="sr-only">
        {segments
          .filter((s) => s.count > 0)
          .map((s) => `${s.label}: ${s.count}`)
          .join(", ")}
      </span>
      {segments
        .filter((s) => s.count > 0)
        .map((s) => (
          <span
            key={s.key}
            title={`${s.label}: ${s.count}`}
            style={{
              width: `${(s.count / total) * 100}%`,
              backgroundColor: s.color,
            }}
          />
        ))}
    </div>
  );
};

export const LeanSpectrum = ({
  counts,
  emptyLabel,
}: {
  counts: LeanCounts;
  emptyLabel?: string;
}) => {
  const { isEnglish, tr } = useNewsLocale();
  const labels = isEnglish ? LEANING_META_EN : LEANING_META;
  return (
    <Segments
      empty={
        emptyLabel ?? tr("няма анализирани източници", "no analysed sources")
      }
      segments={LEANING_ORDER.map((k) => ({
        key: k,
        label: labels[k].label,
        count: counts[k] ?? 0,
        color: labels[k].color,
      }))}
    />
  );
};

export const StanceSpectrum = ({
  counts,
  emptyLabel,
}: {
  counts: StanceCounts;
  emptyLabel?: string;
}) => {
  const { isEnglish, tr } = useNewsLocale();
  const labels = isEnglish ? RUSSIA_META_EN : RUSSIA_META;
  return (
    <Segments
      empty={
        emptyLabel ?? tr("няма анализирани източници", "no analysed sources")
      }
      segments={RUSSIA_ORDER.map((k) => ({
        key: k,
        label: labels[k].label,
        count: counts[k] ?? 0,
        color: labels[k].color,
      }))}
    />
  );
};
