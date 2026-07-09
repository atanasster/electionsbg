// /funds/contract/{number} — single-contract detail page. Reads one tiny
// per-contract shard (~1-2 KB). The contractNumber from the URL is the
// stable ИСУН identifier (e.g. "BG16RFOP002-2.002-0393"). Shows the full
// FundsProject record with cross-links to the beneficiary (`/company/`),
// the programme (`/funds/programme/`), and the implementation place
// (`/settlement/`).

import { FC } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Building2,
  Calendar,
  Clock,
  Coins,
  Hash,
  Layers,
  MapPin,
} from "lucide-react";
import { Title } from "@/ux/Title";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useFundsContract } from "@/data/funds/useFundsContract";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { useSettlementsInfo } from "@/data/settlements/useSettlements";
import { orgTypeLabel, orgFormLabel } from "@/data/funds/orgLabels";

const eurFull = (v: number): string =>
  `€${Math.round(v).toLocaleString("en-US")}`;

const compactEur = (v: number): string => {
  if (v >= 1_000_000_000) return `€${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `€${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `€${(v / 1_000).toFixed(0)}k`;
  return `€${v.toLocaleString("en-US")}`;
};

const statusChipClass = (status: string): string => {
  if (status.startsWith("Приключен"))
    return "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100";
  if (status.startsWith("В изпълнение"))
    return "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100";
  if (status === "Сключен")
    return "bg-slate-100 text-slate-900 dark:bg-slate-900/40 dark:text-slate-100";
  if (status.startsWith("Прекратен"))
    return "bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-100";
  return "bg-muted text-muted-foreground";
};

const statusChipI18nKey = (status: string): string => {
  if (status.startsWith("Приключен")) return "funds_tile_status_completed";
  if (status.startsWith("В изпълнение")) return "funds_tile_status_in_progress";
  if (status === "Сключен") return "funds_tile_status_signed";
  if (status.startsWith("Прекратен")) return "funds_tile_status_terminated";
  return "funds_tile_status_other";
};

export const FundsContractScreen: FC = () => {
  const { number } = useParams();
  const { t, i18n } = useTranslation();
  const { data, isLoading } = useFundsContract(number);
  const { findMunicipality } = useMunicipalities();
  const { findSettlement } = useSettlementsInfo();
  const lang = i18n.language;

  if (isLoading) {
    return (
      <section className="my-4">
        <div className="h-32 rounded-xl border bg-card animate-pulse" />
      </section>
    );
  }
  if (!data) {
    return (
      <section className="my-4 space-y-3">
        <Link
          to="/funds"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden />
          {t("funds_program_back")}
        </Link>
        <p className="text-sm text-muted-foreground">
          {t("funds_contract_not_found", { number })}
        </p>
      </section>
    );
  }

  const disbursementPct =
    data.totalEur > 0 ? Math.min(100, (data.paidEur / data.totalEur) * 100) : 0;

  // Resolve the place link target. For settlement-kind locations we link to
  // the EKATTE settlement page; for muni-kind we link to the first listed
  // обshtina. Region / national / unresolved get no link (no single place).
  let placeLink: string | null = null;
  let placeLabel = data.location.raw;
  if (data.location.kind === "settlement" && data.location.ekatte) {
    const info = findSettlement(data.location.ekatte);
    placeLink = `/settlement/${data.location.ekatte}`;
    if (info)
      placeLabel =
        lang === "bg" ? `${info.t_v_m ?? ""}${info.name}` : info.name_en;
  } else if (data.location.kind === "muni" && data.location.munis?.length) {
    const muni = data.location.munis[0];
    const info = findMunicipality(muni);
    placeLink = `/settlement/${muni}`;
    if (info) placeLabel = lang === "bg" ? info.name : info.name_en;
  }

  return (
    <>
      <Title description={data.title}>
        <span className="line-clamp-3 text-left">{data.title}</span>
      </Title>
      <section aria-label={data.contractNumber} className="my-4 space-y-4">
        <div className="flex items-baseline justify-between flex-wrap gap-3">
          <Link
            to={`/funds/programme/${data.programCode}`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" aria-hidden />
            {data.programName}
          </Link>
          <div className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
            <Hash className="h-3 w-3" aria-hidden />
            {data.contractNumber}
            <span
              className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${statusChipClass(data.status)}`}
              title={data.status}
            >
              {t(statusChipI18nKey(data.status))}
            </span>
          </div>
        </div>

        {/* Amount KPIs */}
        <Card>
          <CardContent className="p-3 md:p-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <div className="text-xs text-muted-foreground">
                  {t("funds_contract_total")}
                </div>
                <div className="text-2xl font-bold tabular-nums">
                  {compactEur(data.totalEur)}
                </div>
                <div className="text-[11px] text-muted-foreground tabular-nums">
                  {eurFull(data.totalEur)}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">
                  {t("funds_contract_grant")}
                </div>
                <div className="text-2xl font-bold tabular-nums">
                  {compactEur(data.grantEur)}
                </div>
                <div className="text-[11px] text-muted-foreground tabular-nums">
                  {data.ownCofinanceEur > 0
                    ? `${compactEur(data.ownCofinanceEur)} ${t("funds_contract_own_cofinance_short")}`
                    : t("funds_contract_full_grant")}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">
                  {t("funds_contract_paid")}
                </div>
                <div className="text-2xl font-bold tabular-nums">
                  {compactEur(data.paidEur)}
                </div>
                <div className="text-[11px] text-muted-foreground tabular-nums">
                  {eurFull(data.paidEur)}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">
                  {t("funds_contract_disbursement")}
                </div>
                <div className="text-2xl font-bold tabular-nums">
                  {disbursementPct.toFixed(0)}%
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {t("funds_status_tile_disbursement_short")}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Cross-links: beneficiary, programme, location, duration */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {t("funds_contract_meta_section")}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 md:p-4 space-y-3 text-sm">
            <div className="flex items-start gap-3">
              <Building2
                className="h-4 w-4 text-amber-600 mt-0.5"
                aria-hidden
              />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-muted-foreground">
                  {t("funds_contract_beneficiary")}
                </div>
                {data.beneficiaryEik ? (
                  <Link
                    to={`/company/${data.beneficiaryEik}`}
                    className="font-medium hover:underline"
                  >
                    {data.beneficiaryName}
                  </Link>
                ) : (
                  <span className="font-medium">{data.beneficiaryName}</span>
                )}
                <div className="text-xs text-muted-foreground">
                  {orgTypeLabel(data.orgType, lang)} ·{" "}
                  {orgFormLabel(data.orgForm, lang)}
                  {data.orgKind ? ` · ${data.orgKind}` : ""}
                </div>
                <div className="text-[11px] text-muted-foreground line-clamp-1">
                  {data.hqAddress}
                </div>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Layers className="h-4 w-4 text-amber-600 mt-0.5" aria-hidden />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-muted-foreground">
                  {t("funds_contract_programme")}
                </div>
                <Link
                  to={`/funds/programme/${data.programCode}`}
                  className="font-medium hover:underline"
                >
                  {data.programName}
                </Link>
                <div className="text-[11px] text-muted-foreground tabular-nums">
                  {data.programCode}
                </div>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <MapPin className="h-4 w-4 text-emerald-600 mt-0.5" aria-hidden />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-muted-foreground">
                  {t("funds_contract_location")}
                </div>
                {placeLink ? (
                  <Link to={placeLink} className="font-medium hover:underline">
                    {placeLabel}
                  </Link>
                ) : (
                  <span className="font-medium">{placeLabel}</span>
                )}
                <div className="text-[11px] text-muted-foreground">
                  {t(`funds_geo_tile_${data.location.kind}`)}
                  {data.location.raw !== placeLabel
                    ? ` · ${t("funds_contract_raw_label")}: ${data.location.raw}`
                    : ""}
                </div>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Clock className="h-4 w-4 text-sky-600 mt-0.5" aria-hidden />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-muted-foreground">
                  {t("funds_contract_duration")}
                </div>
                <div className="font-medium tabular-nums">
                  {data.durationMonths}{" "}
                  {t("funds_contract_months", { count: data.durationMonths })}
                </div>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Calendar
                className="h-4 w-4 text-muted-foreground mt-0.5"
                aria-hidden
              />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-muted-foreground">
                  {t("funds_contract_status")}
                </div>
                <div className="font-medium">{data.status}</div>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Coins
                className="h-4 w-4 text-muted-foreground mt-0.5"
                aria-hidden
              />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-muted-foreground">
                  {t("funds_contract_isun_link")}
                </div>
                <div className="text-sm font-medium tabular-nums">
                  {data.contractNumber}
                </div>
                {/* ИСУН keys its per-project detail pages by an internal GUID, not
                    the public contract number, so there is no stable deep link we
                    can build from our data (a ?contractId=<number> URL 404s). Link
                    to the public project search instead — the number above is
                    copy-pasteable into it. */}
                <a
                  href="https://2020.eufunds.bg/bg/0/0/Project/Search"
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-primary hover:underline"
                >
                  {t("funds_contract_isun_search")} →
                </a>
              </div>
            </div>
          </CardContent>
        </Card>

        <p className="text-[11px] text-muted-foreground">
          {t("funds_contract_source_hint")}
        </p>
      </section>
    </>
  );
};
