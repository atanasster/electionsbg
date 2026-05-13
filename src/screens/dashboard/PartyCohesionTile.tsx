import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Users, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { Link } from "@/ux/Link";
import { useFactionCohesion } from "@/data/parliament/votes/useFactionCohesion";
import { useParliamentGroups } from "@/data/parliament/useParliamentGroups";
import type { CohesionEntry } from "@/data/parliament/votes/types";
import type { PartyInfo } from "@/data/dataTypes";

type Props = { party: PartyInfo };

const formatPct = (frac: number, lang: string): string =>
  new Intl.NumberFormat(lang === "bg" ? "bg-BG" : "en-GB", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(frac);

const norm = (s: string): string => s.toLocaleUpperCase().trim();

// Bridge from a CIK party `nickName` (election-side) to the parliamentary
// group rows in cohesion.json (parliament.bg-side).
//
// Most parties are seated as a single parliamentary group with a matching
// short name, but coalitions can split — e.g. CIK "ПП-ДБ" seats as separate
// "ПП" and "ДБ" groups. parliament_groups.json captures those splits via
// `parentCoalitionNickName`; we use that map first, then fall back to a
// direct case-insensitive match.
const matchCohesion = (
  nickName: string,
  entries: CohesionEntry[],
  childrenAliases: Set<string>,
): CohesionEntry[] => {
  const out: CohesionEntry[] = [];
  const wantedNick = norm(nickName);
  for (const e of entries) {
    const partyNorm = norm(e.partyShort);
    if (childrenAliases.has(partyNorm)) {
      out.push(e);
      continue;
    }
    // Direct equality, then "contains" — partyShort sometimes prepends "ПГ"
    // or otherwise extends the CIK nickName slightly.
    if (partyNorm === wantedNick) out.push(e);
    else if (partyNorm.includes(wantedNick) && wantedNick.length >= 3)
      out.push(e);
  }
  return out;
};

export const PartyCohesionTile: FC<Props> = ({ party }) => {
  const { t, i18n } = useTranslation();
  const { entries, isLoading } = useFactionCohesion();
  const { childrenFor } = useParliamentGroups();

  const childrenAliases = useMemo(() => {
    const set = new Set<string>();
    for (const c of childrenFor(party.nickName) ?? []) {
      if (c.shortName) set.add(norm(c.shortName));
      if (c.longName) set.add(norm(c.longName));
      if (c.displayName) set.add(norm(c.displayName));
    }
    return set;
  }, [childrenFor, party.nickName]);

  const matched = useMemo(
    () => matchCohesion(party.nickName, entries, childrenAliases),
    [entries, party.nickName, childrenAliases],
  );

  // Rank against all parliamentary groups in the file (1-based, smaller = more
  // unified). When the CIK party seats as multiple groups, surface the highest
  // rank (most-unified component) since "best" is the more useful number.
  const ranked = useMemo(
    () => [...entries].sort((a, b) => b.meanCohesion - a.meanCohesion),
    [entries],
  );
  const rankOf = (partyShort: string): number =>
    ranked.findIndex((r) => r.partyShort === partyShort) + 1;

  if (isLoading) {
    return (
      <Card className="my-2" aria-hidden>
        <CardContent>
          <div className="min-h-[140px]" />
        </CardContent>
      </Card>
    );
  }
  if (matched.length === 0) return null;

  const total = ranked.length;
  const lang = i18n.language;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <Users className="h-4 w-4" />
          {t("party_cohesion_title") || "Group cohesion in parliament"}
          <Link
            to="/parliament/cohesion"
            underline={false}
            className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline font-normal"
          >
            {t("dashboard_see_details") || "See details"}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          {matched.map((m) => {
            const rank = rankOf(m.partyShort);
            return (
              <div key={m.partyShort}>
                {matched.length > 1 && (
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {m.partyShort}
                  </div>
                )}
                <div className="text-2xl font-bold tabular-nums">
                  {formatPct(m.meanCohesion, lang)}
                </div>
                <div className="text-xs text-muted-foreground tabular-nums">
                  {t("party_cohesion_rank") || "Rank"}: {rank} / {total} ·{" "}
                  {t("cohesion_median") || "Median"}{" "}
                  {formatPct(m.medianCohesion, lang)}
                </div>
              </div>
            );
          })}
        </div>
        <div className="text-xs text-muted-foreground mt-3 pt-3 border-t">
          {t("party_cohesion_hint") ||
            "Share of group members voting the same way per item, averaged. Absences excluded."}
        </div>
      </CardContent>
    </Card>
  );
};
