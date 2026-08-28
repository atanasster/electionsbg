// Pill badges for the analysis scales. Hue coding rides on a color dot, a
// 30%-alpha border tint and an 8%-alpha background wash (labels.ts guarantees
// 6-digit hex); the text stays in the theme's foreground color so light-theme
// contrast (e.g. slate on cream) can't drop below WCAG AA.

import { Badge } from "@/components/ui/badge";
import {
  AI_META,
  LEANING_META,
  QUALITY_META,
  RUSSIA_META,
  TONE_META,
} from "../labels";
import type {
  AiVerdict,
  Leaning,
  QualityVerdict,
  RussiaStance,
  Tone,
} from "../data";

const MetaBadge = ({
  value,
  meta,
  titlePrefix,
  short = true,
}: {
  value: string | null | undefined;
  meta: Record<string, { label: string; short: string; color: string }>;
  titlePrefix: string;
  short?: boolean;
}) => {
  if (!value) return null;
  const m = meta[value];
  if (!m) return null;
  return (
    <Badge
      variant="outline"
      title={`${titlePrefix}: ${m.label}`}
      aria-label={`${titlePrefix}: ${m.label}`}
      className="news-analysis-badge"
      style={{
        borderColor: `${m.color}4d`,
        backgroundColor: `${m.color}14`,
      }}
    >
      <span
        aria-hidden
        className="mr-1 inline-block size-2 shrink-0 rounded-full"
        style={{ backgroundColor: m.color }}
      />
      {short ? m.short : m.label}
    </Badge>
  );
};

export const LeanBadge = ({
  leaning,
  short,
}: {
  leaning: Leaning | null | undefined;
  short?: boolean;
}) => (
  <MetaBadge
    value={leaning}
    meta={LEANING_META}
    titlePrefix="Политическо рамкиране на материала"
    short={short}
  />
);

export const StanceBadge = ({
  stance,
  short,
}: {
  stance: RussiaStance | null | undefined;
  short?: boolean;
}) => (
  <MetaBadge
    value={stance}
    meta={RUSSIA_META}
    titlePrefix="Позиция на материала спрямо Русия"
    short={short}
  />
);

export const AiBadge = ({
  verdict,
}: {
  verdict: AiVerdict | null | undefined;
}) => {
  if (!verdict || !(verdict in AI_META)) return null;
  const meta = AI_META[verdict];
  return (
    <Badge
      variant="outline"
      title={`Произход: ${meta.label}`}
      className={meta.className}
    >
      {meta.short}
    </Badge>
  );
};

export const QualityBadge = ({
  verdict,
}: {
  verdict: QualityVerdict | null | undefined;
}) => {
  if (!verdict || !(verdict in QUALITY_META)) return null;
  const meta = QUALITY_META[verdict];
  return (
    <Badge
      variant="outline"
      title={`Качество: ${meta.label}`}
      className="text-muted-foreground"
    >
      {meta.short}
    </Badge>
  );
};

export const ToneBadge = ({ tone }: { tone: Tone | null | undefined }) => {
  if (!tone || !(tone in TONE_META)) return null;
  const meta = TONE_META[tone];
  return (
    <span className={`text-xs font-medium ${meta.className}`}>
      {meta.label}
    </span>
  );
};
