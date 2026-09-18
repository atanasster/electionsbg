// Real-registry name-disambiguation probe for Jev (TypeSafe).
//
//   TYPESAFE_API_KEY=... npx tsx ai/llm/fcEval.jev.realNames.ts
//
// Unlike JEV_NAME_DISAMBIG_CASES in fcEval.jev.ts (4 hand-picked candidate
// lists), this probe calls the REAL production fuzzy-search routes —
// electionsbg.com/api/db/person-search and /company-search, the same
// trigram-backed routes the live chat's person/company tools use — with a
// deliberately misspelled query, and hands Jev the ACTUAL top-N candidates
// those routes return (real people/companies, real near-miss confusions),
// not a curated list. This is the closest thing to "run it against real
// registry entities" without a real user-query log, which does not exist in
// this repo (see the chat discussion this file came out of).
//
// Ground truth for each case is established mechanically, not asserted by
// hand: query the SAME route with the CORRECTLY spelled name first, and take
// its #1 hit as the intended entity — the misspelled variants are then typo
// transforms of that same query, so the correct answer is fixed before any
// typo or any Jev call happens.

import { callSystemOne, MODEL } from "./fcEval.jev";

const PROD_BASE = "https://electionsbg.com";

type PersonHit = {
  key: string;
  name: string;
  primary_role?: string | null;
  position_type?: string | null;
  place_label?: string | null;
  party?: string | null;
};
type PersonSearchPayload = {
  power?: PersonHit[];
  money?: PersonHit[];
  others?: PersonHit[];
};
type CompanyHit = {
  eik: string;
  name: string;
  primaryName?: string;
  contracts?: string | number;
};
type CompanySearchPayload = { companies?: CompanyHit[] };

const fetchPersonSearch = async (
  q: string,
  limit = 6,
): Promise<PersonHit[]> => {
  const res = await fetch(
    `${PROD_BASE}/api/db/person-search?q=${encodeURIComponent(q)}&limit=${limit}`,
  );
  if (!res.ok) throw new Error(`person-search ${res.status}`);
  const data = (await res.json()) as PersonSearchPayload;
  return [...(data.power ?? []), ...(data.money ?? []), ...(data.others ?? [])];
};

const fetchCompanySearch = async (
  q: string,
  limit = 6,
): Promise<CompanyHit[]> => {
  const res = await fetch(
    `${PROD_BASE}/api/db/company-search?q=${encodeURIComponent(q)}&limit=${limit}`,
  );
  if (!res.ok) throw new Error(`company-search ${res.status}`);
  const data = (await res.json()) as CompanySearchPayload;
  return data.companies ?? [];
};

// ---- cases: a real (correctly spelled) anchor query, a misspelled variant
// actually sent to the fuzzy search, and the sentence Jev sees. `noRealMatch`
// cases skip the anchor step — there IS no correct entity, ground truth is
// always "none_of_these" regardless of what the fuzzy search returns.
type RealNameCase = {
  id: string;
  kind: "person" | "company";
  anchorQuery: string; // correctly-spelled name, used to fix ground truth
  misspelledQuery: string; // what actually goes to the fuzzy search + Jev
  sentenceTemplate: (name: string) => string; // wraps misspelledQuery for Jev's `state`
  noRealMatch?: boolean;
};

const CASES: RealNameCase[] = [
  {
    id: "real_asen_vasilev_dropped_letter",
    kind: "person",
    anchorQuery: "Асен Василев",
    misspelledQuery: "Асен Всилев", // dropped 'а'
    sentenceTemplate: (n) => `Какви са декларираните активи на ${n}?`,
  },
  {
    id: "real_asen_vasilev_extra_letter",
    kind: "person",
    anchorQuery: "Асен Василев",
    misspelledQuery: "Асен Василиев", // extra 'и'
    sentenceTemplate: (n) => `Покажи имуществото на политика ${n}.`,
  },
  {
    id: "real_kiril_petkov_dropped_letter",
    kind: "person",
    anchorQuery: "Кирил Петков",
    misspelledQuery: "Кирил Пеков", // dropped 'т'
    sentenceTemplate: (n) =>
      `Какво е декларирал ${n} като бивш министър-председател?`,
  },
  {
    id: "real_kiril_petkov_transposed",
    kind: "person",
    anchorQuery: "Кирил Петков",
    misspelledQuery: "Кирли Петков", // transposed 'и'/'л'
    sentenceTemplate: (n) => `Депутатски активи на ${n}.`,
  },
  {
    id: "real_lukoil_dropped_letter",
    kind: "company",
    anchorQuery: "Лукойл България",
    misspelledQuery: "Лукоил България", // dropped 'й'
    sentenceTemplate: (n) => `Покажи ми държавните договори на ${n}.`,
  },
  {
    id: "real_lukoil_dropped_letter2",
    kind: "company",
    anchorQuery: "Лукойл България",
    misspelledQuery: "Лукойл Блгария", // dropped 'ъ'
    sentenceTemplate: (n) => `Какви обществени поръчки има спечелени ${n}?`,
  },
  {
    id: "real_no_such_person",
    kind: "person",
    anchorQuery: "",
    misspelledQuery: "Радко Тервелов Дъбников", // a plausible-sounding but fictitious full name
    sentenceTemplate: (n) => `Какви активи е декларирал ${n}?`,
    noRealMatch: true,
  },
  {
    id: "real_no_such_company",
    kind: "company",
    anchorQuery: "",
    misspelledQuery: "Северозападен Хидростил ЕООД", // plausible-sounding, not a real registered name
    sentenceTemplate: (n) => `Договорите на ${n} с държавата.`,
    noRealMatch: true,
  },
];

const roleDescription = (h: PersonHit): string =>
  [
    h.primary_role ?? h.position_type,
    h.place_label,
    h.party ? `party ${h.party}` : null,
  ]
    .filter(Boolean)
    .join(", ") || "no further detail on record";

export type RealNameRow = {
  id: string;
  kind: "person" | "company";
  anchorQuery: string;
  misspelledQuery: string;
  expectedKey: string; // the anchor's #1 hit key/eik, or "none_of_these"
  expectedLabel: string;
  candidateKeys: string[]; // what the REAL fuzzy search actually returned
  got: string | null;
  confidence: number | null;
  ok: boolean;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  error?: string;
};

export const runRealNameDisambiguation = async (
  apiKey: string,
  cases: RealNameCase[] = CASES,
): Promise<RealNameRow[]> => {
  const rows: RealNameRow[] = [];
  for (const c of cases) {
    try {
      // 1. Fix ground truth from the correctly-spelled anchor query (skipped
      //    for noRealMatch cases — there is no correct entity by construction).
      let expectedKey = "none_of_these";
      let expectedLabel = "(no real match)";
      if (!c.noRealMatch) {
        if (c.kind === "person") {
          const anchorHits = await fetchPersonSearch(c.anchorQuery, 1);
          if (!anchorHits.length)
            throw new Error(`no anchor hit for "${c.anchorQuery}"`);
          expectedKey = anchorHits[0].key;
          expectedLabel = anchorHits[0].name;
        } else {
          const anchorHits = await fetchCompanySearch(c.anchorQuery, 1);
          if (!anchorHits.length)
            throw new Error(`no anchor hit for "${c.anchorQuery}"`);
          expectedKey = anchorHits[0].eik;
          expectedLabel = anchorHits[0].name;
        }
      }

      // 2. Run the REAL fuzzy search against the MISSPELLED query — this is
      //    the candidate list Jev actually has to disambiguate among.
      const criteria: Record<string, string> = {};
      let candidateKeys: string[] = [];
      if (c.kind === "person") {
        const hits = await fetchPersonSearch(c.misspelledQuery, 6);
        candidateKeys = hits.map((h) => h.key);
        for (const h of hits)
          criteria[h.key] = `${h.name} — ${roleDescription(h)}`;
      } else {
        const hits = await fetchCompanySearch(c.misspelledQuery, 6);
        candidateKeys = hits.map((h) => h.eik);
        for (const h of hits)
          criteria[h.eik] =
            `${h.primaryName ?? h.name} (EIK ${h.eik}, ${h.contracts ?? "0"} contracts on record)`;
      }
      criteria.none_of_these =
        "None of the above is who/what the message means.";

      // 3. Ask Jev to disambiguate the ORIGINAL (misspelled) sentence against
      //    the real candidate set.
      const body = {
        state: c.sentenceTemplate(c.misspelledQuery),
        model: MODEL,
        questions: {
          who: {
            type: "choice",
            instructions:
              "These candidates came from a fuzzy/trigram search against a possibly misspelled name in the message. Which one (if any) does the message actually mean? Use the sentence's context, not just spelling similarity.",
            criteria,
          },
        },
      };
      const { res, latencyMs, error } = await callSystemOne(apiKey, body);
      const answer = res?.answers?.who;
      rows.push({
        id: c.id,
        kind: c.kind,
        anchorQuery: c.anchorQuery,
        misspelledQuery: c.misspelledQuery,
        expectedKey,
        expectedLabel,
        candidateKeys,
        got: answer?.choice ?? null,
        confidence: answer?.confidence ?? null,
        ok: answer?.choice === expectedKey,
        inputTokens: res?.usage?.input_tokens ?? 0,
        outputTokens: res?.usage?.output_tokens ?? 0,
        latencyMs,
        error,
      });
    } catch (e) {
      rows.push({
        id: c.id,
        kind: c.kind,
        anchorQuery: c.anchorQuery,
        misspelledQuery: c.misspelledQuery,
        expectedKey: "?",
        expectedLabel: "?",
        candidateKeys: [],
        got: null,
        confidence: null,
        ok: false,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
        error: String(e instanceof Error ? e.message : e),
      });
    }
  }
  return rows;
};

const main = async () => {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) {
    console.error("TYPESAFE_API_KEY is required.");
    process.exit(1);
  }
  console.log(
    "\nJev name disambiguation against REAL production fuzzy search (electionsbg.com/api/db)\n",
  );
  const rows = await runRealNameDisambiguation(apiKey);
  let okCount = 0;
  for (const r of rows) {
    if (r.ok) okCount++;
    console.log(
      `${r.id.padEnd(32)} "${r.misspelledQuery}"\n` +
        `  candidates: [${r.candidateKeys.join(", ") || "(none returned)"}]\n` +
        `  expected: ${r.expectedKey} (${r.expectedLabel})   got: ${r.got ?? "null"}   ${r.ok ? "OK" : "MISS"}   conf=${r.confidence?.toFixed(2) ?? "n/a"}${r.error ? `   ERROR: ${r.error}` : ""}\n`,
    );
  }
  console.log(
    `Accuracy: ${okCount}/${rows.length} (${Math.round((100 * okCount) / rows.length)}%)`,
  );
};

if (process.argv[1] && /fcEval\.jev\.realNames\.(ts|js)$/.test(process.argv[1]))
  main();
