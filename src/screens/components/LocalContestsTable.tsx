// "Contests stood in" spine — a unified table of every local-election
// race a person has appeared in (município mayor, район mayor, kmetstvo
// mayor, councillor) across all available cycles.
//
// Modeled after WhoCanIVoteFor's person-profile pattern, the spine is
// the same set of columns regardless of the office, so a future
// extension that also surfaces parliamentary candidacies on this table
// is a drop-in.
//
// Renders nothing when there are no contests; the consumer can mount it
// unconditionally and rely on graceful auto-hide.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ArrowRight, History } from "lucide-react";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { useOfficialLocalContests } from "@/data/local/useOfficialLocalContests";
import type { LocalContestRole } from "@/data/local/useOfficialLocalContests";

type Props = {
  obshtinaCode?: string | null;
  name?: string | null;
};

const friendlyCycleDate = (cycle: string): string => {
  const m = cycle.match(/^(\d{4})_(\d{2})_(\d{2})/);
  if (!m) return cycle;
  return `${m[3]}.${m[2]}.${m[1]}`;
};

const ROLE_I18N: Record<LocalContestRole, string> = {
  mayor_obshtina: "local_contests_role_mayor_obshtina",
  mayor_rayon: "local_contests_role_mayor_rayon",
  mayor_kmetstvo: "local_contests_role_mayor_kmetstvo",
  councillor: "local_contests_role_councillor",
};

export const LocalContestsTable: FC<Props> = ({ obshtinaCode, name }) => {
  const { t, i18n } = useTranslation();
  const { rows } = useOfficialLocalContests(obshtinaCode, name);
  const { byId: canonicalById } = useCanonicalParties();

  if (rows.length === 0) return null;

  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm space-y-3">
      <h2 className="text-base font-semibold flex items-center gap-2">
        <History className="h-4 w-4" />
        {t("local_contests_section_title")}
      </h2>
      <div className="overflow-x-auto -mx-4 px-4">
        <table className="w-full text-[12px] tabular-nums">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted-foreground text-left">
              <th className="py-1 pr-2 font-normal">
                {t("local_contests_col_cycle")}
              </th>
              <th className="py-1 pr-2 font-normal">
                {t("local_contests_col_role")}
              </th>
              <th className="py-1 pr-2 font-normal">
                {t("local_contests_col_party")}
              </th>
              <th className="py-1 pr-2 font-normal text-right">
                {t("local_contests_col_votes")}
              </th>
              <th className="py-1 pl-2 font-normal text-right">
                {t("local_contests_col_outcome")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const canonical = r.partyCanonicalId
                ? canonicalById.get(r.partyCanonicalId)
                : undefined;
              const partyLabel = canonical?.displayName ?? r.partyName;
              const roleLabel = t(ROLE_I18N[r.role]);
              const scope = r.scopeLabel ? ` · ${r.scopeLabel}` : "";
              const roundLabel = r.round
                ? ` · ${r.round === 2 ? t("local_election_round_2") : t("local_election_round_1")}`
                : "";
              return (
                <tr
                  key={`${r.cycle}-${r.role}-${r.scopeLabel ?? ""}-${i}`}
                  className="border-t border-border/60"
                >
                  <td className="py-1.5 pr-2 whitespace-nowrap text-muted-foreground">
                    <Link
                      to={`/local/${r.cycle}/${obshtinaCode ?? ""}`}
                      className="hover:underline"
                    >
                      {friendlyCycleDate(r.cycle)}
                    </Link>
                  </td>
                  <td className="py-1.5 pr-2">
                    <span className="font-medium text-foreground">
                      {roleLabel}
                    </span>
                    <span className="text-muted-foreground">
                      {scope}
                      {roundLabel}
                    </span>
                  </td>
                  <td className="py-1.5 pr-2">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-sm shrink-0"
                        style={{
                          backgroundColor: canonical?.color ?? "#9ca3af",
                        }}
                        aria-hidden
                      />
                      <span
                        className="truncate max-w-[160px]"
                        title={r.partyName}
                      >
                        {partyLabel}
                      </span>
                    </span>
                  </td>
                  <td className="py-1.5 pr-2 text-right">
                    {r.votes > 0 ? (
                      <>
                        {new Intl.NumberFormat(
                          i18n.language === "bg" ? "bg-BG" : "en-GB",
                        ).format(r.votes)}
                        <span className="ml-1 text-muted-foreground">
                          ({r.pctOfValid.toFixed(1)}%)
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-1.5 pl-2 text-right">
                    {r.isElected ? (
                      <span className="inline-flex items-center rounded-md border border-emerald-500/40 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700">
                        {t("local_contests_outcome_elected")}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        {t("local_contests_outcome_not_elected")}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {obshtinaCode ? (
        <Link
          to={`/local/${rows[0].cycle}/${obshtinaCode}`}
          className="inline-flex items-center gap-1 text-[12px] text-primary hover:underline"
        >
          {t("local_contests_drill_in")}
          <ArrowRight className="h-3 w-3" />
        </Link>
      ) : null}
    </section>
  );
};
