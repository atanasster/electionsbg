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
import { formatEur } from "@/lib/currency";
import type { InterregListedOperation } from "@/data/funds/types";
import { InterregOperationRow } from "@/screens/funds/InterregOperationRow";
import { GOVERNANCE_INTERREG_ANCHOR } from "@/screens/funds/InterregTile";

const OPS_SHOWN = 6;

interface InterregPlace {
  partnerCount: number;
  operationCount: number;
  budgetEur: number;
  unpublishedPartnerCount: number;
  linkedCount: number;
  operations: InterregListedOperation[];
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
    <Card id={GOVERNANCE_INTERREG_ANCHOR}>
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
            <InterregOperationRow
              key={o.keepId}
              operation={o}
              bg={bg}
              lang={lang}
            />
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
