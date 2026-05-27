// Per-company panel rendering the EU-funds political-economy join for one
// beneficiary EIK. Mounted on /company/{eik}. Two-phase loader: the manifest
// answers "is this EIK flagged?" without a 404; if yes, fetch the small
// per-EIK shard.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ShieldAlert, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { usePoliticalForEik } from "@/data/funds/usePoliticalLinks";
import { summarizeFundsRelations } from "@/data/funds/relationLabel";
import {
  officialCategoryLabel,
  summarizeOfficialRoles,
} from "@/data/funds/officialLabels";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import { formatEur } from "@/lib/currency";

interface Props {
  eik?: string | null;
}

export const PoliticalLinksCard: FC<Props> = ({ eik }) => {
  const { t } = useTranslation();
  const { entry, isLoading } = usePoliticalForEik(eik);

  if (isLoading) return null;
  if (!entry) return null;

  const hasMps = entry.mps.length > 0;
  const hasOfficials = entry.officials.length > 0;

  return (
    <Card className="my-4 ring-1 ring-rose-200/60 dark:ring-rose-800/40">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="h-4 w-4 text-rose-600" />
          {t("company_political_title") || "Political-economy linkages"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-3 md:p-4">
        <p className="text-xs text-muted-foreground">
          {t("company_political_intro") ||
            "This beneficiary's declared owners or managers are politically-exposed persons (MPs, cabinet, governors, mayors, councillors). Information from Сметна палата declarations + Commerce Registry — not in itself an accusation of wrongdoing."}
        </p>

        {hasMps ? (
          <div className="space-y-1.5 rounded-md bg-amber-100/40 p-2.5 dark:bg-amber-900/20">
            <div className="text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-500">
              {t("company_political_mp_section") || "Sitting / former MPs"}
            </div>
            <ul className="space-y-1.5">
              {entry.mps.map((mp) => (
                <li
                  key={mp.mpId}
                  className="flex flex-wrap items-center gap-2 text-sm"
                >
                  <Link
                    to={`/candidate/mp-${mp.mpId}`}
                    className="inline-flex items-center gap-2 font-medium hover:underline"
                  >
                    <MpAvatar mpId={mp.mpId} name={mp.mpName} />
                    {mp.mpName}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    — {summarizeFundsRelations(t, mp.relations)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {hasOfficials ? (
          <div className="space-y-1.5 rounded-md bg-purple-100/40 p-2.5 dark:bg-purple-900/20">
            <div className="text-[10px] font-medium uppercase tracking-wide text-purple-700 dark:text-purple-400">
              {t("company_political_official_section") ||
                "Cabinet, governors, mayors, councillors"}
            </div>
            <ul className="space-y-1.5">
              {entry.officials.map((o) => (
                <li key={o.slug} className="text-sm">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">{o.name}</span>
                    <span className="text-xs font-medium text-purple-800 dark:text-purple-300">
                      {officialCategoryLabel(t, o.category)}
                    </span>
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {summarizeOfficialRoles(t, o.roles)}
                    {o.institution ? ` · ${o.institution}` : ""}
                    {o.municipality ? ` · ${o.municipality}` : ""}
                    {o.latestDeclarationYear
                      ? ` · ${t("officials_declaration_year") || "decl."} ${o.latestDeclarationYear}`
                      : ""}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5 text-sm">
          <div>
            <div className="text-[11px] text-muted-foreground">
              {t("company_political_funds_contracted") || "EU-funds contracted"}
            </div>
            <div className="font-semibold tabular-nums">
              {formatEur(entry.contractedEur)}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-muted-foreground">
              {t("company_political_funds_paid") || "Paid"}
            </div>
            <div className="font-semibold tabular-nums">
              {formatEur(entry.paidEur)}
            </div>
          </div>
          {entry.procurementEur > 0 ? (
            <div>
              <div className="text-[11px] text-muted-foreground">
                {t("company_political_proc_overlap") || "АОП overlap"}
              </div>
              <div className="font-semibold tabular-nums text-sky-700 dark:text-sky-400">
                {formatEur(entry.procurementEur)}
              </div>
            </div>
          ) : null}
          {entry.debarred ? (
            <div className="rounded bg-rose-200/70 px-2 py-1 text-[11px] font-semibold uppercase text-rose-900 dark:bg-rose-900/40 dark:text-rose-200">
              {t("funds_political_debarred") || "debarred"}
            </div>
          ) : null}
        </div>

        <Link
          to="/funds/political"
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          {t("company_political_view_all") ||
            "See the full politically-tied list"}
          <ExternalLink className="h-3 w-3" />
        </Link>
      </CardContent>
    </Card>
  );
};
