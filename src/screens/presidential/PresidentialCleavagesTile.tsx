// „Кой къде спечели" — the demographic cleavages of one presidential round.
//
// ⚠⚠ THE CAVEAT COMES FROM THE ARTIFACT, NOT FROM A LOCALE FILE, and here it is the whole
// point of the tile. Every dot is a Pearson r between a pair's municipal vote share and a
// census indicator: it says municipalities with more of a characteristic gave that pair a
// larger share, and NOT that those voters chose them. Reading an individual out of it is the
// ecological fallacy, `usePresidentialCleavages` refuses a payload that lost the sentence, and
// the sentence renders ABOVE the plot so a reader who stops at the picture has still read it.
//
// ⚠ IT REUSES `DemographicCleavagesPlot`. A second dot plot would be a second visual grammar
// for the same claim, and the −1…+1 track is one readers already know from `/parliamentary`.
// What the plot could not do unparameterised is the LEGEND: a parliamentary entry is a party
// with an English display name and a `/party/:slug` page, and a presidential one is a pair of
// people whose name is Cyrillic in both languages and whose page, where the corpus can name
// exactly one public figure, is `/person`.
//
// ⚠ A KEY ENDING IN `_basis` IS UNBUNDLEABLE, AND BOTH OF THIS SECTION'S CAPTIONS WERE NAMED
// THAT WAY FIRST. `UnitCostMethodologyScreen` builds `` t(`${leg.key}_basis`) ``, and the
// reachability analysis treats a built template as naming EVERY key it could match — so any
// `*_basis` key is reachable from that route and cannot live in a deferred bundle. It is a
// naming constraint rather than a lint, and there is no error until the gate runs.
//
// ⚠ THE ROW SELECTION IS THE SHARED ONE. `selectCleavageRows` decides which of the 18 metrics
// are headline cleavages and which are pinned or hidden; a presidential copy would drift from
// the parliamentary tile on a page a reader reaches from the same header.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import { Hint } from "@/ux/Hint";
import { StatCard } from "@/screens/dashboard/StatCard";
import { selectCleavageRows } from "@/screens/dashboard/selectCleavageRows";
import { DemographicCleavagesPlot } from "@/screens/components/demographics/DemographicCleavagesPlot";
import { personHrefForTicket } from "@/data/presidential/ticketPersons";
import { formatInt } from "@/lib/currency";
import type { DemographicCleavagesPayload } from "@/data/dashboard/useDemographicCleavages";
import type { PresidentialCleavages } from "@/data/presidential/usePresidentialCleavages";

export const PresidentialCleavagesTile: FC<{
  cleavages: PresidentialCleavages;
}> = ({ cleavages }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const isEn = lang === "en";

  // ⚠ ADAPTED, NOT RE-SHAPED IN THE PRODUCER. The plot's payload type is the parliamentary
  // one; mapping a ticket onto it here keeps the artifact honest about what it is (a ticket
  // number and a person's name) while letting one chart draw both kinds.
  const payload = useMemo<DemographicCleavagesPayload>(
    () => ({
      election: `${cleavages.cycle}/tur${cleavages.round}`,
      parties: cleavages.tickets.map((tk) => ({
        partyNum: tk.number,
        nickName: tk.president,
        color: tk.color,
        pctNational: tk.pctNational,
      })),
      rows: cleavages.rows,
    }),
    [cleavages],
  );
  const rows = useMemo(() => selectCleavageRows(cleavages.rows), [cleavages]);

  if (rows.length === 0) return null;

  return (
    <StatCard
      label={
        <Hint text={t("presidential_cleavages_hint")} underline={false}>
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            <span>{t("presidential_cleavages_title")}</span>
          </div>
        </Hint>
      }
    >
      <p className="text-xs text-muted-foreground">
        {isEn ? cleavages.basisEn : cleavages.basis}
      </p>
      <DemographicCleavagesPlot
        payload={payload}
        rows={rows}
        // ⚠ THE SAME LINK RULE AS EVERY OTHER PRESIDENTIAL NAME, from the same resolver, so a
        // candidate cannot be a link in the ranked list and plain text here. It REFUSES a
        // shared name and `undefined` renders as plain text — the honest answer rather than a
        // link that attributes this candidacy to somebody who merely shares a name.
        nameFor={(p) => p.nickName}
        hrefFor={(p) => personHrefForTicket(p.nickName)}
        // ⚠ THE DEFAULT NOTE IS FALSE HERE, TWICE OVER. It says „Всяка точка е ПАРТИЯ, преминала
        // прага от 4%" — a presidential dot is a PAIR OF PEOPLE, and the cut is a 3% readability
        // threshold with no legal meaning, since a presidential ballot has none.
        noteKey="presidential_cleavages_note"
        // ⚠ INERT ROWS. The default sends a row to `/demographics`, which plots census
        // characteristics against PARTY vote for the SELECTED PARLIAMENTARY election — a
        // different ballot, a different field of candidates, reached from a row labelled with
        // this one's numbers. The local tile dropped its links for the same reason.
        metricHref={() => undefined}
      />
      <p className="mt-2 text-xs text-muted-foreground">
        {t("presidential_cleavages_coverage", {
          municipalities: formatInt(cleavages.municipalities, lang),
          abroad: formatInt(cleavages.abroadVotes, lang),
        })}
      </p>
      {/* ⚠ SUPPRESSED AT ZERO, NOT PRINTED AS A ZERO — and it IS zero on all ten committed
          artifacts, which is exactly why it needs saying when it is not. The field exists
          because the producer cannot always place a section in a municipality; the day it
          cannot, this tile would otherwise state „computed across N municipalities, abroad is
          outside it" while silently omitting a THIRD bucket that is also outside every r. The
          transfer family solved the same problem with the same shape. */}
      {cleavages.unmappedVotes > 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {t("presidential_cleavages_unplaced", {
            votes: formatInt(cleavages.unmappedVotes, lang),
          })}
        </p>
      ) : null}
    </StatCard>
  );
};
