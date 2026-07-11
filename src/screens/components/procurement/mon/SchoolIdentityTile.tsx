// "Това е училище" — the entity-graph back-link on a school's own /company/:eik
// (or /awarder/:eik) page. Reads the RELATIONAL schools table by ЕИК (the
// schools.eik = awarder-EIK join realised via /api/db/school-by-eik), so a
// company page whose EIK matched a school surfaces its matura report card and
// links to /school/:id. Self-hides (renders null) when the EIK isn't a school.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { GraduationCap, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import {
  useSchoolByEik,
  MIN_RANK_COHORT,
} from "@/data/schools/useSchoolDirectory";

export const SchoolIdentityTile: FC<{ eik: string }> = ({ eik }) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const { data } = useSchoolByEik(eik);
  if (!data) return null;

  // Honour the same small-cohort suppression the rest of the feature applies
  // (/school/:id, /education, the AI tool): below MIN_RANK_COHORT graduates the
  // average is too noisy to show as a headline figure.
  const ranked = (data.latestN ?? 0) >= MIN_RANK_COHORT;
  const bel =
    data.latestBel != null && ranked
      ? data.latestBel.toLocaleString(bg ? "bg-BG" : "en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <GraduationCap className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
          {bg ? "Това е училище" : "This is a school"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-3 text-sm md:p-4">
        <p className="text-muted-foreground">
          {bg
            ? "Този ЕИК е разпознат като училище. Виж успеха на матурите, постижението спрямо подобни училища и напредъка 7→12 клас в картона на училището."
            : "This EIK is recognised as a school. See its matura results, performance versus its social context, and 7th→12th-grade progress in the school report card."}
        </p>
        {bel != null ? (
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-2xl font-bold tabular-nums">{bel}</span>
            <span className="text-muted-foreground">
              {bg
                ? `среден успех на матурата по БЕЛ${data.latestYear ? ` (${data.latestYear})` : ""}`
                : `average БЕЛ matura score${data.latestYear ? ` (${data.latestYear})` : ""}`}
            </span>
          </div>
        ) : (
          !ranked &&
          data.latestBel != null && (
            <p className="text-xs text-muted-foreground">
              {bg
                ? "Малка група зрелостници — успехът не се показва."
                : "Small cohort — score withheld."}
            </p>
          )
        )}
        <Link
          to={`/school/${data.id}`}
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          {bg ? "Виж картона на училището" : "Open the school report card"}
          <ArrowRight className="h-3 w-3" />
        </Link>
      </CardContent>
    </Card>
  );
};
