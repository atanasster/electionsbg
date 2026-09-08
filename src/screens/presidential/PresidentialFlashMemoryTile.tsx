// „Разлика с флаш паметта" — the machines' own records against the protocol's machine votes.
//
// ⚠ TWO DOCUMENTS, NOT ONE NUMBER RESTATED. The protocol is what the section commission WROTE
// DOWN; the flash export is what the machine ITSELF recorded. Neither is derived from the
// other, which is what makes the gap a finding rather than an arithmetic slip — and what makes
// a zero here worth printing too.
//
// ⚠⚠ THE DIFFERENCE IS NOT AN ALLEGATION, and the copy must not let it read as one. A gap of a
// few hundred votes across ~9,400 sections is the ordinary residue of two independent counts
// — machines swapped mid-day, a protocol written from a different printout, a shard the export
// missed. The tile states the size and the basis and stops there; it names no section and
// draws no conclusion.
//
// ⚠ THE SHARE IS OF MACHINE VOTES COMPARED, NEVER OF SECTIONS. 9,355 of 12,488 sections reads
// as 75% coverage and is misleading: most uncovered sections had no machine at all, so they
// have no machine votes to compare. Measured on 2021 round 1, only 3,089 machine votes of
// ~2.0M sit outside the comparison — 99.85% — and that is the honest headline.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Cpu } from "lucide-react";
import { StatCard } from "@/screens/dashboard/StatCard";
import { formatInt, formatPct } from "@/lib/currency";
import { useFlashDiff } from "@/data/presidential/useFlashDiff";
import { useTicketsByNumber } from "@/data/presidential/useTickets";
import { PresidentialPersonName } from "./PresidentialPersonName";

/** ⚠ ZERO IS ITS OWN CASE AND STAYS MUTED. A green „0" reads as a gain and a red one as a
 *  problem; an exact match between two independent documents is neither. */
const toneOf = (d: number): string =>
  d === 0 ? "text-muted-foreground" : d > 0 ? "text-positive" : "text-negative";

export const PresidentialFlashMemoryTile: FC<{
  cycle: string;
  round: 1 | 2;
}> = ({ cycle, round }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const diff = useFlashDiff(cycle, round);
  const tickets = useTicketsByNumber(cycle);

  // See the hook: absent means this election published no such records, so the tile is not
  // rendered at all rather than showing an empty comparison.
  if (!diff || diff.tickets.length === 0) return null;

  const compared = diff.tickets.reduce((a, r) => a + r.machineVotes, 0);
  const total = compared + diff.coverage.uncomparedMachineVotes;
  // Only the rows worth reading: a ticket with no machine votes on either side says nothing.
  const rows = diff.tickets.filter(
    (r) => r.machineVotes > 0 || r.flashVotes > 0,
  );
  const maxAbs = Math.max(
    1,
    ...rows.map((r) => Math.abs(r.flashVotes - r.machineVotes)),
  );

  return (
    <StatCard
      label={
        <div className="flex items-center gap-2">
          <Cpu className="h-4 w-4" />
          <span>{t("presidential_flash_title")}</span>
        </div>
      }
      hint={t("presidential_flash_hint")}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              {/* ⚠ „Президент", NOT „Президент и вицепрезидент". `presidential_col_pair` is
                  the FULL ranking's header, where both names are rendered; this column carries
                  the president alone, and a header naming a person the row does not show is a
                  claim about whose votes these are. */}
              <th scope="col">{t("presidential_flash_col_president")}</th>
              <th scope="col" className="text-right">
                {t("presidential_flash_col_protocol")}
              </th>
              <th scope="col" className="text-right">
                {t("presidential_flash_col_flash")}
              </th>
              <th scope="col" className="text-right">
                {t("presidential_flash_col_diff")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const ticket = tickets.get(r.number);
              const d = r.flashVotes - r.machineVotes;
              const bar = Math.max(2, (Math.abs(d) / maxAbs) * 100);
              return (
                <tr key={r.number} className="border-t">
                  <td className="py-1">
                    <span className="flex items-center gap-2">
                      {ticket?.color ? (
                        <span
                          aria-hidden
                          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: ticket.color }}
                        />
                      ) : null}
                      {/* ⚠ THE NUMBER IS THE FALLBACK, never a blank: a row with a real vote
                          count and no name attributes it to nobody — and a bare ticket number
                          is never a link, because it names no one to link to.
                          ⚠ THE SAME LINK RULE AS EVERY OTHER PRESIDENTIAL NAME on this page,
                          through the one component that owns it — it refuses a name the corpus
                          cannot resolve to exactly one person, so nobody is linked by
                          coincidence. */}
                      <span className="truncate">
                        {ticket?.president ? (
                          <PresidentialPersonName name={ticket.president} />
                        ) : (
                          r.number
                        )}
                      </span>
                    </span>
                  </td>
                  <td className="py-1 text-right tabular-nums">
                    {formatInt(r.machineVotes, lang)}
                  </td>
                  <td className="py-1 text-right tabular-nums">
                    {formatInt(r.flashVotes, lang)}
                  </td>
                  <td className="py-1 text-right tabular-nums">
                    <span className="flex items-center justify-end gap-2">
                      <span
                        aria-hidden
                        className="h-1.5 min-w-[20px] flex-1 rounded-full bg-muted"
                        style={{
                          backgroundImage: `linear-gradient(to right, currentColor ${bar}%, transparent ${bar}%)`,
                        }}
                      />
                      {/* ⚠ SIGNED. „522" and „−522" are opposite claims about which document
                          recorded more, so the sign is not decoration. */}
                      <span className={toneOf(d)}>
                        {d > 0 ? "+" : ""}
                        {formatInt(d, lang)}
                      </span>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {/* ⚠ THE BASIS TRAVELS WITH THE FIGURES — see the header.
          ⚠ AND ITS KEY DELIBERATELY DOES NOT END IN THE SUFFIX THE COPY WOULD SUGGEST.
          `UnitCostMethodologyScreen` builds its own key from a template, and the bundle
          analysis treats a built template as naming EVERY key it could match — so a key with
          that ending is reachable from a methodology route and can never live in a deferred
          bundle. This one was named that way first and the gate caught it, as it caught two
          earlier presidential keys. See `bundles.ts` for the rule.

          ⚠ AND THE OLD NAME IS NOT WRITTEN OUT HERE, which is not squeamishness: the
          reachability scan reads these files as text, so a comment QUOTING the key is
          indistinguishable from a call site naming it. Writing it out re-created the failure
          this comment exists to explain — on the methodology bundle rather than this one,
          which is what made it confusing. */}
      <p className="mt-2 text-xs text-muted-foreground">
        {t("presidential_flash_coverage_note", {
          pct: formatPct(total > 0 ? compared / total : null, lang, 2),
          sections: formatInt(diff.coverage.comparedSections, lang),
          left: formatInt(diff.coverage.uncomparedMachineVotes, lang),
        })}
      </p>
    </StatCard>
  );
};
