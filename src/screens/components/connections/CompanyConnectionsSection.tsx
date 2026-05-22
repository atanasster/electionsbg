// Commerce-Registry connections section for the /company/:eik page. Reads the
// per-EIK file (company-connections/{eik}.json) and renders the officers of
// this company who personally hold public office, plus politicians reached one
// company-hop away. Renders nothing when the company has no political link.

import { FC, useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Network, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { candidateUrlForMp } from "@/data/candidates/candidateSlug";
import { MpAvatar } from "../candidates/MpAvatar";
import {
  useCompanyConnections,
  type ConnPowerRef,
} from "@/data/parliament/useCompanyConnections";

const powerHref = (p: ConnPowerRef): string =>
  p.kind === "mp"
    ? candidateUrlForMp(Number(p.refId))
    : `/officials/${p.refId}`;

export const CompanyConnectionsSection: FC<{ eik?: string }> = ({ eik }) => {
  const { t } = useTranslation();
  const { connections } = useCompanyConnections(eik);

  const sorted = useMemo(() => {
    if (!connections) return null;
    return {
      direct: [...connections.directLinks].sort((a, b) =>
        a.power.name.localeCompare(b.power.name, "bg"),
      ),
      bridged: [...connections.bridgedLinks].sort(
        (a, b) =>
          a.power.name.localeCompare(b.power.name, "bg") ||
          (a.viaCompany ?? "").localeCompare(b.viaCompany ?? "", "bg"),
      ),
    };
  }, [connections]);

  if (!connections || !sorted) return null;
  if (sorted.direct.length === 0 && sorted.bridged.length === 0) return null;

  const trRole = (role: string): string => t(`tr_role_${role}`, role);
  const powerSubtitle = (p: ConnPowerRef): string =>
    p.kind === "mp"
      ? t("company_conn_kind_mp") + (p.party ? ` · ${p.party}` : "")
      : (p.roleLabel ?? t("company_conn_official"));

  const PowerLink: FC<{ p: ConnPowerRef }> = ({ p }) => (
    <Link
      to={powerHref(p)}
      className="font-medium hover:underline inline-flex items-center gap-2"
    >
      {p.kind === "mp" ? (
        <MpAvatar mpId={Number(p.refId)} name={p.name} />
      ) : null}
      {p.name}
    </Link>
  );

  return (
    <Card className="my-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Network className="h-4 w-4 text-muted-foreground" />
          {t("company_conn_title") || "Connections to people in power"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-4">
        <p className="text-[11px] text-muted-foreground">
          {t("company_conn_note")}
        </p>

        {sorted.direct.length > 0 ? (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
              {t("company_conn_direct")} ({sorted.direct.length})
            </h3>
            <ul className="divide-y text-sm">
              {sorted.direct.map((d, i) => (
                <li
                  key={`d-${d.power.kind}-${d.power.refId}-${i}`}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5"
                >
                  <PowerLink p={d.power} />
                  <span className="text-xs text-muted-foreground">
                    {powerSubtitle(d.power)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    · {trRole(d.officerRole)}
                    {!d.isCurrent ? ` (${t("company_conn_former")})` : ""}{" "}
                    {t("company_conn_here")}
                  </span>
                  {d.confidence === "low" ? (
                    <span className="rounded bg-muted px-1 py-px text-[10px] text-muted-foreground">
                      {t("company_conn_namematch")}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {sorted.bridged.length > 0 ? (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
              {t("company_conn_bridge")} ({sorted.bridged.length})
            </h3>
            <ul className="divide-y text-sm">
              {sorted.bridged.map((b, i) => (
                <li
                  key={`b-${b.viaEik}-${b.power.refId}-${i}`}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2"
                >
                  <span className="text-xs text-muted-foreground">
                    {b.bridgeName} · {trRole(b.bridgeRole)}
                  </span>
                  <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <Link
                    to={`/company/${b.viaEik}`}
                    className="text-primary hover:underline"
                  >
                    {b.viaCompany ?? `ЕИК ${b.viaEik}`}
                  </Link>
                  <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <PowerLink p={b.power} />
                  <span className="text-xs text-muted-foreground">
                    {powerSubtitle(b.power)}
                  </span>
                </li>
              ))}
            </ul>
            {connections.truncated ? (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {t("company_conn_truncated")}
              </p>
            ) : null}
          </div>
        ) : null}

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
            {t("company_conn_officers")} ({connections.officers.length})
          </h3>
          <ul className="text-xs text-muted-foreground space-y-0.5">
            {connections.officers.map((o, i) => (
              <li key={`o-${i}`}>
                {o.name} — {trRole(o.role)}
                {!o.isCurrent ? ` (${t("company_conn_former")})` : ""}
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
};
