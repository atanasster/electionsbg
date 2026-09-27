// „В медиите" — how the news outlets frame this person, summarised from the
// news site's person page (news-person-sentiment-v1 §8).
//
// ⚠️ IT DESCRIBES COVERAGE, NOT THE PERSON. The counts are the tone of the
// (outlet, story) units that name them, as Jev read the articles — never a
// verdict on the individual, and never a rank. So: no mean, no score, no
// comparison with anyone else, and the full distribution with its neutral
// majority rather than a single colour. The tile renders only when the news
// pipeline published a summary; a person without one gets no tile.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Newspaper } from "lucide-react";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { Card, CardContent } from "@/ux/Card";
import {
  TONE_BUCKETS,
  usePersonMediaTone,
  type PersonMediaTone,
  type ToneBucket,
} from "@/data/news/usePersonMediaTone";

const FILL: Record<ToneBucket, string> = {
  strongly_unfavorable: "bg-negative",
  unfavorable: "bg-negative/55",
  neutral: "bg-muted-foreground/60",
  favorable: "bg-positive/55",
  strongly_favorable: "bg-positive",
};

export const PersonMediaToneBody: FC<{ tone: PersonMediaTone }> = ({
  tone,
}) => {
  const { t, i18n } = useTranslation();
  const total = TONE_BUCKETS.reduce((s, b) => s + (tone.counts[b] ?? 0), 0);
  const url =
    i18n.language === "en"
      ? tone.news_url.replace(/\/person\//, "/en/person/")
      : tone.news_url;
  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <p className="text-xs text-muted-foreground">
          {t("pp_media_basis", {
            n: tone.n,
            outlets: tone.outlet_count ?? tone.outlets.length,
          })}
        </p>
        <div
          className="flex h-3 w-full overflow-hidden rounded-sm"
          role="img"
          aria-label={TONE_BUCKETS.map(
            (b) => `${t(`pp_media_${b}`)}: ${tone.counts[b] ?? 0}`,
          ).join(", ")}
          data-testid="media-tone-bar"
        >
          {total > 0 &&
            TONE_BUCKETS.map((b) =>
              tone.counts[b] ? (
                <span
                  key={b}
                  className={FILL[b]}
                  style={{ width: `${(100 * tone.counts[b]!) / total}%` }}
                />
              ) : null,
            )}
        </div>
        <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          {TONE_BUCKETS.map((b) => (
            <li key={b}>
              <span
                aria-hidden
                className={`mr-1 inline-block size-2 rounded-sm align-middle ${FILL[b]}`}
              />
              {t(`pp_media_${b}`)} {tone.counts[b] ?? 0}
            </li>
          ))}
        </ul>
        {tone.outlets.length > 0 && (
          <p className="text-sm">
            <span className="text-muted-foreground">
              {t("pp_media_outlets")}:{" "}
            </span>
            {tone.outlets.map((o) => `${o.outlet} (${o.n})`).join(", ")}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {t("pp_media_caveat")}{" "}
          <a href={url} className="underline underline-offset-4" rel="noopener">
            {t("pp_media_link")}
          </a>
        </p>
      </CardContent>
    </Card>
  );
};

export const PersonInTheMedia: FC<{ slug: string }> = ({ slug }) => {
  const { t } = useTranslation();
  const { data } = usePersonMediaTone(slug);
  if (!data) return null;
  return (
    <DashboardSection
      id="person-media"
      title={t("pp_media_title")}
      icon={Newspaper}
      headingLevel={2}
    >
      <PersonMediaToneBody tone={data} />
    </DashboardSection>
  );
};
