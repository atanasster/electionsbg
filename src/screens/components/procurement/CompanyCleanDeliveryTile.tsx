// ИСУН „clean delivery" on /company/:eik — how many EU-funded contracts this
// beneficiary completed with no financial correction imposed (migration 175).
//
// ⚠️ THIS TILE ONLY EVER RENDERS A POSITIVE. It is mounted only when the company
// HAS a row in the register, and it never draws a zero. That is not a styling
// choice — it is what keeps the dataset honest:
//
//   • PRESENCE is a real claim ИСУН makes: this beneficiary has no correction.
//   • ABSENCE is not the opposite. A company can be missing because it finished
//     late, was terminated, is still in final verification, or holds no EU grant
//     at all. Individual irregularities go to OLAF's IMS, which is confidential —
//     there is no public „was corrected" list anywhere.
//
// So a „0 clean contracts" state would read as an accusation the source cannot
// support, against a named company. It is unreachable by construction: no row,
// no tile. The caveat still renders in words, because a reader who sees the tile
// on one company will wonder what its absence means on the next.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { BadgeCheck } from "lucide-react";
import { Card } from "@/components/ui/card";

export interface CleanDeliveryInfo {
  eik: string;
  name: string;
  /** „Брой договори, успешно приключени В СРОК" — on time, a stricter test than
   *  merely uncorrected, which is why it can exceed `clean_contracts`. */
  on_time_contracts: number;
  /** Rows in the „Проекти без наложени финансови корекции" list for this EIK. */
  clean_contracts: number | string;
  programmes: string[] | null;
  /** Server-supplied. Rendered verbatim rather than restated here, so the page
   *  and the database cannot drift on what absence means. */
  absence_meaning: string | null;
}

export const CompanyCleanDeliveryTile: FC<{ info: CleanDeliveryInfo }> = ({
  info,
}) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const T = (b: string, e: string) => (bg ? b : e);

  const onTime = Number(info.on_time_contracts) || 0;
  const clean = Number(info.clean_contracts) || 0;
  // Nothing to say. Should be unreachable (the row exists only for listed
  // beneficiaries), but a zero here must never render as a finding.
  if (onTime <= 0 && clean <= 0) return null;

  const programmes = (info.programmes ?? []).filter(Boolean);

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <BadgeCheck className="mt-0.5 size-5 shrink-0 text-emerald-600" />
        <div className="min-w-0">
          <div className="font-medium">
            {T(
              "Еврофондове: изпълнение без корекция",
              "EU funds: delivered without correction",
            )}
          </div>

          <div className="mt-1 text-sm">
            {onTime > 0 && (
              <div>
                <span className="text-lg font-semibold tabular-nums">
                  {onTime}
                </span>{" "}
                {T(
                  onTime === 1
                    ? "договор, приключен в срок"
                    : "договора, приключени в срок",
                  onTime === 1
                    ? "contract completed on time"
                    : "contracts completed on time",
                )}
              </div>
            )}
            {clean > 0 && (
              <div className="text-muted-foreground">
                {T(
                  `${clean} ${clean === 1 ? "проект" : "проекта"} без наложена финансова корекция`,
                  `${clean} ${clean === 1 ? "project" : "projects"} with no financial correction imposed`,
                )}
              </div>
            )}
          </div>

          {programmes.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {programmes.slice(0, 4).map((p) => (
                <span
                  key={p}
                  className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                >
                  {p}
                </span>
              ))}
              {programmes.length > 4 && (
                <span className="px-1 py-0.5 text-xs text-muted-foreground">
                  +{programmes.length - 4}
                </span>
              )}
            </div>
          )}

          {/* The bound, in words. Verbatim from the register's own coverage row. */}
          {info.absence_meaning && (
            <p className="mt-2 text-xs leading-snug text-muted-foreground">
              {bg
                ? info.absence_meaning
                : "Being absent from this register does not mean a financial correction was imposed — a project may have finished late, been terminated, or still be under verification. Individual irregularities are reported to OLAF's IMS and are not public."}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
};
