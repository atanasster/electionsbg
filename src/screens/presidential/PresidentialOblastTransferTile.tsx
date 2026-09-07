// „Откъде дойдоха гласовете на балотажа" for ONE oblast — the region page's own transition
// matrix, from `<cycle>/runoff_transfer/<oblast>.json`.
//
// ⚠ THE SHELL IS `PresidentialTransferCard`, shared with the country tile; this file is only
// the COVERAGE sentence, which is the one thing the two genuinely differ on.
//
// ⚠⚠ THE CAVEAT AND THE COVERAGE REFUSAL BOTH COME FROM THE SHARD, and that matters more here
// than on the country page. A region page fetches this file and nothing else, so there is no
// cycle file in the document to fall back on: a shard that had lost either sentence would draw
// a complete-looking chart with nothing qualifying it. `useOblastTransfer` refuses such a
// payload, so „the chart rendered" implies „both caveats rendered".
//
// ⚠⚠ BOTH REFUSALS ARE CYCLE-WIDE AND THE COPY SAYS SO. Neither the `_unplaced` shard nor the
// abroad rollup carries an oblast — that is what makes them unplaceable — so their mass cannot
// be attributed to one, and a region page that printed only its own figures would read as
// complete. On 2011 that mass is 1,355 sections / 422,726 runoff votes, all of them Sofia,
// against 32,024 votes inside Sofia's three shards.
//
// ⚠ BOTH ARE PRINTED, and the symmetry is deliberate. An earlier cut named the placement
// refusal and dropped the abroad figure, which made this tile state a narrower completeness
// claim than the country tile does about the same estimate — 47,883 votes on 2011 and 127,572
// on 2021, each larger than several oblasts' entire runoff vote.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { PresidentialTransferCard } from "./PresidentialTransferCard";
import { formatInt } from "@/lib/currency";
import type { OblastTransfer } from "@/data/presidential/useOblastTransfer";

export const PresidentialOblastTransferTile: FC<{
  transfer: OblastTransfer;
}> = ({ transfer }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const isEn = lang === "en";
  const cov = transfer.coverage;

  return (
    <PresidentialTransferCard
      basis={transfer.basis}
      basisEn={transfer.basisEn}
      matrix={transfer.matrix}
      marginGap={transfer.marginGap}
      coverage={
        <>
          {isEn ? cov.basisEn : cov.basis}{" "}
          {t("presidential_oblast_transfer_coverage", {
            sections: formatInt(transfer.sections, lang),
            abroad: formatInt(cov.abroadVotesInCycle, lang),
          })}
          {/* ⚠ SUPPRESSED AT ZERO, NOT PRINTED AS „0 REFUSED", and NAMED AS CYCLE-WIDE. Four of
              the five cycles refuse nothing. On 2011 the refusal is larger than every shard it
              sits beside, and a reader of Sofia's page shown „35 секции" and no refusal would
              have no way to discover that fourteen times as many votes are outside it. */}
          {cov.unplacedSectionsInCycle > 0 ? (
            <>
              {" "}
              {t("presidential_oblast_transfer_unplaced", {
                sections: formatInt(cov.unplacedSectionsInCycle, lang),
                votes: formatInt(cov.unplacedVotesInCycle, lang),
              })}
            </>
          ) : null}
        </>
      }
    />
  );
};
