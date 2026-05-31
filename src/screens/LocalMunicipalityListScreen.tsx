// Standalone município-list pages behind the country / region dashboard stat
// tiles. One screen, four variants (selected by the `list` prop):
//
//   all          → every município with data        (Общини с данни)
//   runoffs      → municípios that went to a runoff  (Общини с балотаж)
//   split        → mayor's party ≠ council's party   (Общини с разделено управление)
//   independents → independently-elected mayors      (Независими кметове)
//
// Routes served (national + region-scoped):
//   /local/:cycle/{municipalities,runoffs,split-control,independents}
//   /local/:cycle/region/:oblast/{municipalities,runoffs,split-control}
//
// National rows come from the precomputed national_municipalities.json (one
// fetch — no per-município fan-out); region-scoped rows reuse the region
// rollup the region dashboard already loads. Both share one row shape, so the
// filtering + table rendering below is source-agnostic.

import { FC, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import { PartyChip } from "@/screens/components/local/LocalRankedBar";
import { useNationalMunicipalities } from "@/data/local/useNationalMunicipalities";
import { useLocalRegion } from "@/data/local/useLocalRegion";
import { useRegions } from "@/data/regions/useRegions";
import { friendlyCycleDate } from "@/data/local/cycleDate";
import { formatThousands } from "@/data/utils";
import { titleCaseName } from "@/lib/utils";
import type { LocalRegionMunicipalityRow } from "@/data/local/types";

export type LocalMunicipalityListKind =
  | "all"
  | "runoffs"
  | "split"
  | "independents";

// National rows carry `oblast`; region rollup rows don't (the region is the
// page). The screen omits the oblast column when it's redundant.
type Row = LocalRegionMunicipalityRow & { oblast?: string };

const Dot: FC<{ color: string }> = ({ color }) => (
  <span
    aria-hidden
    className="inline-block size-2 rounded-full ring-1 ring-border shrink-0"
    style={{ backgroundColor: color }}
  />
);

const OblastLink: FC<{ cycle: string; code: string }> = ({ cycle, code }) => {
  const { t, i18n } = useTranslation();
  const { findRegion } = useRegions();
  const info = findRegion(code);
  const name = !info
    ? code === "SOF"
      ? t("local_region_sofia_city")
      : code
    : (i18n.language === "bg"
        ? info.long_name || info.name
        : info.long_name_en || info.name_en) || code;
  const to =
    code === "SOF" ? `/local/${cycle}/SOF` : `/local/${cycle}/region/${code}`;
  return (
    <Link to={to} className="text-muted-foreground hover:underline">
      {name}
    </Link>
  );
};

const MuniLink: FC<{ cycle: string; row: Row; markRunoff?: boolean }> = ({
  cycle,
  row,
  markRunoff,
}) => {
  const { t } = useTranslation();
  return (
    <>
      <Link
        to={`/local/${cycle}/${row.obshtinaCode}`}
        className="font-medium hover:underline"
      >
        {row.name}
      </Link>
      {markRunoff && row.hadRound2 ? (
        <span
          className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground"
          title={t("local_national_runoffs")}
        >
          II
        </span>
      ) : null}
    </>
  );
};

const MayorCell: FC<{ row: Row }> = ({ row }) => {
  const m = row.electedMayor;
  if (!m) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex items-start gap-2 min-w-0">
      <MpAvatar name={m.candidateName} mpId={m.mpId} showPartyRing={false} />
      <div className="min-w-0">
        <div className="font-medium break-words">
          {titleCaseName(m.candidateName)}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground min-w-0">
          <Dot color={m.color} />
          <span className="truncate">{m.displayName}</span>
        </div>
      </div>
    </div>
  );
};

const TableShell: FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="rounded-xl border bg-card overflow-x-auto">
    <table className="w-full text-sm">{children}</table>
  </div>
);

// === all / runoffs ========================================================

const DirectoryTable: FC<{
  rows: Row[];
  cycle: string;
  showOblast: boolean;
  markRunoff: boolean;
}> = ({ rows, cycle, showOblast, markRunoff }) => {
  const { t } = useTranslation();
  return (
    <TableShell>
      <thead className="text-xs uppercase tracking-wide text-muted-foreground border-b">
        <tr>
          <th className="py-2 px-3 text-left">
            {t("local_cycle_overview_municipalities_section")}
          </th>
          {showOblast ? (
            <th className="hidden py-2 px-3 text-left sm:table-cell">
              {t("local_region_th_region")}
            </th>
          ) : null}
          <th className="py-2 px-3 text-left">
            {t("local_election_stat_mayor")}
          </th>
          <th className="hidden py-2 px-3 text-left md:table-cell">
            {t("local_national_top_council_party")}
          </th>
          <th className="py-2 px-3 text-right w-20">
            {t("local_election_stat_council_seats")}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.obshtinaCode} className="border-b last:border-b-0">
            <td className="py-2 px-3 align-top">
              <MuniLink cycle={cycle} row={r} markRunoff={markRunoff} />
            </td>
            {showOblast ? (
              <td className="hidden py-2 px-3 align-top sm:table-cell">
                <OblastLink cycle={cycle} code={r.oblast ?? ""} />
              </td>
            ) : null}
            <td className="py-2 px-3 align-top">
              <MayorCell row={r} />
            </td>
            <td className="hidden py-2 px-3 align-top md:table-cell">
              {r.topCouncil ? (
                <PartyChip
                  name={r.topCouncil.displayName}
                  color={r.topCouncil.color}
                />
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </td>
            <td className="py-2 px-3 text-right tabular-nums align-top">
              {formatThousands(r.councilSeats)}
            </td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
};

// === split control ========================================================

const SplitTable: FC<{ rows: Row[]; cycle: string; showOblast: boolean }> = ({
  rows,
  cycle,
  showOblast,
}) => {
  const { t } = useTranslation();
  return (
    <TableShell>
      <thead className="text-xs uppercase tracking-wide text-muted-foreground border-b">
        <tr>
          <th className="py-2 px-3 text-left">
            {t("local_cycle_overview_municipalities_section")}
          </th>
          {showOblast ? (
            <th className="hidden py-2 px-3 text-left sm:table-cell">
              {t("local_region_th_region")}
            </th>
          ) : null}
          <th className="py-2 px-3 text-left">
            {t("local_election_stat_mayor")}
          </th>
          <th className="py-2 px-3 text-left">
            {t("local_election_sec_council")}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.obshtinaCode} className="border-b last:border-b-0">
            <td className="py-2 px-3 align-top">
              <MuniLink cycle={cycle} row={r} />
            </td>
            {showOblast ? (
              <td className="hidden py-2 px-3 align-top sm:table-cell">
                <OblastLink cycle={cycle} code={r.oblast ?? ""} />
              </td>
            ) : null}
            <td className="py-2 px-3 align-top">
              <MayorCell row={r} />
            </td>
            <td className="py-2 px-3 align-top">
              {r.topCouncil ? (
                <span className="flex items-center gap-1.5 min-w-0">
                  <Dot color={r.topCouncil.color} />
                  <span className="truncate text-muted-foreground">
                    {r.topCouncil.displayName}
                  </span>
                </span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
};

// === independent mayors ===================================================

const IndependentsTable: FC<{
  rows: Row[];
  cycle: string;
  showOblast: boolean;
}> = ({ rows, cycle, showOblast }) => {
  const { t } = useTranslation();
  return (
    <TableShell>
      <thead className="text-xs uppercase tracking-wide text-muted-foreground border-b">
        <tr>
          <th className="py-2 px-3 text-left">
            {t("local_cycle_overview_municipalities_section")}
          </th>
          {showOblast ? (
            <th className="hidden py-2 px-3 text-left sm:table-cell">
              {t("local_region_th_region")}
            </th>
          ) : null}
          <th className="py-2 px-3 text-left">
            {t("local_election_th_candidate")}
          </th>
          <th className="hidden py-2 px-3 text-left md:table-cell">
            {t("local_election_th_party")}
          </th>
          <th className="py-2 px-3 text-right w-16">
            {t("local_election_th_pct")}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const m = r.electedMayor;
          return (
            <tr key={r.obshtinaCode} className="border-b last:border-b-0">
              <td className="py-2 px-3 align-top">
                <MuniLink cycle={cycle} row={r} />
              </td>
              {showOblast ? (
                <td className="hidden py-2 px-3 align-top sm:table-cell">
                  <OblastLink cycle={cycle} code={r.oblast ?? ""} />
                </td>
              ) : null}
              <td className="py-2 px-3 align-top">
                {m ? (
                  <div className="flex items-start gap-2 min-w-0">
                    <MpAvatar
                      name={m.candidateName}
                      mpId={m.mpId}
                      showPartyRing={false}
                    />
                    <span className="font-medium break-words min-w-0">
                      {titleCaseName(m.candidateName)}
                    </span>
                  </div>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="hidden py-2 px-3 text-muted-foreground align-top md:table-cell break-words">
                {m?.localPartyName ?? ""}
              </td>
              <td className="py-2 px-3 text-right tabular-nums align-top">
                {m ? `${m.pctOfValid.toFixed(1)}%` : ""}
              </td>
            </tr>
          );
        })}
      </tbody>
    </TableShell>
  );
};

// === screen ===============================================================

const TITLE_KEY: Record<LocalMunicipalityListKind, string> = {
  all: "local_national_municipalities",
  runoffs: "local_national_runoffs",
  split: "local_national_split_control",
  independents: "local_national_independents",
};

export const LocalMunicipalityListScreen: FC<{
  list: LocalMunicipalityListKind;
}> = ({ list }) => {
  const { t } = useTranslation();
  const { cycle, oblast } = useParams<{ cycle: string; oblast?: string }>();
  const isRegional = !!oblast;
  const { data: national, isLoading: nLoading } = useNationalMunicipalities(
    cycle,
    !isRegional,
  );
  const { data: region, isLoading: rLoading } = useLocalRegion(oblast, cycle);

  const rows: Row[] = useMemo(
    () =>
      isRegional
        ? (region?.municipalities ?? [])
        : (national?.municipalities ?? []),
    [isRegional, region, national],
  );
  const loading = isRegional ? rLoading && !region : nLoading && !national;

  const filtered = useMemo(() => {
    switch (list) {
      case "runoffs":
        return rows.filter((r) => r.hadRound2);
      case "split":
        return rows.filter(
          (r) =>
            r.electedMayor &&
            r.topCouncil &&
            r.electedMayor.canonicalId !== r.topCouncil.canonicalId,
        );
      case "independents":
        return rows.filter((r) => r.electedMayor?.isIndependent);
      case "all":
      default:
        return rows;
    }
  }, [rows, list]);

  if (!cycle) return null;

  const backTo = isRegional
    ? `/local/${cycle}/region/${oblast}`
    : `/local/${cycle}`;
  const showOblast = !isRegional;

  return (
    <main className="container mx-auto px-4 py-6 space-y-6">
      <div className="text-xs text-muted-foreground">
        <Link to={backTo} className="hover:underline">
          {t("local_election_screen_back")}
        </Link>
        <span className="mx-2">·</span>
        <span>{friendlyCycleDate(cycle)}</span>
        {isRegional ? (
          <>
            <span className="mx-2">·</span>
            <OblastLink cycle={cycle} code={oblast} />
          </>
        ) : null}
      </div>
      <div>
        <h1 className="text-2xl font-semibold">{t(TITLE_KEY[list])}</h1>
        {!loading ? (
          <p className="mt-1 text-xs text-muted-foreground tabular-nums">
            {t("local_list_count", { count: filtered.length })}
          </p>
        ) : null}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("local_list_empty")}</p>
      ) : list === "split" ? (
        <SplitTable rows={filtered} cycle={cycle} showOblast={showOblast} />
      ) : list === "independents" ? (
        <IndependentsTable
          rows={filtered}
          cycle={cycle}
          showOblast={showOblast}
        />
      ) : (
        <DirectoryTable
          rows={filtered}
          cycle={cycle}
          showOblast={showOblast}
          markRunoff={list === "all"}
        />
      )}
    </main>
  );
};
