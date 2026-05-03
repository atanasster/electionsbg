import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Briefcase, ExternalLink, ArrowRightLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useMpDeclarations } from "@/data/parliament/useMpDeclarations";
import type {
  MpDeclaration,
  MpOwnershipStake,
} from "@/data/dataTypes";

const formatBgn = (n: number | null, lang: string): string => {
  if (n == null) return "—";
  try {
    return new Intl.NumberFormat(lang === "bg" ? "bg-BG" : "en-GB", {
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return String(n);
  }
};

const StakeRow: FC<{
  stake: MpOwnershipStake;
  declarantName: string;
  lang: string;
}> = ({ stake, declarantName, lang }) => {
  const Icon = stake.table === "11" ? ArrowRightLeft : Briefcase;
  const slug = stake.companySlug ?? null;
  const name = stake.companyName ?? "—";
  const holder = stake.holderName?.trim();
  // Show holder only when it's not the declarant (i.e. spouse / family member)
  const heldByOther =
    holder &&
    holder.toLowerCase() !== declarantName.trim().toLowerCase();
  return (
    <div className="grid grid-cols-[auto_1fr_auto] gap-3 items-center py-2 border-b last:border-b-0">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <div className="min-w-0">
        <div className="text-sm font-medium truncate">
          {slug ? (
            <Link
              to={`/mp/company/${encodeURIComponent(slug)}`}
              className="hover:underline"
            >
              {name}
            </Link>
          ) : (
            name
          )}
        </div>
        <div className="text-xs text-muted-foreground truncate">
          {[stake.itemType, stake.registeredOffice]
            .filter(Boolean)
            .join(" · ") || "—"}
        </div>
        {heldByOther && (
          <div className="text-xs text-muted-foreground italic truncate">
            {holder}
          </div>
        )}
      </div>
      <div className="text-right text-sm">
        {stake.shareSize && (
          <div className="font-mono text-xs">{stake.shareSize}</div>
        )}
        {stake.valueBgn != null && (
          <div className="text-xs text-muted-foreground">
            {formatBgn(stake.valueBgn, lang)} лв
          </div>
        )}
      </div>
    </div>
  );
};

const DeclarationCard: FC<{ decl: MpDeclaration; lang: string }> = ({
  decl,
  lang,
}) => {
  const { t } = useTranslation();
  const stakes = decl.ownershipStakes;
  if (stakes.length === 0) return null;

  return (
    <div className="mb-4">
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-sm font-semibold">
          {t("declaration_year") || "Declaration"} {decl.declarationYear}
          {decl.fiscalYear != null && (
            <span className="text-xs text-muted-foreground font-normal ml-2">
              ({t("fiscal_year") || "fiscal year"} {decl.fiscalYear})
            </span>
          )}
        </div>
        <a
          href={decl.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          register.cacbg.bg
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
      <div>
        {stakes.map((s, i) => (
          <StakeRow
            key={i}
            stake={s}
            declarantName={decl.declarantName}
            lang={lang}
          />
        ))}
      </div>
    </div>
  );
};

export const MpFinancialDeclarations: FC<{ name: string }> = ({ name }) => {
  const { t, i18n } = useTranslation();
  const { declarations } = useMpDeclarations(name);

  const withStakes = declarations.filter((d) => d.ownershipStakes.length > 0);
  if (withStakes.length === 0) return null;

  return (
    <Card className="my-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Briefcase className="h-4 w-4" />
          {t("business_interests") || "Business interests"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {withStakes.map((d, i) => (
          <DeclarationCard key={i} decl={d} lang={i18n.language} />
        ))}
        <div className="text-xs text-muted-foreground mt-3 pt-3 border-t">
          {t("source_declarations") ||
            "Source: property/interest declarations filed with the Bulgarian Court of Audit (Сметна палата). Sitting MPs cannot legally hold management roles, so this list covers ownership stakes only."}
        </div>
      </CardContent>
    </Card>
  );
};
