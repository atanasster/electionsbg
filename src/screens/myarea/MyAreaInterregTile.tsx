// Interreg projects pinned to this place — the cross-border money that is NOT
// in the EU-funds tile beside it.
//
// `fund_projects` (ИСУН) holds zero Interreg operations, and that is a system
// boundary rather than a filter: Interreg runs on Jems. Because Interreg is
// cross-border by definition, its money lands on border municipalities almost
// exclusively — so for exactly the places most likely to be looking at this
// dashboard, the ИСУН tile above has always been an undercount. This tile is
// where that money becomes visible per place.
//
// Self-hides when the place has no Interreg rows, so the ~130 municipalities
// that have some get a tile and the rest are unchanged.
//
// EVERY € HERE IS THE BULGARIAN PARTNER'S OWN BUDGET, never the operation
// total. On BSB00963 those are €357,183.12 and €1,419,207.76 — showing the
// second would put roughly four times the true money on Малко Търново, a
// municipality of 2,628 people. The operation total is rendered only as
// per-project context, clearly labelled as the whole cross-border project.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Globe } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Link } from "react-router-dom";
import { formatEur } from "@/lib/currency";

const OPS_SHOWN = 6;

interface InterregPlaceOperation {
  keepId: number;
  operationId: string | null;
  programmeBg: string | null;
  programmeEn: string | null;
  period: string;
  titleEn: string;
  titleBg: string | null;
  status: string | null;
  startDate: string | null;
  endDate: string | null;
  operationTotalEur: number | null;
  partnerCount: number | null;
  countries: string[] | null;
  localBudgetEur: number | null;
  localBudgetBasis: string;
}

interface InterregPlace {
  partnerCount: number;
  operationCount: number;
  budgetEur: number;
  unpublishedPartnerCount: number;
  linkedCount: number;
  operations: InterregPlaceOperation[];
}

const useInterregPlace = (obshtina: string | undefined) =>
  useQuery({
    queryKey: ["interreg", "place", obshtina ?? ""] as const,
    queryFn: async (): Promise<InterregPlace> => {
      const r = await fetch(
        `/api/db/interreg-place?obshtina=${encodeURIComponent(obshtina!)}&limit=${OPS_SHOWN}`,
      );
      if (!r.ok) throw new Error(`interreg-place failed: ${r.status}`);
      return (await r.json()) as InterregPlace;
    },
    enabled: !!obshtina,
    staleTime: Infinity,
  });

export const MyAreaInterregTile: FC<{ obshtina: string }> = ({ obshtina }) => {
  const { t, i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const lang = bg ? "bg" : "en";
  const { data } = useInterregPlace(obshtina);

  if (!data || data.operationCount === 0) return null;

  return (
    <Card id="myarea-interreg">
      <div className="p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Globe className="size-4 text-primary" />
          <h2 className="text-sm font-semibold flex-1">
            {t("myarea_interreg_title")}
          </h2>
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {data.operationCount}
          </span>
        </div>

        <p className="text-xs text-muted-foreground">
          {t("myarea_interreg_intro", {
            eur: formatEur(data.budgetEur, lang),
            count: data.operationCount,
          })}
        </p>

        {/* Rows whose programme published no budget count in the project total
            and contribute ZERO euros. Saying so is the difference between an
            undercount and an unexplained one. */}
        {data.unpublishedPartnerCount > 0 ? (
          <p className="text-[10px] text-muted-foreground">
            {t("myarea_interreg_unpublished", {
              count: data.unpublishedPartnerCount,
            })}
          </p>
        ) : null}

        <ul className="divide-y text-xs">
          {data.operations.map((o) => (
            <li key={o.keepId} className="flex flex-col gap-0.5 py-2">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <Link
                  to={`/funds/interreg/${o.keepId}`}
                  className="min-w-0 flex-1 font-medium underline"
                >
                  {/* keep.eu publishes titles in English only — 107 of 107
                      sampled projects have no `bg` translation. Rendering the
                      English one with a marker is honest; inventing a Bulgarian
                      title would not be. */}
                  {o.titleBg ?? o.titleEn}
                  {bg && !o.titleBg ? (
                    <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                      {t("myarea_interreg_in_english")}
                    </span>
                  ) : null}
                </Link>
                <span className="shrink-0 tabular-nums font-semibold">
                  {o.localBudgetEur != null
                    ? formatEur(o.localBudgetEur, lang)
                    : t("myarea_interreg_no_budget")}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-2 text-[10px] text-muted-foreground">
                <span>{(bg ? o.programmeBg : o.programmeEn) ?? "—"}</span>
                <span>·</span>
                <span>{o.period}</span>
                {o.operationTotalEur != null ? (
                  <>
                    <span>·</span>
                    <span>
                      {t("myarea_interreg_whole_project", {
                        eur: formatEur(o.operationTotalEur, lang),
                      })}
                    </span>
                  </>
                ) : null}
                {o.countries && o.countries.length > 0 ? (
                  <>
                    <span>·</span>
                    <span>{o.countries.join(", ")}</span>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>

        {data.operationCount > data.operations.length ? (
          <p className="text-[10px] text-muted-foreground">
            {t("myarea_interreg_showing", {
              shown: data.operations.length,
              total: data.operationCount,
            })}
          </p>
        ) : null}

        <p className="text-[10px] text-muted-foreground">
          <a
            href="https://keep.eu/"
            target="_blank"
            rel="noreferrer noopener"
            className="underline"
          >
            keep.eu
          </a>{" "}
          {t("myarea_interreg_source")}
        </p>
      </div>
    </Card>
  );
};
