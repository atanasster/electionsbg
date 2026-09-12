import {
  validateRollcallQuery,
  encodeRollcallQuery,
  ROLLCALL_TOPICS,
  type RollcallArgs,
  type RollcallCorpus,
} from "../../rollcallQuery";
import type { QuestionDefinition } from "../types";
export const ROLLCALL_TEMPLATES: {
  id: string;
  bg: string;
  en: string;
  corpus: RollcallCorpus;
}[] = [
  {
    id: "S01",
    bg: "Покажи ми последните заседания на парламента.",
    en: "Show me the latest parliament sittings.",
    corpus: "parliamentSessions",
  },
  {
    id: "S02",
    bg: "Покажи ми последните гласувания в парламента.",
    en: "Show me the latest votes in parliament.",
    corpus: "parliamentVotes",
  },
  {
    id: "S03",
    bg: "Покажи заседанията на {assembly}-ото НС от {from} до {to}.",
    en: "Show sittings of Assembly {assembly} from {from} to {to}.",
    corpus: "parliamentSessions",
  },
  {
    id: "S04",
    bg: "Какви гласувания има на {date} в {assembly}-ото НС?",
    en: "What votes were recorded on {date} in Assembly {assembly}?",
    corpus: "parliamentVotes",
  },
  {
    id: "S05",
    bg: "Кои са последните 10 гласувания на {person}?",
    en: "What are {person}'s last 10 votes?",
    corpus: "parliamentCasts",
  },
  {
    id: "S06",
    bg: "Как гласува {person} по {topic} от {from} до {to}?",
    en: "How did {person} vote on {topic} from {from} to {to}?",
    corpus: "parliamentCasts",
  },
  {
    id: "S07",
    bg: "Покажи гласуванията за здравеопазване през {year}.",
    en: "Show parliamentary votes on healthcare in {year}.",
    corpus: "parliamentVotes",
  },
  {
    id: "S08",
    bg: "Покажи гласуванията за бюджета от 04/2025 до 01/2026.",
    en: "Show parliamentary votes on the budget from 04/2025 to 01/2026.",
    corpus: "parliamentVotes",
  },
  {
    id: "S09",
    bg: "Кой гласува против по {vote}?",
    en: "Who voted against on {vote}?",
    corpus: "parliamentCasts",
  },
  {
    id: "S10",
    bg: "Покажи поименния вот и първоизточника за {vote}.",
    en: "Show the named roll and primary source for {vote}.",
    corpus: "parliamentCasts",
  },
  {
    id: "S11",
    bg: "Имало ли е прегласуване на {vote}?",
    en: "Was {vote} voted on again?",
    corpus: "parliamentVotes",
  },
  {
    id: "S12",
    bg: "Кои са най-оспорваните гласувания в {assembly} през {year}?",
    en: "Which votes were most contested in Assembly {assembly} during {year}?",
    corpus: "parliamentVotes",
  },
  {
    id: "S13",
    bg: "Какъв е делът на записаните гласове „за“ на {person} през {year}?",
    en: "What share of {person}'s recorded votes were for in {year}?",
    corpus: "parliamentCasts",
  },
  {
    id: "S14",
    bg: "Колко често {personA} и {personB} гласуват еднакво по {topic}?",
    en: "How often do {personA} and {personB} vote alike on {topic}?",
    corpus: "parliamentCasts",
  },
  {
    id: "S15",
    bg: "Как гласува групата {party} по {topic} през {year}?",
    en: "How did faction {party} vote on {topic} in {year}?",
    corpus: "parliamentCasts",
  },
  {
    id: "S16",
    bg: "За кои периоди имате поименни парламентарни гласувания?",
    en: "Which periods have indexed parliamentary roll calls?",
    corpus: "parliamentVotes",
  },
  {
    id: "S17",
    bg: "Покажи последните решения на общинския съвет в {municipality}.",
    en: "Show the latest council resolutions in {municipality}.",
    corpus: "councilResolutions",
  },
  {
    id: "S18",
    bg: "Покажи заседанията на общинския съвет в {municipality} през {year}.",
    en: "Show indexed council sittings in {municipality} during {year}.",
    corpus: "councilSessions",
  },
  {
    id: "S19",
    bg: "Какво реши общинският съвет в {municipality} за {topic} от {from} до {to}?",
    en: "What did the council in {municipality} decide on {topic} from {from} to {to}?",
    corpus: "councilResolutions",
  },
  {
    id: "S20",
    bg: "Кои са последните поименни гласувания на {councillor} в {municipality}?",
    en: "What are {councillor}'s latest named votes in {municipality}?",
    corpus: "councilCasts",
  },
  {
    id: "S21",
    bg: "Как гласува {councillor} по бюджета на {municipality} през {year}?",
    en: "How did {councillor} vote on {municipality}'s budget in {year}?",
    corpus: "councilCasts",
  },
  {
    id: "S22",
    bg: "Кои съветници гласуваха против решение {resolution}?",
    en: "Which councillors voted against resolution {resolution}?",
    corpus: "councilCasts",
  },
  {
    id: "S23",
    bg: "Покажи решенията за градоустройство в {municipality} през {year}.",
    en: "Show urban-planning resolutions in {municipality} in {year}.",
    corpus: "councilResolutions",
  },
  {
    id: "S24",
    bg: "Покажи приетите решения с поименен вот в {municipality}.",
    en: "Show adopted resolutions with named votes in {municipality}.",
    corpus: "councilResolutions",
  },
  {
    id: "S25",
    bg: "Кои решения в {municipality} нямат публикуван поименен вот?",
    en: "Which resolutions in {municipality} have no published named roll?",
    corpus: "councilResolutions",
  },
  {
    id: "S26",
    bg: "Покажи оригиналния протокол за решение {resolution}.",
    en: "Show the original protocol for resolution {resolution}.",
    corpus: "councilResolutions",
  },
  {
    id: "S27",
    bg: "Сравни решенията за {topic} през {yearA} и {yearB} в {municipality}.",
    en: "Compare {topic} resolutions in {municipality} during {yearA} and {yearB}.",
    corpus: "councilResolutions",
  },
  {
    id: "S28",
    bg: "За кои общини имате решения и поименни гласувания?",
    en: "Which municipalities have indexed resolutions and named votes?",
    corpus: "councilResolutions",
  },
];
const defaults: Record<string, unknown> = { year: 2026 };
const labels: Record<string, [string, string]> = {
  person: ["Име на депутат", "MP name"],
  councillor: ["Име в поименния вот", "Name in the published roll"],
  personA: ["Първи депутат", "First MP"],
  personB: ["Втори депутат", "Second MP"],
  assembly: ["Номер на Народното събрание", "Assembly number"],
  municipality: ["Община", "Municipality"],
  topic: ["Тема или изходни думи", "Topic or source words"],
  from: ["Начална дата", "Start date"],
  to: ["Крайна дата (включително)", "End date (inclusive)"],
  date: ["Дата", "Date"],
  year: ["Година", "Year"],
  yearA: ["Първа година", "First year"],
  yearB: ["Втора година", "Second year"],
  vote: [
    "Ключ на гласуване (НС:дата:номер)",
    "Vote key (assembly:date:number)",
  ],
  resolution: ["Ключ на решение", "Resolution key"],
  party: ["Наименование на групата в източника", "Source faction name"],
};
const fields = (t: { bg: string; en: string }) => [
  ...new Set([...t.bg.matchAll(/\{(\w+)\}/g)].map((m) => m[1])),
];
export function rollcallTemplate(
  id: string,
  lang: "bg" | "en",
  values: Record<string, unknown> = {},
) {
  const t = ROLLCALL_TEMPLATES.find((t) => "rollcall-query-" + t.id === id);
  if (!t) throw Error("Unknown rollcall template");
  const defaultsFor = Object.fromEntries(
    fields(t).flatMap((k) =>
      k === "person" && t.id === "S05"
        ? [[k, lang === "bg" ? "Бойко Рашков" : "Boyko Rashkov"]]
        : defaults[k] !== undefined
          ? [[k, defaults[k]]]
          : [],
    ),
  );
  const params = { ...defaultsFor, ...values };
  const text = t[lang].replace(/\{(\w+)\}/g, (_, k) =>
    String(params[k] ?? `{${k}}`),
  );
  return {
    text,
    tool: "rollcallQuestion",
    args: { question: text, corpus: t.corpus },
  };
}
export function matchRollcallTemplate(text: string): {
  draft: RollcallArgs;
  names: string[];
  municipality?: string;
  missing?: string;
} | null {
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const t of ROLLCALL_TEMPLATES)
    for (const lang of ["bg", "en"] as const) {
      const keys: string[] = [];
      let pattern = "";
      let cursor = 0;
      for (const m of t[lang].matchAll(/\{(\w+)\}/g)) {
        pattern += escape(t[lang].slice(cursor, m.index));
        pattern += "(.+?)";
        keys.push(m[1]);
        cursor = m.index! + m[0].length;
      }
      pattern += escape(t[lang].slice(cursor));
      const hit = text
        .trim()
        .match(new RegExp("^" + pattern.replace(/\\\.$/, "[.!?]?") + "$", "i"));
      if (!hit) continue;
      const values = Object.fromEntries(
        keys.map((k, i) => [k, hit[i + 1].trim()]),
      );
      const q: RollcallArgs = { corpus: t.corpus };
      const names = [
        values.person,
        values.personA,
        values.personB,
        values.councillor,
      ].filter(Boolean);
      if (Object.values(values).some((v) => /^\{\w+\}$/.test(v)))
        return { draft: q, names: [], missing: "scope" };
      if (values.assembly) q.assemblyIds = [values.assembly];
      for (const [field, a, b] of [
        ["year", "from", "toExclusive"],
        ["yearA", "from", "toExclusive"],
        ["yearB", "compareFrom", "compareToExclusive"],
      ] as const)
        if (values[field]) {
          if (!/^20\d{2}$/.test(values[field]))
            return { draft: q, names, missing: "dates" };
          q[a] = values[field] + "-01-01";
          q[b] = String(+values[field] + 1) + "-01-01";
        }
      if (values.from || values.date) q.from = values.from || values.date;
      if (values.to || values.date) {
        const raw = values.to || values.date;
        const date = new Date(raw + "T00:00:00Z");
        if (!Number.isFinite(+date) || date.toISOString().slice(0, 10) !== raw)
          return { draft: q, names, missing: "dates" };
        q.toExclusive = new Date(+date + 86400000).toISOString().slice(0, 10);
      }
      if (values.topic) {
        const mapped = Object.entries(ROLLCALL_TOPICS).find(([id, topic]) =>
          [id, topic.bg.toLowerCase(), topic.en.toLowerCase()].includes(
            values.topic.toLowerCase(),
          ),
        );
        if (mapped) q.topicIds = [mapped[0]];
        else q.keyword = values.topic;
      }
      if (values.party) q.factionIds = [values.party];
      if (t.id === "S05") q.latestN = 10;
      if (t.id === "S07") q.topicIds = ["health"];
      if (t.id === "S08") {
        q.topicIds = ["budget"];
        q.from = "2025-04-01";
        q.toExclusive = "2026-02-01";
      }
      if (t.id === "S12") {
        q.metric = "contested";
        q.operation = "rank";
      }
      if (t.id === "S13") {
        q.metric = "choiceShare";
        q.choice = "for";
        q.operation = "share";
      }
      if (t.id === "S14") q.metric = "agreement";
      if (["S16", "S28"].includes(t.id)) q.operation = "methodology";
      if (t.id === "S21") q.topicIds = ["budget"];
      if (t.id === "S23") q.topicIds = ["urban_planning"];
      if (t.id === "S24") {
        q.outcome = "adopted";
        q.named = "yes";
      }
      if (t.id === "S25") q.named = "no";
      if (t.id === "S27") q.operation = "compare";
      if (values.vote && !/^\d{1,2}:\d{4}-\d{2}-\d{2}:\d+$/.test(values.vote))
        return { draft: q, names, missing: "record" };
      if (values.vote || values.resolution) {
        const key = values.vote || values.resolution;
        const parentCorpus = values.vote
          ? "parliamentVotes"
          : "councilResolutions";
        if (["S09", "S10", "S22"].includes(t.id)) {
          const p = validateRollcallQuery({
            corpus: parentCorpus,
            operation: "detail",
            key,
          });
          if (!p.ok) return { draft: q, names, missing: "record" };
          q.parentQuery = encodeRollcallQuery(p.query);
          q.relationship = "voteCasts";
          if (t.id !== "S10") q.choice = "against";
        } else {
          q.key = key;
          q.operation = "detail";
          q.basis = "attempts";
        }
      }
      return { draft: q, names, municipality: values.municipality };
    }
  return null;
}
export const ROLLCALL_QUESTIONS: QuestionDefinition[] = ROLLCALL_TEMPLATES.map(
  (t) => ({
    id: "rollcall-query-" + t.id,
    categoryId: "institutions",
    subcategoryId: t.corpus.startsWith("council")
      ? t.corpus === "councilCasts"
        ? "councillor-votes"
        : "council-records"
      : t.corpus === "parliamentCasts"
        ? "member-votes"
        : "parliament-records",
    question: { bg: t.bg, en: t.en },
    aliases: {},
    parameters: fields(t).map((id) => ({
      id,
      kind: (["from", "to", "date"].includes(id)
        ? "date"
        : id.startsWith("year")
          ? "year"
          : id === "assembly"
            ? "number"
            : "string") as "date" | "year" | "number" | "string",
      required: true,
      label: { bg: labels[id][0], en: labels[id][1] },
      ...(id.startsWith("year")
        ? { min: 2000, max: 2100 }
        : id === "assembly"
          ? { min: 1, max: 99 }
          : {}),
    })),
    defaults: Object.fromEntries(
      fields(t).flatMap((k) =>
        k === "person" && t.id === "S05"
          ? [[k, "Бойко Рашков"]]
          : defaults[k] !== undefined
            ? [[k, defaults[k]]]
            : [],
      ),
    ),
    chat: { status: "ready", capabilityId: "rollcallQuestion", version: 1 },
    sql: { status: "unavailable" },
    sourceIds: ["db:rollcall-query"],
  }),
);
