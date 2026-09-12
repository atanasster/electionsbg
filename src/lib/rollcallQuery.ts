import { isQueryDate } from "./queryDates";
export const ROLLCALL_VERSION = "rollcall-records-v1";
export const ROLLCALL_CORPORA = [
  "parliamentSessions",
  "parliamentVotes",
  "parliamentCasts",
  "councilSessions",
  "councilResolutions",
  "councilCasts",
] as const;
export type RollcallCorpus = (typeof ROLLCALL_CORPORA)[number];
export const ROLLCALL_OPERATIONS = [
  "list",
  "detail",
  "count",
  "summary",
  "trend",
  "compare",
  "rank",
  "share",
  "methodology",
] as const;
export const ROLLCALL_TOPICS = {
  budget: { bg: "Бюджет", en: "Budget", stems: ["бюджет"] },
  health: {
    bg: "Здравеопазване",
    en: "Healthcare",
    stems: ["здрав", "болниц"],
  },
  education: {
    bg: "Образование",
    en: "Education",
    stems: ["образова", "училищ"],
  },
  roads: { bg: "Пътища", en: "Roads", stems: ["пътн", "пътищ"] },
  pensions: { bg: "Пенсии", en: "Pensions", stems: ["пенси"] },
  taxes: { bg: "Данъци", en: "Taxes", stems: ["данъч", "данък"] },
  defense: { bg: "Отбрана", en: "Defence", stems: ["отбрана", "военн"] },
  urban_planning: {
    bg: "Градоустройство",
    en: "Urban planning",
    stems: ["устройствен", "регулаци", "застроява"],
  },
} as const;
export type RollcallQuery = {
  version: typeof ROLLCALL_VERSION;
  corpus: RollcallCorpus;
  operation: (typeof ROLLCALL_OPERATIONS)[number];
  metric: "records" | "choiceShare" | "agreement" | "alignment" | "contested";
  basis: "attempts" | "standing";
  assemblyIds?: string[];
  councilIds?: string[];
  seatIds?: string[];
  councilCastKeys?: string[];
  comparatorSeatIds?: string[];
  factionIds?: string[];
  from?: string;
  toExclusive?: string;
  compareFrom?: string;
  compareToExclusive?: string;
  topicIds?: string[];
  keyword?: string;
  topicMode: "all" | "any";
  searchField: "sourceTitle";
  choice?: "for" | "against" | "abstain" | "recordedAbsent";
  outcome?: "adopted" | "rejected" | "returned" | "unknown";
  named?: "yes" | "no";
  tallyMethod?: "named" | "open" | "secret" | "none";
  key?: string;
  sessionKey?: string;
  parentQuery?: string;
  relationship?: "sessionVotes" | "voteCasts" | "personVotes";
  latestN?: number;
  groupBy?: "month" | "year" | "person" | "faction" | "choice" | "body";
  denominator: "recorded" | "participating";
  minOverlap: number;
  limit: number;
  offset: number;
  order: "desc" | "asc";
  expectedRevision?: string;
};
export type RollcallArgs = Partial<RollcallQuery> & { corpus: RollcallCorpus };
const lists = [
  "assemblyIds",
  "councilIds",
  "seatIds",
  "comparatorSeatIds",
  "councilCastKeys",
  "factionIds",
  "topicIds",
];
const numbers = ["limit", "offset", "latestN", "minOverlap"];
const enums: Record<string, readonly string[]> = {
  version: [ROLLCALL_VERSION],
  corpus: ROLLCALL_CORPORA,
  operation: ROLLCALL_OPERATIONS,
  metric: ["records", "choiceShare", "agreement", "alignment", "contested"],
  basis: ["attempts", "standing"],
  topicMode: ["all", "any"],
  searchField: ["sourceTitle"],
  choice: ["for", "against", "abstain", "recordedAbsent"],
  outcome: ["adopted", "rejected", "returned", "unknown"],
  named: ["yes", "no"],
  tallyMethod: ["named", "open", "secret", "none"],
  relationship: ["sessionVotes", "voteCasts", "personVotes"],
  groupBy: ["month", "year", "person", "faction", "choice", "body"],
  denominator: ["recorded", "participating"],
  order: ["desc", "asc"],
};
const strings = [
  "from",
  "toExclusive",
  "compareFrom",
  "compareToExclusive",
  "keyword",
  "key",
  "sessionKey",
  "parentQuery",
  "expectedRevision",
];
export function validateRollcallQuery(
  raw: unknown,
  depth = 0,
): { ok: true; query: RollcallQuery } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return { ok: false, errors: ["query_object_required"] };
  if (depth > 2) return { ok: false, errors: ["parent_depth"] };
  const input = raw as Record<string, unknown>,
    out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue;
    if (lists.includes(k)) {
      if (
        !Array.isArray(v) ||
        !v.length ||
        v.length > 100 ||
        v.some((x) => typeof x !== "string" || !x.trim() || x.length > 250)
      )
        errors.push(k);
      else out[k] = [...new Set(v.map((x) => x.trim()))].sort();
    } else if (numbers.includes(k)) {
      if (
        typeof v !== "number" ||
        !Number.isInteger(v) ||
        v < (k === "offset" ? 0 : 1) ||
        v > (k === "offset" ? 10000 : 100)
      )
        errors.push(k);
      else out[k] = v;
    } else if (Object.prototype.hasOwnProperty.call(enums, k)) {
      if (typeof v !== "string" || !enums[k].includes(v)) errors.push(k);
      else out[k] = v;
    } else if (strings.includes(k)) {
      if (
        typeof v !== "string" ||
        !v.trim() ||
        v.length > (k === "parentQuery" ? 16000 : 500)
      )
        errors.push(k);
      else out[k] = v.trim();
    } else errors.push(`unknown:${k}`);
  }
  if (!out.corpus) errors.push("corpus_required");
  const parliament = String(out.corpus).startsWith("parliament"),
    casts = String(out.corpus).endsWith("Casts"),
    sessions = String(out.corpus).endsWith("Sessions");
  const operation = out.operation ?? "list";
  const q = {
    version: ROLLCALL_VERSION,
    operation,
    metric: "records",
    basis:
      parliament &&
      ["count", "summary", "rank", "share", "trend", "compare"].includes(
        String(operation),
      )
        ? "standing"
        : "attempts",
    topicMode: "all",
    searchField: "sourceTitle",
    denominator: "recorded",
    minOverlap: 5,
    limit: 10,
    offset: 0,
    order: "desc",
    ...out,
  } as RollcallQuery;
  if (
    !parliament &&
    (q.assemblyIds ||
      q.seatIds ||
      q.comparatorSeatIds ||
      q.factionIds ||
      q.choice === "recordedAbsent" ||
      q.groupBy === "faction")
  )
    errors.push("parliament_only_scope");
  if (
    parliament &&
    (q.councilIds || q.councilCastKeys || q.tallyMethod || q.named || q.outcome)
  )
    errors.push("council_only_scope");
  if (!parliament && q.basis === "standing")
    errors.push("council_standing_unsupported");
  if (q.assemblyIds?.some((s) => !/^\d{1,2}$/.test(s) || Number(s) < 1))
    errors.push("assemblyIds");
  if (
    [...(q.seatIds ?? []), ...(q.comparatorSeatIds ?? [])].some(
      (s) => !/^\d{1,2}:\d{1,9}$/.test(s),
    )
  )
    errors.push("seatIds");
  if (q.councilIds?.some((s) => !/^([A-Z]{3}\d{2}|SOF)$/.test(s)))
    errors.push("councilIds");
  if (q.councilCastKeys && q.councilIds?.length !== 1)
    errors.push("council_identity_requires_one_body");
  if (
    q.councilCastKeys?.some(
      (key) => !/^[A-Za-z0-9_-]+::[^:]{1,200}$/u.test(key),
    )
  )
    errors.push("council_source_key_required");
  if (
    q.topicIds?.some(
      (s) => !Object.prototype.hasOwnProperty.call(ROLLCALL_TOPICS, s),
    )
  )
    errors.push("topicIds");
  for (const [a, b] of [
    ["from", "toExclusive"],
    ["compareFrom", "compareToExclusive"],
  ] as const) {
    if (
      Boolean(q[a]) !== Boolean(q[b]) ||
      (q[a] && (!isQueryDate(q[a]!) || !isQueryDate(q[b]!) || q[a]! >= q[b]!))
    )
      errors.push("date_window");
  }
  if (q.operation === "compare" && (!q.from || !q.compareFrom))
    errors.push("comparison_windows_required");
  if (q.operation !== "compare" && (q.compareFrom || q.compareToExclusive))
    errors.push("comparison_operation_required");
  if (q.operation === "detail" && !q.key) errors.push("detail_key_required");
  if (
    sessions &&
    (q.choice ||
      q.seatIds ||
      q.councilCastKeys ||
      q.factionIds ||
      q.metric !== "records" ||
      q.groupBy === "person" ||
      q.groupBy === "choice")
  )
    errors.push("session_grain");
  if (
    !casts &&
    (q.choice ||
      q.metric === "choiceShare" ||
      q.groupBy === "choice" ||
      q.groupBy === "person")
  )
    errors.push("cast_grain_required");
  if (
    q.metric === "agreement" &&
    (!parliament || !casts || !q.seatIds || !q.comparatorSeatIds)
  )
    errors.push("agreement_identities_required");
  if (q.metric === "alignment" && (!parliament || !casts))
    errors.push("parliament_casts_required");
  if (q.metric === "contested" && q.corpus !== "parliamentVotes")
    errors.push("parliament_votes_required");
  if (q.metric === "choiceShare" && !q.choice) errors.push("choice_required");
  if (q.operation === "share" && q.metric !== "choiceShare")
    errors.push("share_metric_required");
  if (q.operation === "trend" && !q.groupBy) q.groupBy = "month";
  if (q.latestN && q.operation === "compare")
    errors.push("latest_comparison_ambiguous");
  if (q.offset && !q.expectedRevision) errors.push("page_revision_required");
  if (Boolean(q.parentQuery) !== Boolean(q.relationship))
    errors.push("parent_relationship_required");
  if (q.parentQuery) {
    const p = decodeRollcallQuery(q.parentQuery, depth + 1);
    if (!p.ok) errors.push("parent_invalid");
    else {
      const pc = p.query.corpus;
      const allowed =
        q.relationship === "sessionVotes"
          ? (pc === "parliamentSessions" && q.corpus === "parliamentVotes") ||
            (pc === "councilSessions" && q.corpus === "councilResolutions")
          : q.relationship === "voteCasts"
            ? (pc === "parliamentVotes" && q.corpus === "parliamentCasts") ||
              (pc === "councilResolutions" && q.corpus === "councilCasts")
            : (pc === "parliamentCasts" && q.corpus === "parliamentVotes") ||
              (pc === "councilCasts" && q.corpus === "councilResolutions");
      if (!allowed) errors.push("parent_relationship_invalid");
      if (p.query.operation === "compare")
        errors.push("comparison_parent_unsupported");
    }
  }
  if (encodeURIComponent(JSON.stringify(q)).length > 16000)
    errors.push("query_too_large");
  return errors.length
    ? { ok: false, errors: [...new Set(errors)] }
    : { ok: true, query: q };
}
export function encodeRollcallQuery(raw: unknown): string {
  const p = validateRollcallQuery(raw);
  if (!p.ok) throw Error(p.errors.join(","));
  return encodeURIComponent(
    JSON.stringify(
      Object.fromEntries(
        Object.entries(p.query).sort(([a], [b]) => a.localeCompare(b)),
      ),
    ),
  );
}
export function decodeRollcallQuery(
  value: string,
  depth = 0,
): ReturnType<typeof validateRollcallQuery> {
  if (value.length > 16000) return { ok: false, errors: ["query_too_large"] };
  try {
    return validateRollcallQuery(JSON.parse(decodeURIComponent(value)), depth);
  } catch {
    return { ok: false, errors: ["invalid_encoding"] };
  }
}
export function rollcallScope(q: RollcallQuery, lang: "bg" | "en"): string {
  const bg = lang === "bg";
  const names: Record<RollcallCorpus, string> = bg
    ? {
        parliamentSessions: "Парламентарни заседания",
        parliamentVotes: "Парламентарни гласувания",
        parliamentCasts: "Поименни парламентарни гласове",
        councilSessions: "Групи от индексирани решения по заседание",
        councilResolutions: "Решения на общински съвет",
        councilCasts: "Публикувани поименни гласове на съветници",
      }
    : {
        parliamentSessions: "Parliament sittings",
        parliamentVotes: "Parliament votes",
        parliamentCasts: "Named parliamentary casts",
        councilSessions: "Indexed resolutions grouped by sitting",
        councilResolutions: "Council resolutions",
        councilCasts: "Published councillor casts",
      };
  return [
    names[q.corpus],
    q.assemblyIds?.join(", "),
    q.councilIds?.join(", "),
    q.from
      ? `${q.from} ≤ ${bg ? "дата" : "date"} < ${q.toExclusive}`
      : bg
        ? "Всички индексирани дати"
        : "All indexed dates",
    q.seatIds?.join(", "),
    q.councilCastKeys?.join(", "),
    q.topicIds
      ?.map((t) => ROLLCALL_TOPICS[t as keyof typeof ROLLCALL_TOPICS][lang])
      .join(", "),
    q.keyword,
    q.corpus.startsWith("council")
      ? bg
        ? "Индексирани решения и публикувани гласове"
        : "Indexed resolutions and published casts"
      : q.basis === "standing"
        ? bg
          ? "Без заменените прегласувания"
          : "Standing decisions"
        : bg
          ? "Всички записани опити"
          : "All recorded attempts",
    q.latestN ? `${bg ? "Последни" : "Latest"} ${q.latestN}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
