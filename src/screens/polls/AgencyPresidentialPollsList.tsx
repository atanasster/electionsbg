import type {
  Poll,
  PresidentialPollDetail,
  Runoff,
} from "@/data/polls/pollsTypes";
import { sortByFieldworkDesc } from "@/data/polls/fieldwork";
import { PresidentialSurvey } from "./PresidentialSurvey";

export function AgencyPresidentialPollsList({
  polls,
  details,
  runoffs,
  round,
}: {
  polls: Poll[];
  details: PresidentialPollDetail[];
  runoffs: Runoff[];
  round?: 1 | 2;
}) {
  return (
    <div className="space-y-4">
      {sortByFieldworkDesc(polls).map((poll) => (
        <PresidentialSurvey
          key={poll.id}
          poll={poll}
          details={details}
          runoffs={runoffs}
          round={round}
        />
      ))}
    </div>
  );
}
