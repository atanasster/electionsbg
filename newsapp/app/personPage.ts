// The person page's rules, apart from its markup (news-person-sentiment-v1 §6).

import type {
  PersonIndexRow,
  PersonArticleRow,
  PersonPayload,
  PersonRole,
  ToneBucket,
} from "./data";
import { TONE_BUCKET_ORDER } from "./sentimentScale";
import { transliterateName } from "@/data/candidates/transliterateName";

/** Bar fills per bucket — the strong degree full, the plain one lighter. */
export const BUCKET_FILL: Record<ToneBucket, string> = {
  strongly_unfavorable: "bg-negative",
  unfavorable: "bg-negative/55",
  neutral: "bg-muted-foreground/60",
  favorable: "bg-positive/55",
  strongly_favorable: "bg-positive",
};

export const BUCKETS = TONE_BUCKET_ORDER as readonly ToneBucket[];

/**
 * The name a reader sees: the curated Latin name on the EN side when there is
 * one, else a transliteration — never Cyrillic under an English page.
 */
export const displayName = (
  p: { name_bg: string | null; name_en: string | null },
  isEnglish: boolean,
): string | null =>
  isEnglish
    ? (p.name_en ?? (p.name_bg ? transliterateName(p.name_bg) : null))
    : p.name_bg;

export const roleName = (
  code: string,
  labels: PersonPayload["role_labels"] | undefined,
  isEnglish: boolean,
): string => labels?.[code]?.[isEnglish ? "en" : "bg"] ?? code;

/**
 * The office line under a name: every current office, or — when none is
 * current — the latest one held, marked FORMER. ⚠️ Never a bare role code
 * without a date basis read as „holds it now".
 */
export const officeLine = (
  roles: PersonRole[],
  labels: PersonPayload["role_labels"] | undefined,
  isEnglish: boolean,
): { text: string; former: boolean } | null => {
  const current = roles.filter((r) => r.current);
  const seen = new Set<string>();
  if (current.length) {
    const names = current
      .map((r) => roleName(r.role, labels, isEnglish))
      .filter((n) => (seen.has(n) ? false : (seen.add(n), true)));
    return { text: names.join(" · "), former: false };
  }
  const last = roles.find((r) => r.start) ?? roles[0];
  if (!last) return null;
  const years =
    last.start || last.end
      ? ` (${last.start?.slice(0, 4) ?? "?"}–${last.end?.slice(0, 4) ?? ""})`
      : "";
  return {
    text: `${roleName(last.role, labels, isEnglish)}${years}`,
    former: true,
  };
};

export interface RowFilter {
  outlet?: string | null;
  bucket?: ToneBucket | null;
  role?: "primary" | "secondary" | "incidental" | null;
}

export const filterActive = (f: RowFilter) =>
  Boolean(f.outlet || f.bucket || f.role);

export const filterRows = (rows: PersonArticleRow[], f: RowFilter) =>
  rows.filter(
    (r) =>
      (!f.outlet || r.domain === f.outlet) &&
      (!f.bucket || r.bucket === f.bucket) &&
      (!f.role || r.subject_role === f.role),
  );

/** The series bucket a calendar day falls in — the build's `period_of`. */
export const periodOf = (
  day: string,
  granularity: "day" | "week" | "month",
): string | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  if (!m) return null;
  if (granularity === "day") return `${m[1]}-${m[2]}-${m[3]}`;
  if (granularity === "month") return `${m[1]}-${m[2]}-01`;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const weekday = (d.getUTCDay() + 6) % 7; // Monday = 0, the ISO rule
  d.setUTCDate(d.getUTCDate() - weekday);
  return d.toISOString().slice(0, 10);
};

/**
 * Role changes that fall inside the plotted range, as series periods. A shift
 * that coincides with taking or leaving office is the most common real
 * explanation of a change in tone, so the chart marks where one happened.
 */
export const roleChanges = (
  roles: PersonRole[],
  periods: string[],
  granularity: "day" | "week" | "month",
  labels: PersonPayload["role_labels"] | undefined,
  isEnglish: boolean,
): { period: string; text: string }[] => {
  if (!periods.length) return [];
  const first = periods[0];
  const last = periods[periods.length - 1];
  const out: { period: string; text: string }[] = [];
  for (const r of roles) {
    for (const [day, verb] of [
      [r.start, isEnglish ? "took office" : "встъпва"],
      [r.end, isEnglish ? "left office" : "освободен"],
    ] as const) {
      if (!day) continue;
      const period = periodOf(day, granularity);
      if (period && period >= first && period <= last)
        out.push({
          period,
          text: `${roleName(r.role, labels, isEnglish)}: ${verb}`,
        });
    }
  }
  return out.sort((a, b) => a.period.localeCompare(b.period));
};

/** Percent of units where the person was the article's main subject. */
export const primaryShare = (p: PersonPayload): number | null => {
  const primary = p.by_role.primary?.n ?? 0;
  const total = primary + (p.by_role.secondary?.n ?? 0);
  return total ? Math.round((primary / total) * 100) : null;
};

/** A row's n and counts — for one outlet when the outlet filter is set. */
export const rowFigures = (
  row: PersonIndexRow,
  outlet: string | null,
): { n: number; counts: Record<ToneBucket, number> } => {
  if (!outlet) return { n: row.n, counts: row.counts };
  const cell = row.by_outlet?.[outlet];
  if (!cell) return { n: 0, counts: {} as Record<ToneBucket, number> };
  const [n, ...counts] = cell;
  return {
    n,
    counts: Object.fromEntries(
      BUCKETS.map((b, i) => [b, counts[i] ?? 0]),
    ) as Record<ToneBucket, number>,
  };
};
