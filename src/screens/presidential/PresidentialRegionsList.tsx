// The country map's TEXT TWIN — every oblast, its leading pair, and a link to that oblast.
//
// ⚠ IT IS NOT AN ACCOMPANIMENT, IT IS THE RULE. §4: „a map always has a text equivalent" and
// „colour is never the only encoding of a winner". A choropleth of 31 oblasts filled by leading
// ticket says nothing at all to a screen reader beyond its per-region labels, and nothing to a
// reader who cannot distinguish two neutral-palette greys — 17 of 2021's 23 tickets carry one,
// because an инициативен комитет has no party colour to inherit.
//
// ⚠ IT IS ALSO THE ONLY ROUTE DOWN. `ElectionResultsShell` draws no parent or child
// navigation, and the presidential place pages have no `PlaceHeader` (see
// `PresidentialPlaceScreen`), so without this table `/presidential/:cycle/region/:oblast` is
// reachable only by typing it. That is why it renders even while the map's geography is still
// loading, and why the map is the optional half of the pair rather than this.
//
// ⚠ A KEY ENDING IN `_basis` IS UNBUNDLEABLE. `UnitCostMethodologyScreen` builds
// `` t(`${leg.key}_basis`) ``, and the reachability analysis treats a built template as naming
// EVERY key it could match — so any `*_basis` key is reachable from that route and cannot live
// in a deferred bundle. Two keys here were named that way and had to be renamed; it is a
// naming constraint rather than a lint, and there is no error until the gate runs.
//
// ⚠ THE SHARE IS OF THE TICKET VOTES, NOT THE VALID VOTES, and the caption says so. „не
// подкрепям никого" is valid and is not in this file, so this figure is „of the vote cast for
// a pair" and is the LARGER of the two — a reader comparing it against the ranked list's `pct`
// would otherwise read the gap as an error.

import { FC, useId } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useRegions } from "@/data/regions/useRegions";
import { regionDisplayName } from "@/data/presidential/regionName";
import { presidentialUrl } from "@/data/elections/presidentialRoutes";
import { formatInt, formatPct } from "@/lib/currency";
import type { PresidentialTicket } from "@/data/presidential/useTickets";
import type { RegionLeader } from "./PresidentialRegionsMap";

export const PresidentialRegionsList: FC<{
  cycle: string;
  leaders: Map<string, RegionLeader>;
  tickets: Map<number, PresidentialTicket>;
}> = ({ cycle, leaders, tickets }) => {
  // ⚠ SCOPED, NOT A MODULE CONSTANT. Every other heading id on this page carries the round, so
  // a static one here is the odd row out — and two rounds' panels on one page would give the
  // document two elements with the same id, which is what an `aria-labelledby` resolves by.
  const headingId = useId();
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const isBg = lang?.startsWith("bg") ?? true;
  const { findRegion } = useRegions();

  // ⚠ SORTED BY NAME IN THE ACTIVE LANGUAGE, not by votes. A leader table ordered by size
  // answers „where were the most votes", which is a question about population; this table's
  // job is to let a reader find their own oblast.
  const rows = [...leaders.entries()]
    .map(([code, lead]) => ({
      code,
      lead,
      // ⚠ THE SAME RULE THE MAP USES, from the same module. §4's text-equivalent rule is worth
      // nothing if the two spell a place differently — and read without `long_name`, Sofia's
      // three МИР become rows whose entire link text is „23", „24", „25".
      name: regionDisplayName(findRegion(code), isBg, code),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, isBg ? "bg" : "en"));

  if (rows.length === 0) return null;

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="font-semibold">
        {t("presidential_regions_heading")}
      </h2>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th scope="col">{t("presidential_col_region")}</th>
              <th scope="col">{t("presidential_col_leader")}</th>
              <th scope="col" className="text-right">
                {t("presidential_col_votes")}
              </th>
              <th scope="col" className="text-right">
                {t("presidential_col_leader_share")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ code, lead, name }) => {
              const ticket = tickets.get(lead.number);
              const to = presidentialUrl(cycle, "region", code);
              return (
                <tr key={code} className="border-t">
                  <td>
                    {/* ⚠ A LINK ONLY WHERE ONE RESOLVES. `presidentialUrl` refuses an empty or
                        separator-bearing code, and a row with no route renders as plain text
                        rather than as a link to nowhere. */}
                    {to ? (
                      <Link className="underline" to={to}>
                        {name}
                      </Link>
                    ) : (
                      name
                    )}
                  </td>
                  <td>
                    <span className="flex items-center gap-2">
                      {/* The swatch is a SECOND encoding beside the name, never the only one —
                          which is the whole reason this table exists beside the map. */}
                      <span
                        aria-hidden="true"
                        className="inline-block h-3 w-3 rounded-sm border"
                        style={{ backgroundColor: ticket?.color }}
                      />
                      {ticket?.president ?? lead.number}
                    </span>
                  </td>
                  <td className="text-right tabular-nums">
                    {formatInt(lead.votes, lang)}
                  </td>
                  <td className="text-right tabular-nums">
                    {formatPct(lead.shareOfTicketVotes, lang, 1)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {t("presidential_regions_share_note")}
      </p>
    </section>
  );
};
