import type {
  Poll,
  PresidentialPollDetail,
  Runoff,
  PollResidual,
} from "../../../src/data/polls/pollsTypes";

const residualNumbers = (r: PollResidual | null) =>
  r ? [r.undecided, r.wontVote, r.wontSay, r.otherNamedMinor] : null;
const sorted = <T>(rows: T[]): T[] =>
  rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

/** Language-neutral review guard. Equal content is a possible mirror, not proof
 * that two URLs are the same publication; acceptance must reconcile it first. */
export const presidentialSurveySignature = (
  poll: Pick<Poll, "agencyId" | "fieldwork" | "respondents" | "questions">,
  details: PresidentialPollDetail[],
  runoffs: Runoff[],
): string | null => {
  if (
    !poll.fieldwork ||
    !poll.questions?.length ||
    (!details.length && !runoffs.length)
  )
    return null;
  return JSON.stringify({
    agency: poll.agencyId,
    fieldwork: poll.fieldwork,
    respondents: poll.respondents,
    questions: poll.questions
      .map((q) => ({
        round: q.round,
        measure: q.measure,
        base: q.base.kind,
        baseSize: q.base.respondents,
        includesNone: q.base.includesNone,
        residual: residualNumbers(q.residual),
        rows: details
          .filter((d) => d.questionId === q.id)
          .map((d) => [d.candidateKey, d.answerCode, d.support])
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
        runoffs: sorted(
          runoffs
            .filter((r) => r.questionId === q.id)
            .map((r) => ({
              pair: sorted([
                [r.a, r.supportA],
                [r.b, r.supportB],
              ]),
              residual: residualNumbers(r.residual),
            })),
        ),
      }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  });
};
