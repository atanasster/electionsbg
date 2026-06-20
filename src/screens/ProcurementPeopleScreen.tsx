// /procurement/people — the "public money scanner". Type a politician's name
// and see the public-procurement reachable through the companies they're tied
// to. Scoped to the political class we resolve with confidence (MPs today via
// mp_connected.json; officials follow once pep_connected ships). Each result
// drills into the existing per-MP procurement page.

import { FC, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Search, ArrowRight } from "lucide-react";
import { Title } from "@/ux/Title";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { MpAvatar } from "./components/candidates/MpAvatar";
import { usePersonProcurementIndex } from "@/data/procurement/usePersonProcurementIndex";
import { normalizeMpName } from "@/lib/utils";
import { formatEur } from "@/lib/currency";

const numFmt = new Intl.NumberFormat("bg-BG");

export const ProcurementPeopleScreen: FC = () => {
  const { t } = useTranslation();
  const { rows, isLoading } = usePersonProcurementIndex();
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const needle = normalizeMpName(q.trim());
    if (!needle) return rows;
    return rows.filter((r) => normalizeMpName(r.mpName).includes(needle));
  }, [rows, q]);

  return (
    <>
      <Title
        description={
          t("procurement_people_desc") ||
          "Search a politician and see the public procurement reachable through the companies they are tied to."
        }
      >
        {t("procurement_people_title") || "Public money scanner"}
      </Title>
      <section aria-label="procurement people" className="my-4 space-y-4">
        <Card>
          <CardContent className="p-3 md:p-4">
            <label className="relative block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={
                  t("procurement_people_search_ph") ||
                  "Search by name (e.g. Делян Пеевски)…"
                }
                className="w-full rounded-md border bg-background pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </label>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {t("procurement_people_scope") ||
                "Covers sitting and former MPs with companies declared in the Commerce Registry or asset declarations. A link is a declared tie, not proof of wrongdoing."}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              {t("procurement_people_results") ||
                "People with procurement ties"}
              <span className="text-xs text-muted-foreground font-normal">
                {numFmt.format(filtered.length)}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 md:p-4">
            {isLoading ? (
              <div className="min-h-[200px]" aria-hidden />
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                {t("procurement_people_empty") || "No matching people."}
              </p>
            ) : (
              <div className="flex flex-col">
                {filtered.slice(0, 100).map((r, idx) => (
                  <Link
                    key={r.mpId}
                    to={`/candidate/mp-${r.mpId}/procurement`}
                    className="group flex items-center gap-3 py-2 border-b border-border/40 last:border-b-0 hover:bg-accent/30 rounded-sm -mx-1 px-1"
                  >
                    <span className="text-muted-foreground w-6 shrink-0 text-right tabular-nums text-xs">
                      {idx + 1}
                    </span>
                    <MpAvatar mpId={r.mpId} name={r.mpName} />
                    <span className="min-w-0 flex-1 font-medium truncate">
                      {r.mpName}
                    </span>
                    <span className="hidden sm:inline text-xs text-muted-foreground tabular-nums shrink-0">
                      {numFmt.format(r.contractorCount)}{" "}
                      {t("procurement_people_companies") || "cos"}
                    </span>
                    <span className="tabular-nums font-medium shrink-0 min-w-[96px] text-right">
                      {formatEur(r.totalEur)}
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-50 group-hover:opacity-100" />
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </>
  );
};
