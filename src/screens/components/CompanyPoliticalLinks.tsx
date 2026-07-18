// Single shared renderer for a company's political-economy linkages — the
// politically-exposed people (sitting/former MPs + cabinet/governors/mayors/
// councillors) declared as owners or managers of one beneficiary EIK.
//
// It unions TWO link sets, because neither alone is complete (measured):
//   - the PG /api/db/company `politicians[]` payload (company_politicians,
//     built from the procurement-side mp_connected/pep_connected joins), and
//   - the funds-side per-EIK shard (usePoliticalForEik), which additionally
//     covers ~279 fund-beneficiary EIKs (NGOs / читалища with EU funds but no
//     public contracts) that never appear in the procurement-derived table.
// Where an EIK is in both, the ref sets are identical (verified), so the PG row
// wins and the funds shard only contributes links PG doesn't have.
//
// Reuses MpAvatar and the shared relation/role label helpers, so this is the
// one place company political links are rendered (replaces the old inline tile
// in CompanyDbScreen and the orphaned funds/PoliticalLinksCard).

import { FC, useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Landmark } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import { formatEur } from "@/lib/currency";
import {
  usePoliticalForEik,
  type PoliticalEntry,
} from "@/data/funds/usePoliticalLinks";
import { summarizeFundsRelations } from "@/data/funds/relationLabel";
import type { FundsMpRelation } from "@/data/funds/types";
import {
  officialCategoryLabel,
  summarizeOfficialRoles,
} from "@/data/funds/officialLabels";

// One PG company_politicians row (from the /api/db/company `politicians[]`).
export interface DbPolitician {
  politician: string;
  ref: string;
  kind: string; // 'mp' | 'official'
  role: string | null;
  total_eur: number | null;
  // jsonb: MP rows are [{kind,isCurrent,…}], official rows are [{role,…}].
  relations?: unknown;
}

interface PoliticalLink {
  ref: string;
  name: string;
  kind: "mp" | "official";
  mpId?: number;
  relationLabel: string;
  categoryLabel?: string;
  meta?: string;
  totalEur?: number | null;
}

const mpIdFromRef = (ref: string): number | undefined => {
  const m = /mp-(\d+)/.exec(ref);
  return m ? Number(m[1]) : undefined;
};

const asArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

// PG company_politicians rows → normalized links. MP relations are kind-based
// (summarizeFundsRelations); official relations are role-based ({role}) and
// need adapting to the {source,trRole} shape summarizeOfficialRoles expects.
const fromPg = (t: TFunction, rows: DbPolitician[]): PoliticalLink[] =>
  rows.map((p) => {
    if (p.kind === "mp") {
      return {
        ref: p.ref,
        name: p.politician,
        kind: "mp",
        mpId: mpIdFromRef(p.ref),
        relationLabel: summarizeFundsRelations(
          t,
          asArray<FundsMpRelation>(p.relations),
        ),
        totalEur: p.total_eur,
      };
    }
    return {
      ref: p.ref,
      name: p.politician,
      kind: "official",
      relationLabel: summarizeOfficialRoles(
        t,
        asArray<{ role?: string }>(p.relations).map((r) => ({
          source: "tr",
          trRole: r.role ?? null,
        })),
      ),
      categoryLabel: p.role ? officialCategoryLabel(t, p.role) : undefined,
      totalEur: p.total_eur,
    };
  });

// Funds-side per-EIK shard → normalized links (adds the beneficiary-only EIKs).
const fromFunds = (t: TFunction, entry: PoliticalEntry): PoliticalLink[] => {
  const mps: PoliticalLink[] = entry.mps.map((m) => ({
    ref: `/candidate/mp-${m.mpId}`,
    name: m.mpName,
    kind: "mp",
    mpId: m.mpId,
    relationLabel: summarizeFundsRelations(t, m.relations as FundsMpRelation[]),
  }));
  const officials: PoliticalLink[] = entry.officials.map((o) => {
    const meta = [
      o.institution,
      o.municipality,
      o.latestDeclarationYear
        ? `${t("officials_declaration_year") || "decl."} ${o.latestDeclarationYear}`
        : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return {
      ref: `/officials/${o.slug}`,
      name: o.name,
      kind: "official",
      relationLabel: summarizeOfficialRoles(t, o.roles),
      categoryLabel: officialCategoryLabel(t, o.category),
      meta: meta || undefined,
    };
  });
  return [...mps, ...officials];
};

// Union by ref: PG wins, funds shard fills the beneficiary-only gap.
const unionLinks = (
  t: TFunction,
  pg: DbPolitician[],
  entry: PoliticalEntry | null,
): PoliticalLink[] => {
  const byRef = new Map<string, PoliticalLink>();
  for (const l of fromPg(t, pg)) byRef.set(l.ref, l);
  if (entry)
    for (const l of fromFunds(t, entry))
      if (!byRef.has(l.ref)) byRef.set(l.ref, l);
  return [...byRef.values()].sort(
    (a, b) =>
      (b.totalEur ?? -1) - (a.totalEur ?? -1) ||
      a.name.localeCompare(b.name, "bg"),
  );
};

export const CompanyPoliticalLinks: FC<{
  eik: string;
  politicians: DbPolitician[];
}> = ({ eik, politicians }) => {
  const { t } = useTranslation();
  const { entry } = usePoliticalForEik(eik);
  const links = useMemo(
    () => unionLinks(t, politicians, entry),
    [t, politicians, entry],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Landmark className="h-4 w-4" /> Политически връзки ({links.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {links.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            Няма установени връзки с политици.
          </div>
        ) : (
          <ul className="space-y-2">
            {links.map((l) => (
              <li
                key={l.ref}
                className="flex flex-wrap items-center gap-2 text-sm"
              >
                <Link
                  to={l.ref}
                  className="inline-flex items-center gap-2 font-medium text-accent hover:underline"
                >
                  {l.kind === "mp" ? (
                    <MpAvatar mpId={l.mpId} name={l.name} />
                  ) : null}
                  {l.name}
                </Link>
                <span className="text-xs text-muted-foreground">
                  ·{" "}
                  {l.kind === "mp" ? "депутат" : l.categoryLabel || "служител"}
                  {l.relationLabel ? ` · ${l.relationLabel}` : ""}
                  {l.meta ? ` · ${l.meta}` : ""}
                  {l.totalEur ? ` · ${formatEur(l.totalEur)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
};
