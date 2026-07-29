// "Какво определя законът за 2026 г." — the six ЗБДОО amounts people actually
// search for, in euro, each with the article that sets it and a link to the
// promulgated text.
//
// These constants existed in src/lib/bgTax.ts with nothing rendering them: the
// tax calculator consumes the МОД cap and the pension bounds, but the чл. 11–13
// benefits and the чл. 15 guaranteed-claims cap had no surface at all. They are
// the most-searched figures in the package and the ones a citizen is most
// likely to arrive looking for.
//
// Two of the six step mid-year, which is the reason each row carries a date
// rather than a bare number — a single figure for 2026 would describe no month
// correctly.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Scale } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEur } from "@/lib/currency";
import { StatutoryValue } from "@/components/ui/StatutoryValue";
import { statutoryStepProps } from "@/components/ui/statutoryStep";
import {
  MIN_PENSION_SCHEDULE,
  MAX_PENSION,
  UNEMPLOYMENT_BENEFIT_DAILY_MIN,
  UNEMPLOYMENT_BENEFIT_DAILY_MAX,
  CHILD_REARING_BENEFIT,
  DEATH_GRANT,
  GUARANTEED_CLAIMS_CAP,
} from "@/lib/bgTax";

/** ЗБДОО-2026 — обн. ДВ бр. 68 от 28.07.2026. */
const DV_ISSUE = "ДВ бр. 68/2026";
const ID_MAT = "244982";

export const PensionStatutoryStrip: FC = () => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const eur = (v: number): string => formatEur(v, lang, { decimals: 2 });

  const minPension = statutoryStepProps(MIN_PENSION_SCHEDULE[2026], eur);

  const rows: {
    key: string;
    label: string;
    article: string;
    value: string;
    from?: string;
    previous?: { value: string; from?: string };
  }[] = [
    {
      key: "min",
      label: t("pensions_stat_min"),
      article: "чл. 10",
      value: minPension?.value ?? eur(0),
      from: minPension?.from,
      previous: minPension?.previous,
    },
    {
      key: "max",
      label: t("pensions_stat_max"),
      article: "§ 4 ал. 2",
      // Whole-year, so deliberately no date: the one figure this law confirms
      // rather than moves.
      value: eur(MAX_PENSION),
    },
    {
      key: "unemployment",
      label: t("pensions_stat_unemployment"),
      article: "чл. 11",
      value: `${eur(UNEMPLOYMENT_BENEFIT_DAILY_MIN)} – ${eur(UNEMPLOYMENT_BENEFIT_DAILY_MAX)}`,
    },
    {
      key: "child",
      label: t("pensions_stat_child"),
      article: "чл. 12",
      value: eur(CHILD_REARING_BENEFIT),
    },
    {
      key: "death",
      label: t("pensions_stat_death"),
      article: "чл. 13",
      value: eur(DEATH_GRANT),
    },
    {
      key: "guaranteed",
      label: t("pensions_stat_guaranteed"),
      article: "чл. 15 ал. 2",
      value: eur(GUARANTEED_CLAIMS_CAP),
    },
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Scale className="h-4 w-4" />
          {t("pensions_statutory_heading")}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-2">
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {rows.map((r) => (
            <div
              key={r.key}
              className="flex flex-wrap items-baseline justify-between gap-x-2 border-b border-dashed pb-1.5"
            >
              <dt className="text-xs text-muted-foreground">{r.label}</dt>
              <dd className="text-sm">
                <StatutoryValue
                  value={r.value}
                  from={r.from}
                  previous={r.previous}
                  article={r.article}
                  dvIssue={DV_ISSUE}
                  idMat={ID_MAT}
                />
              </dd>
            </div>
          ))}
        </dl>
        <p className="text-[11px] text-muted-foreground">
          {t("pensions_statutory_caption")}
        </p>
      </CardContent>
    </Card>
  );
};
