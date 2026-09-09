import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  NONE_CANDIDATE_KEY,
  foldCandidateName,
  placeholderCandidateKey,
  provisionalCandidateKey,
  resolveCandidate,
  type ResolvableTicket,
} from "./candidate_resolver";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

/** Every real `<cycle>_pvr/tickets.json` on disk (2001, 2006, 2011, 2016,
 *  2021 today) — the round-trip fixture below needs no synthetic data at
 *  all, since ЦИК's own real registrations are already committed. */
const realCycleTicketSets = (): {
  cycle: string;
  tickets: ResolvableTicket[];
}[] => {
  const out: { cycle: string; tickets: ResolvableTicket[] }[] = [];
  const dataDir = path.join(REPO_ROOT, "data");
  for (const entry of fs.readdirSync(dataDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/_pvr$/.test(entry.name)) continue;
    const file = path.join(dataDir, entry.name, "tickets.json");
    if (!fs.existsSync(file)) continue;
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as {
      tickets: ResolvableTicket[];
    };
    out.push({ cycle: entry.name, tickets: parsed.tickets });
  }
  return out;
};

describe("foldCandidateName", () => {
  it("reproduces every real cycle's own canonicalKey from its president field", () => {
    const sets = realCycleTicketSets();
    expect(sets.length).toBeGreaterThan(0); // the fixture itself must be real
    for (const { tickets } of sets) {
      expect(tickets.length).toBeGreaterThan(0);
      for (const t of tickets) {
        expect(foldCandidateName(t.president)).toBe(t.canonicalKey);
      }
    }
  });

  it("folds a hyphenated surname to a space, matching the one real case in the corpus", () => {
    expect(foldCandidateName("Боян Боянов Станков-Расате")).toBe(
      "боян боянов станков расате",
    );
  });
});

describe("resolveCandidate", () => {
  it("resolves every real ticket's own name to its own canonicalKey, across all five real cycles", () => {
    const sets = realCycleTicketSets();
    for (const { tickets } of sets) {
      for (const t of tickets) {
        const result = resolveCandidate(t.president, tickets);
        expect(result).toEqual({
          candidateKey: t.canonicalKey,
          resolved: true,
        });
      }
    }
  });

  it("resolves a bare two-word name against a three-part ticket (patronymic skipped on the ticket side)", () => {
    const tickets: ResolvableTicket[] = [
      {
        canonicalKey: "румен георгиев радев",
        president: "Румен Георгиев Радев",
      },
    ];
    expect(resolveCandidate("Румен Радев", tickets)).toEqual({
      candidateKey: "румен георгиев радев",
      resolved: true,
    });
  });

  it("refuses — never grades — a name matching two tickets", () => {
    // The plan's own example (T4.5): two "Иван Иванов" tickets.
    const tickets: ResolvableTicket[] = [
      { canonicalKey: "иван иванов иванов", president: "Иван Иванов Иванов" },
      { canonicalKey: "иван петров иванов", president: "Иван Петров Иванов" },
    ];
    const result = resolveCandidate("Иван Иванов", tickets);
    expect(result.resolved).toBe(false);
    expect(result.reason).toBe("ambiguous");
    expect(result.matchCount).toBe(2);
    expect(result.candidateKey).toBe(provisionalCandidateKey("Иван Иванов"));
    // Never one of the two real candidates' own keys.
    expect(result.candidateKey).not.toBe("иван иванов иванов");
    expect(result.candidateKey).not.toBe("иван петров иванов");
  });

  // Mutation test (T4.5's own requirement): prove the refusal above is not
  // vacuously true of any implementation — a naive "just take the first
  // match" resolver WOULD wrongly resolve the same ambiguous fixture to a
  // real candidate's key, which is exactly the wrong-attribution harm this
  // module exists to prevent.
  it("[mutation] a naive first-match implementation would wrongly resolve the ambiguous fixture", () => {
    const tickets: ResolvableTicket[] = [
      { canonicalKey: "иван иванов иванов", president: "Иван Иванов Иванов" },
      { canonicalKey: "иван петров иванов", president: "Иван Петров Иванов" },
    ];
    const naiveFirstMatch = (rawName: string): string | null => {
      const folded = foldCandidateName(rawName);
      const [qFirst, qLast] = [
        folded.split(" ")[0],
        folded.split(" ").at(-1) as string,
      ];
      const match = tickets.find((t) => {
        const tFolded = foldCandidateName(t.president);
        const tParts = tFolded.split(" ");
        return tParts[0] === qFirst && tParts.at(-1) === qLast;
      });
      return match?.canonicalKey ?? null;
    };
    // The broken variant DOES resolve (wrongly) — proving the real
    // function's refusal is a deliberate guard, not an accident of the
    // fixture.
    expect(naiveFirstMatch("Иван Иванов")).toBe("иван иванов иванов");
    // ... while the real function refuses on the exact same input.
    expect(resolveCandidate("Иван Иванов", tickets).resolved).toBe(false);
  });

  it("resolves as provisional (no-match) when no ticket exists yet — the pre-registration state", () => {
    const result = resolveCandidate("Румен Радев", []);
    expect(result.resolved).toBe(false);
    expect(result.reason).toBe("no-match");
    expect(result.matchCount).toBe(0);
    expect(result.candidateKey).toBe("provisional:румен-радев");
  });

  it("resolves as no-match when the name matches no ticket at all", () => {
    const tickets: ResolvableTicket[] = [
      {
        canonicalKey: "костадин тодоров костадинов",
        president: "Костадин Тодоров Костадинов",
      },
    ];
    const result = resolveCandidate("Никой Никого", tickets);
    expect(result.resolved).toBe(false);
    expect(result.reason).toBe("no-match");
    expect(result.matchCount).toBe(0);
  });

  it("resolves an abstention row to the fixed NONE_CANDIDATE_KEY, never a phantom provisional identity", () => {
    const result = resolveCandidate("Не подкрепям никого", []);
    expect(result).toEqual({
      candidateKey: NONE_CANDIDATE_KEY,
      resolved: true,
    });
    expect(result.candidateKey).not.toContain("provisional");
  });

  it("degrades safely on an empty name", () => {
    const result = resolveCandidate("", []);
    expect(result.resolved).toBe(false);
    expect(result.candidateKey).toBe("provisional:-");
  });

  it("treats a single-token name as first===last (fails closed against a multi-token ticket, does not crash)", () => {
    const tickets: ResolvableTicket[] = [
      {
        canonicalKey: "румен георгиев радев",
        president: "Румен Георгиев Радев",
      },
    ];
    const result = resolveCandidate("Радев", tickets);
    expect(result.resolved).toBe(false);
    expect(result.reason).toBe("no-match");
  });

  it("does not refuse a duplicate ticket ROW for the same real candidate (W-3: counts distinct canonicalKeys)", () => {
    const tickets: ResolvableTicket[] = [
      {
        canonicalKey: "румен георгиев радев",
        president: "Румен Георгиев Радев",
      },
      {
        canonicalKey: "румен георгиев радев",
        president: "Румен Георгиев Радев",
      }, // accidental duplicate row
    ];
    const result = resolveCandidate("Румен Радев", tickets);
    expect(result).toEqual({
      candidateKey: "румен георгиев радев",
      resolved: true,
    });
  });
});

describe("placeholderCandidateKey", () => {
  it("never overlaps a real or provisional candidateKey shape", () => {
    expect(placeholderCandidateKey("пб")).toBe("placeholder:пб");
  });

  it("folds a hyphenated party key the same way candidate names are folded, then re-hyphenates for readability", () => {
    // foldCandidateName turns the hyphen into a space ("герб-сдс" ->
    // "герб сдс"); placeholderCandidateKey turns that space back into a
    // hyphen so the key stays one readable token after "placeholder:".
    expect(placeholderCandidateKey("ГЕРБ-СДС")).toBe("placeholder:герб-сдс");
  });
});

describe("provisionalCandidateKey", () => {
  it("is stable across repeated calls for the same name", () => {
    expect(provisionalCandidateKey("Румен Радев")).toBe(
      provisionalCandidateKey("Румен  Радев"), // extra whitespace folds the same
    );
  });

  it("differs for different names", () => {
    expect(provisionalCandidateKey("Румен Радев")).not.toBe(
      provisionalCandidateKey("Илияна Йотова"),
    );
  });
});
