// The Jev scales on ONE article page — a position on each published axis and
// a tone per subject, measured by a model that read the WHOLE text.
//
// ⚠️ NO CONFIDENCE PERCENTAGE, and that is measured, not a style choice. Phase
// 0 (`news/evals/jev-sentiment-phase0-2026-09-23.md`) found Jev's reported
// confidence and the distribution's modal probability are different
// quantities, and that NEITHER predicts agreement on the Russia axis (AUC
// 0.555 / 0.541). A percentage beside a verdict would decorate it. What the
// reader gets instead is the distribution itself, which shows its own spread.
//
// ⚠️ NO QUOTE BLOCK. The old „Проверима оценка" rested on a quoted span per
// verdict; the scales judge the whole article, so the honest pointer is the
// source itself (plan §4) — and a model's paraphrase in a quote-shaped box is
// exactly what the evidence gate used to refuse.

import type {
  JevAxisScore,
  JevScore,
  JevSubject,
  TextScope,
  ToneBucket,
} from "../data";
import {
  LEANING_META,
  LEANING_META_EN,
  RUSSIA_META,
  RUSSIA_META_EN,
  formatDateTime,
  toneMeta,
  withheldReasonLabel,
} from "../labels";
import {
  BUCKET_EDGES,
  LEANING_BUCKET_ORDER,
  RUSSIA_BUCKET_ORDER,
  TONE_BUCKET_ORDER,
} from "../sentimentScale";
import { useNewsLocale } from "../i18n";
import { bucketOf } from "../jevBucket";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * Below this, an axis is shown as NOT APPLYING rather than placed on its scale.
 *
 * ⚠️ PROVISIONAL, and the eval says where it is safe. On Russia the gate
 * separates cleanly (median 0.01 for GLM's „not applicable", 0.97 for every
 * group that took a position), so any threshold in 0.1–0.9 draws the same
 * line. On leaning GLM's own „neutral" sits at median 0.45, so this value
 * splits that group — the boundary between „takes no side" and „is not about
 * sides" is genuinely fuzzy there. Absent is never drawn as zero.
 */
export const APPLIES_FLOOR = 0.5;

export type JevAxisId = "leaning" | "russia_stance";

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));
const pct = (normalized: number) => clamp(((normalized + 1) / 2) * 100, 0, 100);

/** Is this a score the page can place? Every field a position needs. */
const placeable = (
  s: JevScore | undefined | null,
): s is JevScore & { normalized: number; levels: number; value: number } =>
  !!s &&
  typeof s.normalized === "number" &&
  Number.isFinite(s.normalized) &&
  typeof s.value === "number" &&
  Number.isFinite(s.value) &&
  typeof s.levels === "number" &&
  Number.isInteger(s.levels) &&
  s.levels >= 2;

/**
 * One scale: the track, the spread as a band, the position as a marker, and
 * the model's distribution under it.
 *
 * The band is ±1 SD of the model's OWN distribution, normalized the same way
 * as the position. A band the scale cut is said to be cut — a clamp that hid
 * it would turn a two-sided interval into a one-sided one.
 */
export const ScaleTrack = ({
  score,
  lowLabel,
  highLabel,
  summary,
  compact = false,
}: {
  score: JevScore & { normalized: number; levels: number };
  lowLabel: string;
  highLabel: string;
  /** The screen-reader sentence: the position in words. */
  summary: string;
  /**
   * A row in a list of tracks: the end labels and the distribution caption
   * are printed ONCE by the list, not repeated under every row. The end
   * labels stay in the screen-reader text either way.
   */
  compact?: boolean;
}) => {
  const { tr } = useNewsLocale();
  const extent = (score.levels - 1) / 2;
  const half =
    typeof score.spread === "number" && Number.isFinite(score.spread)
      ? score.spread / extent
      : 0;
  const lo = score.normalized - half;
  const hi = score.normalized + half;
  const clipped = lo < -1 || hi > 1;
  const distribution = score.distribution ?? [];
  const peak = Math.max(0, ...distribution);
  return (
    <div className="mt-3">
      <div role="img" aria-label={summary} className="relative h-3">
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-muted" />
        {BUCKET_EDGES.map((edge) => (
          <span
            key={edge}
            aria-hidden
            className="absolute top-0 h-3 w-px bg-border"
            style={{ left: `${pct(edge)}%` }}
          />
        ))}
        {half > 0 ? (
          <span
            aria-hidden
            data-testid="scale-band"
            className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-foreground/20"
            style={{ left: `${pct(lo)}%`, width: `${pct(hi) - pct(lo)}%` }}
          />
        ) : null}
        <span
          aria-hidden
          data-testid="scale-marker"
          className="absolute top-0 h-3 w-1.5 -translate-x-1/2 rounded-sm bg-foreground"
          style={{ left: `${pct(score.normalized)}%` }}
        />
      </div>
      {compact ? (
        <span className="sr-only">{`${lowLabel} — ${highLabel}`}</span>
      ) : (
        <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
          <span>{lowLabel}</span>
          <span>{highLabel}</span>
        </div>
      )}
      {distribution.length === score.levels && peak > 0 ? (
        <div className={compact ? "mt-1" : "mt-2"}>
          <div
            aria-hidden
            className={`flex items-end gap-1 ${compact ? "h-3" : "h-6"}`}
            data-testid="scale-distribution"
          >
            {distribution.map((p, i) => (
              <span
                key={i}
                className="flex-1 rounded-t-sm bg-muted-foreground/60"
                style={{ height: `${Math.max(2, (p / peak) * 100)}%` }}
              />
            ))}
          </div>
          {compact ? null : <DistributionCaption />}
        </div>
      ) : null}
      {clipped ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {tr(
            "Разсейването излиза извън скалата и е отрязано в края ѝ.",
            "The spread runs past the scale and is cut at its end.",
          )}
        </p>
      ) : null}
    </div>
  );
};

const DistributionCaption = ({ many = false }: { many?: boolean }) => {
  const { tr } = useNewsLocale();
  return (
    <p className="mt-1 text-[11px] text-muted-foreground">
      {many
        ? tr(
            "Под всяка скала: разпределението на отговора на модела по степените ѝ",
            "Under each scale: the model's answer distributed across its levels",
          )
        : tr(
            "Под скалата: разпределението на отговора на модела по степените ѝ",
            "Under the scale: the model's answer distributed across its levels",
          )}
    </p>
  );
};

/** A published article axis — replaces the model card for that axis. */
export const JevAxisCard = ({
  title,
  axis,
  score,
}: {
  title: string;
  axis: JevAxisId;
  score: JevAxisScore;
}) => {
  const { isEnglish, tr } = useNewsLocale();
  // Widened to a string key: the two axes' label maps are keyed by different
  // unions, and `order` below is one of them — the lookup is total either way.
  const meta: Record<string, { label: string; short: string; color: string }> =
    axis === "leaning"
      ? isEnglish
        ? LEANING_META_EN
        : LEANING_META
      : isEnglish
        ? RUSSIA_META_EN
        : RUSSIA_META;
  const order = axis === "leaning" ? LEANING_BUCKET_ORDER : RUSSIA_BUCKET_ORDER;
  const applies =
    typeof score.applies === "number" && Number.isFinite(score.applies)
      ? score.applies
      : null;
  const notApplicable = applies !== null && applies < APPLIES_FLOOR;
  const place = placeable(score);
  const bucket = place ? bucketOf(score, order) : null;
  const hit = bucket ? meta[bucket] : null;
  return (
    <Card className="p-4" data-testid={`jev-axis-${axis}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        <Badge variant="outline" className="shrink-0 font-normal">
          {/* Not „whole text": a truncated article is scored on a prefix,
              and `JevProvenance` below says which — a badge cannot. */}
          {tr("Моделна скала", "Model scale")}
        </Badge>
      </div>
      {notApplicable ? (
        // ⚠️ ABSENT, NOT ZERO. A marker at the centre would read as „takes no
        // side", which is a different finding from „is not about sides".
        <p
          className="mt-2 font-title text-lg"
          data-testid="axis-not-applicable"
        >
          {tr(
            "Оста не се отнася към този материал",
            "This axis does not apply to the article",
          )}
        </p>
      ) : place && hit ? (
        <>
          <div className="mt-2 flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block size-2.5 rounded-sm"
              style={{ backgroundColor: hit.color }}
            />
            <p className="font-title text-lg">{hit.label}</p>
          </div>
          <ScaleTrack
            score={score}
            lowLabel={meta[order[0]].short}
            highLabel={meta[order[order.length - 1]].short}
            summary={tr(
              `Позиция: ${hit.label} (${score.normalized.toFixed(2)} по скала от −1 до +1)`,
              `Position: ${hit.label} (${score.normalized.toFixed(2)} on a scale from −1 to +1)`,
            )}
          />
        </>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          {tr("Оценката не е налична.", "The assessment is not available.")}
        </p>
      )}
      {applies !== null ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {tr(
            `Вероятност оста да се отнася към материала: ${Math.round(applies * 100)}%`,
            `Likelihood that the axis applies to the article: ${Math.round(applies * 100)}%`,
          )}
        </p>
      ) : null}
    </Card>
  );
};

const ROLE_BG: Record<string, string> = {
  primary: "основен субект",
  secondary: "второстепенен субект",
};
const ROLE_EN: Record<string, string> = {
  primary: "primary subject",
  secondary: "secondary subject",
};

/** How the article frames each subject it is substantially about. */
export const JevSubjects = ({
  subjects,
  dropped,
  max,
}: {
  subjects: JevSubject[];
  dropped: number | null | undefined;
  /** The pass's subject cap, as the build shipped it. */
  max?: number | null;
}) => {
  const { isEnglish, language, tr } = useNewsLocale();
  const scored = subjects.filter(
    (s) => s.subject_role !== "incidental" && placeable(s.tone),
  );
  // ⚠️ THREE LISTS, NOT TWO. An incidental subject was never asked about —
  // the fix for a party quoted once being scored as the article's target.
  // A primary or secondary one with no placeable tone WAS asked and has no
  // answer (a failed call); calling that a passing mention is a false label,
  // and the party archive already says „not rated yet" for the same record.
  const passing = subjects.filter((s) => s.subject_role === "incidental");
  const unrated = subjects.filter(
    (s) => s.subject_role !== "incidental" && !placeable(s.tone),
  );
  if (!scored.length && !passing.length && !unrated.length) return null;
  return (
    <Card className="mt-3 p-4" data-testid="jev-subjects">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {tr(
          "Как материалът представя споменатите",
          "How the article frames those it names",
        )}
      </h3>
      {scored.length ? (
        <div
          aria-hidden
          className="mt-2 flex justify-between text-[11px] text-muted-foreground"
        >
          <span>{toneMeta("strongly_unfavorable", language).label}</span>
          <span>{toneMeta("strongly_favorable", language).label}</span>
        </div>
      ) : null}
      {scored.length ? (
        <ul className="mt-1 space-y-3">
          {scored.map((subject) => {
            const tone = subject.tone as JevScore & {
              normalized: number;
              levels: number;
              value: number;
            };
            const bucket = bucketOf(tone, TONE_BUCKET_ORDER) as ToneBucket;
            const meta = toneMeta(bucket, language);
            const role = subject.subject_role
              ? (isEnglish ? ROLE_EN : ROLE_BG)[subject.subject_role]
              : null;
            return (
              <li key={`${subject.kind}:${subject.name}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium">{subject.name}</span>
                  <span className={`text-sm ${meta.className}`}>
                    {meta.label}
                  </span>
                </div>
                {role ? (
                  <p className="text-xs text-muted-foreground">{role}</p>
                ) : null}
                <ScaleTrack
                  score={tone}
                  lowLabel={toneMeta("strongly_unfavorable", language).label}
                  highLabel={toneMeta("strongly_favorable", language).label}
                  summary={tr(
                    `${subject.name}: ${meta.label}`,
                    `${subject.name}: ${meta.label}`,
                  )}
                  compact
                />
              </li>
            );
          })}
        </ul>
      ) : null}
      {scored.length ? <DistributionCaption many /> : null}
      {passing.length ? (
        <p
          className="mt-3 text-sm text-muted-foreground"
          data-testid="jev-passing"
        >
          {withheldReasonLabel("incidental", language, { plural: true })}:{" "}
          {passing.map((s) => s.name).join(", ")}
        </p>
      ) : null}
      {unrated.length ? (
        <p
          className="mt-1 text-sm text-muted-foreground"
          data-testid="jev-unrated"
        >
          {withheldReasonLabel("not_scored", language, { plural: true })}:{" "}
          {unrated.map((s) => s.name).join(", ")}
        </p>
      ) : null}
      {typeof dropped === "number" && dropped > 0 ? (
        <p
          className="mt-2 text-xs text-muted-foreground"
          data-testid="jev-dropped"
        >
          {typeof max === "number"
            ? tr(
                `Още ${dropped} споменати не са оценени — оценяват се най-много ${max} на материал, най-споменаваните първо.`,
                `${dropped} more named are not rated — at most ${max} per article are, the most-mentioned first.`,
              )
            : tr(
                `Още ${dropped} споменати не са оценени — извън лимита на материал, най-споменаваните първо.`,
                `${dropped} more named are not rated — past the per-article limit, the most-mentioned first.`,
              )}
        </p>
      ) : null}
    </Card>
  );
};

/**
 * What stands where the quote block used to: who read what, and where to check.
 */
export const JevProvenance = ({
  textScope,
  articleUrl,
  model,
  assessedAt,
}: {
  textScope: TextScope | null | undefined;
  articleUrl: string | null | undefined;
  /**
   * ⚠️ THE SCALES' OWN MODEL AND DATE. The section header names the model
   * that wrote the SUMMARY and when — a different model, often on a
   * different day — so without this line the page attributes a scale to a
   * model that did not produce it.
   */
  model?: string | null;
  assessedAt?: string | null;
}) => {
  const { language, tr } = useNewsLocale();
  const byline = [
    model ? tr(`модел ${model}`, `model ${model}`) : null,
    assessedAt ? formatDateTime(assessedAt, language) : null,
  ].filter(Boolean);
  // ⚠️ THE KIND DECIDES, the counts only decorate. A prefix read with a
  // missing count is still a prefix read; requiring both counts first made
  // such a record fall through to the whole-text sentence.
  const prefix = textScope?.kind === "prefix";
  const partial =
    prefix &&
    textScope.chars_seen != null &&
    textScope.chars_total != null &&
    textScope.chars_seen < textScope.chars_total;
  return (
    <p
      className="mt-3 text-sm text-muted-foreground"
      data-testid="jev-provenance"
    >
      {byline.length ? (
        <span data-testid="jev-byline">
          {tr("Скали: ", "Scales: ")}
          {byline.join(" · ")}.{" "}
        </span>
      ) : null}
      {prefix && !partial
        ? tr(
            "Модел прочете част от материала и постави позицията му по всяка скала. Непрочетен пасаж може да я промени.",
            "A model read part of the article and placed it on each scale. An unread passage could change the position.",
          )
        : partial
          ? tr(
              `Модел прочете първите ${textScope!.chars_seen!.toLocaleString("bg-BG")} от ${textScope!.chars_total!.toLocaleString("bg-BG")} знака и постави материала по всяка скала. Непрочетен пасаж може да промени позицията.`,
              `A model read the first ${textScope!.chars_seen!.toLocaleString("en-GB")} of ${textScope!.chars_total!.toLocaleString("en-GB")} characters and placed the article on each scale. An unread passage could change the position.`,
            )
          : tr(
              "Модел прочете целия материал и постави позицията му по всяка скала — без цитат, защото оценката е за текста като цяло.",
              "A model read the whole article and placed it on each scale — with no quotation, because the rating is of the text as a whole.",
            )}{" "}
      {articleUrl ? (
        <a
          href={articleUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="font-medium text-primary underline underline-offset-4"
        >
          {tr("Проверете в източника", "Check the source")}
        </a>
      ) : null}
    </p>
  );
};
