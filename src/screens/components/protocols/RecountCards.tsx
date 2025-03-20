import { RecountOriginal, VoteResults } from "@/data/dataTypes";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

import { FC, useMemo } from "react";
import { ProtocolCard } from "../../../ux/ProtocolCard";
import { BadgeMinus, BadgePlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { VotesChart } from "../charts/VotesChart";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { useSearchParam } from "@/screens/utils/useSearchParam";
import { RecountAddedVotesCard } from "../cards/RecountAddedVotesCard";
import { RecountRemovedVotesCard } from "../cards/RecountRemovedVotesCard";

const RecountInternal: FC<{
  results: VoteResults;
  original: RecountOriginal;
}> = ({ results, original }) => {
  const { t } = useTranslation();
  const { findParty } = usePartyInfo();
  const [recountOpen, setRecountOpen] = useSearchParam("recount", {
    replace: true,
  });

  const { topParties, bottomParties } = useMemo(() => {
    const parties = original.votes
      .map((vote) => {
        const recount = results.votes.find((v) => v.partyNum === vote.partyNum);
        if (!recount) {
          return undefined;
        }
        return {
          ...vote,
          ...findParty(vote.partyNum),
        };
      })
      .filter((v) => v !== undefined);
    const topParties = parties
      .filter((p) => p.addedVotes > 0)
      .map((p) => ({ ...p, totalVotes: p.addedVotes }))
      .sort((a, b) => b.totalVotes - a.totalVotes)
      .slice(0, 5);

    const bottomParties = parties
      .filter((p) => p.removedVotes < 0)
      .map((p) => ({ ...p, totalVotes: Math.abs(p.removedVotes) }))
      .sort((a, b) => b.totalVotes - a.totalVotes)
      .slice(0, 5);
    return { topParties, bottomParties };
  }, [findParty, original.votes, results.votes]);
  return original.addedVotes || original.removedVotes ? (
    <Accordion
      type="single"
      value={recountOpen === "open" ? "cards" : "none"}
      collapsible
      className="w-full"
      onValueChange={(value) => {
        if (value === "cards") {
          setRecountOpen("open");
        } else {
          setRecountOpen(undefined);
        }
      }}
    >
      <AccordionItem value="cards">
        <AccordionTrigger>
          <div className="text-center w-full font-extrabold text-2xl text-muted-foreground">
            {t("voting_recount")}
          </div>
        </AccordionTrigger>
        <AccordionContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 my-4">
            <RecountAddedVotesCard original={original} votes={results.votes} />

            {!!topParties.length && (
              <ProtocolCard
                icon={<BadgePlus />}
                title={t("top_party_recount_gainer")}
              >
                <VotesChart votes={topParties} maxRows={6} />
              </ProtocolCard>
            )}
            <RecountRemovedVotesCard
              original={original}
              votes={results.votes}
            />
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
