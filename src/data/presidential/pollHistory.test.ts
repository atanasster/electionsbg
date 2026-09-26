import { describe, expect, it } from "vitest";
import { campaignObservations, questionSeries } from "./pollHistory";
import type { Poll, PresidentialPollDetail } from "@/data/polls/pollsTypes";
import pollsJson from "../../../data/polls/presidential/polls.json";
import detailsJson from "../../../data/polls/presidential/polls_details.json";
const polls = pollsJson as unknown as Poll[];
const details = detailsJson as PresidentialPollDetail[];
describe("campaignObservations", () => {
  it("keeps all historical vote-intention waves and excludes hypothetical potential", () => {
    const points = campaignObservations(polls, details, 1);
    expect(new Set(points.map((p) => p.poll.id)).size).toBe(12);
    expect(points.some((p) => p.poll.agencyId === "GM")).toBe(false);
    expect(points.every((p) => p.question.measure === "vote_intention")).toBe(
      true,
    );
    expect(points.map((p) => p.date)).toEqual(points.map((p) => p.date).sort());
    expect(
      campaignObservations(polls, details, 2).every(
        (p) => p.poll.id === "ar-2016-11-10-presidential",
      ),
    ).toBe(true);
  });
  it("never combines different population bases or answer tiers into one series", () => {
    const p = polls.find((p) => p.agencyId === "GM")!;
    const q = p.questions![0],
      d = details.find((d) => d.pollId === p.id)!;
    const key = questionSeries(p, q, d);
    expect(
      questionSeries(
        p,
        { ...q, base: { ...q.base, kind: "all_respondents" } },
        d,
      ),
    ).not.toBe(key);
    expect(questionSeries(p, q, { ...d, answerCode: "different" })).not.toBe(
      key,
    );
  });
});
