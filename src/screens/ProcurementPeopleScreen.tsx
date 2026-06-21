// /procurement/people — the "public money scanner". Type a politician's name
// and see the public-procurement reachable through the companies they're tied
// to. Scoped to the political class we resolve with confidence: MPs (via
// mp_connected.json) AND non-MP officials — cabinet, agency heads, governors,
// mayors, deputy-mayors, councillors (via pep_connected.json, HIGH-confidence
// links only). MP rows drill into the MP's candidate dashboard
// (/candidate/mp-<id>); official rows into /officials/<slug>. Both land on the
// person's full page (which carries a procurement section), not a
// procurement-only view.

import { FC, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Search, ArrowRight, Landmark } from "lucide-react";
import { Title } from "@/ux/Title";
import { ProcurementNav } from "@/screens/components/procurement/ProcurementNav";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { MpAvatarView } from "./components/candidates/MpAvatar";
import {
  usePersonProcurementIndex,
  type PersonProcurementRow,
} from "@/data/procurement/usePersonProcurementIndex";
import { dataUrl } from "@/data/dataUrl";
import { normalizeMpName } from "@/lib/utils";
import { formatEur } from "@/lib/currency";

const numFmt = new Intl.NumberFormat("bg-BG");

// Human label for an official's role, falling back to a de-underscored form
// when no translation exists. MPs have no role chip (their kind is implicit).
const roleLabel = (
  role: string | undefined,
  t: (k: string) => string,
): string | null => {
  if (!role) return null;
  const key = `official_role_${role}`;
  const translated = t(key);
  return translated === key ? role.replace(/_/g, " ") : translated;
};

export const ProcurementPeopleScreen: FC = () => {
  const { t } = useTranslation();
  const { rows, isLoading } = usePersonProcurementIndex();
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const needle = normalizeMpName(q.trim());
    if (!needle) return rows;
    return rows.filter((r) => normalizeMpName(r.name).includes(needle));
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
      <ProcurementNav />
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
                  <PersonScannerRow
                    key={r.kind === "mp" ? `mp-${r.mpId}` : `off-${r.slug}`}
                    row={r}
                    rank={idx + 1}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </>
  );
};

// One ranked row. MPs link to their candidate dashboard with a photo avatar;
// officials link to their profile with an institution icon + a role chip
// (mayor / councillor / agency head …) so the reader knows which tier of the
// political class the tie sits in.
const PersonScannerRow: FC<{ row: PersonProcurementRow; rank: number }> = ({
  row,
  rank,
}) => {
  const { t } = useTranslation();
  // MPs → their full candidate dashboard (election results, connections AND a
  // procurement tile); officials → their profile (which carries the procurement
  // section). Both land on the person's complete page rather than a
  // procurement-only view.
  const to =
    row.kind === "mp" ? `/candidate/mp-${row.mpId}` : `/officials/${row.slug}`;
  const role = row.kind === "official" ? roleLabel(row.role, t) : null;
  return (
    <Link
      to={to}
      className="group flex items-center gap-3 py-2 border-b border-border/40 last:border-b-0 hover:bg-accent/30 rounded-sm -mx-1 px-1"
    >
      <span className="text-muted-foreground w-6 shrink-0 text-right tabular-nums text-xs">
        {rank}
      </span>
      {row.kind === "mp" ? (
        // MpAvatarView (presentational) + the photo-path convention avoids
        // pulling the ~949 KB parliament/index.json roster just to show faces
        // on this list. Photo 404s degrade to initials.
        <MpAvatarView
          photoUrl={dataUrl(`/parliament/photos/${row.mpId}.webp`)}
          displayName={row.name}
          className="h-8 w-8"
        />
      ) : (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-200">
          <Landmark className="h-4 w-4" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="font-medium block truncate">{row.name}</span>
        {role ? (
          <span className="text-[11px] text-muted-foreground block truncate">
            {role}
          </span>
        ) : null}
      </span>
      <span className="hidden sm:inline text-xs text-muted-foreground tabular-nums shrink-0">
        {numFmt.format(row.contractorCount)}{" "}
        {t("procurement_people_companies") || "cos"}
      </span>
      <span className="tabular-nums font-medium shrink-0 min-w-[96px] text-right">
        {formatEur(row.totalEur)}
      </span>
      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-50 group-hover:opacity-100" />
    </Link>
  );
};
