// /school/:id — per-school report card. Refuses a single "grade": it shows the
// matura LEVEL (national percentile) and the TREND separately, plus the honest
// signal — POSTIЖЕНИЕ СПРЯМО СРЕДАТА (the SES-adjusted над/близо/под очакваното
// verdict) — always with the cohort size and small-N suppression.

import { FC, lazy, Suspense, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  GraduationCap,
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Minus,
  Scale,
} from "lucide-react";
import { Title } from "@/ux/Title";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { Sparkline } from "@/ux/Sparkline";
import {
  useSchoolDirectory,
  MIN_RANK_COHORT,
  type ContextVerdict,
} from "@/data/schools/useSchoolDirectory";

// Lazy — the SVG scatter + its D3 helpers are only needed on the report card.
const ContextScatter = lazy(() =>
  import("./ContextScatter").then((m) => ({ default: m.ContextScatter })),
);

const fmtScore = (v: number, lang: string): string =>
  v.toLocaleString(lang === "bg" ? "bg-BG" : "en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const VERDICT: Record<
  ContextVerdict,
  { bg: string; en: string; text: string; ring: string; bgc: string }
> = {
  above: {
    bg: "над очакваното за средата си",
    en: "above expected for its context",
    text: "text-emerald-700",
    ring: "border-emerald-500/40",
    bgc: "bg-emerald-500/5",
  },
  expected: {
    bg: "близо до очакваното за средата си",
    en: "about as expected for its context",
    text: "text-slate-600",
    ring: "border-slate-400/40",
    bgc: "bg-slate-400/5",
  },
  under: {
    bg: "под очакваното за средата си",
    en: "below expected for its context",
    text: "text-rose-700",
    ring: "border-rose-500/40",
    bgc: "bg-rose-500/5",
  },
};

// Matura scores cluster in a narrow high band (≈2–6), which a 0-based sparkline
// flattens. Rebase to the series' own range so the shape reads honestly.
const rebase = (scores: number[]): number[] => {
  if (scores.length === 0) return scores;
  const lo = Math.min(...scores);
  return scores.map((s) => s - lo + 0.15);
};

export const SchoolScreen: FC = () => {
  const { id } = useParams<{ id: string }>();
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const dir = useSchoolDirectory();

  const school = useMemo(() => (dir && id ? dir.byId(id) : null), [dir, id]);

  if (!dir) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="my-8 h-40 animate-pulse rounded-xl border bg-card" />
      </div>
    );
  }

  if (!school) {
    return (
      <div className="mx-auto max-w-3xl">
        <Title>{bg ? "Училището не е намерено" : "School not found"}</Title>
        <p className="mt-4 text-muted-foreground">
          {bg
            ? "Няма училище с този идентификатор в данните за матурите."
            : "No school with this identifier in the matura data."}{" "}
          <Link to="/education" className="text-primary hover:underline">
            {bg ? "Виж всички училища" : "Browse all schools"}
          </Link>
        </p>
      </div>
    );
  }

  const ranked = (school.latestN ?? 0) >= MIN_RANK_COHORT;
  const pct =
    school.latestScore != null && ranked
      ? dir.percentileOf(school.latestScore)
      : null;
  const first = school.series[0];
  const last = school.series[school.series.length - 1];
  const delta = first && last ? last.score - first.score : null;
  const mathLatest = school.mathLatest;

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        to="/education"
        className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary"
      >
        <ArrowLeft className="h-4 w-4" />
        {bg ? "Училища и матури" : "Schools & matura"}
      </Link>

      <Title
        description={
          bg
            ? "Резултати от държавните зрелостни изпити (матура) по данни на МОН."
            : "State matura (ДЗИ) results, sourced from the Ministry of Education."
        }
      >
        <span className="flex items-center gap-2">
          <GraduationCap className="h-6 w-6 text-muted-foreground" />
          {school.name}
        </span>
      </Title>

      <div className="mt-1 text-sm text-muted-foreground">
        {school.address ? `${school.address} · ` : ""}
        <Link
          to={`/governance/${school.obshtina}`}
          className="hover:text-primary hover:underline"
        >
          {bg ? "община " : ""}
          {school.obshtinaName}
        </Link>
        {school.eik && (
          <>
            {" · "}
            <Link
              to={`/company/${school.eik}`}
              className="text-primary hover:underline"
            >
              {bg
                ? "обществени поръчки на училището"
                : "the school's own procurement"}
            </Link>
          </>
        )}
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {/* LEVEL */}
        <Card>
          <CardHeader>
            <CardTitle>
              {bg ? "Ниво (матура по БЕЛ)" : "Level (matura, Bulgarian)"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {school.latestScore != null ? (
              <>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-bold tabular-nums">
                    {fmtScore(school.latestScore, lang)}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {school.latestYear} ·{" "}
                    {school.latestN != null
                      ? `${school.latestN} ${bg ? "зрелостници" : "graduates"}`
                      : ""}
                  </span>
                </div>
                {ranked && pct != null ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {pct >= 99
                      ? bg
                        ? "Сред най-добрите в страната по успех на матурата по БЕЛ."
                        : "Among the country's top schools on the Bulgarian-language matura."
                      : bg
                        ? `По-добре от ${pct}% от училищата с матура по БЕЛ.`
                        : `Above ${pct}% of schools with a Bulgarian-language matura.`}
                  </p>
                ) : (
                  <p className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-muted-foreground">
                    {bg
                      ? `Малка група (${school.latestN ?? "?"} зрелостници) — средният успех е несигурен и училището не се класира.`
                      : `Small cohort (${school.latestN ?? "?"} graduates) — the average is noisy, so the school is not ranked.`}
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                {bg ? "Няма данни за матура." : "No matura data."}
              </p>
            )}
            {mathLatest && (
              <div className="mt-3 border-t pt-2 text-sm text-muted-foreground">
                {bg ? "Матура по математика" : "Maths matura"} (
                {mathLatest.year}):{" "}
                <span className="font-semibold tabular-nums text-foreground">
                  {fmtScore(mathLatest.score, lang)}
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* TREND */}
        <Card>
          <CardHeader>
            <CardTitle>
              {bg ? "Тренд (матура по БЕЛ)" : "Trend (Bulgarian matura)"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {school.series.length >= 2 ? (
              <>
                <div className="text-primary">
                  <Sparkline
                    values={rebase(school.series.map((p) => p.score))}
                    ariaLabel={bg ? "Тренд на матурата" : "Matura trend"}
                  />
                </div>
                <div className="mt-2 flex items-center gap-2 text-sm">
                  {delta != null && Math.abs(delta) >= 0.05 ? (
                    delta > 0 ? (
                      <span className="inline-flex items-center gap-1 text-emerald-600">
                        <TrendingUp className="h-4 w-4" />+
                        {fmtScore(delta, lang)}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-rose-600">
                        <TrendingDown className="h-4 w-4" />
                        {fmtScore(delta, lang)}
                      </span>
                    )
                  ) : (
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <Minus className="h-4 w-4" />
                      {bg ? "без промяна" : "flat"}
                    </span>
                  )}
                  <span className="text-muted-foreground">
                    {first?.year}–{last?.year}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums text-muted-foreground">
                  {school.series.map((p) => (
                    <span key={p.year}>
                      {p.year}: {fmtScore(p.score, lang)}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                {bg
                  ? "Недостатъчно години за тренд."
                  : "Not enough years for a trend."}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Постижение спрямо средата — the honest, context-adjusted signal. Show
          raw AND expected side by side (the CVA lesson: don't force one number). */}
      {school.verdict && school.predicted != null && school.ses != null && (
        <Card
          className={`mt-4 border ${VERDICT[school.verdict].ring} ${VERDICT[school.verdict].bgc}`}
        >
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Scale className="h-5 w-5 text-muted-foreground" />
              {bg ? "Постижение спрямо средата" : "Achievement vs its context"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={`text-lg font-semibold ${VERDICT[school.verdict].text}`}
            >
              {bg ? VERDICT[school.verdict].bg : VERDICT[school.verdict].en}
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3 text-center">
              <Metric
                label={bg ? "Реален успех" : "Actual"}
                value={fmtScore(school.latestScore ?? 0, lang)}
              />
              <Metric
                label={bg ? "Очакван за средата" : "Expected for context"}
                value={fmtScore(school.predicted, lang)}
              />
              <Metric
                label={bg ? "Разлика" : "Gap"}
                value={`${school.residual! >= 0 ? "+" : ""}${fmtScore(school.residual!, lang)}`}
                emphasis={VERDICT[school.verdict].text}
              />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {bg
                ? `Средата на община ${school.obshtinaName} е ${school.ses >= 0 ? "над" : "под"} средната (индекс ${school.ses.toFixed(1)}). „Очакваното“ е успехът, който училище в такава среда постига средно; разликата показва колко училището надхвърля или изостава от него — независимо от богатството на средата.`
                : `The context of ${school.obshtinaName} is ${school.ses >= 0 ? "above" : "below"} average (index ${school.ses.toFixed(1)}). "Expected" is the score a school in such a context averages; the gap shows how far this school exceeds or trails it — independent of how affluent the area is.`}
            </p>
          </CardContent>
        </Card>
      )}

      {/* The school's place in the national SES-vs-score cloud — the same
          scatter as /education, with THIS school ringed. Makes the verdict above
          concrete: is the dot over or under the expectation line? */}
      {school.verdict && school.ses != null && school.latestScore != null && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Scale className="h-5 w-5 text-muted-foreground" />
              {bg ? "Мястото сред всички училища" : "Where this school sits"}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {bg
                ? "Всяка точка е училище: наляво-надясно = средата на общината, нагоре = успех на матурата. Пунктирът е очакваното; синият пръстен е това училище."
                : "Each dot is a school: left–right = community context, up = matura score. The dashed line is the expectation; the blue ring is this school."}
            </p>
          </CardHeader>
          <CardContent>
            <Suspense
              fallback={
                <div className="h-[300px] w-full animate-pulse rounded-xl border bg-card" />
              }
            >
              <ContextScatter dir={dir} highlightId={school.id} />
            </Suspense>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {[
                { c: "#16a34a", l: bg ? "над очакваното" : "above expected" },
                { c: "#94a3b8", l: bg ? "близо" : "as expected" },
                { c: "#dc2626", l: bg ? "под очакваното" : "below expected" },
              ].map((x) => (
                <span key={x.l} className="inline-flex items-center gap-1">
                  <span
                    className="inline-block h-3 w-3 rounded-full"
                    style={{ backgroundColor: x.c }}
                  />
                  {x.l}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Напредък 7→12 клас — true prior-attainment value-added (Progress-8
          style). Where a school's ДЗИ cohort has a 7th-grade НВО, this is the
          honest "did the school move its pupils forward" signal — stronger than
          the community-context measure above. */}
      {school.vaVerdict &&
        school.vaPredicted != null &&
        school.nvoPrior != null && (
          <Card
            className={`mt-4 border ${VERDICT[school.vaVerdict].ring} ${VERDICT[school.vaVerdict].bgc}`}
          >
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-muted-foreground" />
                {bg ? "Напредък 7→12 клас" : "Progress, grade 7 → 12"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div
                className={`text-lg font-semibold ${VERDICT[school.vaVerdict].text}`}
              >
                {bg
                  ? school.vaVerdict === "above"
                    ? "добавя повече от очакваното"
                    : school.vaVerdict === "under"
                      ? "добавя по-малко от очакваното"
                      : "добавя колкото очакваното"
                  : school.vaVerdict === "above"
                    ? "adds more progress than expected"
                    : school.vaVerdict === "under"
                      ? "adds less progress than expected"
                      : "adds about the expected progress"}
              </div>
              <div className="mt-3 grid grid-cols-3 gap-3 text-center">
                <Metric
                  label={bg ? "Реален успех" : "Actual"}
                  value={fmtScore(school.latestScore ?? 0, lang)}
                />
                <Metric
                  label={bg ? "Очакван от НВО" : "Expected from НВО"}
                  value={fmtScore(school.vaPredicted, lang)}
                />
                <Metric
                  label={bg ? "Добавена стойност" : "Value added"}
                  value={`${school.vaResidual! >= 0 ? "+" : ""}${fmtScore(school.vaResidual!, lang)}`}
                  emphasis={VERDICT[school.vaVerdict].text}
                />
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                {bg
                  ? `Тази матура е на випуска, който през ${(school.latestYear ?? 0) - 5} г. е бил в 7. клас с НВО по БЕЛ ${school.nvoPrior.toFixed(0)} т. „Очакваното“ е успехът, който випуск с такова входно ниво постига средно — разликата е стойността, която училището добавя между 8. и 12. клас. Учениците сменят училище между 7. и 12. клас, затова сравнението е на випуск, не на отделен ученик.`
                  : `This matura is the cohort that in ${(school.latestYear ?? 0) - 5} sat 7th-grade НВО in Bulgarian at ${school.nvoPrior.toFixed(0)} pts. "Expected" is what a cohort entering at that level averages — the gap is the value the school adds between grades 8 and 12. Pupils change schools between grades 7 and 12, so this is a cohort, not pupil-level, comparison.`}
              </p>
            </CardContent>
          </Card>
        )}

      <p className="mt-4 text-[11px] text-muted-foreground/80">
        {bg
          ? "Показва се средният успех от задължителната държавна зрелостна матура по БЕЛ. „Напредък 7→12 клас“ сравнява матурата с входното ниво на випуска (НВО в 7. клас) — истинска добавена стойност. „Средата“ е социално-икономически индекс на общината (Преброяване 2021), използван когато няма НВО за випуска. Данните са начало на разговор, не присъда."
          : 'Shows the average score on the mandatory Bulgarian-language state matura. "Progress 7→12" compares the matura to the cohort\'s intake level (7th-grade НВО) — true value-added. The "context" is a socioeconomic index of the municipality (Census 2021), used when no НВО exists for the cohort. The data is a starting point, not a verdict.'}
      </p>
    </div>
  );
};

const Metric: FC<{ label: string; value: string; emphasis?: string }> = ({
  label,
  value,
  emphasis,
}) => (
  <div className="rounded-lg border bg-card p-2">
    <div className={`text-xl font-bold tabular-nums ${emphasis ?? ""}`}>
      {value}
    </div>
    <div className="text-[11px] text-muted-foreground">{label}</div>
  </div>
);
