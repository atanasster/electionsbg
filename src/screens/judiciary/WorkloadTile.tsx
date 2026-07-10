// Натовареност по съдебен ред — the workload each tier of the bench carries.
//
// The ВСС publishes TWO workload numbers and they disagree, sometimes by a
// third: "по щат" divides the caseload by the judge posts a court is allocated,
// while "действителна" divides it by the months judges actually worked (posts
// sit vacant; judges are seconded, on leave, or ill). The methodology behind the
// weighted figures (SINS) is publicly contested, so this tile shows both side by
// side and says plainly why they differ, rather than picking a winner.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Scale } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import type { JudiciaryTier } from "@/data/judiciary/useCaseload";

const n2 = (v: number, lang: string) =>
  v.toLocaleString(lang, { maximumFractionDigits: 1 });

export const WorkloadTile: FC<{ tiers: JudiciaryTier[]; year: number }> = ({
  tiers,
  year,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const rows = tiers.filter((t) => t.loadPerPostToConsider > 0);
  if (!rows.length) return null;
  const max = Math.max(
    ...rows.map((t) =>
      Math.max(t.loadPerPostToConsider, t.actualLoadToConsider),
    ),
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Scale className="h-4 w-4" />
          {bg
            ? `Натовареност на съдиите по съдебен ред (${year})`
            : `Judges' workload by court tier (${year})`}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-primary" />
            {bg ? "по щат" : "per allocated post"}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-amber-500" />
            {bg ? "действителна" : "actual (per month worked)"}
          </span>
        </div>

        {rows.map((t) => {
          const gap = t.actualLoadToConsider - t.loadPerPostToConsider;
          return (
            <div key={t.id} className="text-xs">
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="font-medium">{bg ? t.bg : t.en}</span>
                <span className="tabular-nums text-muted-foreground">
                  {n2(t.loadPerPostToConsider, lang)} →{" "}
                  <span className="font-semibold text-foreground">
                    {n2(t.actualLoadToConsider, lang)}
                  </span>
                  <span className="ml-1 text-muted-foreground/70">
                    {bg ? "дела/мес." : "cases/mo"}
                  </span>
                </span>
              </div>
              {/* Both figures are already printed as text on the row above, so
                  the bars are a redundant visual encoding: announcing them again
                  would just double every number for a screen-reader user. */}
              <div className="space-y-1" aria-hidden="true">
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{
                      width: `${Math.max(2, (t.loadPerPostToConsider / max) * 100)}%`,
                    }}
                  />
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-amber-500"
                    style={{
                      width: `${Math.max(2, (t.actualLoadToConsider / max) * 100)}%`,
                    }}
                  />
                </div>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                <span>
                  {t.judges.toLocaleString(lang)}{" "}
                  {bg ? "съдии по щат" : "judge posts"}
                </span>
                {gap > 0.5 && (
                  <span className="text-amber-600 dark:text-amber-400">
                    +{n2(gap, lang)}{" "}
                    {bg
                      ? "над щатната — незаети места и отсъствия"
                      : "above nominal — vacancies & absences"}
                  </span>
                )}
              </div>
            </div>
          );
        })}

        <p className="pt-1 text-[11px] text-muted-foreground/80">
          {bg
            ? "Натовареността „по щат“ дели делата на броя съдийски места, а „действителната“ — на реално отработените човекомесеци. Разликата е мярка за незаетите места и отсъствията. Методиката на ВСС за измерване на натовареността (СИНС) е обект на публичен спор, затова показваме и двата официални показателя, без да избираме между тях."
            : "The “per post” figure divides cases by allocated judge posts; the “actual” figure divides them by the person-months judges really worked. The gap measures vacancies and absences. The ВСС's workload methodology (SINS) is publicly contested, so both official measures are shown side by side rather than one being chosen."}
        </p>
      </CardContent>
    </Card>
  );
};
