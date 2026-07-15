// "Най-големи договори" — the costliest individual МВР contracts, the award-level
// accountability view the aggregates can't give (plan §7b: "name the real contract,
// not just the total"). The group model carries no per-contract rows, so this queries
// the `awarder-group-top-contracts` PG endpoint — ONE server-side ORDER BY amount_eur +
// LIMIT 8 over the WHOLE 75-EIK group, returning only the 8 rows rendered (was a 4×
// full-corpus client fan-out ≈ 3.5 MB). Single-bid / EU-funded risk chips. Mirrors the
// tourism TopCampaignsTile.

import { FC } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import { useScopeWindow } from "@/data/scope/useScopeWindow";
import { SECURITY_SECTOR_EIKS } from "@/lib/securityReferenceData";

interface TopContract {
  key: string;
  title: string | null;
  date: string | null;
  amountEur: number | null;
  contractorEik: string | null;
  contractorName: string | null;
  numberOfTenderers: number | null;
  euFunded: boolean | null;
}

const useMvrTopContracts = (from: string | null, to: string | null) => {
  const eiks = SECURITY_SECTOR_EIKS.join(",");
  return useQuery({
    queryKey: [
      "db",
      "awarder-group-top-contracts",
      "security",
      from,
      to,
    ] as const,
    queryFn: async (): Promise<TopContract[]> => {
      const p = new URLSearchParams({ eiks, limit: "8" });
      if (from) p.set("from", from);
      if (to) p.set("to", to);
      const r = await fetch(`/api/db/awarder-group-top-contracts?${p}`);
      if (!r.ok) return [];
      const j = (await r.json()) as { contracts: TopContract[] };
      return j.contracts ?? [];
    },
    staleTime: Infinity,
  });
};

export const MvrTopContractsTile: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const { from, to } = useScopeWindow();
  const [params] = useSearchParams();
  const { data: rows, isLoading } = useMvrTopContracts(from, to);

  if (isLoading)
    return (
      <div className="h-[260px] animate-pulse rounded-xl border bg-card" />
    );
  if (!rows || rows.length < 2) return null;

  // "See all" → the sector-filtered browse table, carrying the current scope forward.
  const seeAllParams = new URLSearchParams(params);
  seeAllParams.set("sector", "security");
  const seeAllTo = {
    pathname: "/procurement/contracts",
    search: `?${seeAllParams.toString()}`,
  };

  return (
    <Card id="top-contracts" className="min-w-0">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4" />
            {bg ? "Най-големи договори" : "Biggest contracts"}
          </CardTitle>
          <Link
            to={seeAllTo}
            className="mt-0.5 shrink-0 text-xs font-medium text-primary hover:underline"
          >
            {bg ? "виж всички →" : "see all →"}
          </Link>
        </div>
        <p className="text-xs text-muted-foreground">
          {bg
            ? "Най-скъпите отделни договори в цялата група на МВР, в избрания обхват."
            : "The costliest individual contracts across the whole МВР group, in the selected scope."}
        </p>
      </CardHeader>
      <CardContent className="space-y-3 p-3 md:p-4">
        {rows.map((c) => (
          <div key={c.key} className="text-sm">
            <div className="flex items-baseline justify-between gap-2">
              <Link
                to={`/procurement/contract/${c.key}`}
                className="min-w-0 truncate text-primary hover:underline"
                title={c.title ?? undefined}
              >
                {c.title || "—"}
              </Link>
              <span className="shrink-0 font-medium tabular-nums">
                {formatEurCompact(c.amountEur ?? 0, i18n.language)}
              </span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
              {c.contractorEik ? (
                <Link
                  to={`/company/${c.contractorEik}`}
                  className="max-w-[60%] truncate text-primary hover:underline"
                  title={c.contractorName ?? undefined}
                >
                  {c.contractorName}
                </Link>
              ) : (
                <span className="max-w-[60%] truncate">{c.contractorName}</span>
              )}
              <span className="tabular-nums">
                · {(c.date ?? "").slice(0, 4)}
              </span>
              {c.euFunded && (
                <span className="rounded bg-primary/10 px-1 font-medium text-primary">
                  {bg ? "ЕС" : "EU"}
                </span>
              )}
              {c.numberOfTenderers === 1 && (
                <span className="rounded bg-amber-500/15 px-1 font-medium text-amber-600 dark:text-amber-400">
                  {bg ? "1 оферта" : "1 bid"}
                </span>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
};
