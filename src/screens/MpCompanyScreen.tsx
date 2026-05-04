import { FC, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Briefcase,
  ExternalLink,
  MapPin,
  ArrowRightLeft,
  Building2,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Title } from "@/ux/Title";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import {
  useCompanyIndex,
  type CompanyIndexStake,
} from "@/data/parliament/useCompanyIndex";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import type { TrCompanyOfficer } from "@/data/dataTypes";

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

const StakeIcon: FC<{ stake: CompanyIndexStake }> = ({ stake }) =>
  stake.table === "11" ? (
    <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
  ) : (
    <Briefcase className="h-4 w-4 text-muted-foreground" />
  );

const STATUS_CLASSES: Record<string, string> = {
  active:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200",
  in_liquidation:
    "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200",
  bankrupt: "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-200",
  ceased: "bg-gray-200 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
  erased: "bg-gray-200 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
};

const StatusBadge: FC<{ status: string }> = ({ status }) => {
  const { t } = useTranslation();
  const cls = STATUS_CLASSES[status] ?? STATUS_CLASSES.active;
  const label = t(`tr_status_${status}`) || status;
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-[11px] font-medium ${cls}`}
    >
      {label}
    </span>
  );
};

const trRoleLabel = (role: string, t: (k: string) => string): string => {
  const key = `tr_role_${role}`;
  const translated = t(key);
  return translated && translated !== key ? translated : role;
};

const OfficerRow: FC<{ officer: TrCompanyOfficer }> = ({ officer }) => {
  const { t } = useTranslation();
  const isMp = officer.matchedMpId != null;
  return (
    <div className="grid grid-cols-[1fr_auto] gap-3 items-center py-2 border-b last:border-b-0">
      <div className="min-w-0">
        <div className="text-sm font-medium truncate flex items-center gap-1.5">
          {isMp && <MpAvatar mpId={officer.matchedMpId} name={officer.name} />}
          {isMp ? (
            <Link
              to={`/candidate/${encodeURIComponent(officer.name)}`}
              className="hover:underline"
            >
              {officer.name}
            </Link>
          ) : (
            officer.name
          )}
          {isMp && (
            <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-primary/10 text-primary">
              <ShieldCheck className="h-2.5 w-2.5" />
              {t("tr_is_mp") || "MP"}
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground truncate">
          {trRoleLabel(officer.role, t)}
          {officer.positionLabel ? ` · ${officer.positionLabel}` : ""}
        </div>
      </div>
      <div className="text-right text-xs text-muted-foreground">
        {officer.sharePercent != null && (
          <div className="font-mono">{officer.sharePercent}%</div>
        )}
        {officer.addedAt && <div>{officer.addedAt.slice(0, 10)}</div>}
      </div>
    </div>
  );
};

export const MpCompanyScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const { slug: rawSlug } = useParams();
  const slug = rawSlug ? decodeURIComponent(rawSlug) : "";
  const { bySlug, isLoading } = useCompanyIndex();

  const company = useMemo(
    () => (slug ? bySlug.get(slug) : undefined),
    [bySlug, slug],
  );

  if (isLoading) {
    return (
      <div className="w-full px-4 md:px-8 py-6 text-sm text-muted-foreground">
        {t("loading") || "Loading…"}
      </div>
    );
  }

  if (!company) {
    return (
      <div className="w-full px-4 md:px-8 py-6">
        <Title description="Company not found">
          {t("company_not_found") || "Company not found"}
        </Title>
        <p className="text-sm text-muted-foreground">{slug}</p>
      </div>
    );
  }

  const tr = company.tr;

  return (
    <div className="w-full px-4 md:px-8">
      <Title description={`MP-declared company: ${company.displayName}`}>
        {company.displayName}
      </Title>

      {tr && (
        <Card className="my-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2 flex-wrap">
              <Building2 className="h-4 w-4" />
              <span>{t("tr_commerce_registry") || "Commerce Registry"}</span>
              <StatusBadge status={tr.status} />
              <a
                href={`https://portal.registryagency.bg/CR/en/Reports/VerifiedPersonShortInfo?uic=${tr.uic}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline font-normal"
              >
                {t("tr_eik") || "UIC"} {tr.uic}
                <ExternalLink className="h-3 w-3" />
              </a>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {tr.seat && (
              <div className="flex items-start gap-1.5 text-sm text-muted-foreground mb-4">
                <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>{tr.seat}</span>
              </div>
            )}

            {tr.currentOfficers.length > 0 && (
              <div className="mb-4">
                <div className="text-sm font-semibold mb-1 flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5" />
                  {t("tr_current_officers") || "Current officers"}
                  <span className="text-xs text-muted-foreground font-normal">
                    ({tr.currentOfficers.length})
                  </span>
                </div>
                {tr.currentOfficers.map((o, i) => (
                  <OfficerRow key={`o-${i}`} officer={o} />
                ))}
              </div>
            )}

            {tr.currentOwners.length > 0 && (
              <div>
                <div className="text-sm font-semibold mb-1 flex items-center gap-1.5">
                  <Briefcase className="h-3.5 w-3.5" />
                  {t("tr_current_owners") || "Current owners"}
                  <span className="text-xs text-muted-foreground font-normal">
                    ({tr.currentOwners.length})
                  </span>
                </div>
                {tr.currentOwners.map((o, i) => (
                  <OfficerRow key={`p-${i}`} officer={o} />
                ))}
              </div>
            )}

            {tr.currentOfficers.length === 0 &&
              tr.currentOwners.length === 0 && (
                <div className="text-sm text-muted-foreground italic">
                  {t("tr_no_current_records") ||
                    "No currently-active officers or owners on file."}
                </div>
              )}

            {tr.lastUpdated && (
              <div className="text-xs text-muted-foreground mt-3 pt-3 border-t">
                {t("tr_last_updated") || "Last updated"}{" "}
                {tr.lastUpdated.slice(0, 10)}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="my-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Briefcase className="h-4 w-4" />
            {t("company_stakes_held_by_mps") || "Stakes declared by MPs"} (
            {company.stakes.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {company.registeredOffices.length > 0 && (
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground mb-4">
              <MapPin className="h-3.5 w-3.5" />
              <span>{company.registeredOffices.join(" · ")}</span>
            </div>
          )}

          <div>
            {company.stakes.map((entry, i) => (
              <div
                key={i}
                className="grid grid-cols-[auto_auto_1fr_auto] gap-3 items-center py-3 border-b last:border-b-0"
              >
                <StakeIcon stake={entry.stake} />
                <MpAvatar name={entry.declarantName} mpId={entry.mpId} />
                <div className="min-w-0">
                  <Link
                    to={`/candidate/${encodeURIComponent(entry.declarantName)}`}
                    className="text-sm font-medium hover:underline truncate block"
                  >
                    {entry.declarantName}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {entry.institution}
                    {" · "}
                    {t("declaration_year") || "Declaration"}{" "}
                    {entry.declarationYear}
                    {entry.stake.table === "11" && (
                      <>
                        {" · "}
                        {t("stake_transferred") || "transferred"}
                      </>
                    )}
                  </div>
                  {entry.stake.legalBasis && (
                    <div className="text-xs text-muted-foreground">
                      {entry.stake.legalBasis}
                      {entry.stake.fundsOrigin
                        ? ` · ${entry.stake.fundsOrigin}`
                        : ""}
                    </div>
                  )}
                </div>
                <div className="text-right text-sm">
                  {entry.stake.shareSize && (
                    <div className="font-mono text-xs">
                      {entry.stake.shareSize}
                    </div>
                  )}
                  {entry.stake.valueBgn != null && (
                    <div className="text-xs text-muted-foreground">
                      {formatBgn(entry.stake.valueBgn, i18n.language)} лв
                    </div>
                  )}
                  <a
                    href={entry.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
                  >
                    {t("source") || "source"}
                    <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                </div>
              </div>
            ))}
          </div>

          <div className="text-xs text-muted-foreground mt-4 pt-3 border-t">
            {t("source_declarations") ||
              "Source: property and interest declarations filed with the Bulgarian Court of Audit (Сметна палата). Sitting MPs cannot legally hold management roles, so this list covers ownership stakes only."}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
