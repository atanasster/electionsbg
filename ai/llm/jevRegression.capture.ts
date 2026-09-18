// Capture the FROZEN disambiguation fixture for the Jev regression suite.
//
//   npx tsx ai/llm/jevRegression.capture.ts [persons] [companies]
//
// Hits the LIVE production fuzzy-search routes, records what they actually
// return for a deterministically misspelled real name, and freezes the result
// to ai/llm/jevRegression.fixtures/disambiguation.json.
//
// WHY FREEZE. The regression suite has to answer "did JEV get worse", and live
// candidates move under it every time the corpus reloads or the trigram
// threshold changes (docs/plans/jev-typesafe-eval-v1.md §4 measured that
// retrieval alone swings between 41% and 96%). Replaying frozen candidates
// isolates the model; re-running this capture is an explicit, reviewable act
// that shows up as a fixture diff.
//
// Ground truth is fixed MECHANICALLY, never asserted by hand: the correctly
// spelled name is searched first and its #1 hit is the intended entity. Cases
// where that entity does NOT survive the typo'd search are kept and labelled
// `absent` — those are the safety-critical "must refuse" half of the suite.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  COMPANY_TEMPLATES,
  FIXTURE_PATH,
  NONE_OF_THESE,
  PERSON_TEMPLATES,
  TYPO_KINDS,
  type DisambigCase,
  type DisambigFixture,
} from "./jevRegression.cases";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const PROD_BASE = "https://electionsbg.com";

type PersonHit = {
  key: string;
  name: string;
  primary_role?: string | null;
  position_type?: string | null;
  place_label?: string | null;
};
type CompanyHit = {
  eik: string;
  name: string;
  primaryName?: string;
  contracts?: string | number;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The production API rate-limits (429) — this capture walks a few hundred
// queries, so it backs off rather than hammering. Keep the pacing polite: this
// hits the live site, and the capture is a rare, one-off act.
const getJson = async <T>(url: string, maxRetries = 6): Promise<T> => {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url);
    if (res.status === 429 || res.status === 503) {
      const wait = 3000 * (attempt + 1);
      console.error(`    [${res.status}] backing off ${wait / 1000}s…`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return (await res.json()) as T;
  }
  throw new Error(`gave up after ${maxRetries} retries: ${url}`);
};

const personSearch = async (q: string, limit = 6): Promise<PersonHit[]> => {
  const d = await getJson<{
    power?: PersonHit[];
    money?: PersonHit[];
    others?: PersonHit[];
  }>(
    `${PROD_BASE}/api/db/person-search?q=${encodeURIComponent(q)}&limit=${limit}`,
  );
  return [...(d.power ?? []), ...(d.money ?? []), ...(d.others ?? [])];
};

const companySearch = async (q: string, limit = 6): Promise<CompanyHit[]> => {
  const d = await getJson<{ companies?: CompanyHit[] }>(
    `${PROD_BASE}/api/db/company-search?q=${encodeURIComponent(q)}&limit=${limit}`,
  );
  return d.companies ?? [];
};

const personDesc = (h: PersonHit): string =>
  [h.name, h.primary_role ?? h.position_type, h.place_label]
    .filter(Boolean)
    .join(" — ");

const companyDesc = (h: CompanyHit): string =>
  `${(h.primaryName ?? h.name).replace(/&quot;/g, '"')} (EIK ${h.eik}, ${h.contracts ?? 0} contracts)`;

// Real person names: the committed MP car declarations (real, full three-part
// Bulgarian names, no network needed to build the sample).
const personNames = (limit: number): string[] => {
  const raw = JSON.parse(
    readFileSync(join(ROOT, "data/parliament/mp-cars.json"), "utf8"),
  ) as { cars: { mpName: string }[] };
  const all = [
    ...new Set(
      raw.cars.map((c) => c.mpName).filter((n) => n.split(" ").length === 3),
    ),
  ].sort();
  const step = Math.max(1, Math.floor(all.length / limit));
  return all.filter((_, i) => i % step === 0).slice(0, limit);
};

// Real company names, from the live contractor leaderboard. Consortium carriers
// (`obed-` keys, "Обединение …" names) are skipped: they are synthetic keys for
// a member set, not a company somebody would type by name.
const companyNames = async (limit: number): Promise<string[]> => {
  const d = await getJson<{ rows?: { eik: string; name: string }[] }>(
    `${PROD_BASE}/api/db/table?q=${encodeURIComponent(
      JSON.stringify({ resource: "contractor_rankings", limit: limit * 4 }),
    )}`,
  );
  const clean = (d.rows ?? [])
    .filter((r) => !r.eik.startsWith("obed-"))
    .map((r) =>
      r.name
        .replace(/&quot;/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(
      (n) =>
        !/^Обединение/i.test(n) && n.split(" ").length >= 2 && n.length <= 40,
    );
  return [...new Set(clean)].slice(0, limit);
};

const main = async () => {
  const personLimit = Number(process.argv[2]) || 40;
  const companyLimit = Number(process.argv[3]) || 15;
  const capturedAt = new Date().toISOString();
  const cases: DisambigCase[] = [];

  const people = personNames(personLimit);
  const companies = await companyNames(companyLimit);
  console.log(
    `capturing ${people.length} persons × ${TYPO_KINDS.length} typos + ${companies.length} companies × ${TYPO_KINDS.length} typos…`,
  );

  let tIdx = 0;
  for (const anchorName of people) {
    let anchorKey: string | null = null;
    try {
      await sleep(250);
      const anchorHits = await personSearch(anchorName, 1);
      anchorKey = anchorHits[0]?.key ?? null;
    } catch (e) {
      console.error(
        `  anchor failed for "${anchorName}": ${String(e).slice(0, 80)}`,
      );
    }
    if (!anchorKey) continue;

    for (const { kind, fn } of TYPO_KINDS) {
      const typoQuery = fn(anchorName);
      if (typoQuery === anchorName) continue;
      try {
        await sleep(250);
        const hits = await personSearch(typoQuery, 6);
        const candidates: Record<string, string> = {};
        for (const h of hits) candidates[h.key] = personDesc(h);
        candidates[NONE_OF_THESE] =
          "None of the above is who the message means.";
        const present = anchorKey in candidates;
        const tpl = PERSON_TEMPLATES[tIdx++ % PERSON_TEMPLATES.length];
        cases.push({
          id: `person_${anchorKey.replace(/[^a-z0-9]+/gi, "_")}_${kind}`,
          kind: "person",
          klass: present ? "present" : "absent",
          anchorName,
          typoQuery,
          typoKind: kind,
          candidates,
          expected: present ? anchorKey : NONE_OF_THESE,
          question: { en: tpl.en(typoQuery), bg: tpl.bg(typoQuery) },
          capturedAt,
        });
      } catch (e) {
        console.error(
          `  typo search failed "${typoQuery}": ${String(e).slice(0, 80)}`,
        );
      }
    }
  }

  let cIdx = 0;
  for (const anchorName of companies) {
    let anchorKey: string | null = null;
    try {
      await sleep(250);
      const anchorHits = await companySearch(anchorName, 1);
      anchorKey = anchorHits[0]?.eik ?? null;
    } catch (e) {
      console.error(
        `  anchor failed for "${anchorName}": ${String(e).slice(0, 80)}`,
      );
    }
    if (!anchorKey) continue;

    for (const { kind, fn } of TYPO_KINDS) {
      const typoQuery = fn(anchorName);
      if (typoQuery === anchorName) continue;
      try {
        await sleep(250);
        const hits = await companySearch(typoQuery, 6);
        const candidates: Record<string, string> = {};
        for (const h of hits) candidates[h.eik] = companyDesc(h);
        candidates[NONE_OF_THESE] =
          "None of the above is who the message means.";
        const present = anchorKey in candidates;
        const tpl = COMPANY_TEMPLATES[cIdx++ % COMPANY_TEMPLATES.length];
        cases.push({
          id: `company_${anchorKey}_${kind}`,
          kind: "company",
          klass: present ? "present" : "absent",
          anchorName,
          typoQuery,
          typoKind: kind,
          candidates,
          expected: present ? anchorKey : NONE_OF_THESE,
          question: { en: tpl.en(typoQuery), bg: tpl.bg(typoQuery) },
          capturedAt,
        });
      } catch (e) {
        console.error(
          `  typo search failed "${typoQuery}": ${String(e).slice(0, 80)}`,
        );
      }
    }
  }

  const fixture: DisambigFixture = {
    capturedAt,
    source: `${PROD_BASE}/api/db/{person,company}-search (live), ground truth = #1 hit of the correctly spelled anchor query`,
    cases,
  };
  mkdirSync(dirname(FIXTURE_PATH), { recursive: true });
  writeFileSync(FIXTURE_PATH, JSON.stringify(fixture, null, 2) + "\n");

  const present = cases.filter((c) => c.klass === "present").length;
  console.log(
    `\nwrote ${FIXTURE_PATH}\n  ${cases.length} cases — ${present} present / ${cases.length - present} absent` +
      `\n  (the present/absent split is a property of RETRIEVAL at capture time, not of Jev)`,
  );
};

main();
