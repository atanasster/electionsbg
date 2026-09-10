// The one property `ai/tests/regression.ts` cannot exercise against the real
// corpus: GM's real July 2026 capture already carries a named candidate row,
// so the real-data suite can never reach the placeholder-only refusal branch.
// Synthetic fixtures here cover exactly that gap.

import { afterEach, expect, it } from "vitest";
import { clearDataCache, setFetcher } from "./dataClient";
import { latestPresidentialPoll } from "./presidentialPollsDepth";

afterEach(clearDataCache);

const AGENCIES = [
  { id: "GM", name_bg: "Глобал Метрикс", name_en: "Global Metrics" },
];

const respond =
  (polls: unknown[], details: unknown[]): Parameters<typeof setFetcher>[0] =>
  async (path: string) => {
    if (path === "/polls/presidential/polls.json") return polls;
    if (path === "/polls/presidential/polls_details.json") return details;
    if (path === "/polls/agencies.json") return AGENCIES;
    throw new Error(`unexpected fetch: ${path}`);
  };

it("refuses a placeholder-only poll rather than naming a party as if it were a candidate", async () => {
  setFetcher(
    respond(
      [
        {
          id: "gm-2026-07-11",
          agencyId: "GM",
          fieldwork: "through Jul 11 2026",
        },
      ],
      [
        {
          pollId: "gm-2026-07-11",
          candidateKey: "placeholder:прб",
          candidateName_bg: "Прогресивна България",
          candidateName_en: "Progressive Bulgaria",
          placeholderFor: "ПрБ",
          support: 39.7,
        },
      ],
    ),
  );
  const env = await latestPresidentialPoll(
    {},
    { lang: "bg", election: "2026_04_19" },
  );
  expect(env.kind).toBe("scalar");
  expect(env.title).toContain("Няма");
  expect(env.rows).toBeUndefined();
  expect(env.provenance).toEqual([
    "polls/presidential/polls.json",
    "polls/presidential/polls_details.json",
  ]);
});

it("refuses when the corpus is empty", async () => {
  setFetcher(respond([], []));
  const env = await latestPresidentialPoll(
    {},
    { lang: "bg", election: "2026_04_19" },
  );
  expect(env.kind).toBe("scalar");
  expect(env.rows).toBeUndefined();
  expect(env.provenance).toEqual([
    "polls/presidential/polls.json",
    "polls/presidential/polls_details.json",
  ]);
});

it('refuses a poll whose only row is "none" (Не подкрепям никого)', async () => {
  setFetcher(
    respond(
      [
        {
          id: "gm-2026-07-11",
          agencyId: "GM",
          fieldwork: "through Jul 11 2026",
        },
      ],
      [
        {
          pollId: "gm-2026-07-11",
          candidateKey: "none",
          candidateName_bg: "Не подкрепям никого",
          candidateName_en: "None of the above",
          placeholderFor: null,
          support: 12.0,
        },
      ],
    ),
  );
  const env = await latestPresidentialPoll(
    {},
    { lang: "bg", election: "2026_04_19" },
  );
  expect(env.kind).toBe("scalar");
  expect(env.title).toContain("Няма");
});

it("answers once the latest poll carries at least one named candidate, including its placeholder rows", async () => {
  setFetcher(
    respond(
      [
        {
          id: "gm-2026-07-11",
          agencyId: "GM",
          fieldwork: "through Jul 11 2026",
          respondents: 1503,
        },
      ],
      [
        {
          pollId: "gm-2026-07-11",
          candidateKey: "placeholder:прб",
          candidateName_bg: "Прогресивна България",
          candidateName_en: "Progressive Bulgaria",
          placeholderFor: "ПрБ",
          support: 39.7,
        },
        {
          pollId: "gm-2026-07-11",
          candidateKey: "provisional:илияна-йотова",
          candidateName_bg: "Илияна Йотова",
          candidateName_en: "Iliana Yotova",
          placeholderFor: null,
          support: 30,
        },
      ],
    ),
  );
  const env = await latestPresidentialPoll(
    {},
    { lang: "bg", election: "2026_04_19" },
  );
  expect(env.kind).toBe("table");
  // The leader by raw support is STILL the placeholder row — that is the honest
  // answer for this poll, and refusing it would misreport who is actually ahead.
  expect(env.facts?.leader).toContain("Прогресивна България");
  expect(env.rows).toHaveLength(2);
  expect(env.provenance).toEqual([
    "polls/presidential/polls.json",
    "polls/presidential/polls_details.json",
  ]);
});

it("never reaches backward past a placeholder-only latest poll to an older named one", async () => {
  setFetcher(
    respond(
      [
        {
          id: "gm-2026-01-01",
          agencyId: "GM",
          fieldwork: "Jan 01 2026",
        },
        {
          id: "gm-2026-07-11",
          agencyId: "GM",
          fieldwork: "through Jul 11 2026",
        },
      ],
      [
        {
          pollId: "gm-2026-01-01",
          candidateKey: "provisional:илияна-йотова",
          candidateName_bg: "Илияна Йотова",
          candidateName_en: "Iliana Yotova",
          placeholderFor: null,
          support: 28,
        },
        {
          pollId: "gm-2026-07-11",
          candidateKey: "placeholder:прб",
          candidateName_bg: "Прогресивна България",
          candidateName_en: "Progressive Bulgaria",
          placeholderFor: "ПрБ",
          support: 39.7,
        },
      ],
    ),
  );
  const env = await latestPresidentialPoll(
    {},
    { lang: "bg", election: "2026_04_19" },
  );
  expect(env.kind).toBe("scalar");
  expect(env.title).toContain("Няма");
});

it("keeps the candidate's own name untranslated when asked in English, matching the real corpus's blank candidateName_en", async () => {
  setFetcher(
    respond(
      [
        {
          id: "gm-2026-07-11",
          agencyId: "GM",
          fieldwork: "through Jul 11 2026",
        },
      ],
      [
        {
          pollId: "gm-2026-07-11",
          candidateKey: "provisional:илияна-йотова",
          candidateName_bg: "Илияна Йотова",
          // Real, currently-committed corpus shape (global_metrics.ts leaves
          // this blank by design) — a fixture with a populated
          // candidateName_en would mask the FINDING-001 regression this test
          // exists to guard against.
          candidateName_en: "",
          placeholderFor: null,
          support: 30,
        },
      ],
    ),
  );
  const env = await latestPresidentialPoll(
    {},
    { lang: "en", election: "2026_04_19" },
  );
  expect(env.title).toContain("Global Metrics");
  // A candidate's own name is never translated by UI language — matches the
  // reference UI (PresidentialPollsSection.tsx, AgencyPresidentialPollsList.tsx).
  expect(env.rows?.[0]?.candidate).toBe("Илияна Йотова");
});
