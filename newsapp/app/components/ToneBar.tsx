// The distribution of tones for one subject (a party or a person), with a TEXT label beside every
// colour and the count beside every label. ⚠️ It draws the distribution and
// nothing else: no average, no score, no ordering by favourability.

import type { Tone } from "../data";
import { toneMeta } from "../labels";
import { useNewsLocale } from "../i18n";

const ORDER: Tone[] = ["favorable", "neutral", "unfavorable", "mixed"];

// The bar's fill per tone. `TONE_META.className` is a TEXT colour (it labels
// a chip elsewhere); a bar needs a background, and the two must stay the
// same hue, so they are derived from the same token names.
const FILL: Record<Tone, string> = {
  favorable: "bg-positive",
  neutral: "bg-muted-foreground",
  unfavorable: "bg-negative",
  mixed: "bg-foreground",
};

export const ToneBar = ({
  counts,
  total,
}: {
  counts: Partial<Record<Tone, number>>;
  total: number;
}) => {
  const { language, tr } = useNewsLocale();
  const segments = ORDER.map((tone) => ({ tone, n: counts[tone] ?? 0 })).filter(
    (s) => s.n > 0,
  );
  if (!total || segments.length === 0) {
    return (
      <p className="mt-1 text-xs text-muted-foreground">
        {tr("Няма публикувани оценки.", "No published assessments.")}
      </p>
    );
  }
  return (
    <div className="mt-1.5">
      <div
        className="flex h-2 overflow-hidden rounded-full"
        role="presentation"
      >
        {segments.map((s) => (
          <span
            key={s.tone}
            className={`block h-full ${FILL[s.tone]}`}
            style={{ width: `${(s.n / total) * 100}%` }}
          />
        ))}
      </div>
      <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        {segments.map((s) => (
          <li key={s.tone}>
            <span
              aria-hidden
              className={`mr-1 inline-block size-2 rounded-sm align-middle ${FILL[s.tone]}`}
            />
            {toneMeta(s.tone, language)?.label ?? s.tone} {s.n}
          </li>
        ))}
      </ul>
    </div>
  );
};
