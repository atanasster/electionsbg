// Pill badges for the analysis scales. Hue coding rides on a color dot, a
// 30%-alpha border tint and an 8%-alpha background wash (labels.ts guarantees
// 6-digit hex); the text stays in the theme's foreground color so light-theme
// contrast (e.g. slate on cream) can't drop below WCAG AA.

import { Badge } from "@/components/ui/badge";
import {
  AI_META,
  aiMeta,
  LEANING_META,
  LEANING_META_EN,
  qualityMeta,
  RUSSIA_META,
  RUSSIA_META_EN,
  toneMeta,
} from "../labels";
import type {
  AiVerdict,
  Leaning,
  QualityVerdict,
  RussiaStance,
  Tone,
} from "../data";
import { useNewsLocale } from "../i18n";

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
}) => {
  const { isEnglish, tr } = useNewsLocale();
  return (
    <MetaBadge
      value={leaning}
      meta={isEnglish ? LEANING_META_EN : LEANING_META}
      titlePrefix={tr(
        "Политическо рамкиране на материала",
        "Political framing of the article",
      )}
      short={short}
    />
  );
};

export const StanceBadge = ({
  stance,
  short,
}: {
  stance: RussiaStance | null | undefined;
  short?: boolean;
}) => {
  const { isEnglish, tr } = useNewsLocale();
  return (
    <MetaBadge
      value={stance}
      meta={isEnglish ? RUSSIA_META_EN : RUSSIA_META}
      titlePrefix={tr(
        "Позиция на материала спрямо Русия",
        "Article position on Russia",
      )}
      short={short}
    />
  );
};

export const AiBadge = ({
  verdict,
}: {
  verdict: AiVerdict | null | undefined;
}) => {
  const { language, tr } = useNewsLocale();
  if (!verdict || !(verdict in AI_META)) return null;
  const meta = aiMeta(verdict, language);
  return (
    <Badge
      variant="outline"
      title={`${tr("Произход", "Origin")}: ${meta.label}`}
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
  const { language, tr } = useNewsLocale();
  if (!verdict) return null;
  const meta = qualityMeta(verdict, language);
  return (
    <Badge
      variant="outline"
      title={`${tr("Качество", "Quality")}: ${meta.label}`}
      className="text-muted-foreground"
    >
      {meta.short}
    </Badge>
  );
};

export const ToneBadge = ({ tone }: { tone: Tone | null | undefined }) => {
  const { language } = useNewsLocale();
  if (!tone) return null;
  const meta = toneMeta(tone, language);
  return (
    <span className={`text-xs font-medium ${meta.className}`}>
      {meta.label}
    </span>
  );
};
