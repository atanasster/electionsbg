import type {
  Poll,
  PollQuestion,
  PresidentialPollDetail,
  PresidentialPollsAccuracy,
  Runoff,
} from "@/data/polls/pollsTypes";
import { pollEnd } from "./pollHistory";

export const inRound = (q: PollQuestion, round: number) =>
  q.round === null || q.round === round;
export function residualObservations(polls: Poll[], round: number) {
  return polls
    .flatMap((poll) =>
      (poll.questions ?? [])
        .filter((q) => inRound(q, round))
        .flatMap((question) => {
          const date = pollEnd(poll);
          if (!date) return [];
          const residual = (
            ["undecided", "wontVote", "wontSay"] as const
          ).flatMap((code) =>
            question.residual?.[code] == null
              ? []
              : [{ code, share: question.residual[code]! }],
          );
          const answers =
            question.measure === "participation"
              ? (question.observations ?? []).map((o) => ({
                  code: o.answerCode,
                  share: o.share,
                }))
              : [];
          return [...residual, ...answers].map((answer) => ({
            poll,
            question,
            date,
            ...answer,
            series: JSON.stringify([
              poll.agencyId,
              poll.cycle,
              question.id,
              question.measure,
              question.base.kind,
              question.base.label,
              question.scenario,
              answer.code,
            ]),
          }));
        }),
    )
    .sort((a, b) => a.date.localeCompare(b.date));
}
export function matchupObservations(
  polls: Poll[],
  details: PresidentialPollDetail[],
  runoffs: Runoff[],
  accuracy: PresidentialPollsAccuracy,
  round: number,
) {
  return polls
    .flatMap((poll) =>
      (poll.questions ?? [])
        .filter((q) => inRound(q, round))
        .flatMap((question) => {
          const pairs = runoffs.filter(
            (r) => r.pollId === poll.id && r.questionId === question.id,
          );
          if (question.round === 2 && question.measure === "vote_intention") {
            const rows = details.filter(
              (d) =>
                d.pollId === poll.id &&
                d.questionId === question.id &&
                d.candidateKey !== "none" &&
                d.placeholderFor === null,
            );
            if (rows.length === 2)
              pairs.push({
                pollId: poll.id,
                agencyId: poll.agencyId,
                questionId: question.id,
                a: rows[0].candidateKey,
                b: rows[1].candidateKey,
                aName_bg: rows[0].candidateName_bg,
                bName_bg: rows[1].candidateName_bg,
                supportA: rows[0].support,
                supportB: rows[1].support,
                residual: question.residual,
              });
          }
          const first = accuracy.cycles.find(
            (c) => c.cycle === poll.cycle,
          )?.round1Date;
          const kind = question.scenario
            ? "hypothetical"
            : first &&
                poll.provenance?.fieldworkStart &&
                poll.provenance.fieldworkStart > first
              ? "between_rounds"
              : "unclassified";
          const name = (key: string, raw?: string) =>
            raw ??
            details.find((d) => d.pollId === poll.id && d.candidateKey === key)
              ?.candidateName_bg ??
            key;
          return pairs.map((pair) => ({
            poll,
            question,
            pair,
            date: pollEnd(poll),
            kind,
            a: name(pair.a, pair.aName_bg),
            b: name(pair.b, pair.bName_bg),
            margin: pair.supportA - pair.supportB,
            none:
              details.find(
                (d) =>
                  d.pollId === poll.id &&
                  d.questionId === question.id &&
                  d.candidateKey === "none",
              )?.support ?? null,
          }));
        }),
    )
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
}
export function candidateMargins(
  polls: Poll[],
  details: PresidentialPollDetail[],
  round: number,
  a: string,
  b: string,
) {
  if (!a || !b || a === b) return [];
  return polls
    .flatMap((poll) =>
      (poll.questions ?? [])
        .filter(
          (q) =>
            q.round === round &&
            q.measure === "vote_intention" &&
            q.scenario === null,
        )
        .flatMap((question) => {
          const rows = details.filter(
            (d) => d.pollId === poll.id && d.questionId === question.id,
          );
          const left = rows.find((d) => d.candidateKey === a),
            right = rows.find(
              (d) => d.candidateKey === b && d.answerCode === left?.answerCode,
            );
          return left && right
            ? [
                {
                  poll,
                  question,
                  date: pollEnd(poll),
                  a: left,
                  b: right,
                  margin: left.support - right.support,
                },
              ]
            : [];
        }),
    )
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
}
export function pollExport(
  polls: Poll[],
  details: PresidentialPollDetail[],
  runoffs: Runoff[],
  accuracy: PresidentialPollsAccuracy,
  round: number,
  candidate = "",
) {
  const filtered = polls.map((p) => ({
    ...p,
    questions: p.questions?.filter((q) => inRound(q, round)),
  }));
  const questionIds = new Set(
    filtered.flatMap((p) => (p.questions ?? []).map((q) => p.id + "|" + q.id)),
  );
  const allowed = (r: { pollId: string; questionId?: string }) =>
    questionIds.has(r.pollId + "|" + r.questionId);
  return {
    round,
    candidate: candidate || null,
    polls: filtered,
    details: details.filter(
      (r) => allowed(r) && (!candidate || r.candidateKey === candidate),
    ),
    runoffs: runoffs.filter(
      (r) =>
        allowed(r) && (!candidate || r.a === candidate || r.b === candidate),
    ),
    diagnostics: accuracy.cycles
      .flatMap((c) => c.diagnostics ?? [])
      .filter((r) => questionIds.has(r.pollId + "|" + r.questionId)),
    accuracy: accuracy.cycles
      .flatMap((c) =>
        (c.rounds ?? [])
          .filter((r) => r.round === round)
          .flatMap((r) => r.comparisons),
      )
      .filter(allowed),
  };
}
export function exportCsv(data: ReturnType<typeof pollExport>) {
  const header = [
    "poll_id",
    "agency",
    "cycle",
    "round",
    "fieldwork",
    "published_at",
    "sample_total",
    "sample_base",
    "method_bg",
    "method_en",
    "sponsor_bg",
    "sponsor_en",
    "source",
    "source_sha256",
    "question_id",
    "question_bg",
    "question_en",
    "evidence_url",
    "evidence_locator",
    "measure",
    "base_kind",
    "base_bg",
    "base_en",
    "includes_none",
    "scenario",
    "genre",
    "candidate",
    "answer_code",
    "answer_bg",
    "answer_en",
    "share",
    "eligible",
    "eligibility_reason",
    "diagnostics",
  ];
  const rows: (string | number | boolean | null | undefined)[][] = [];
  for (const p of data.polls)
    for (const q of p.questions ?? []) {
      const reason = q.scoring.eligible ? "" : q.scoring.reason;
      const common = [
        p.id,
        p.agencyId,
        p.cycle,
        q.round,
        p.fieldwork,
        p.publishedAt,
        p.respondents,
        q.base.respondents,
        p.methodology.bg,
        p.methodology.en,
        p.sponsor?.bg,
        p.sponsor?.en,
        p.source,
        p.provenance?.sha256,
        q.id,
        q.wording.bg,
        q.wording.en,
        q.evidence.url,
        q.evidence.locator,
        q.measure,
        q.base.kind,
        q.base.label.bg,
        q.base.label.en,
        q.base.includesNone,
        q.scenario,
        q.genre,
      ];
      const suffix = [
        q.scoring.eligible,
        reason,
        data.diagnostics
          .find((d) => d.pollId === p.id && d.questionId === q.id)
          ?.reasons.join(";") ?? "",
      ];
      const answer = (code: string | undefined) => {
        const label = q.answerScale.find((a) => a.code === code)?.label;
        return [code, label?.bg, label?.en];
      };
      for (const d of data.details.filter(
        (d) => d.pollId === p.id && d.questionId === q.id,
      ))
        rows.push([
          ...common,
          d.candidateName_bg,
          ...answer(d.answerCode),
          d.support,
          ...suffix,
        ]);
      for (const r of data.runoffs.filter(
        (r) => r.pollId === p.id && r.questionId === q.id,
      )) {
        rows.push(
          [
            ...common,
            r.aName_bg ?? r.a,
            ...answer("runoff_a"),
            r.supportA,
            ...suffix,
          ],
          [
            ...common,
            r.bName_bg ?? r.b,
            ...answer("runoff_b"),
            r.supportB,
            ...suffix,
          ],
        );
      }
      for (const o of q.observations ?? [])
        rows.push([...common, "", ...answer(o.answerCode), o.share, ...suffix]);
      for (const code of [
        "undecided",
        "wontVote",
        "wontSay",
        "otherNamedMinor",
      ] as const)
        if (q.residual?.[code] != null)
          rows.push([
            ...common,
            "",
            ...answer(code),
            q.residual[code],
            ...suffix,
          ]);
    }
  const cell = (v: unknown) => {
    let s = v == null ? "" : String(v);
    if (typeof v === "string" && /^[\s]*[=+@-]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  return (
    [header, ...rows].map((row) => row.map(cell).join(",")).join("\r\n") +
    "\r\n"
  );
}
