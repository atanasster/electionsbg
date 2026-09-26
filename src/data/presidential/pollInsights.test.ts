import { describe, expect, it } from "vitest";
import {
  candidateMargins,
  exportCsv,
  matchupObservations,
  pollExport,
  residualObservations,
} from "./pollInsights";
import type {
  Poll,
  PresidentialPollDetail,
  PresidentialPollsAccuracy,
  Runoff,
} from "@/data/polls/pollsTypes";
import rawPolls from "../../../data/polls/presidential/polls.json";
import rawDetails from "../../../data/polls/presidential/polls_details.json";
import rawRunoffs from "../../../data/polls/presidential/runoffs.json";
import rawAccuracy from "../../../data/polls/presidential/accuracy.json";
const polls = rawPolls as unknown as Poll[],
  details = rawDetails as PresidentialPollDetail[],
  runoffs = rawRunoffs as Runoff[],
  accuracy = rawAccuracy as PresidentialPollsAccuracy;
describe("presidential insights", () => {
  it("separates hypothetical matchups from genuine between-round questions without dropping none", () => {
    const rows = matchupObservations(polls, details, runoffs, accuracy, 2);
    expect(rows.filter((r) => r.kind === "hypothetical")).toHaveLength(4);
    const real = rows.find((r) => r.kind === "between_rounds")!;
    expect(real.poll.id).toBe("ar-2016-11-10-presidential");
    expect(real.none).toBe(11.3);
    expect(real.margin).toBeCloseTo(10.5);
    expect(matchupObservations(polls, details, runoffs, accuracy, 1)).toEqual(
      [],
    );
  });
  it("keeps distinct hypothetical questions in separate residual series", () => {
    const p = polls.find((p) => p.id === "sh-2021-10-12-presidential")!;
    const residuals = residualObservations([p], 2).filter(
      (r) => r.code === "undecided",
    );
    expect(residuals.map((r) => r.share)).toEqual([9.8, 13.5]);
    expect(new Set(residuals.map((r) => r.series)).size).toBe(2);
  });
  it("retains source participation and unknown complements as distinct observations", () => {
    const rows = residualObservations(polls, 1).filter(
      (r) => r.question.measure === "participation",
    );
    expect(
      rows.filter((r) => r.code === "will_vote").map((r) => r.share),
    ).toEqual([61, 69, 53]);
    expect(
      rows.filter((r) => r.code === "will_not_vote").map((r) => r.share),
    ).toEqual([39]);
    expect(rows.every((r) => r.question.scoring.eligible === false)).toBe(true);
  });
  it("compares candidates only inside the same question and never potential or party placeholders", () => {
    const p = polls.find((p) => p.id === "ml-2021-11-07-presidential")!;
    const rows = details.filter((d) => d.pollId === p.id);
    const a = rows[0].candidateKey,
      b = rows[1].candidateKey;
    const results = candidateMargins([p], details, 1, a, b);
    expect(results).toHaveLength(2);
    expect(new Set(results.map((r) => r.question.base.kind)).size).toBe(2);
    const split = rows.filter(
      (d) =>
        (d.candidateKey === a && d.questionId === p.questions![0].id) ||
        (d.candidateKey === b && d.questionId === p.questions![1].id),
    );
    expect(candidateMargins([p], split, 1, a, b)).toEqual([]);
    expect(
      candidateMargins(
        polls.filter((p) => p.agencyId === "GM"),
        details,
        1,
        a,
        b,
      ),
    ).toEqual([]);
  });
  it("exports selected rounds and candidate answers with full provenance and eligibility", () => {
    const p = polls.find((p) => p.id === "sh-2021-11-02-presidential")!,
      a = details.find((d) => d.pollId === p.id)!.candidateKey;
    const out = pollExport([p], details, runoffs, accuracy, 1, a);
    expect(out.details.every((d) => d.candidateKey === a)).toBe(true);
    expect(out.runoffs).toHaveLength(0);
    expect(out.polls[0].questions!.every((q) => q.round === 1)).toBe(true);
    expect(
      out.diagnostics.some((d) => d.reasons.includes("incomplete_coverage")),
    ).toBe(true);
    const csv = exportCsv(out);
    expect(csv).toContain("source_sha256");
    expect(csv).toContain(p.source);
    expect(csv).toContain("incomplete_coverage");
    expect(csv).toContain("decided_voters");
  });
  it("preserves question wording, answer labels and evidence in CSV downloads", () => {
    const p = polls.find((p) => p.agencyId === "GM")!;
    const csv = exportCsv(pollExport([p], details, runoffs, accuracy, 1));
    const quoted = (value: string) => '"' + value.replace(/"/g, '""') + '"';
    for (const q of p.questions ?? []) {
      expect(csv).toContain(quoted(q.wording.bg));
      expect(csv).toContain(quoted(q.wording.en));
      expect(csv).toContain(quoted(q.evidence.url));
      if (q.evidence.locator) expect(csv).toContain(quoted(q.evidence.locator));
      for (const answer of q.answerScale) {
        expect(csv).toContain(quoted(answer.label.bg));
        expect(csv).toContain(quoted(answer.label.en));
      }
    }
  });
  it("quotes multiline CSV cells and prevents spreadsheet formula evaluation", () => {
    const p = structuredClone(polls.find((p) => p.agencyId === "GM")!);
    p.methodology.en = '=HYPERLINK("example")\nline';
    const csv = exportCsv(pollExport([p], details, runoffs, accuracy, 1));
    expect(csv).toContain('"\'=HYPERLINK(""example"")\nline"');
  });
});
