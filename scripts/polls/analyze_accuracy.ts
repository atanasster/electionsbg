/**
 * Compute polling-agency accuracy metrics by joining public/polls/polls{,_details}.json
 * with actual results in public/{YYYY_MM_DD}/national_summary.json.
 *
 * Outputs public/polls/accuracy.json with:
 *   - per-election errors per agency (using each agency's *last* pre-election poll)
 *   - per-agency aggregate profile: overall MAE, party-level signed bias, ideological-bloc lean
 *
 * Usage:
 *   tsx scripts/polls/analyze_accuracy.ts
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { command, run, option, string } from "cmd-ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const POLLS_DIR = path.resolve(__dirname, "../../public/polls");
const PUBLIC_DIR = path.resolve(__dirname, "../../public");

type Lang = { en: string; bg: string };

type Agency = {
  id: string;
  website: string | null;
  name_bg: string;
  name_en: string;
  abbr_bg: string;
  abbr_en: string;
};

type Poll = {
  id: string;
  agencyId: string;
  fieldwork: string;
  electionDate: string | null;
  respondents: number | null;
  methodology: Lang;
  source: string;
};

type PollDetail = {
  pollId: string;
  agencyId: string;
  support: number;
  nickName_bg: string;
  nickName_en: string;
};

type ActualParty = {
  partyNum: number;
  nickName: string;
  name: string;
  totalVotes: number;
  pct: number;
  passedThreshold?: boolean;
};

type NationalSummary = {
  election: string;
  parties: ActualParty[];
};

// Normalize a party label so polled-name and actual-name converge.
// "ГЕРБ – СДС" / "ГЕРБ-СДС" / "ГЕРБ - СДС" → "ГЕРБ-СДС"
const normKey = (s: string) =>
  s
    .normalize("NFC")
    .replace(/\s*[–—-]\s*/g, "-")
    .replace(/\s+/g, " ")
    .trim();

// Manual aliases for polled labels that don't normalize to the same key as the actual
// election-summary nickName. Keep tight — only entries we've confirmed are the same party.
const POLL_TO_ACTUAL: Record<string, string> = {
  "Прогресивна България": "ПрБ",
  "БСП за България": "БСП",
  "Коалиция за България (БСП)": "БСП",
  "Демократична България": "ДБ",
  "Алианс за права и свободи": "АПС",
  "Български възход": "БВ",
  "Обединени патриоти": "ОП",
  "Изправи се БГ! Ние идваме": "ИСМВ",
  "Изправи се! Мутри вън!": "ИСМВ",
  "Изправи се.БГ": "ИСМВ",
  "Реформаторски блок-Глас народен": "РБ",
  "Реформаторски блок": "РБ",
  "Патриотичен фронт": "ПФ",
  "България без цензура": "ББЦ",
  "Воля": "Воля",
  // Поляризация: polls call it "ДПС" pre-2024, "ДПС-НН" after the split. The actual
  // 2024-10-27 result has "ДПС-НН"; the actual 2024-06 has "ДПС". We let the year resolve it
  // — see resolveActualKey below.
};

// Ideological blocs for "lean" computation. Keys are normalized actual-result nicknames.
type BlocId =
  | "right_govt"
  | "reformist"
  | "nationalist"
  | "left"
  | "minority"
  | "populist"
  | "other";

const BLOC_OF: Record<string, BlocId> = {
  "ГЕРБ-СДС": "right_govt",
  "ГЕРБ": "right_govt",
  "СК": "right_govt",
  "ОДС": "right_govt",
  "ДСБ": "right_govt",
  "ПП": "reformist",
  "ПП-ДБ": "reformist",
  "ДБ": "reformist",
  "ПрБ": "reformist",
  "РБ": "reformist",
  "Възраждане": "nationalist",
  "Атака": "nationalist",
  "ОП": "nationalist",
  "ПФ": "nationalist",
  "Сияние": "nationalist",
  "Величие": "nationalist",
  "МЕЧ": "nationalist",
  "БСП": "left",
  "БСП-ОЛ": "left",
  "ДПС": "minority",
  "ДПС-НН": "minority",
  "АПС": "minority",
  "ИТН": "populist",
  "ВОЛЯ": "populist",
  "Воля": "populist",
  "БВ": "populist",
  "ББЦ": "populist",
  "ИСМВ": "populist",
  "НДСВ": "populist",
};

const blocOf = (key: string): BlocId => BLOC_OF[key] ?? "other";

// Resolve a poll's party label to the matching actual-results nickName for that election.
// Returns null if no match — those parties are excluded from MAE (the agency didn't poll
// or the actual result doesn't list it; either way it's noise for the metric).
const resolveActualKey = (
  polledBg: string,
  actualKeys: Set<string>,
): string | null => {
  const direct = POLL_TO_ACTUAL[polledBg.trim()];
  if (direct && actualKeys.has(direct)) return direct;
  const norm = normKey(polledBg);
  if (actualKeys.has(norm)) return norm;
  // ДПС / ДПС-НН ambiguity — try both.
  if (norm === "ДПС-НН" && actualKeys.has("ДПС")) return "ДПС";
  if (norm === "ДПС" && actualKeys.has("ДПС-НН")) return "ДПС-НН";
  if (norm === "БСП" && actualKeys.has("БСП-ОЛ")) return "БСП-ОЛ";
  if (norm === "БСП-ОЛ" && actualKeys.has("БСП")) return "БСП";
  return null;
};

const isoToFolder = (iso: string) => iso.replace(/-/g, "_");

const daysBetween = (a: string, b: string) => {
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  return Math.round((db - da) / 86400000);
};

// Parse the *end* date of a fieldwork string we wrote during scrape.
// Format examples produced by scrape_polls.ts:
//   "Mar 12-20 2026"        → 2026-03-20
//   "Feb 23 - Mar 2 2026"   → 2026-03-02
//   "Mar 19 2026"           → 2026-03-19
//   "Mar 2024"              → 2024-03-15 (mid-month)
const MONTH_EN: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};
const parseFieldworkEnd = (fw: string): string | null => {
  const s = fw.trim();
  // Cross-month range: "Mon D - Mon D YYYY"
  let m = s.match(/^([A-Za-z]{3})\s+\d{1,2}\s*-\s*([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})$/);
  if (m) {
    const mo = MONTH_EN[m[2].toLowerCase()];
    if (mo === undefined) return null;
    return `${m[4]}-${String(mo + 1).padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  }
  // Same-month range: "Mon D-D YYYY"
  m = s.match(/^([A-Za-z]{3})\s+\d{1,2}-(\d{1,2})\s+(\d{4})$/);
  if (m) {
    const mo = MONTH_EN[m[1].toLowerCase()];
    if (mo === undefined) return null;
    return `${m[3]}-${String(mo + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  // Single date: "Mon D YYYY"
  m = s.match(/^([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})$/);
  if (m) {
    const mo = MONTH_EN[m[1].toLowerCase()];
    if (mo === undefined) return null;
    return `${m[3]}-${String(mo + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  // Fuzzy "Mon YYYY" or "Early Jul YYYY" etc — fall back to mid-month if a month/year are present.
  m = s.match(/([A-Za-z]{3})[a-z]*\s+(\d{4})/);
  if (m) {
    const mo = MONTH_EN[m[1].toLowerCase().slice(0, 3)];
    if (mo === undefined) return null;
    return `${m[2]}-${String(mo + 1).padStart(2, "0")}-15`;
  }
  return null;
};

type ElectionAgencyError = {
  agencyId: string;
  pollId: string;
  fieldworkEnd: string;
  daysBefore: number;
  respondents: number | null;
  errors: { key: string; polled: number; actual: number; error: number }[];
  mae: number;
  rmse: number;
  biggestMiss: { key: string; error: number };
};

type ElectionAccuracy = {
  electionDate: string;
  actualResults: { key: string; pct: number; passedThreshold: boolean }[];
  agencies: ElectionAgencyError[];
};

type AgencyProfile = {
  agencyId: string;
  name_bg: string;
  name_en: string;
  totalPolls: number;
  preElectionPolls: number;
  electionsCovered: string[];
  overallMAE: number;
  overallRMSE: number;
  partyBias: { key: string; meanError: number; samples: number }[];
  blocLean: Record<BlocId, { meanError: number; samples: number }>;
  // Relative-to-consensus house effect: how each agency differs from the cross-agency mean
  // *of the same election cycle* — flags lean even without ground truth (useful for inter-
  // election polls).
  houseEffect: { key: string; meanDiff: number; samples: number }[];
};

const readJson = <T>(file: string): T | null => {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
};

const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

const computeElectionAccuracy = (
  electionDate: string,
  polls: Poll[],
  details: PollDetail[],
): ElectionAccuracy | null => {
  const summary = readJson<NationalSummary>(
    path.join(PUBLIC_DIR, isoToFolder(electionDate), "national_summary.json"),
  );
  if (!summary) {
    console.warn(`  ! no national_summary for ${electionDate}`);
    return null;
  }
  const actuals = new Map<string, ActualParty>();
  for (const p of summary.parties) actuals.set(p.nickName, p);
  const actualKeys = new Set(actuals.keys());

  const cyclePolls = polls.filter((p) => p.electionDate === electionDate);
  // Group by agency; pick the poll whose fieldworkEnd is closest before electionDate.
  const byAgency = new Map<string, Poll[]>();
  for (const p of cyclePolls) {
    const arr = byAgency.get(p.agencyId) ?? [];
    arr.push(p);
    byAgency.set(p.agencyId, arr);
  }

  const agencyResults: ElectionAgencyError[] = [];
  for (const [agencyId, agencyPolls] of byAgency) {
    let last: { poll: Poll; end: string } | null = null;
    for (const poll of agencyPolls) {
      const end = parseFieldworkEnd(poll.fieldwork);
      if (!end) continue;
      if (end > electionDate) continue; // post-election poll, ignore
      if (!last || end > last.end) last = { poll, end };
    }
    if (!last) continue;

    const polledRows = details.filter((d) => d.pollId === last.poll.id);
    const errors: ElectionAgencyError["errors"] = [];
    for (const r of polledRows) {
      const key = resolveActualKey(r.nickName_bg, actualKeys);
      if (!key) continue;
      const actual = actuals.get(key)!;
      errors.push({
        key,
        polled: r.support,
        actual: actual.pct,
        error: round(r.support - actual.pct),
      });
    }
    if (errors.length === 0) continue;

    const absErrors = errors.map((e) => Math.abs(e.error));
    const mae = round(mean(absErrors));
    const rmse = round(Math.sqrt(mean(absErrors.map((e) => e * e))));
    const biggest = errors.reduce((a, b) => (Math.abs(b.error) > Math.abs(a.error) ? b : a));
    agencyResults.push({
      agencyId,
      pollId: last.poll.id,
      fieldworkEnd: last.end,
      daysBefore: daysBetween(last.end, electionDate),
      respondents: last.poll.respondents,
      errors: errors.sort((a, b) => Math.abs(b.error) - Math.abs(a.error)),
      mae,
      rmse,
      biggestMiss: { key: biggest.key, error: biggest.error },
    });
  }
  agencyResults.sort((a, b) => a.mae - b.mae);

  return {
    electionDate,
    actualResults: summary.parties
      .filter((p) => p.pct >= 1)
      .map((p) => ({
        key: p.nickName,
        pct: p.pct,
        passedThreshold: !!p.passedThreshold,
      })),
    agencies: agencyResults,
  };
};

const computeHouseEffects = (
  polls: Poll[],
  details: PollDetail[],
): Map<string, { key: string; diffs: number[] }[]> => {
  // For every (cycle, party), compute the cross-agency mean across all polls in that cycle,
  // then per-agency mean diff. "cycle" = electionDate or null (inter-election → bucketed by
  // calendar quarter to avoid washing out drift).
  const cycleKey = (p: Poll): string => {
    if (p.electionDate) return `e:${p.electionDate}`;
    const end = parseFieldworkEnd(p.fieldwork);
    if (!end) return "unknown";
    return `q:${end.slice(0, 7)}`; // YYYY-MM bucket
  };
  const cycleParty = new Map<string, Map<string, number[]>>(); // cycleKey → party → all support values

  const detailsByPoll = new Map<string, PollDetail[]>();
  for (const d of details) {
    const arr = detailsByPoll.get(d.pollId) ?? [];
    arr.push(d);
    detailsByPoll.set(d.pollId, arr);
  }

  const records: { agencyId: string; party: string; support: number; cycleKey: string }[] = [];
  for (const p of polls) {
    const ck = cycleKey(p);
    const polledRows = detailsByPoll.get(p.id) ?? [];
    for (const r of polledRows) {
      const party = normKey(r.nickName_bg);
      records.push({ agencyId: p.agencyId, party, support: r.support, cycleKey: ck });
      const cm = cycleParty.get(ck) ?? new Map<string, number[]>();
      const arr = cm.get(party) ?? [];
      arr.push(r.support);
      cm.set(party, arr);
      cycleParty.set(ck, cm);
    }
  }

  // Per-agency diff vs cycle mean (only when ≥2 agencies in that cycle for that party)
  const agencyDiffs = new Map<string, Map<string, number[]>>();
  for (const rec of records) {
    const cycle = cycleParty.get(rec.cycleKey)!;
    const series = cycle.get(rec.party) ?? [];
    if (series.length < 2) continue;
    const cycleMean = mean(series);
    const am = agencyDiffs.get(rec.agencyId) ?? new Map<string, number[]>();
    const arr = am.get(rec.party) ?? [];
    arr.push(rec.support - cycleMean);
    am.set(rec.party, arr);
    agencyDiffs.set(rec.agencyId, am);
  }

  const out = new Map<string, { key: string; diffs: number[] }[]>();
  for (const [agencyId, partyMap] of agencyDiffs) {
    const arr: { key: string; diffs: number[] }[] = [];
    for (const [party, diffs] of partyMap) arr.push({ key: party, diffs });
    out.set(agencyId, arr);
  }
  return out;
};

const buildAgencyProfiles = (
  agencies: Agency[],
  polls: Poll[],
  details: PollDetail[],
  elections: ElectionAccuracy[],
): AgencyProfile[] => {
  const houseEffectsRaw = computeHouseEffects(polls, details);

  return agencies.map((a) => {
    const allErrors: { key: string; error: number; abs: number }[] = [];
    const electionsCovered: string[] = [];
    let preElectionPolls = 0;
    for (const e of elections) {
      const agencyEntry = e.agencies.find((x) => x.agencyId === a.id);
      if (!agencyEntry) continue;
      electionsCovered.push(e.electionDate);
      preElectionPolls += 1;
      for (const err of agencyEntry.errors) {
        allErrors.push({ key: err.key, error: err.error, abs: Math.abs(err.error) });
      }
    }

    const overallMAE = round(mean(allErrors.map((e) => e.abs)));
    const overallRMSE = round(Math.sqrt(mean(allErrors.map((e) => e.abs * e.abs))));

    // Party bias = mean signed error per party (positive = agency overestimates that party)
    const byParty = new Map<string, number[]>();
    for (const e of allErrors) {
      const arr = byParty.get(e.key) ?? [];
      arr.push(e.error);
      byParty.set(e.key, arr);
    }
    const partyBias = [...byParty.entries()]
      .map(([key, errs]) => ({ key, meanError: round(mean(errs)), samples: errs.length }))
      .sort((a, b) => Math.abs(b.meanError) - Math.abs(a.meanError));

    // Bloc lean = mean signed error per bloc (averaged across all party-elections in that bloc)
    const byBloc = new Map<BlocId, number[]>();
    for (const e of allErrors) {
      const bloc = blocOf(e.key);
      const arr = byBloc.get(bloc) ?? [];
      arr.push(e.error);
      byBloc.set(bloc, arr);
    }
    const blocLean: AgencyProfile["blocLean"] = {
      right_govt: { meanError: 0, samples: 0 },
      reformist: { meanError: 0, samples: 0 },
      nationalist: { meanError: 0, samples: 0 },
      left: { meanError: 0, samples: 0 },
      minority: { meanError: 0, samples: 0 },
      populist: { meanError: 0, samples: 0 },
      other: { meanError: 0, samples: 0 },
    };
    for (const [bloc, errs] of byBloc) {
      blocLean[bloc] = { meanError: round(mean(errs)), samples: errs.length };
    }

    // House effect (per-cycle relative to consensus)
    const heRaw = houseEffectsRaw.get(a.id) ?? [];
    const houseEffect = heRaw
      .map((h) => ({ key: h.key, meanDiff: round(mean(h.diffs)), samples: h.diffs.length }))
      .filter((h) => h.samples >= 2)
      .sort((a, b) => Math.abs(b.meanDiff) - Math.abs(a.meanDiff))
      .slice(0, 12);

    return {
      agencyId: a.id,
      name_bg: a.name_bg,
      name_en: a.name_en,
      totalPolls: polls.filter((p) => p.agencyId === a.id).length,
      preElectionPolls,
      electionsCovered,
      overallMAE,
      overallRMSE,
      partyBias: partyBias.slice(0, 12),
      blocLean,
      houseEffect,
    };
  });
};

const main = async (opts: { pollsDir: string }) => {
  const polls = readJson<Poll[]>(path.join(opts.pollsDir, "polls.json"));
  const details = readJson<PollDetail[]>(path.join(opts.pollsDir, "polls_details.json"));
  const agencies = readJson<Agency[]>(path.join(opts.pollsDir, "agencies.json"));
  if (!polls || !details || !agencies) {
    throw new Error(`missing polls files in ${opts.pollsDir} — run scrape_polls first`);
  }

  const electionDates = [...new Set(polls.map((p) => p.electionDate).filter((d): d is string => !!d))].sort();
  console.log(`→ analyzing ${electionDates.length} elections, ${polls.length} polls, ${agencies.length} agencies`);

  const elections: ElectionAccuracy[] = [];
  for (const d of electionDates) {
    const e = computeElectionAccuracy(d, polls, details);
    if (e) elections.push(e);
  }
  elections.sort((a, b) => (a.electionDate < b.electionDate ? 1 : -1));

  // Drop the "NA" pseudo-agency (general-consensus placeholder, not a real pollster)
  const realAgencies = agencies.filter((a) => a.id !== "NA");
  const profiles = buildAgencyProfiles(realAgencies, polls, details, elections)
    .filter((p) => p.preElectionPolls > 0)
    .sort((a, b) => a.overallMAE - b.overallMAE);

  const out = {
    generatedAt: new Date().toISOString(),
    elections,
    agencyProfiles: profiles,
  };
  fs.writeFileSync(path.join(opts.pollsDir, "accuracy.json"), JSON.stringify(out, null, 2));
  console.log(`✓ wrote ${path.join(opts.pollsDir, "accuracy.json")}`);

  // Console summary
  console.log("\nAgency leaderboard (overall MAE across all pre-election last-polls):");
  for (const p of profiles) {
    console.log(
      `  ${p.agencyId.padEnd(5)} MAE=${p.overallMAE.toFixed(2)}  RMSE=${p.overallRMSE.toFixed(2)}  elections=${p.electionsCovered.length}  polls=${p.preElectionPolls}`,
    );
  }
  console.log("\nMost recent election (2026-04-19) — agency last-poll MAE:");
  const latest = elections.find((e) => e.electionDate === "2026-04-19");
  if (latest) {
    for (const a of latest.agencies) {
      console.log(
        `  ${a.agencyId.padEnd(5)} MAE=${a.mae.toFixed(2)}  ${a.daysBefore}d before  worst=${a.biggestMiss.key} (${a.biggestMiss.error > 0 ? "+" : ""}${a.biggestMiss.error})`,
      );
    }
  }
};

const cli = command({
  name: "analyze_accuracy",
  args: {
    pollsDir: option({ type: string, long: "polls", defaultValue: () => POLLS_DIR }),
  },
  handler: async (args) => {
    await main({ pollsDir: args.pollsDir });
  },
});

run(cli, process.argv.slice(2));
