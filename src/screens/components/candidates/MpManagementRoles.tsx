import { FC } from "react";
import { useTranslation } from "react-i18next";
import { ShieldCheck, ExternalLink, CheckCircle2, Circle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useMpManagement } from "@/data/parliament/useMpManagement";
import type { MpManagementRole } from "@/data/dataTypes";

const ConfidenceBadge: FC<{
  confidence: "high" | "medium";
  reason: string;
}> = ({ confidence, reason }) => {
  const { t } = useTranslation();
  const isHigh = confidence === "high";
  const label = isHigh
    ? t("tr_confidence_high") || "high confidence"
    : t("tr_confidence_medium") || "medium confidence";
  return (
    <span
      title={reason}
      className={
        isHigh
          ? "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200"
          : "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200"
      }
    >
      <ShieldCheck className="h-2.5 w-2.5" />
      {label}
    </span>
  );
};

const trStatusLabel = (status: string, t: (k: string) => string): string => {
  switch (status) {
    case "active":
      return t("tr_status_active") || "active";
    case "in_liquidation":
      return t("tr_status_in_liquidation") || "in liquidation";
    case "bankrupt":
      return t("tr_status_bankrupt") || "bankrupt";
    case "ceased":
      return t("tr_status_ceased") || "ceased";
    case "erased":
      return t("tr_status_erased") || "erased";
    default:
      return status;
  }
};

const trRoleLabel = (role: string, t: (k: string) => string): string => {
  // We don't translate every role separately — the SQLite stores the raw
  // identifier and the i18n table provides the labels. Fall back to the raw
  // string if a key is missing.
  const key = `tr_role_${role}`;
  const translated = t(key);
  return translated && translated !== key ? translated : role;
};

const RoleRow: FC<{ role: MpManagementRole }> = ({ role }) => {
  const { t } = useTranslation();
  const isActive = role.erasedAt === null;
  const ActiveIcon = isActive ? CheckCircle2 : Circle;
  return (
    <div className="grid grid-cols-[auto_1fr_auto] gap-3 items-center py-2 border-b last:border-b-0">
      <ActiveIcon
        className={
          isActive
            ? "h-4 w-4 text-emerald-600 dark:text-emerald-400"
            : "h-4 w-4 text-muted-foreground"
        }
      />
      <div className="min-w-0">
        <div className="text-sm font-medium truncate">
          {role.companyName ?? "—"}
          {role.legalForm && (
            <span className="text-xs text-muted-foreground font-normal ml-1">
              {role.legalForm}
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground truncate">
          {trRoleLabel(role.role, t)}
          {role.positionLabel ? ` · ${role.positionLabel}` : ""}
          {" · "}
          {trStatusLabel(role.status, t)}
        </div>
        {role.seat && (
          <div className="text-xs text-muted-foreground truncate italic">
            {role.seat}
          </div>
        )}
      </div>
      <div className="text-right text-sm space-y-1">
        <ConfidenceBadge
          confidence={role.confidence}
          reason={role.confidenceReason}
        />
        <div className="text-[10px] text-muted-foreground">
          {isActive
            ? t("tr_currently_active") || "currently active"
            : `${t("tr_role_ended") || "ended"} ${role.erasedAt?.slice(0, 10)}`}
        </div>
        <a
          href={`https://portal.registryagency.bg/CR/en/Reports/VerifiedPersonShortInfo?uic=${role.uic}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
        >
          {t("tr_eik") || "UIC"} {role.uic}
          <ExternalLink className="h-2.5 w-2.5" />
        </a>
      </div>
    </div>
  );
};

export const MpManagementRoles: FC<{ name: string }> = ({ name }) => {
  const { t } = useTranslation();
  const { management } = useMpManagement(name);

  if (!management || management.roles.length === 0) return null;

  return (
    <Card className="my-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" />
          {t("tr_management_roles") || "Management roles"}
          <span className="text-xs text-muted-foreground font-normal ml-1">
            ({management.roles.length})
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div>
          {management.roles.map((r, i) => (
            <RoleRow key={`${r.uic}-${i}`} role={r} />
          ))}
        </div>
        <div className="text-xs text-muted-foreground mt-3 pt-3 border-t">
          {t("tr_source_commerce_registry") ||
            "Source: Bulgarian Commerce Registry (Търговски регистър) open data on data.egov.bg. Roles include both currently held and historical ones, since active management while seated is restricted by ЗПК Art. 35."}
        </div>
      </CardContent>
    </Card>
  );
};
