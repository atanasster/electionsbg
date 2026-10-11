import { describe, expect, it } from "vitest";
import { campaignObservations, questionSeries } from "./pollHistory";
import type { Poll, PresidentialPollDetail } from "@/data/polls/pollsTypes";
import pollsJson from "../../../data/polls/presidential/polls.json";
import detailsJson from "../../../data/polls/presidential/polls_details.json";
const polls = pollsJson as unknown as Poll[];
const details = detailsJson as PresidentialPollDetail[];
// The pinned figures below are the CLOSED cycles. The 2026 race is live — its accepted polls
// grow with every agency publication — so it is asserted by inclusion, never by a count.
const LIVE_YEAR = "2026";
const isHistorical = (p: Poll) =>
  p.electionDate != null && p.electionDate < `${LIVE_YEAR}-01-01`;
describe("campaignObservations", () => {
  it("keeps all historical vote-intention waves and excludes hypothetical potential", () => {
    const points = campaignObservations(polls, details, 1);
    const historical = points.filter((p) => isHistorical(p.poll));
    expect(new Set(historical.map((p) => p.poll.id)).size).toBe(12);
    // Every live-cycle poll with a round-1 vote-intention question is kept as well.
    const liveWaves = polls.filter(
      (p) =>
        !isHistorical(p) &&
        p.questions?.some(
          (q) => q.measure === "vote_intention" && q.round === 1,
        ),
    );
    expect(liveWaves.length).toBeGreaterThan(0);
    for (const p of liveWaves)
      expect(points.some((pt) => pt.poll.id === p.id)).toBe(true);
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
