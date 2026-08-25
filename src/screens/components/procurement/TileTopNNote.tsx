// The one disclosure a capped tile owes its reader: is this list everything, or a top-N?
//
// Five procurement tiles cap their rows and, before this, answered that question four
// different ways — three of them wrong:
//
//   • CompanyTopAwardersTile with `seeAllHref={null}` (the person page) showed NOTHING.
//     Measured live on /person/АСЕН ЙОРДАНОВ НИКОЛОВ: 10 of 270 awarders, silently, under
//     a heading naming the whole set.
//   • CompanyTopContractsTile showed „See all →" whenever a href existed, with no count
//     check at all — so a company with three contracts got a link promising more.
//   • ProcurementBreakdownTile silently sliced CPV divisions to six under a heading
//     („В кои сектори печели" / „Какво купува") that is itself a claim about the whole set.
//   • AwarderTopContractorsTile guarded on `> TOP_ROWS` rather than on what it rendered,
//     and carried no total.
//
// Only PersonProcurementBreakdownTile got it right, with a „Топ 8" chip. This generalises
// that, and the states are the point:
//
//   nothing hidden          → render nothing. A „Топ 10" chip over ten of ten is noise,
//                             and worse, it implies a cap where none binds.
//   hidden, somewhere to go → a link. It carries the full count WHEN THE CALLER KNOWS IT,
//                             so the number the reader is missing is visible before they
//                             click, and no number when it does not (see `total` below).
//   hidden, nowhere to go   → a plain „Топ N / M" chip. A see-all pointing at a route that
//                             does not exist is worse than an honest cap — and on the
//                             person page there is no per-person awarders route.
//
// No new i18n keys: `pp_breakdown_top_n` („Топ {{n}}") and `procurement_tile_see_all`
// („Виж всички") already exist in both corpora's always-loaded core chunk.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

/** Both branches sit in a CardTitle's flex row, so they share every layout class; only
 *  the colour differs. Written once because a divergence here is invisible in review and
 *  shows up as one tile's note sitting a pixel off from its neighbour's. */
const NOTE_CLASS = "whitespace-nowrap text-[11px] font-normal normal-case";

export const TileTopNNote: FC<{
  /** Rows actually rendered. */
  shown: number;
  /** Rows that EXIST, when the caller can know it.
   *
   *  ⚠️ Pass the true total, not `rows.length` after slicing — several rollups carry a
   *  separate count field (`awarderCount`, `contractorCount`) precisely because the array
   *  they ship is already truncated server-side, and reading the array would report
   *  „10 / 10" on a company with 270 awarders.
   *
   *  ⚠️⚠️ And pass it only when it counts THE SAME POPULATION as `shown`. This is not
   *  pedantry: `CompanyTopContractsTile` was first wired to `contractCount`, which
   *  excludes €0 consortium-member rows that `topContracts` includes and RENDERS — so
   *  `total < shown` was reachable and the tile went silent on 146 entities that had more
   *  to show (`/company/206773326`: 25 rows shipped, `contractCount` 4). Where the two
   *  bases differ, omit this and pass `hasMore` instead: a link with no number is honest,
   *  a link with the wrong number is not. */
  total?: number;
  /** Evidence that rows are hidden, for a caller with no comparable total. Ignored when
   *  `total` is given. */
  hasMore?: boolean;
  /** Where the full list lives, or null/undefined when it has no page. */
  seeAllHref?: string | null;
  /** Extra classes — used by the one card whose note qualifies a single SECTION rather
   *  than the whole card, and so must not be pushed to the far right by `ml-auto`. */
  className?: string;
}> = ({ shown, total, hasMore, seeAllHref, className }) => {
  const { t } = useTranslation();
  // `total < shown` should be impossible and was not: treat any total at or below what is
  // rendered as "nothing verifiably hidden" and fall back to `hasMore`, so a mis-wired
  // caller degrades to the un-counted link rather than to silence.
  const more = total != null && total > shown ? true : !!hasMore;
  if (!more) return null;

  const known = total != null && total > shown;
  const cls = cn(NOTE_CLASS, className ?? "ml-auto");

  if (!seeAllHref) {
    return (
      <span className={cn(cls, "text-muted-foreground")}>
        {t("pp_breakdown_top_n", { n: shown })}
        {known ? ` / ${total}` : null}
      </span>
    );
  }
  return (
    <Link to={seeAllHref} className={cn(cls, "text-primary hover:underline")}>
      {t("procurement_tile_see_all")}
      {known ? ` (${total})` : null} →
    </Link>
  );
};
