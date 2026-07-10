// Education — per-school matura (ДЗИ) tool. Answers "как се справя <училище> на
// матурата" with the school's latest БЕЛ average, cohort, national percentile
// and its socioeconomic-context read. Reads the SAME precomputed 'directory'
// payload the /education view uses (/api/db/education-payload, migration 055) —
// the ~150 KB blob with latestScore/latestN/ses already baked, NOT the 1.25 MB
// raw index — so the tool and the UI share one source of truth. Every number in
// `facts` is straight from that payload (the narrator never computes).

import { fetchDb } from "./dataClient";
import type { Envelope, ToolArgs, ToolContext } from "./types";

const MIN_RANK = 10;

// The subset of the directory payload's per-school record this tool reads.
export type DirSchool = {
  id: string;
  name: string;
  address?: string;
  obshtinaName: string;
  latestYear: number | null;
  latestScore: number | null;
  latestN: number | null;
  ses: number | null;
  mathLatest: { year: number; score: number } | null;
};
type DirectoryPayload = { schools: DirSchool[] } | null;

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[.,"„“»«]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Name match, sorted best-score first. Tests BOTH directions of containment: a
// clean school-name arg (LLM path) is a substring of the record name, while a
// longer residual query ("матурата на <school>") CONTAINS the shorter school
// name — a one-way `name.includes(needle)` would miss the latter and always
// return notFound. The `needle.length >= 4` guard stops a 2–3 char junk token
// ("на", "смг" is 3 but only via the name→needle direction) from over-matching
// every school whose name happens to contain it. Pure + exported for unit tests.
export const matchSchoolByName = <
  T extends { name: string; latestScore: number | null },
>(
  schools: T[],
  raw: string,
): T[] => {
  const needle = norm(raw);
  if (!needle) return [];
  return schools
    .filter((s) => {
      if (s.latestScore == null) return false;
      const name = norm(s.name);
      return (
        name.includes(needle) || (needle.length >= 4 && needle.includes(name))
      );
    })
    .sort((a, b) => (b.latestScore ?? 0) - (a.latestScore ?? 0));
};

export const schoolMatura = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const raw = String(args.school ?? args.place ?? args.query ?? "").trim();
  const fmt = (v: number) =>
    v.toLocaleString(bg ? "bg-BG" : "en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  const notFound = (): Envelope => ({
    tool: "schoolMatura",
    domain: "indicators",
    kind: "scalar",
    title: bg
      ? `Не намерих училище „${raw}“ в данните за матурите`
      : `No school “${raw}” found in the matura data`,
    subtitle: bg
      ? "Търси по име на училище (напр. СМГ, Първа езикова Варна)."
      : "Search by school name (e.g. SMG, First Language School Varna).",
    facts: {},
    viz: "none",
    provenance: ["education-payload"],
  });
  if (!raw) return notFound();

  const payload = await fetchDb<DirectoryPayload>("education-payload", {
    kind: "directory",
  });
  if (!payload?.schools?.length) return notFound();
  const schools = payload.schools;

  const hit = matchSchoolByName(schools, raw)[0];
  if (!hit || hit.latestScore == null) return notFound();
  const score = hit.latestScore;

  // National percentile over rankable schools (a firm cohort), same gate the
  // /education view + the report card apply.
  const rankable = schools.filter(
    (s) => s.latestScore != null && (s.latestN ?? 0) >= MIN_RANK,
  );
  const ranked = (hit.latestN ?? 0) >= MIN_RANK;
  const pct = ranked
    ? Math.round(
        (100 * rankable.filter((s) => (s.latestScore ?? 0) < score).length) /
          Math.max(1, rankable.length),
      )
    : null;

  const facts: Record<string, string | number> = {
    school: hit.name,
    matura_bel: fmt(score),
    year: hit.latestYear ?? "",
    graduates: hit.latestN ?? 0,
  };
  if (pct != null) facts.percentile = pct;
  if (hit.ses != null) {
    facts.context_index = hit.ses.toFixed(1);
    facts.context = bg
      ? hit.ses >= 0
        ? "над средната"
        : "под средната"
      : hit.ses >= 0
        ? "above average"
        : "below average";
  }
  const matchCount = matchSchoolByName(schools, raw).length;
  if (matchCount > 1) facts.other_matches = matchCount - 1;

  return {
    tool: "schoolMatura",
    domain: "indicators",
    kind: "scalar",
    title: bg
      ? `${hit.name} — среден успех на матурата по БЕЛ ${fmt(score)}${hit.latestYear ? ` (${hit.latestYear} г.)` : ""}`
      : `${hit.name} — Bulgarian-matura average ${fmt(score)}${hit.latestYear ? ` (${hit.latestYear})` : ""}`,
    subtitle: hit.address
      ? bg
        ? `${hit.address} · по данни на МОН`
        : `${hit.address} · Ministry of Education`
      : bg
        ? "по данни на МОН"
        : "Ministry of Education data",
    value: score,
    valueFormat: "text",
    facts,
    viz: "none",
    provenance: ["education-payload"],
  };
};
