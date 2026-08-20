// Declared stakes and management roles on /company/:eik — the content of the retired
// /mp/company/:slug page, served from company_declared_stakes() (migration 177).
//
// ⚠️ ABSENCE IS NOT A NEGATIVE FINDING, and this tile never draws one. The route returns
// NULL when nothing survived 096's three gates, which is a different claim from „nobody
// declared a stake in this company" — 1,751 of the retired companies-index's own UICs are in
// exactly that state. So the tile is mounted only on a present payload and renders no
// „0 декларирани дялове" state. Same discipline as CompanyCleanDeliveryTile.
//
// ⚠️ NOTHING HERE MAY SAY „депутати". The population is public office-holders of every tier —
// 966 of the EIKs this serves were unreachable from the MP-only artifact it replaces — and
// MPs are a minority of it. The one place MPs are named is the ЗПК чл. 35 note on the roles
// card, where the law genuinely is MP-specific and the copy says so explicitly.
//
// THREE KINDS, TWO CARDS. `stake_kind` is (share | role | sole_trader) per 089's CHECK, and
// only that column tells them apart. A sole tradership is the declarant's OWN business, so it
// sits with the holdings rather than under „ръководни длъжности" — but it is LABELLED, never
// silently absorbed, because an ЕТ is not a shareholding either.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ArrowRightLeft,
  Briefcase,
  ExternalLink,
  Store,
  Users,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEur } from "@/lib/currency";

export interface DeclaredStakeFiling {
  year: number;
  institution: string | null;
  sourceUrl: string;
}

export interface DeclaredStakeGroup {
  personId: number;
  slug: string;
  name: string;
  /** share | role | sole_trader — 089's CHECK. Never inferred from shareSize. */
  stakeKind: string;
  /** Whether the LATEST filing still declares it. Server-derived: a table-11 disposal is
   *  filed after the holding it ends, so „held anywhere wins" is backwards. See 177. */
  held: boolean;
  shareSize: string | null;
  valueEur: number | null;
  itemType: string | null;
  /** false = the filing names a spouse or a child as the holder. The row must then be
   *  attributed to them, never rendered as the office-holder's own. */
  holderIsDeclarant: boolean;
  holderName: string | null;
  years: number[];
  filings: DeclaredStakeFiling[];
}

export interface DeclaredStakesPayload {
  uic: string;
  groups: DeclaredStakeGroup[];
}
// The route also returns total / personCount / shareCount / roleCount / soleTraderCount.
// They are deliberately NOT declared here: each card counts what it actually lists, so a
// server count in this type is dead code whose only future is a heading that disagrees with
// the rows under it. The server-side counts are gated by
// scripts/db/tests/company_declared_stakes.data.test.ts.

const KindIcon: FC<{ group: DeclaredStakeGroup }> = ({ group }) => {
  const cls = "h-4 w-4 text-muted-foreground shrink-0";
  if (group.stakeKind === "role") return <Users className={cls} />;
  if (group.stakeKind === "sole_trader") return <Store className={cls} />;
  return group.held ? (
    <Briefcase className={cls} />
  ) : (
    <ArrowRightLeft className={cls} />
  );
};

const StakeRow: FC<{ group: DeclaredStakeGroup }> = ({ group }) => {
  const { t, i18n } = useTranslation();
  const isRole = group.stakeKind === "role";
  // ⚠️ „прехвърлен" BELONGS TO `share` ALONE — not to "everything that is not a role".
  // Measured over the corpus: released SHARES carry a transferee on 689 of 2,369 rows, while
  // released roles (0 of 2,024) and sole traderships (0 of 84) carry one on none. A released
  // ЕТ is an интереси-form "held before taking office" row, never a disposal — so a
  // not-a-role complement renders a share sale that the register does not record, against a
  // named office-holder. Two of them render it today.
  const isShare = group.stakeKind === "share";
  return (
    <div className="grid grid-cols-[auto_1fr_auto] gap-3 items-start py-3 border-b last:border-b-0">
      <KindIcon group={group} />
      <div className="min-w-0">
        <Link
          to={`/person/${encodeURIComponent(group.slug)}`}
          className="text-sm font-medium hover:underline truncate block"
        >
          {group.name}
        </Link>
        <div className="text-xs text-muted-foreground">
          {group.stakeKind === "sole_trader" && (
            <>
              {t("company_declared_sole_trader")}
              {" · "}
            </>
          )}
          {t("declaration_year") || "Declaration"} {group.years.join(", ")}
          {/* The past-tense label DEPENDS on the kind: '11' means "transferred to
              someone" for a holding and "held before taking office, not since" for a
              role. Labelling a directorship „прехвърлен" describes a share sale that
              never happened. */}
          {!group.held && (
            <>
              {" · "}
              {isShare ? t("stake_transferred") : t("stake_role_before_office")}
            </>
          )}
        </div>
        {/* Somebody else's holding. The filing says so, and so must the page — this is
            never rendered as the office-holder's own. */}
        {/* ⚠️ NO `truncate` HERE. This line is the attribution that stops the row reading as
            the office-holder's own holding, and a clipped „…" on a long spouse name is
            exactly where a reader stops reading. It wraps instead. */}
        {/* Gated on holderIsDeclarant ALONE, never on the name being present. Requiring
            both let a family row whose holder cell is blank render with no attribution at
            all — i.e. as the office-holder's own holding, which is the one thing 096's
            family arm exists to prevent. */}
        {!group.holderIsDeclarant && (
          <div className="text-xs text-muted-foreground italic">
            {group.holderName
              ? `${t("company_declared_by_other")}: ${group.holderName}`
              : t("company_declared_by_other_unnamed")}
          </div>
        )}
        {group.itemType && (
          <div className="text-xs text-muted-foreground truncate">
            {group.itemType}
          </div>
        )}
      </div>
      <div className="text-right text-sm shrink-0">
        {/* Monospace suits a quantity ("50%") and fights a job title, which is prose —
            mono letter-spaces a shouted role label so hard that two rows of one list
            stop looking like the same column. */}
        {group.shareSize && (
          <div className={isRole ? "text-xs" : "font-mono text-xs"}>
            {group.shareSize}
          </div>
        )}
        {group.valueEur != null && (
          <div className="text-xs text-muted-foreground">
            {formatEur(group.valueEur, i18n.language)}
          </div>
        )}
        {/* One link per filing — the server already collapsed the (year, body) duplicates,
            so what survives here is a distinct document. */}
        <div className="flex flex-wrap justify-end gap-x-2">
          {group.filings.map((f) => (
            <a
              key={f.sourceUrl}
              href={f.sourceUrl}
              target="_blank"
              rel="noreferrer"
              // The visible text is a bare year when a group has several filings, which
              // is no use to a screen reader (and `title` does not supply an accessible
              // name once the link has text content). The label names the document.
              aria-label={[t("declaration_year"), f.year, f.institution]
                .filter(Boolean)
                .join(" · ")}
              title={[f.institution, f.year].filter(Boolean).join(" · ")}
              className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
            >
              {group.filings.length > 1 ? f.year : t("source")}
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
          ))}
        </div>
      </div>
    </div>
  );
};

export const CompanyDeclaredStakesTile: FC<{ data: DeclaredStakesPayload }> = ({
  data,
}) => {
  const { t } = useTranslation();
  // A sole tradership is a form of owning the business, so it belongs with the holdings —
  // labelled per row, never folded in silently.
  // Defence in depth. 177's correlated join is NULL-safe, so a group with no filings is
  // unreachable today — but if that ever regresses, the row must DISAPPEAR rather than
  // assert a named person's holding while citing no document.
  const cited = data.groups.filter((g) => g.filings.length > 0);
  const holdings = cited.filter((g) => g.stakeKind !== "role");
  const roles = cited.filter((g) => g.stakeKind === "role");

  if (holdings.length === 0 && roles.length === 0) return null;

  return (
    <>
      {holdings.length > 0 && (
        <Card className="my-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Briefcase className="h-4 w-4" />
              {t("company_declared_stakes_title")} ({holdings.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {holdings.map((g) => (
              <StakeRow
                key={`h-${g.personId}-${g.stakeKind}-${g.shareSize}-${g.holderIsDeclarant}`}
                group={g}
              />
            ))}
            <div className="text-xs text-muted-foreground mt-4 pt-3 border-t">
              {/* No inline English fallback: `t()` returns the KEY when a string is
                  missing, which is truthy, so `t(k) || "…"` never fires — it is dead
                  copy that silently drifts from the corpus it duplicates. */}
              {t("company_declared_stakes_note")}
            </div>
          </CardContent>
        </Card>
      )}

      {roles.length > 0 && (
        <Card className="my-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" />
              {t("company_roles_declared")} ({roles.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {roles.map((g) => (
              <StakeRow
                key={`r-${g.personId}-${g.stakeKind}-${g.shareSize}-${g.holderIsDeclarant}`}
                group={g}
              />
            ))}
            <div className="text-xs text-muted-foreground mt-4 pt-3 border-t">
              {t("company_roles_declared_note")}
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
};
