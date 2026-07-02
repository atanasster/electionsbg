// Merged CPV-sector tile for the DB company page — combines the old "В кои
// сектори печели" (breakdown: € per division + procedure mix + EU) and "Позиция
// в сектора" (rank / market share / ×median) into one per-division row. Each row
// expands to lazily load the top competitors in that division (sector_peers),
// with this company highlighted at its rank. Full CPV names use the app's
// styled <Tooltip>, not the native title=.

import { FC, useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PieChart, ChevronRight, ChevronDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { Tooltip } from "@/ux/Tooltip";
import {
  cpvDivisionName,
  procedureLabel,
  type ProcedureBucket,
} from "@/lib/cpvSectors";
import { formatEurCompact } from "@/lib/currency";
import { decodeEntities } from "@/lib/decodeEntities";
import type { ProcurementBreakdown } from "@/data/dataTypes";
import type { SectorRank } from "./CompanySectorRankTile";

interface PeerRow {
  eik: string;
  name: string | null;
  totalEur: number;
  rank: number;
  isSelf: boolean;
}
interface PeersResp {
  division: string;
  divContractors: number;
  peers: PeerRow[];
}
type PeerState = { loading: boolean; data?: PeersResp };

const SHOWN = 6;

const pct = (v: number, lang: string) =>
  (v * 100).toLocaleString(lang, { maximumFractionDigits: 1 }) + "%";

// Badge tone by how high the company ranks in the division.
const rankTone = (rank: number, of: number): string => {
  const p = rank / of;
  return rank <= 3 || p <= 0.01
    ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
    : p <= 0.1
      ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
      : "bg-muted text-muted-foreground";
};

export const CompanySectorsTile: FC<{
  eik: string;
  breakdown: ProcurementBreakdown;
  sectors: SectorRank[] | null;
}> = ({ eik, breakdown, sectors }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const nf = new Intl.NumberFormat(bg ? "bg-BG" : "en-GB");

  const [expanded, setExpanded] = useState<string | null>(null);
  const [peers, setPeers] = useState<Record<string, PeerState>>({});

  const loadPeers = useCallback(
    (division: string) => {
      setExpanded((cur) => (cur === division ? null : division));
      setPeers((cur) => {
        if (cur[division]) return cur; // cached
        fetch(
          `/api/db/sector-peers?division=${encodeURIComponent(division)}&eik=${encodeURIComponent(eik)}`,
        )
          .then((r) => r.json())
          .then((d: PeersResp) =>
            setPeers((c) => ({
              ...c,
              [division]: { loading: false, data: d },
            })),
          )
          .catch(() =>
            setPeers((c) => ({
              ...c,
              [division]: { loading: false, data: undefined },
            })),
          );
        return { ...cur, [division]: { loading: true } };
      });
    },
    [eik],
  );

  const cpvKnown = breakdown.cpvKnownEur || 1;
  const procTotal = breakdown.proc.reduce((s, p) => s + p.eur, 0) || 1;
  const cpvCoverage =
    breakdown.totalEur > 0 ? breakdown.cpvKnownEur / breakdown.totalEur : 0;
  const euCoverage =
    breakdown.totalEur > 0 ? breakdown.euKnownEur / breakdown.totalEur : 0;
  const euShare =
    breakdown.euKnownEur > 0 ? breakdown.euEur / breakdown.euKnownEur : 0;

  const sectorFor = (division: string): SectorRank | undefined =>
    (sectors ?? []).find((s) => s.division === division);

  const rows = breakdown.cpv.slice(0, SHOWN);
  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <PieChart className="h-4 w-4" />
          {bg ? "Сектори и позиция" : "Sectors & rank"}
          <span className="text-xs text-muted-foreground font-normal ml-1">
            {bg
              ? "Дял по CPV раздел и класиране сред изпълнителите"
              : "Share by CPV division and rank among contractors"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <div className="space-y-2">
          {rows.map((c) => {
            const name = cpvDivisionName(c.d, lang);
            const s = sectorFor(c.d);
            const marketShare =
              s && s.divTotalEur > 0 ? s.totalEur / s.divTotalEur : null;
            const vsMedian =
              s && s.divMedianEur > 0 ? s.totalEur / s.divMedianEur : null;
            const open = expanded === c.d;
            const ps = peers[c.d];
            return (
              <div key={c.d} className="space-y-1">
                <button
                  type="button"
                  onClick={() => loadPeers(c.d)}
                  className="flex w-full items-baseline gap-2 text-left"
                >
                  {open ? (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground mt-0.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground mt-0.5" />
                  )}
                  <Tooltip content={name}>
                    <span className="text-sm font-medium truncate max-w-[55%]">
                      {name}
                    </span>
                  </Tooltip>
                  {s ? (
                    <span
                      className={`ml-auto shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums ${rankTone(
                        s.rank,
                        s.divContractors,
                      )}`}
                    >
                      №{nf.format(s.rank)} {bg ? "от" : "of"}{" "}
                      {nf.format(s.divContractors)}
                    </span>
                  ) : (
                    <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                      {formatEurCompact(c.eur, lang)}
                    </span>
                  )}
                </button>

                <div className="flex items-center gap-2 pl-[22px]">
                  <span className="flex-1 min-w-0 h-2 rounded bg-muted overflow-hidden">
                    <span
                      className="block h-full bg-primary/60"
                      style={{
                        width: `${Math.max(2, Math.min(100, (c.eur / cpvKnown) * 100))}%`,
                      }}
                    />
                  </span>
                  <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                    {formatEurCompact(c.eur, lang)}
                    {marketShare != null
                      ? ` · ${pct(marketShare, lang)} ${bg ? "от раздела" : "of div."}`
                      : ""}
                    {vsMedian && vsMedian >= 2
                      ? ` · ${nf.format(Math.round(vsMedian))}× ${bg ? "медианата" : "median"}`
                      : ""}
                  </span>
                </div>

                {open && (
                  <div className="pl-[22px] pt-1">
                    {ps?.loading ? (
                      <div className="text-xs text-muted-foreground">…</div>
                    ) : ps?.data && ps.data.peers.length > 0 ? (
                      <ul className="space-y-0.5 rounded-md border bg-muted/20 p-2">
                        {ps.data.peers.map((p) => (
                          <li
                            key={`${p.eik}-${p.rank}`}
                            className={`flex items-baseline gap-2 text-xs ${
                              p.isSelf ? "font-semibold text-foreground" : ""
                            }`}
                          >
                            <span className="w-8 shrink-0 tabular-nums text-muted-foreground">
                              №{p.rank}
                            </span>
                            <Link
                              to={`/db/company/${p.eik}`}
                              className={`truncate ${p.isSelf ? "" : "text-accent hover:underline"}`}
                            >
                              {decodeEntities(p.name) || p.eik}
                            </Link>
                            <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
                              {formatEurCompact(p.totalEur, lang)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="text-xs text-muted-foreground">
                        {bg ? "няма данни" : "no data"}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* How it wins — procedure mix (orthogonal to sector) */}
        <div className="pt-2 border-t">
          <div className="text-xs font-medium mb-1.5">
            {bg ? "Как печели" : "How it wins"}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums">
            {breakdown.proc.map((p) => (
              <span key={p.b}>
                {procedureLabel(p.b as ProcedureBucket, lang)}{" "}
                <span className="text-foreground">
                  {pct(p.eur / procTotal, lang)}
                </span>
              </span>
            ))}
          </div>
        </div>

        {euCoverage >= 0.6 ? (
          <div className="pt-2 border-t flex items-baseline gap-2 text-xs">
            <span className="text-muted-foreground">
              {bg ? "Финансиране от ЕС" : "EU funding"}
            </span>
            <span className="font-semibold tabular-nums">
              {pct(euShare, lang)}
            </span>
            <span className="text-muted-foreground">
              {bg ? "от обема" : "of volume"}
            </span>
          </div>
        ) : null}

        {cpvCoverage < 0.9 ? (
          <p className="text-[11px] text-muted-foreground/80">
            {bg
              ? `По ${pct(cpvCoverage, lang)} от обема с известен сектор.`
              : `Based on ${pct(cpvCoverage, lang)} of volume with a known sector.`}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
};
