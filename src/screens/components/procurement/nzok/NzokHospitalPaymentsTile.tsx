// "Плащания към болниците" — the real money. Hospital care (болнична
// медицинска помощ) is НЗОК's single largest budget line (~€2.36bn/yr) and it is
// paid OUTSIDE public procurement, so it never appears in the contract ledger
// above. This tile surfaces it from НЗОК's own monthly per-facility report: the
// national YTD total, the top-paid hospitals, and the per-РЗОК split. Matched
// hospitals (via the Рег.№→EIK crosswalk) deep-link to their own /company/:eik
// page — reimbursement-in meets procurement-out. Pure from NzokHospitalPaymentsFile.

import { FC, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Building2, Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import { decodeEntities } from "@/lib/decodeEntities";
import { downloadCsv, toCsv } from "@/lib/downloadCsv";
import { monthYearLabel } from "@/lib/monthNames";
import type {
  NzokHospitalPaymentsFile,
  NzokOwnership,
} from "@/data/budget/types";
import {
  ownershipChipClass,
  ownershipColor,
  ownershipLabel,
  type OwnershipFilterValue,
} from "@/lib/nzokOwnership";
import { OwnershipFilter } from "./OwnershipFilter";

const TOP_N = 12;

export const NzokHospitalPaymentsTile: FC<{
  data: NzokHospitalPaymentsFile;
  /** Drop the card's own title when the band header already names it (avoids the
   *  band-title ↔ tile-title echo). The view toggle stays. */
  hideTitle?: boolean;
}> = ({ data, hideTitle }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const eur = (v: number) => formatEurCompact(v, lang);
  const [view, setView] = useState<"hospitals" | "rzok">("hospitals");
  const [own, setOwn] = useState<OwnershipFilterValue>("all");

  const total = data.totalCumulativeEur;

  // Private-vs-public split (the headline Диагноза cannot draw — they exclude
  // private). Ordered state → municipal → private → unclassified for the bar.
  const split = useMemo(() => {
    const bo = data.byOwnership;
    if (!bo) return null;
    const order: ("state" | "municipal" | "private" | "unclassified")[] = [
      "state",
      "municipal",
      "private",
      "unclassified",
    ];
    const segs = order
      .map((k) => ({ k, ...(bo[k] ?? { cumulativeEur: 0, facilityCount: 0 }) }))
      .filter((s) => s.cumulativeEur > 0);
    const sum = segs.reduce((a, s) => a + s.cumulativeEur, 0) || 1;
    const priv = bo.private?.cumulativeEur ?? 0;
    return { segs, sum, privShare: priv / sum, privEur: priv };
  }, [data.byOwnership]);

  if (total <= 0 || !data.hospitals.length) return null;
  const period = monthYearLabel(data.month, data.year, lang);

  const filteredHospitals =
    own === "all"
      ? data.hospitals
      : data.hospitals.filter((h) => h.ownership === own);

  const rows =
    view === "hospitals"
      ? filteredHospitals.slice(0, TOP_N).map((h) => ({
          key: h.regNo,
          label: h.name,
          sub: h.rzokName,
          value: h.cumulativeEur,
          eik: h.eik ?? null,
          ownership: h.ownership ?? null,
        }))
      : data.byRzok.map((r) => ({
          key: r.code,
          label: r.name,
          sub: `${r.facilityCount} ${bg ? "заведения" : "facilities"}`,
          value: r.cumulativeEur,
          eik: null as string | null,
          ownership: null as NzokOwnership | null,
        }));
  // Guard the ACTIVE view's array: the toggled view renders a different field
  // than the early-return guard checked, so an empty secondary array would make
  // Math.max(...[]) return -Infinity (every bar collapses to the 2% floor).
  const max = rows.length ? Math.max(...rows.map((r) => r.value)) : 1;

  // CSV export — the FULL facility list (not the top-12 shown), with ownership,
  // so a reader can audit the private-vs-public split themselves.
  const exportCsv = () => {
    const csv = toCsv(data.hospitals, [
      { header: "reg_no", value: (h) => h.regNo },
      { header: "name", value: (h) => decodeEntities(h.name) },
      { header: "eik", value: (h) => h.eik ?? "" },
      { header: "ownership", value: (h) => h.ownership ?? "unclassified" },
      { header: "rzok", value: (h) => h.rzokName },
      { header: "cumulative_eur", value: (h) => h.cumulativeEur },
      { header: "month_eur", value: (h) => h.monthEur },
    ]);
    downloadCsv(
      `nzok-hospital-payments-${data.year}-${String(data.month).padStart(2, "0")}`,
      csv,
    );
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div
          className={`flex flex-wrap items-center gap-2 ${
            hideTitle ? "justify-end" : "justify-between"
          }`}
        >
          {!hideTitle && (
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              {bg ? "Плащания към болниците" : "Payments to hospitals"}
            </CardTitle>
          )}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={exportCsv}
              title={bg ? "Свали като CSV" : "Download as CSV"}
              aria-label={bg ? "Свали като CSV" : "Download as CSV"}
              className="rounded-full border border-border bg-background p-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              <Download className="h-3.5 w-3.5" />
            </button>
            <div
              className="flex gap-1"
              role="group"
              aria-label={bg ? "Изглед" : "View"}
            >
              {(["hospitals", "rzok"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  aria-pressed={v === view}
                  className={`rounded-full border px-2 py-0.5 text-xs font-medium transition-colors ${
                    v === view
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-background text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {v === "hospitals"
                    ? bg
                      ? "Болници"
                      : "Hospitals"
                    : bg
                      ? "По РЗОК"
                      : "By region"}
                </button>
              ))}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        {/* National headline */}
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-2xl font-bold tabular-nums">{eur(total)}</span>
          <span className="text-sm text-muted-foreground">
            {bg
              ? `изплатени на ${data.facilityCount} лечебни заведения за болнична помощ (натрупано до ${period})`
              : `paid to ${data.facilityCount} hospitals for inpatient care (cumulative to ${period})`}
          </span>
        </div>

        {/* Private-vs-public split — the slice a state/municipal-only scope hides. */}
        {split && split.segs.length > 1 && (
          <div className="space-y-1.5 rounded-lg border bg-muted/30 p-2.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-2">
              <span className="text-xs font-medium">
                {bg
                  ? "Публични срещу частни болници"
                  : "Public vs private hospitals"}
              </span>
              <span className="text-xs text-muted-foreground">
                {bg ? "към частни: " : "to private: "}
                <span className="font-semibold text-amber-700 dark:text-amber-400 tabular-nums">
                  {eur(split.privEur)} ·{" "}
                  {(split.privShare * 100).toLocaleString(lang, {
                    maximumFractionDigits: 0,
                  })}
                  %
                </span>
              </span>
            </div>
            <div className="flex h-2.5 w-full overflow-hidden rounded-full">
              {split.segs.map((s) => (
                <div
                  key={s.k}
                  style={{
                    width: `${(s.cumulativeEur / split.sum) * 100}%`,
                    backgroundColor: ownershipColor(s.k),
                  }}
                  title={`${ownershipLabel(s.k, bg)}: ${eur(s.cumulativeEur)}`}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5">
              {split.segs.map((s) => (
                <span
                  key={s.k}
                  className="flex items-center gap-1 text-[11px] text-muted-foreground"
                >
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: ownershipColor(s.k) }}
                  />
                  {ownershipLabel(s.k, bg)}{" "}
                  <span className="tabular-nums">
                    {((s.cumulativeEur / split.sum) * 100).toLocaleString(
                      lang,
                      { maximumFractionDigits: 0 },
                    )}
                    %
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Ownership filter (hospitals view only — the РЗОК rollup has no owner). */}
        {view === "hospitals" && data.byOwnership && (
          <OwnershipFilter value={own} onChange={setOwn} bg={bg} />
        )}

        {/* Ranked list */}
        <div className="space-y-2">
          {rows.map((r) => {
            const share = r.value / total;
            return (
              <div key={r.key} className="text-xs">
                <div className="flex items-baseline justify-between gap-2 mb-0.5">
                  <span className="flex min-w-0 items-baseline gap-1.5">
                    {r.eik ? (
                      <Link
                        to={`/company/${r.eik}`}
                        className="min-w-0 truncate font-medium text-accent hover:underline"
                      >
                        {decodeEntities(r.label)}
                      </Link>
                    ) : (
                      <span className="min-w-0 truncate font-medium">
                        {decodeEntities(r.label)}
                      </span>
                    )}
                    {r.ownership && (
                      <span
                        className={`shrink-0 rounded-full border px-1.5 py-px text-[10px] font-medium leading-none ${ownershipChipClass(
                          r.ownership,
                        )}`}
                      >
                        {ownershipLabel(r.ownership, bg)}
                      </span>
                    )}
                  </span>
                  <span className="tabular-nums text-muted-foreground shrink-0">
                    {eur(r.value)}
                    <span className="ml-1 text-muted-foreground/70">
                      {(share * 100).toLocaleString(lang, {
                        maximumFractionDigits: 1,
                      })}
                      %
                    </span>
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }}
                  />
                </div>
                {r.sub && (
                  <div className="mt-0.5 text-[11px] text-muted-foreground/70">
                    {r.sub}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? `Източник: месечният отчет на НЗОК „Заплатени здравноосигурителни плащания за БМП по лечебни заведения". Сумите са кумулативни от началото на ${data.year} г. и се плащат извън обществените поръчки.`
            : `Source: НЗОК's monthly "hospital-care payments by facility" report. Figures are cumulative from the start of ${data.year} and are paid outside public procurement.`}
        </p>
      </CardContent>
    </Card>
  );
};
