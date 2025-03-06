import { RecountOriginal, VoteResults } from "@/data/dataTypes";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

import { FC, useMemo } from "react";
import { ProtocolCard } from "./ProtocolCard";
import { Hint } from "@/ux/Hint";
import { LabelXL } from "./LabelXL";
import { formatPct } from "@/data/utils";
import { BadgeMinus, BadgePlus, FileMinus, FilePlus } from "lucide-react";
import { LabelL } from "./LabelL";
import { useTranslation } from "react-i18next";
import { ThousandsChange } from "@/ux/ThousandsChange";
import { VotesChart } from "../charts/VotesChart";
import { usePartyInfo } from "@/data/parties/usePartyInfo";

const RecountInternal: FC<{
  results: VoteResults;
  original: RecountOriginal;
}> = ({ results, original }) => {
  const { t } = useTranslation();
  const { findParty } = usePartyInfo();

  const totalVotesRecount =
    (results.protocol?.numValidMachineVotes || 0) +
    (results.protocol?.numValidVotes || 0);
  const machineVotesRecount = results.protocol?.numValidMachineVotes || 0;
  const paperVotesRecount = results.protocol?.numValidVotes || 0;
  const { topParties, bottomParties } = useMemo(() => {
    const partiesChange = original.votes
      .map((vote) => {
        const recount = results.votes.find((v) => v.partyNum === vote.partyNum);
        if (!recount) {
          return undefined;
        }
        return {
          partyNum: vote.partyNum,
          added: Math.max(0, recount.totalVotes - vote.totalVotes),
          removed: Math.min(0, recount.totalVotes - vote.totalVotes),
          ...findParty(vote.partyNum),
        };
      })
      .filter((v) => v !== undefined);
    const topParties = partiesChange
      .filter((p) => p.added > 0)
      .map((p) => ({ ...p, totalVotes: p.added }))
      .sort((a, b) => b.totalVotes - a.totalVotes);

    const bottomParties = partiesChange
      .filter((p) => p.removed < 0)
      .map((p) => ({ ...p, totalVotes: Math.abs(p.removed) }))
      .sort((a, b) => b.totalVotes - a.totalVotes);
    return { topParties, bottomParties };
  }, [findParty, original.votes, results.votes]);
  return original.addedVotes || original.removedVotes ? (
    <Accordion type="single" collapsible className="w-full">
      <AccordionItem value="item-1">
        <AccordionTrigger>
          <div className="text-center w-full font-extrabold text-2xl text-muted-foreground">
            {t("voting_recount")}
          </div>
        </AccordionTrigger>
        <AccordionContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 my-4">
            <ProtocolCard title={t("added_votes")} icon={<FilePlus />}>
              <div className="flex">
                <Hint
                  text={t("added_votes_recount_explainer")}
                  underline={false}
                >
                  <LabelXL>
                    <ThousandsChange number={original.addedVotes} />
                  </LabelXL>
                </Hint>
                {!!totalVotesRecount && (
                  <Hint
                    text={t("pct_added_recount_explainer")}
                    underline={false}
                  >
                    <LabelL>
                      {`(${formatPct((100 * original.addedVotes) / totalVotesRecount, 2)})`}
                    </LabelL>
                  </Hint>
                )}
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <div>{`${t("paper_votes")}: `}</div>
                <div className="flex">
                  <ThousandsChange
                    className="font-bold"
                    number={original.addedPaperVotes}
                  />
                  {!!paperVotesRecount && (
                    <div className="font-bold text-primary ml-2">
                      {`(${formatPct((100 * original.addedPaperVotes) / paperVotesRecount, 2)})`}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <div>{`${t("machine_votes")}: `}</div>
                <div className="flex">
                  <ThousandsChange
                    className="font-bold"
                    number={original.addedMachineVotes}
                  />
                  {!!machineVotesRecount && (
                    <div className="font-bold text-primary ml-2">
                      {`(${formatPct((100 * original.addedMachineVotes) / machineVotesRecount, 2)})`}
                    </div>
                  )}
                </div>
              </div>
            </ProtocolCard>
            {!!topParties.length && (
              <ProtocolCard
                icon={<BadgePlus />}
                title={t("top_party_recount_gainer")}
              >
                <VotesChart votes={topParties} maxRows={6} />
              </ProtocolCard>
            )}
            <ProtocolCard title={t("removed_votes")} icon={<FileMinus />}>
              <div className="flex">
                <Hint
                  text={t("removed_votes_recount_explainer")}
                  underline={false}
                >
                  <LabelXL>
                    <ThousandsChange number={original.removedVotes} />
                  </LabelXL>
                </Hint>
                {!!totalVotesRecount && (
                  <Hint
                    text={t("pct_removed_recount_explainer")}
                    underline={false}
                  >
                    <LabelL>
                      {`(${formatPct((100 * original.removedVotes) / totalVotesRecount, 2)})`}
                    </LabelL>
                  </Hint>
                )}
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <div>{`${t("paper_votes")}: `}</div>
                <div className="flex">
                  <ThousandsChange
                    className="font-bold"
                    number={original.removedPaperVotes}
                  />
                  {!!paperVotesRecount && (
                    <div className="font-bold text-primary ml-2">
                      {`(${formatPct((100 * original.removedPaperVotes) / paperVotesRecount, 2)})`}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <div>{`${t("machine_votes")}: `}</div>
                <div className="flex">
                  <ThousandsChange
                    className="font-bold"
                    number={original.removedMachineVotes}
                  />
                  {!!machineVotesRecount && (
                    <div className="font-bold text-primary ml-2">
                      {`(${formatPct((100 * original.removedMachineVotes) / machineVotesRecount, 2)})`}
                    </div>
                  )}
                </div>
              </div>
            </ProtocolCard>
            {!!bottomParties.length && (
              <ProtocolCard
                icon={<BadgeMinus />}
                title={t("top_party_recount_loser")}
              >
                <VotesChart votes={bottomParties} maxRows={6} />
              </ProtocolCard>
            )}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  ) : null;
};

export const RecountCards: FC<{
  results?: VoteResults;
  original?: RecountOriginal;
}> = ({ original, results }) => {
  if (!original || !results || original.votes.length === 0) {
    return null;
  }

  return <RecountInternal original={original} results={results} />;
};
