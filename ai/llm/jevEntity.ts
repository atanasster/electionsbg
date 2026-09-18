// Name-shaped parameters: deterministic search, Jev disambiguation.
//
// ⚠️ THE DIVISION OF LABOUR IS THE WHOLE POINT, and it is forced by what Jev
// is. Jev cannot produce a person's name or a company's: it has no primitive
// that generates a value, only ones that pick from a list we enumerate
// (docs/plans/jev-typesafe-eval-v1.md §3). So:
//
//   1. a DETERMINISTIC extractor pulls the name-like span out of the question
//      (`extractPersonName` / `extractCompanyName`, shared with the keyword
//      router — the same regexes, not a second opinion);
//   2. the existing trigram search turns that span into real candidates, which
//      is what tolerates a misspelling;
//   3. Jev picks which candidate the sentence means, or refuses.
//
// Jev's step is the one measured at 93-96% (n=318, frozen fixture), and its
// `absent` class — "the intended person is NOT in this list, refuse" — scored
// 96.4%. That refusal is the safety-critical half: naming the wrong real person
// is the failure this module exists to avoid, not a missing answer.
//
// ⚠️ MEASURED CEILING, so nobody reads more into this than it can deliver. The
// retrieval step is currently the bottleneck, NOT this code: at the production
// trigram threshold the intended person survives a dropped or transposed letter
// only 9-19% of the time (jev-typesafe-eval-v1.md §4). Correctly spelled names
// already resolve deterministically, so what this adds TODAY is mainly
// disambiguation among several real people who share a name — which works at
// any threshold. The typo case unlocks when the per-tier threshold work lands.

import {
  choiceOf,
  type JevCredentials,
  type JevQuestion,
  type JevResult,
} from "./jevClient";
import { JEV_CONFIDENCE_GATE } from "./jev";

/** The refusal option. ALWAYS offered: a trigram search returns near-miss
 *  candidates even for a name that is not in the registry at all, so without
 *  this the Choice must name SOMEBODY — and naming the wrong real individual is
 *  the one outcome this path must never produce. */
export const NONE_OF_THESE = "none_of_these";

export type EntityKind = "person" | "company";

export type EntityCandidate = {
  /** The value handed to the tool — a name for a person, an EIK or name for a
   *  company, i.e. whatever that tool's parameter actually takes. */
  value: string;
  /** What the reader would recognise, used as the Choice option's description
   *  so the model disambiguates on role/place rather than on spelling alone. */
  label: string;
};

/** Search seam. The browser implementation calls /api/db/{person,company}-search
 *  through the app's own db client; tests inject a stub. Returning [] must be
 *  safe — it simply means no candidate, and the caller falls back. */
export type EntitySearch = (
  kind: EntityKind,
  term: string,
) => Promise<EntityCandidate[]>;

/** The production search: the SAME `/api/db/*-search` routes the chat's own
 *  person and company tools already use, so the candidate list Jev arbitrates
 *  is exactly the one the rest of the app would have shown. */
/** Budget for the SEARCH leg. `fetchDb` takes no abort signal, so the timeout
 *  is applied by racing it: without this the turn has an unbounded wait in
 *  front of a deterministic answer the lane already holds, which is precisely
 *  the hang the Jev call's own 1200ms budget exists to prevent. */
export const ENTITY_SEARCH_TIMEOUT_MS = 1200;

const withTimeout = async <T>(
  work: Promise<T>,
  ms: number,
  fallback: T,
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export const dbEntitySearch: EntitySearch = async (kind, term) =>
  withTimeout(
    dbEntitySearchUnbounded(kind, term),
    ENTITY_SEARCH_TIMEOUT_MS,
    [],
  );

const dbEntitySearchUnbounded: EntitySearch = async (kind, term) => {
  const { fetchDb } = await import("../tools/dataClient");
  if (kind === "person") {
    const res = await fetchDb<{
      power?: PersonHit[];
      money?: PersonHit[];
      others?: PersonHit[];
    }>("person-search", { q: term, limit: 6 });
    return [
      ...(res?.power ?? []),
      ...(res?.money ?? []),
      ...(res?.others ?? []),
    ]
      .filter((h) => h.name)
      .map((h) => ({
        value: h.name,
        // Role and place are what let the model disambiguate on CONTEXT rather
        // than on spelling — two real people with one name differ here.
        label: [h.name, h.primary_role ?? h.position_type, h.place_label]
          .filter(Boolean)
          .join(" — "),
      }));
  }
  const res = await fetchDb<{ companies?: CompanyHit[] }>("company-search", {
    q: term,
    limit: 6,
  });
  return (res?.companies ?? [])
    .filter((c) => c.eik && c.name)
    .map((c) => ({
      value: c.eik,
      label: `${(c.primaryName ?? c.name).replace(/&quot;/g, '"')} (ЕИК ${c.eik})`,
    }));
};

type PersonHit = {
  name: string;
  primary_role?: string | null;
  position_type?: string | null;
  place_label?: string | null;
};
type CompanyHit = {
  eik: string;
  name: string;
  primaryName?: string;
};

/** Build the disambiguation question for one name-shaped parameter. */
export const entityQuestion = (
  candidates: EntityCandidate[],
  kind: EntityKind,
): JevQuestion => {
  const criteria: Record<string, string | null> = {};
  for (const c of candidates) criteria[c.value] = c.label;
  criteria[NONE_OF_THESE] = "None of the above is who the message means.";
  return {
    type: "choice",
    instructions:
      kind === "person"
        ? `These candidates came from a fuzzy/trigram search against a possibly misspelled name in the message. Which one (if any) does the message actually mean? Use the sentence's context, not just spelling similarity. Choose ${NONE_OF_THESE} if none is right.`
        : `These candidates came from a fuzzy/trigram search against a possibly misspelled company name in the message. Which one (if any) does the message actually mean? Choose ${NONE_OF_THESE} if none is right.`,
    criteria,
  };
};

/** Read the resolved entity out of an answer set.
 *
 *  Returns null for a refusal, a below-gate pick, or an answer naming something
 *  that was not on offer — in every one of those cases the caller must NOT
 *  substitute a guess. */
export const resolveEntityAnswer = (
  result: JevResult | null,
  questionId: string,
  candidates: EntityCandidate[],
): EntityCandidate | null => {
  const pick = choiceOf(result, questionId);
  if (!pick || pick.choice === NONE_OF_THESE) return null;
  if (!(pick.confidence >= JEV_CONFIDENCE_GATE)) return null;
  return candidates.find((c) => c.value === pick.choice) ?? null;
};

export type EntityResolution = {
  entity: EntityCandidate | null;
  /** How many real candidates the search returned — 0 means retrieval failed,
   *  which is a different thing from Jev refusing them all, and the two must
   *  stay distinguishable in telemetry (they have different fixes). */
  candidateCount: number;
  /** True when candidates existed and Jev declined all of them. */
  refused: boolean;
};

/**
 * Resolve one name-shaped parameter end to end.
 *
 * `ask` is the client seam (askJev-shaped). Every failure — no term extracted,
 * no candidates, a refusal, an unavailable Jev — returns `entity: null`, and
 * the caller keeps whatever the deterministic router produced.
 */
export const resolveEntity = async (
  question: string,
  kind: EntityKind,
  term: string | undefined,
  search: EntitySearch,
  ask: (
    state: unknown,
    questions: Record<string, JevQuestion>,
    credentials: JevCredentials | undefined,
  ) => Promise<JevResult | null>,
  credentials: JevCredentials | undefined,
): Promise<EntityResolution> => {
  const empty = { entity: null, candidateCount: 0, refused: false };
  if (!term) return empty;
  let candidates: EntityCandidate[] = [];
  try {
    candidates = await search(kind, term);
  } catch {
    // A search failure is not a chat failure: the lane still answers from its
    // deterministic route.
    return empty;
  }
  if (!candidates.length) return empty;
  // A single candidate still goes through Jev: the search matched on spelling,
  // and "the only near-spelling in the registry" is not the same claim as "the
  // person this sentence means". The `absent` class exists for exactly that.
  const result = await ask(
    question,
    { entity: entityQuestion(candidates, kind) },
    credentials,
  );
  const entity = resolveEntityAnswer(result, "entity", candidates);
  return { entity, candidateCount: candidates.length, refused: !entity };
};
