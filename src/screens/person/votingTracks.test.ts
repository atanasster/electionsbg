// The sequencing rule for a person who served in BOTH a municipal council and the
// National Assembly. Two things it must never do: merge the two bodies into one history
// (they are measured against different reference frames and are not comparable), and
// render a labelled track header for someone who only has one track — the header exists
// to disambiguate two records, so with one there is nothing to disambiguate.

import { describe, it, expect } from "vitest";
import { votingTracks, showTrackHeaders, type TrackRole } from "./votingTracks";

const mp = (start: string | null = "2021-04-15"): TrackRole => ({
  source: "mp",
  role: "mp",
  start,
});
const councillor = (start: string | null = "2015-10-25"): TrackRole => ({
  source: "local",
  role: "councillor",
  start,
});

describe("votingTracks", () => {
  it("returns nothing for a person with neither track", () => {
    expect(
      votingTracks([{ source: "magistrate", role: "judge" }], false),
    ).toEqual([]);
  });

  it("returns the national track alone for a pure MP", () => {
    expect(votingTracks([mp()], true)).toEqual([
      { kind: "national", start: "2021-04-15" },
    ]);
  });

  it("returns the local track alone for a pure councillor", () => {
    expect(votingTracks([councillor()], false)).toEqual([
      { kind: "local", start: "2015-10-25" },
    ]);
  });

  it("orders a councillor-then-MP career earliest first", () => {
    const tracks = votingTracks(
      [mp("2021-04-15"), councillor("2015-10-25")],
      true,
    );
    expect(tracks.map((t) => t.kind)).toEqual(["local", "national"]);
  });

  it("orders an MP-then-councillor career earliest first too", () => {
    // The reverse career is a real shape (an MP who later took a council seat), and it
    // must not be pinned to a fixed local-then-national order.
    const tracks = votingTracks(
      [mp("2009-07-14"), councillor("2019-10-27")],
      true,
    );
    expect(tracks.map((t) => t.kind)).toEqual(["national", "local"]);
  });

  it("takes the EARLIEST start when a track has several roles", () => {
    // A nine-term MP has one role per parliament; the track's date is the start of the
    // career, not whichever term the payload happened to order first.
    const tracks = votingTracks(
      [mp("2021-04-15"), mp("2009-07-14"), mp("2017-03-26")],
      true,
    );
    expect(tracks[0].start).toBe("2009-07-14");
  });

  it("sorts an UNDATED track last, never first", () => {
    // null is "we do not know when", not "before everything" — ordering an unknown first
    // would assert a career order the corpus cannot support.
    const tracks = votingTracks([mp(null), councillor("2015-10-25")], true);
    expect(tracks.map((t) => t.kind)).toEqual(["local", "national"]);
  });

  it("does not invent a national track when the MP card cannot mount", () => {
    // hasNational is the SAME condition the card is gated on (mpId != null), not an
    // mp-role check — otherwise a header could render above nothing.
    expect(
      votingTracks([mp(), councillor()], false).map((t) => t.kind),
    ).toEqual(["local"]);
  });

  it("builds the local track from a council_chair with no councillor role", () => {
    // A председател на общински съвет appears in protokol vote lists like any other
    // member, so council_vote can carry their attributed votes — measured 2026-08-25,
    // 67 people hold council_chair and no councillor role. Narrowing to "councillor"
    // (as the inline gate this replaced did) hides their record entirely.
    const chair: TrackRole = {
      source: "local",
      role: "council_chair",
      start: "2019-10-27",
    };
    expect(votingTracks([chair], false)).toEqual([
      { kind: "local", start: "2019-10-27" },
    ]);
  });

  it("falls back to `end` for a role dated only at its close", () => {
    // offices.ts explicitly admits this shape (`.filter(s => s.start || s.end)`), so a
    // track made only of such roles is located in time and must not sort as undated.
    const endOnly: TrackRole = {
      source: "local",
      role: "councillor",
      start: null,
      end: "2011-10-23",
    };
    expect(votingTracks([endOnly], false)).toEqual([
      { kind: "local", start: "2011-10-23" },
    ]);
  });

  it("has no national track at all when hasNational is false, whatever the roles say", () => {
    // The candidacy-fallback path means "has an mp role" and "the card can mount" are
    // different sets; measured 2026-08-25 all 2,118 people with an `mp-<id>` candidacy
    // ref also hold an mp role, so this is currently unreachable in the corpus — pinned
    // because the whole point of hasNational being a parameter is that they may diverge.
    expect(votingTracks([mp()], false)).toEqual([]);
  });
});

describe("showTrackHeaders", () => {
  it("is false for one track — a lone pill labels nothing", () => {
    expect(showTrackHeaders(votingTracks([mp()], true))).toBe(false);
    expect(showTrackHeaders(votingTracks([councillor()], false))).toBe(false);
  });

  it("is false for no tracks at all", () => {
    expect(showTrackHeaders([])).toBe(false);
  });

  it("is true only when both bodies are in play", () => {
    expect(showTrackHeaders(votingTracks([mp(), councillor()], true))).toBe(
      true,
    );
  });
});
