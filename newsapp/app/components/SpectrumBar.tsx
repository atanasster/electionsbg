// Static stacked spectrum bar for cards and listings (the interactive,
// click-to-filter version on the story page is the shared src/ux/MixBar).
// Segments render in the fixed left→right order from labels.ts; zero-count
// segments are omitted except when the whole distribution is empty, which
// renders a muted placeholder strip so card rows stay aligned.

import {
  LEANING_META,
  LEANING_ORDER,
  RUSSIA_META,
  RUSSIA_ORDER,
} from "../labels";
import type { Leaning, RussiaStance } from "../data";

type LeanCounts = Partial<Record<Leaning, number>>;
type StanceCounts = Partial<Record<RussiaStance, number>>;

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

export const LeanSpectrum = ({ counts }: { counts: LeanCounts }) => (
  <Segments
    empty="няма анализирани източници"
    segments={LEANING_ORDER.map((k) => ({
      key: k,
      label: LEANING_META[k].label,
      count: counts[k] ?? 0,
      color: LEANING_META[k].color,
    }))}
  />
);

export const StanceSpectrum = ({ counts }: { counts: StanceCounts }) => (
  <Segments
    empty="няма анализирани източници"
    segments={RUSSIA_ORDER.map((k) => ({
      key: k,
      label: RUSSIA_META[k].label,
      count: counts[k] ?? 0,
      color: RUSSIA_META[k].color,
    }))}
  />
);
