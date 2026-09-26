import type {
  Poll,
  PollQuestion,
  PresidentialPollDetail,
} from "@/data/polls/pollsTypes";
import { parseFieldworkEnd } from "@/data/polls/fieldwork";

export const pollEnd = (p: Poll) =>
  p.provenance?.fieldworkEnd ?? parseFieldworkEnd(p.fieldwork) ?? null;
export const questionSeries = (
  p: Poll,
  q: PollQuestion,
  d: PresidentialPollDetail,
) =>
  JSON.stringify([
    p.agencyId,
    q.cycle,
    q.round,
    q.measure,
    q.base.kind,
    q.base.label,
    q.base.includesNone,
    q.scenario,
    q.genre,
    d.candidateKey,
    d.answerCode,
  ]);

export function campaignObservations(
  polls: Poll[],
  details: PresidentialPollDetail[],
  round: number,
) {
  return polls
    .flatMap((poll) =>
      (poll.questions ?? []).flatMap((question) => {
        const date = pollEnd(poll);
        if (
          !date ||
          question.round !== round ||
          question.measure !== "vote_intention" ||
          question.scenario !== null
        )
          return [];
        return details
          .filter((d) => d.pollId === poll.id && d.questionId === question.id)
          .map((detail) => ({
            poll,
            question,
            detail,
            date,
            time: Date.parse(date),
            series: questionSeries(poll, question, detail),
          }));
      }),
    )
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.poll.id.localeCompare(b.poll.id),
    );
}
