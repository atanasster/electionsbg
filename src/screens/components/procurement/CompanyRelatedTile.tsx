// "Related companies (same owners)" tile for the DB company page. Lists other
// companies that share an owner with this one (TR partners/owners), matched on
// normalised name and gated to HIGH-CONFIDENCE only (declared stake in both, or
// a globally rare owner name) — see 019_related_companies.sql. Owner identity in
// TR is name-only, so a "matched by name" caveat is shown. Fed by company_related().

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Network } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";

export interface RelatedCompany {
  eik: string;
  name: string | null;
  status: string | null;
  sharedOwners: string[];
  sharedCount: number;
  namesakeCount: number;
}

const SHOWN = 12;
const NAMES_PREVIEW = 2;

export const CompanyRelatedTile: FC<{ data: RelatedCompany[] }> = ({
  data,
}) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const nf = new Intl.NumberFormat(lang === "bg" ? "bg-BG" : "en-GB");

  const rows = data.slice(0, SHOWN);
  if (rows.length === 0) return null;

  return (
    <Card className="my-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <Network className="h-4 w-4" />
          {t("company_related_title") || "Свързани фирми"}
          <span className="text-xs text-muted-foreground font-normal ml-1">
            {t("company_related_subtitle") ||
              "Фирми със същите собственици според Търговския регистър"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-2.5">
        {rows.map((r) => {
          const owners = r.sharedOwners ?? [];
          const preview = owners.slice(0, NAMES_PREVIEW).join(", ");
          const extra = owners.length - NAMES_PREVIEW;
          return (
            <div
              key={r.eik}
              className="flex items-baseline justify-between gap-3"
            >
              <div className="min-w-0">
                <Link
                  to={`/db/company/${r.eik}`}
                  className="text-sm font-medium hover:underline"
                >
                  {r.name || `ЕИК ${r.eik}`}
                </Link>
                <div className="text-xs text-muted-foreground truncate">
                  {preview}
                  {extra > 0
                    ? ` ${t("company_related_and_more", {
                        count: extra,
                        defaultValue: "и още {{count}}",
                      })}`
                    : ""}
                </div>
              </div>
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs font-semibold tabular-nums text-muted-foreground">
                {nf.format(r.sharedCount)}{" "}
                {r.sharedCount === 1
                  ? t("company_related_owner_one") || "общ собственик"
                  : t("company_related_owner_many") || "общи собственици"}
              </span>
            </div>
          );
        })}
        <p className="pt-1 text-xs text-muted-foreground/80">
          {t("company_related_caveat") ||
            "Съвпадение по име от Търговския регистър — възможни са съвпадения на имена."}
        </p>
      </CardContent>
    </Card>
  );
};
