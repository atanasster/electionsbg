// „On the same day" — the pill between a local cycle and the presidential one held beside it.
//
// ⚠ IT SELF-HIDES, and that is the whole of its error handling. Only one pair exists in the
// committed corpus (2011), so on every other cycle this renders nothing rather than a disabled
// control pointing at a page that does not exist.
//
// ⚠ THE LABEL NAMES THE OTHER VOTE, not „see also". A reader on `/local/2011_10_23_mi` is being
// told a fact they may not know — that the presidency was decided the same day, out of the same
// ЦИК bundle — so the pill has to say which election it leads to.
//
// ⚠⚠ BOTH SCREENS MOUNT THEIR HALF, AND THE DESTINATION IS THE ONE THAT MATTERS. The
// presidential pill lands on `/local/:cycle`, so that page — `CountryDashboard`, not the
// município view — is where the return pill has to be; mounted only on
// `/local/:cycle/:obshtinaCode` it is a route a reader can take once and never find again, which
// is exactly what this component's own test forbids. `sameDayMountCoverage.test.ts` reads both
// screens and fails when either half goes missing.
//
// ⚠ ON A PLACE PAGE THE PILL KEEPS THE PLACE. `/local/2011_10_23_mi/SML09` links to that
// município's presidential page, not to the national result — 261 of the 262 local 2011 codes
// have a published presidential twin. The exception is `SOF`, the local tree's synthetic city
// aggregate, which has none and falls back to the country page.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Landmark, UserRound } from "lucide-react";
import { CrossElectionPill } from "./CrossElectionLink";
import {
  localSameDayAs,
  presidentialSameDayAs,
} from "@/data/elections/sameDayPresidential";
import { presidentialUrl } from "@/data/elections/presidentialRoutes";

/** ⚠ THE ONE LOCAL CODE WITH NO PRESIDENTIAL TWIN — the local tree's synthetic Sofia city-wide
 *  aggregate. Measured over the committed 2011 trees: 261 of 262 codes resolve, and this is the
 *  one that does not. */
const NO_PRESIDENTIAL_TWIN = new Set(["SOF"]);

/**
 * Rendered on a LOCAL page → the presidential vote held the same day.
 *
 * @param cycle - The local cycle slug, e.g. `2011_10_23_mi`.
 * @param obshtina - The município code when the page has one; the link then keeps the place.
 * @returns The pill, or `null` when no presidential vote shared that day.
 */
export const ToPresidentialSameDay: FC<{
  cycle?: string;
  obshtina?: string;
}> = ({ cycle, obshtina }) => {
  const { t } = useTranslation();
  const entry = presidentialSameDayAs(cycle);
  const placed =
    entry && obshtina && !NO_PRESIDENTIAL_TWIN.has(obshtina)
      ? presidentialUrl(entry.name, "municipality", obshtina)
      : null;
  const to = entry ? (placed ?? presidentialUrl(entry.name, "country")) : null;
  if (!entry || !to) return null;
  return (
    <CrossElectionPill
      to={to}
      search=""
      // ⚠ ITS OWN ICON. `Landmark` is what `CrossElectionLink` already uses for „parliament",
      // and two sibling pills whose icons mean different things is a legend nobody wrote down.
      icon={<UserRound className="h-3.5 w-3.5" aria-hidden />}
      label={t("same_day_to_presidential", {
        year: entry.round1Date.slice(0, 4),
      })}
    />
  );
};

/**
 * Rendered on a PRESIDENTIAL cycle page → the local vote held the same day.
 *
 * @param cycle - The presidential cycle slug, e.g. `2011_10_23_pvr`.
 * @param className - Spacing from the caller. ⚠ IT RIDES ON THE PILL rather than on a wrapper,
 *   because the component self-hides on four of the five cycles and an unconditional wrapper
 *   leaves a gap under the header on every one of them.
 * @returns The pill, or `null` when no local vote shared that day.
 */
export const ToLocalSameDay: FC<{ cycle?: string; className?: string }> = ({
  cycle,
  className,
}) => {
  const { t } = useTranslation();
  const local = localSameDayAs(cycle);
  if (!local) return null;
  return (
    <CrossElectionPill
      to={`/local/${local.name}`}
      search=""
      className={className}
      icon={<Landmark className="h-3.5 w-3.5" aria-hidden />}
      label={t("same_day_to_local", { year: local.round1Date.slice(0, 4) })}
    />
  );
};
