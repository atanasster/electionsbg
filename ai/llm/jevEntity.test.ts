// The failure this module must never produce is naming the WRONG real person.
// So every uncertain outcome — a refusal, a below-gate pick, an answer naming
// something that was not offered, an empty or failing search — resolves to "no
// entity", and the caller keeps its deterministic answer.
import { describe, expect, it, vi } from "vitest";
import {
  NONE_OF_THESE,
  entityQuestion,
  resolveEntity,
  resolveEntityAnswer,
  type EntityCandidate,
} from "./jevEntity";
import { JEV_CONFIDENCE_GATE } from "./jev";
import type { JevResult } from "./jevClient";

const candidates: EntityCandidate[] = [
  { value: "Асен Васков Василев", label: "Асен Васков Василев — mp — Пловдив" },
  {
    value: "Асен Николаев Василев",
    label: "Асен Николаев Василев — executive",
  },
];

const picked = (choice: string, confidence = 0.95): JevResult => ({
  answers: {
    entity: { type: "choice", choice, probabilities: {}, confidence },
  },
  latencyMs: 30,
});

describe("entityQuestion", () => {
  it("always offers the refusal option", () => {
    // A trigram search returns near-miss candidates even for a name that is not
    // in the registry at all, so without this the Choice must name SOMEBODY.
    const q = entityQuestion(candidates, "person");
    expect(Object.keys(q.criteria as object)).toContain(NONE_OF_THESE);
  });

  it("describes candidates by role and place, not just by name", () => {
    // Two real people can share a name; only the context separates them.
    const q = entityQuestion(candidates, "person");
    expect(
      (q.criteria as Record<string, string>)["Асен Васков Василев"],
    ).toMatch(/mp|Пловдив/);
  });
});

describe("resolveEntityAnswer", () => {
  it("resolves a confident pick to the candidate it names", () => {
    expect(
      resolveEntityAnswer(picked(candidates[0].value), "entity", candidates),
    ).toEqual(candidates[0]);
  });

  it.each([
    ["a refusal", picked(NONE_OF_THESE)],
    [
      "a below-gate pick",
      picked(candidates[0].value, JEV_CONFIDENCE_GATE - 0.01),
    ],
    ["a name that was never offered", picked("Кирил Петков Петков")],
    ["no answer at all", null],
  ])("returns nothing for %s", (_label, result) => {
    expect(resolveEntityAnswer(result, "entity", candidates)).toBeNull();
  });
});

describe("resolveEntity", () => {
  const search = (out: EntityCandidate[]) => vi.fn(async () => out);
  const asking = (result: JevResult | null) => vi.fn(async () => result);

  it("searches with the extracted term and resolves the pick", async () => {
    const s = search(candidates);
    const res = await resolveEntity(
      "Какви активи е декларирал Асен Василев?",
      "person",
      "Асен Василев",
      s,
      asking(picked(candidates[0].value)) as never,
      { sessionToken: "s", questionId: "q" },
    );
    expect(s).toHaveBeenCalledWith("person", "Асен Василев");
    expect(res.entity).toEqual(candidates[0]);
    expect(res.candidateCount).toBe(2);
    expect(res.refused).toBe(false);
  });

  it("does not call Jev when no term could be extracted", async () => {
    const ask = asking(picked(candidates[0].value));
    const res = await resolveEntity(
      "нещо",
      "person",
      undefined,
      search(candidates),
      ask as never,
      undefined,
    );
    expect(ask).not.toHaveBeenCalled();
    expect(res.entity).toBeNull();
  });

  it("does not call Jev when the search found nothing", async () => {
    // Retrieval failing and Jev refusing are DIFFERENT problems with different
    // fixes, so they stay distinguishable: candidateCount separates them.
    const ask = asking(picked(candidates[0].value));
    const res = await resolveEntity(
      "q",
      "person",
      "Жоро Петков",
      search([]),
      ask as never,
      undefined,
    );
    expect(ask).not.toHaveBeenCalled();
    expect(res.candidateCount).toBe(0);
    expect(res.refused).toBe(false);
  });

  it("reports a refusal distinctly from an empty search", async () => {
    const res = await resolveEntity(
      "q",
      "person",
      "Жоро Петков",
      search(candidates),
      asking(picked(NONE_OF_THESE)) as never,
      undefined,
    );
    expect(res.entity).toBeNull();
    expect(res.candidateCount).toBe(2);
    expect(res.refused).toBe(true);
  });

  it("sends a single candidate through Jev rather than assuming it", async () => {
    // "The only near-spelling in the registry" is not the same claim as "the
    // person this sentence means" — that is what the refusal class is for.
    const ask = asking(picked(NONE_OF_THESE));
    const res = await resolveEntity(
      "q",
      "person",
      "Жоро Петков",
      search([candidates[0]]),
      ask as never,
      undefined,
    );
    expect(ask).toHaveBeenCalled();
    expect(res.entity).toBeNull();
  });

  it("survives a search that throws", async () => {
    const res = await resolveEntity(
      "q",
      "person",
      "Асен Василев",
      vi.fn(async () => {
        throw new Error("db down");
      }),
      asking(picked(candidates[0].value)) as never,
      undefined,
    );
    // A search failure is not a chat failure — the lane still answers from its
    // deterministic route.
    expect(res.entity).toBeNull();
    expect(res.candidateCount).toBe(0);
  });
});
