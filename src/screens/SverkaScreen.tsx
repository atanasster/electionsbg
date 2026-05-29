// National officials-vs-CIK reconciliation overview.
//
// Sortable table of all 287 municípios with their diff status, mayor
// comparison, and council match counts. Mismatches first so the
// journalistic signal is visible immediately.

import { FC, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CheckCircle2, AlertTriangle, Clock } from "lucide-react";
import { useOfficialsDiff } from "@/data/local/useOfficialsDiff";
import { useLatestLocalCycle } from "@/data/local/useLatestLocalCycle";
import {
  MunicipalityOfficialsDiff,
  OfficialsDiffOverall,
} from "@/data/local/types";

type Filter = "all" | OfficialsDiffOverall;

const STATUS_TONE: Record<
  OfficialsDiffOverall,
  { color: string; bg: string; Icon: typeof CheckCircle2; labelKey: string }
> = {
  match: {
    color: "text-emerald-600",
    bg: "bg-emerald-50",
    Icon: CheckCircle2,
    labelKey: "sverka_status_match",
  },
  partial_mismatch: {
    color: "text-amber-600",
    bg: "bg-amber-50",
    Icon: AlertTriangle,
    labelKey: "sverka_status_partial",
  },
  mismatch: {
    color: "text-red-600",
    bg: "bg-red-50",
    Icon: AlertTriangle,
    labelKey: "sverka_status_mismatch",
  },
  missing: {
    color: "text-muted-foreground",
    bg: "bg-muted",
    Icon: Clock,
    labelKey: "sverka_status_missing",
  },
};

const FILTERS: Filter[] = [
  "all",
  "mismatch",
  "partial_mismatch",
  "missing",
  "match",
];

const StatusPill: FC<{ status: OfficialsDiffOverall }> = ({ status }) => {
  const { t } = useTranslation();
  const tone = STATUS_TONE[status];
  const Icon = tone.Icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${tone.bg} ${tone.color}`}
    >
      <Icon className="size-3" />
      {t(tone.labelKey)}
    </span>
  );
};

const MayorCell: FC<{ m: MunicipalityOfficialsDiff["mayor"] }> = ({ m }) => {
  switch (m.status) {
    case "match":
      return (
        <span className="text-sm">{m.cikName ?? m.officialName ?? "—"}</span>
      );
    case "replaced":
      return (
        <span className="text-sm">
          <span>{m.cikName}</span>
          <span className="mx-1.5 text-muted-foreground">→</span>
          <span className="text-amber-700">{m.officialName}</span>
        </span>
      );
    case "missing_official":
      return (
        <span className="text-sm">
          <span>{m.cikName}</span>
          <span className="ml-1.5 text-[11px] text-muted-foreground">
            (без декларация)
          </span>
        </span>
      );
    case "missing_cik":
      return (
        <span className="text-sm">
          <span className="text-muted-foreground">— </span>
          <span>{m.officialName}</span>
        </span>
      );
  }
};

export const SverkaScreen: FC = () => {
  const { t } = useTranslation();
  const cycle = useLatestLocalCycle();
  const { data } = useOfficialsDiff(cycle);
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = useMemo(() => {
    if (!data) return [];
    if (filter === "all") return data.municipalities;
    return data.municipalities.filter((m) => m.overallStatus === filter);
  }, [data, filter]);

  if (!data) {
    return (
      <main className="container mx-auto px-4 py-6">
        <h1 className="text-2xl font-semibold">{t("sverka_title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("local_election_no_data")}
        </p>
      </main>
    );
  }

  const s = data.summary;

  return (
    <main className="container mx-auto px-4 py-6">
      <h1 className="text-2xl font-semibold">{t("sverka_title")}</h1>
      <p className="mt-2 text-sm text-muted-foreground max-w-prose">
        {t("sverka_intro")}
      </p>
      <p className="mt-1 text-xs text-muted-foreground tabular-nums">
        {t("sverka_summary", {
          checked: s.municipalitiesChecked,
          match: s.mayorMatches,
          partial: data.municipalities.filter(
            (m) => m.overallStatus === "partial_mismatch",
          ).length,
          mismatch: data.municipalities.filter(
            (m) => m.overallStatus === "mismatch",
          ).length,
          missing: s.mayorMissingOfficial,
        })}
      </p>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => {
          const count =
            f === "all"
              ? data.municipalities.length
              : data.municipalities.filter((m) => m.overallStatus === f).length;
          const active = filter === f;
          return (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-md border px-2 py-1 text-xs font-medium tabular-nums transition-colors ${
                active
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground hover:border-accent"
              }`}
            >
              {f === "all" ? "Всички" : t(STATUS_TONE[f].labelKey)} · {count}
            </button>
          );
        })}
      </div>

      <div className="mt-4 rounded-xl border bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wide text-muted-foreground border-b">
            <tr>
              <th className="py-2 px-3 text-left">
                {t("sverka_th_municipality")}
              </th>
              <th className="py-2 px-3 text-left w-40">
                {t("sverka_th_status")}
              </th>
              <th className="py-2 px-3 text-left">{t("sverka_th_mayor")}</th>
              <th className="py-2 px-3 text-right w-32">
                {t("sverka_th_council")}
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((m) => (
              <tr key={m.obshtinaCode} className="border-b last:border-b-0">
                <td className="py-2 px-3">
                  <Link
                    to={`/settlement/${m.obshtinaCode}`}
                    className="font-medium hover:underline"
                  >
                    {m.obshtinaName}
                  </Link>
                  <div className="text-[11px] text-muted-foreground">
                    {m.obshtinaCode}
                  </div>
                </td>
                <td className="py-2 px-3">
                  <StatusPill status={m.overallStatus} />
                </td>
                <td className="py-2 px-3">
                  <MayorCell m={m.mayor} />
                </td>
                <td className="py-2 px-3 text-right tabular-nums">
                  {m.council.cikElectedCount > 0 ? (
                    <span>
                      {m.council.matched}/{m.council.cikElectedCount}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
};
