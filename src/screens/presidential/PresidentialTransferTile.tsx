// „Откъде дойдоха гласовете на балотажа" — the estimated round-1 → runoff transition matrix,
// for the whole country.
//
// ⚠ THE SHELL AND THE PICTURE BOTH LIVE ELSEWHERE, and this file is now only the COVERAGE
// sentence. `PresidentialTransferCard` owns the caveat-first layout and the precision line;
// `PresidentialTransferChart` owns the Sankey-or-table decision. Two tiles draw this kind of
// matrix now, and a rule answered twice is two answers the day either moves — one of them
// (`PCT_DIGITS`) had already forked between the copies before the extraction.
//
// ⚠ THE NODE TOTALS AND THE RIBBONS DO NOT ADD UP EXACTLY, and the card says by how much.
// `marginGap` is the estimate's own imprecision — RAS converges geometrically and a nearly
// degenerate oblast does not get there — so a reader who adds the ribbons into „Радев" and
// finds a different number than the node's label has been told why in advance.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { PresidentialTransferCard } from "./PresidentialTransferCard";
import { formatInt } from "@/lib/currency";
import type { RunoffTransfer } from "@/data/presidential/useRunoffTransfer";

export const PresidentialTransferTile: FC<{ transfer: RunoffTransfer }> = ({
  transfer,
}) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const isEn = lang === "en";
  const { matrix, marginGap } = transfer.national;
  const cov = transfer.coverage;

  return (
    <PresidentialTransferCard
      basis={transfer.basis}
      basisEn={transfer.basisEn}
      matrix={matrix}
      marginGap={marginGap}
      coverage={
        <>
          {isEn ? cov.basisEn : cov.basis}{" "}
          {t("presidential_transfer_coverage", {
            sections: formatInt(cov.domesticSections, lang),
            abroad: formatInt(cov.abroadVotes, lang),
          })}
          {/* ⚠ SUPPRESSED AT ZERO, NOT PRINTED AS „0 REFUSED". Four of the five cycles refuse
              nothing; 2011 refuses 1,355 sections and 422,726 votes — nine times the abroad
              figure — and without this clause the Sankey's node labels are 276k below the
              result the same page prints, with nothing to explain the gap. */}
          {cov.unplacedSections > 0 ? (
            <>
              {" "}
              {t("presidential_transfer_coverage_unplaced", {
                sections: formatInt(cov.unplacedSections, lang),
                votes: formatInt(cov.unplacedVotes, lang),
              })}
            </>
          ) : null}
        </>
      }
    />
  );
};
