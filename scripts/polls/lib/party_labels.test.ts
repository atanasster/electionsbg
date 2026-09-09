import { describe, expect, it } from "vitest";
import { POLL_TO_ACTUAL } from "../../../src/data/polls/aliases";
import { KNOWN_PARTY_LABELS } from "./party_labels";

describe("KNOWN_PARTY_LABELS", () => {
  it("carries no duplicates, and is at least as large as POLL_TO_ACTUAL's own key set", () => {
    // A real structural invariant (the union can never be smaller than one
    // of its inputs) rather than an arbitrary threshold that stays correct
    // as the alias table grows, and that would not catch e.g. every
    // POLL_TO_ACTUAL VALUE silently dropping from the union while the keys
    // remained.
    expect(KNOWN_PARTY_LABELS.length).toBeGreaterThanOrEqual(
      Object.keys(POLL_TO_ACTUAL).length,
    );
    expect(new Set(KNOWN_PARTY_LABELS).size).toBe(KNOWN_PARTY_LABELS.length);
  });

  it("is sorted longest-first, so a scan prefers the more specific label", () => {
    for (let i = 1; i < KNOWN_PARTY_LABELS.length; i++) {
      expect(KNOWN_PARTY_LABELS[i - 1].length).toBeGreaterThanOrEqual(
        KNOWN_PARTY_LABELS[i].length,
      );
    }
  });

  it("includes both alias-table full names and bare current-cycle ballot nicknames", () => {
    // From POLL_TO_ACTUAL's keys (full-name spellings, aliases.ts).
    expect(KNOWN_PARTY_LABELS).toContain("Прогресивна България");
    expect(KNOWN_PARTY_LABELS).toContain("Има такъв народ");
    expect(KNOWN_PARTY_LABELS).toContain("Алиансът за права и свободи");
    // From the 2026-04-19 ballot (elections.json), never overridden because
    // the agency publishes the nickname bare.
    expect(KNOWN_PARTY_LABELS).toContain("ГЕРБ-СДС");
    expect(KNOWN_PARTY_LABELS).toContain("ПП-ДБ");
    expect(KNOWN_PARTY_LABELS).toContain("Възраждане");
    expect(KNOWN_PARTY_LABELS).toContain("МЕЧ");
  });
});
