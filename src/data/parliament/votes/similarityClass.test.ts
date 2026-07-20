import { describe, it, expect } from "vitest";
import {
  SIMILARITY,
  classifyPeer,
  isVotingTwin,
  isVotingTwinByScore,
  hasVotingTwins,
} from "./similarityClass";

describe("similarityClass", () => {
  it("gates on overlap before score — a high score over too few votes is unreliable", () => {
    // The bug this guards: mp-5100's peers scored ~0.4–0.53 over 6–21 shared votes and were
    // still shown as "twins". Even a 0.95 over 10 shared votes is noise, not a twin.
    expect(classifyPeer(0.95, SIMILARITY.minOverlap - 1)).toBe("unreliable");
    expect(classifyPeer(0.53, 18)).toBe("unreliable");
    expect(isVotingTwin(0.95, 10)).toBe(false);
  });

  it("classifies a reliable peer by score", () => {
    const n = 400; // plenty of shared votes
    expect(classifyPeer(0.9, n)).toBe("twin");
    expect(classifyPeer(SIMILARITY.twin, n)).toBe("twin"); // boundary inclusive
    expect(classifyPeer(0.6, n)).toBe("aligned");
    expect(classifyPeer(SIMILARITY.aligned, n)).toBe("aligned");
    expect(classifyPeer(0.4, n)).toBe("weak");
  });

  it("hasVotingTwins is true only when a reliable near-identical peer exists", () => {
    // mp-5100 shape: no reliable twin.
    expect(
      hasVotingTwins([
        { score: 0.535, overlap: 18 },
        { score: 0.418, overlap: 21 },
      ]),
    ).toBe(false);
    // a real twin present
    expect(
      hasVotingTwins([
        { score: 0.9, overlap: 470 },
        { score: 0.6, overlap: 300 },
      ]),
    ).toBe(true);
    // high score but thin overlap does NOT qualify
    expect(hasVotingTwins([{ score: 0.99, overlap: 12 }])).toBe(false);
  });

  it("isVotingTwinByScore ignores overlap (for the overlap-less hub headline)", () => {
    expect(isVotingTwinByScore(0.8)).toBe(true);
    expect(isVotingTwinByScore(0.7)).toBe(false);
  });
});
