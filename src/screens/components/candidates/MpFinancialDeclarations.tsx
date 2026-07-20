import { FC, Fragment, useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Briefcase, ExternalLink, ArrowRightLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useMpDeclarations } from "@/data/parliament/useMpDeclarations";
import {
  consolidate,
  type ConsolidatedStake,
  type StakeRange,
} from "@/data/parliament/consolidateStakes";
import { formatEur } from "@/lib/currency";

export const RangeLabel: FC<{ r: StakeRange; lang: string }> = ({
  r,
  lang,
}) => {
  const yearLabel =
    r.fromYear === r.toYear ? `${r.fromYear}` : `${r.fromYear}–${r.toYear}`;
  const parts: string[] = [];
  if (r.shareSize) parts.push(r.shareSize);
  if (r.valueEur != null) parts.push(formatEur(r.valueEur, lang));
  return (
    <span className="font-mono">
      <span className="text-muted-foreground">{yearLabel}</span>
      {parts.length > 0 && <span className="ml-1.5">{parts.join(" · ")}</span>}
    </span>
  );
};

export const StakeRow: FC<{ stake: ConsolidatedStake; lang: string }> = ({
  stake,
  lang,
}) => {
  const { t } = useTranslation();
  const Icon = stake.table === "11" ? ArrowRightLeft : Briefcase;
  const slug = stake.companySlug;
  const subtitle = [stake.itemType, stake.registeredOffice]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="grid grid-cols-[auto_1fr] gap-3 items-start py-2 border-b last:border-b-0">
      <Icon className="h-4 w-4 text-muted-foreground mt-0.5" />
      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-3">
          <div className="text-sm font-medium truncate">
            {slug ? (
              <Link
                to={`/mp/company/${encodeURIComponent(slug)}`}
                className="hover:underline"
              >
                {stake.companyName}
              </Link>
            ) : (
              stake.companyName
            )}
            {stake.table === "11" && (
              <span className="ml-2 text-xs font-normal text-muted-foreground italic">
                {t("stake_transferred") || "transferred"}
              </span>
            )}
          </div>
        </div>
        {subtitle && (
          <div className="text-xs text-muted-foreground truncate">
            {subtitle}
          </div>
        )}
        {stake.heldByOther && stake.holderName && (
          <div className="text-xs text-muted-foreground italic truncate">
            {stake.holderName}
          </div>
        )}
        {stake.ranges.length > 0 && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            {stake.ranges.map((r, i) => (
              <Fragment key={i}>
                {i > 0 && (
                  <span
                    aria-hidden
                    className="text-muted-foreground/60 select-none"
                  >
                    →
                  </span>
                )}
                <RangeLabel r={r} lang={lang} />
              </Fragment>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export const MpFinancialDeclarations: FC<{ name: string }> = ({ name }) => {
  const { t, i18n } = useTranslation();
  const { declarations, isLoading } = useMpDeclarations(name);

  const consolidated = useMemo(
    () => consolidate(declarations.filter((d) => d.ownershipStakes.length > 0)),
    [declarations],
  );

  const sourceDecls = useMemo(
    () =>
      [...declarations]
        .filter((d) => d.ownershipStakes.length > 0)
        .sort((a, b) => b.declarationYear - a.declarationYear),
    [declarations],
  );

  if (consolidated.length === 0) {
    // Reserve a placeholder card while declarations are loading so this
    // section doesn't pop in and push the rest of the candidate page down.
    if (isLoading) {
      return (
        <Card className="my-4" aria-hidden>
          <CardContent>
            <div className="min-h-[80px] sm:min-h-[180px]" />
          </CardContent>
        </Card>
      );
    }
    return null;
  }

  return (
    <Card className="my-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Briefcase className="h-4 w-4" />
          {t("business_interests") || "Business interests"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div>
          {consolidated.map((s) => (
            <StakeRow key={s.key} stake={s} lang={i18n.language} />
          ))}
        </div>
        {sourceDecls.length > 0 && (
          <div className="text-xs text-muted-foreground mt-3 pt-3 border-t flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>register.cacbg.bg:</span>
            {sourceDecls.map((d, i) => (
              <a
                key={i}
                href={d.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
                title={
                  d.fiscalYear != null
                    ? `${t("declaration_year") || "Declaration"} ${d.declarationYear} · ${t("fiscal_year") || "fiscal year"} ${d.fiscalYear}`
                    : `${t("declaration_year") || "Declaration"} ${d.declarationYear}`
                }
              >
                {d.declarationYear}
                <ExternalLink className="h-3 w-3" />
              </a>
            ))}
          </div>
        )}
        <div className="text-xs text-muted-foreground mt-3 pt-3 border-t">
          {t("source_declarations") ||
            "Source: property/interest declarations filed with the Bulgarian Court of Audit (Сметна палата). Sitting MPs cannot legally hold management roles, so this list covers ownership stakes only."}
        </div>
      </CardContent>
    </Card>
  );
};
