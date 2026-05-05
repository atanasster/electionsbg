import { FC, useMemo } from "react";
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
    ? t("tr_confidence_high") || "high"
    : t("tr_confidence_medium") || "medium";
  return (
    <span
      title={reason}
      className={
        isHigh
          ? "inline-flex items-center gap-1 rounded px-1 py-px text-[10px] font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200"
          : "inline-flex items-center gap-1 rounded px-1 py-px text-[10px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200"
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
  const key = `tr_role_${role}`;
  const translated = t(key);
  return translated && translated !== key ? translated : role;
};

type GroupedRole = {
  uic: string;
  companyName: string | null;
  legalForm: string | null;
  seat: string | null;
  status: string;
  confidence: "high" | "medium";
  confidenceReason: string;
  /** Earliest non-null erasedAt across the group, or null if any role is active. */
  erasedAt: string | null;
  isActive: boolean;
  roles: MpManagementRole[];
};

const groupRolesByUic = (roles: MpManagementRole[]): GroupedRole[] => {
  const map = new Map<string, GroupedRole>();
  for (const r of roles) {
    const existing = map.get(r.uic);
    if (!existing) {
      map.set(r.uic, {
        uic: r.uic,
        companyName: r.companyName,
        legalForm: r.legalForm,
        seat: r.seat,
        status: r.status,
        confidence: r.confidence,
        confidenceReason: r.confidenceReason,
        erasedAt: r.erasedAt,
        isActive: r.erasedAt === null,
        roles: [r],
      });
    } else {
      existing.roles.push(r);
      if (r.erasedAt === null) {
        existing.isActive = true;
        existing.erasedAt = null;
      } else if (existing.erasedAt !== null && r.erasedAt > existing.erasedAt) {
        existing.erasedAt = r.erasedAt;
      }
      if (r.confidence === "high" && existing.confidence !== "high") {
        existing.confidence = "high";
        existing.confidenceReason = r.confidenceReason;
      }
    }
  }
  return Array.from(map.values());
};

const RoleRow: FC<{ group: GroupedRole }> = ({ group }) => {
  const { t } = useTranslation();
  const ActiveIcon = group.isActive ? CheckCircle2 : Circle;

  const roleSummary = group.roles
    .map((r) => {
      const label = trRoleLabel(r.role, t);
      return r.positionLabel ? `${label} (${r.positionLabel})` : label;
    })
    .join(", ");

  return (
    <div className="grid grid-cols-[auto_1fr_auto] gap-2 items-center py-1 border-b last:border-b-0">
      <ActiveIcon
        className={
          group.isActive
            ? "h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400"
            : "h-3.5 w-3.5 text-muted-foreground"
        }
      />
      <div className="min-w-0">
        <div className="text-sm truncate">
          <span className="font-medium">{group.companyName ?? "—"}</span>
          {group.legalForm && (
            <span className="text-xs text-muted-foreground ml-1">
              {group.legalForm}
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            {" · "}
            {roleSummary}
            {" · "}
            {trStatusLabel(group.status, t)}
            {!group.isActive && group.erasedAt && (
              <>
                {" · "}
                {t("tr_role_ended") || "ended"} {group.erasedAt.slice(0, 10)}
              </>
            )}
          </span>
        </div>
        {group.seat && (
          <div className="text-[11px] text-muted-foreground truncate italic">
            {group.seat}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <ConfidenceBadge
          confidence={group.confidence}
          reason={group.confidenceReason}
        />
        <a
          href={`https://portal.registryagency.bg/CR/en/Reports/VerifiedPersonShortInfo?uic=${group.uic}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
        >
          {group.uic}
          <ExternalLink className="h-2.5 w-2.5" />
        </a>
      </div>
    </div>
  );
};

export const MpManagementRoles: FC<{ name: string }> = ({ name }) => {
  const { t } = useTranslation();
  const { management } = useMpManagement(name);

  const groups = useMemo(
    () => (management ? groupRolesByUic(management.roles) : []),
    [management],
  );

  if (!management || groups.length === 0) return null;

  return (
    <Card className="my-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" />
          {t("tr_management_roles") || "Management roles"}
          <span className="text-xs text-muted-foreground font-normal ml-1">
            ({groups.length})
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div>
          {groups.map((g) => (
            <RoleRow key={g.uic} group={g} />
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
