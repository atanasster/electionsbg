// /procurement/sectors — full ranked list of CPV divisions ("what does the
// state buy"), the "see all" destination for ProcurementSectorsTile (which
// shows only the top 8 + a folded "rest" bar). Each division row expands to
// lazily load the top contractors in that sector (/api/db/sector-peers → the
// division's top 8), cached per window — mirroring the company page's "Сектори
// и позиция". Full CPV names use the styled <Tooltip>, not the native title=.
// Each sector also links onward to its filtered contracts
// (/procurement/contracts?cpv=<division>).
//
// Both the division totals (useProcurementSectors) and the expanded
// top-contractor lists are window-scoped to the same ?pscope: from/to are
// passed to sector-peers so it ranks within the window (sector_peers_window);
// the full corpus (no window) uses the fast precomputed matview.

import { FC, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PieChart, ChevronRight, ChevronDown, ArrowRight } from "lucide-react";
import { Title } from "@/ux/Title";
import { Card, CardContent } from "@/ux/Card";
import { Tooltip } from "@/ux/Tooltip";
import { useProcurementSectors } from "@/data/procurement/useProcurementSectors";
import { useProcurementWindow } from "@/data/procurement/useProcurementWindow";
import { ProcurementSectionHeader } from "@/screens/components/procurement/ProcurementSectionHeader";
import { cpvDivisionName } from "@/lib/cpvSectors";
import { formatEurCompact } from "@/lib/currency";
import { decodeEntities } from "@/lib/decodeEntities";

interface PeerRow {
  eik: string;
  name: string | null;
  totalEur: number;
  rank: number;
}
interface PeersResp {
  division: string;
  divContractors: number;
  peers: PeerRow[];
}
type PeerState = { loading: boolean; data?: PeersResp };

export const ProcurementSectorsScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const nf = new Intl.NumberFormat(lang === "bg" ? "bg-BG" : "en-GB");
  const { data, isLoading } = useProcurementSectors();
  const { from, to } = useProcurementWindow();
  const [params] = useSearchParams();

  const [expanded, setExpanded] = useState<string | null>(null);
  const [peers, setPeers] = useState<Record<string, PeerState>>({});

  // The cached peers belong to the current window — drop them (and collapse)
  // when the scope changes so a reopened sector refetches for the new window.
  useEffect(() => {
    setPeers({});
    setExpanded(null);
  }, [from, to]);

  // Toggle a division open/closed; fetch its top contractors once per window
  // (cached). from/to carry the ?pscope window so the peers match the row's
  // window-scoped totals; omitted for the full corpus (server uses the matview).
  const loadPeers = useCallback(
    (division: string) => {
      setExpanded((cur) => (cur === division ? null : division));
      setPeers((cur) => {
        if (cur[division]) return cur; // already loading or loaded
        const qs = new URLSearchParams({ division });
        if (from) qs.set("from", from);
        if (to) qs.set("to", to);
        fetch(`/api/db/sector-peers?${qs.toString()}`)
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
    [from, to],
  );

  // Carries the current scope (?pscope) and election forward while adding the
  // division's CPV filter (a Postgres `cpv LIKE '<division>%'` prefix match).
  const contractsHref = (division: string) => {
    const next = new URLSearchParams(params);
    next.set("cpv", division);
    return {
      pathname: "/procurement/contracts",
      search: `?${next.toString()}`,
    };
  };

  const total = data?.totalEur ?? 0;
  const sectors = useMemo(
    () => [...(data?.sectors ?? [])].sort((a, b) => b.eur - a.eur),
    [data],
  );
  const maxEur = sectors[0]?.eur ?? 0;
  const pctOfTotal = (v: number) =>
    total > 0 ? `${((v / total) * 100).toFixed(1)}%` : "—";
  const contractsWord = t("procurement_sectors_contracts_short") || "contracts";

  return (
    <>
      <Title
        description={
          t("procurement_sectors_page_desc") ||
          "Every CPV division the state buys under, ranked by total procurement value in the current scope. Expand a sector to see its top contractors."
        }
      >
        {t("procurement_sectors_title") || "What does the state buy"}
      </Title>
      <ProcurementSectionHeader
        current="procurement_sectors_title"
        scopeMode="toggle"
      />
      <section aria-label="procurement-sectors" className="my-4">
        <div className="flex items-center gap-2 mb-2 text-sm text-muted-foreground">
          <PieChart className="h-4 w-4" />
          {t("procurement_sectors_page_subtitle") ||
            "Ranked by total value in the current scope. Expand a sector to see its top contractors."}
        </div>
        {isLoading || !data ? (
          <div className="min-h-[600px]" aria-hidden />
        ) : (
          <Card>
            <CardContent className="p-3 md:p-4 space-y-2">
              {sectors.map((sct) => {
                const name = cpvDivisionName(sct.division, lang);
                const open = expanded === sct.division;
                const ps = peers[sct.division];
                return (
                  <div
                    key={sct.division}
                    className="border-b border-border/40 last:border-b-0 pb-2 last:pb-0"
                  >
                    <button
                      type="button"
                      onClick={() => loadPeers(sct.division)}
                      aria-expanded={open}
                      className="flex w-full items-baseline gap-2 text-left"
                    >
                      {open ? (
                        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground mt-0.5" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground mt-0.5" />
                      )}
                      <Tooltip content={name}>
                        <span className="text-sm font-medium truncate max-w-[46%]">
                          {name}
                        </span>
                      </Tooltip>
                      <span className="ml-auto shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                        {formatEurCompact(sct.eur, lang)} ·{" "}
                        {pctOfTotal(sct.eur)} · {nf.format(sct.n)}{" "}
                        {contractsWord}
                      </span>
                    </button>

                    <div className="flex items-center gap-2 pl-[22px] pt-1">
                      <span className="flex-1 min-w-0 h-2 rounded bg-muted overflow-hidden">
                        <span
                          className="block h-full bg-primary/60"
                          style={{
                            width: `${Math.max(2, maxEur > 0 ? (sct.eur / maxEur) * 100 : 0)}%`,
                          }}
                        />
                      </span>
                    </div>

                    {open && (
                      <div className="pl-[22px] pt-2">
                        {ps?.loading ? (
                          <div className="text-xs text-muted-foreground">…</div>
                        ) : ps?.data && ps.data.peers.length > 0 ? (
                          <div className="rounded-md border bg-muted/20 p-2">
                            <div className="mb-1 flex items-baseline justify-between gap-2">
                              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                {t("procurement_sectors_top_contractors") ||
                                  "Top contractors in this sector"}
                              </span>
                              <span className="text-[11px] text-muted-foreground tabular-nums">
                                {(
                                  t("procurement_sectors_of_n") ||
                                  "of {{count}} contractors"
                                ).replace(
                                  "{{count}}",
                                  nf.format(ps.data.divContractors),
                                )}
                              </span>
                            </div>
                            <ul className="space-y-0.5">
                              {ps.data.peers.map((p) => (
                                <li
                                  key={`${p.eik}-${p.rank}`}
                                  className="flex items-baseline gap-2 text-xs"
                                >
                                  <span className="w-8 shrink-0 tabular-nums text-muted-foreground">
                                    №{p.rank}
                                  </span>
                                  <Link
                                    to={`/company/${p.eik}`}
                                    className="truncate text-accent hover:underline"
                                  >
                                    {decodeEntities(p.name || "") || p.eik}
                                  </Link>
                                  <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
                                    {formatEurCompact(p.totalEur, lang)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                            <div className="mt-2 flex items-center justify-end gap-2 border-t border-border/40 pt-1.5">
                              <Link
                                to={contractsHref(sct.division)}
                                className="inline-flex items-center gap-1 text-xs text-primary hover:underline shrink-0"
                              >
                                {t("procurement_sectors_browse_cpv") ||
                                  "Browse all contracts in this sector"}
                                <ArrowRight className="h-3 w-3" />
                              </Link>
                            </div>
                          </div>
                        ) : (
                          <div className="text-xs text-muted-foreground">
                            {t("no_results") || "No data"}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {data.uncoded.n > 0 ? (
                <div className="pl-[22px] pt-1 text-xs text-muted-foreground tabular-nums">
                  {t("procurement_sectors_uncoded") || "Uncoded"} ·{" "}
                  {formatEurCompact(data.uncoded.eur, lang)} ·{" "}
                  {nf.format(data.uncoded.n)} {contractsWord}
                </div>
              ) : null}
            </CardContent>
          </Card>
        )}
      </section>
    </>
  );
};
