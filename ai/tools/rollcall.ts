import {
  rollcallDisplayRow,
  rollcallDisplayScope,
  rollcallColumn,
  rollcallDateLabel,
} from "../../src/lib/rollcallPresentation";
import {
  validateRollcallQuery,
  decodeRollcallQuery,
  encodeRollcallQuery,
  type RollcallQuery,
} from "../../src/lib/rollcallQuery";
import {
  understandRollcall,
  type RollcallCatalog,
} from "../orchestrator/rollcallUnderstanding";
import { fetchDb } from "./dataClient";
import type { Envelope, ToolDef, ToolArgs, ToolContext, Row } from "./types";
export type RollcallResult = {
  status: string;
  reason?: string;
  query?: RollcallQuery;
  revision?: string;
  rows?: Row[];
  groups?: Row[];
  groupCount?: number;
  totals?: { records: number; cohortRecords: number };
  metrics?: Record<string, string | number | null>;
  coverage?: Record<string, unknown>;
  comparisons?: RollcallResult[];
};
export function rollcallMessage(
  reason: string | undefined,
  lang: "bg" | "en",
): string {
  const messages: Record<string, [string, string]> = {
    source_year_only: [
      "Източникът съдържа само година. Изберете годишен обхват за решенията.",
      "The source supplies only a year. Use an annual resolution scope.",
    ],
    named_roll_not_published: [
      "Не е публикуван поименен вот за избрания обхват.",
      "No named roll is published for this scope.",
    ],
    revision_changed: [
      "Данните са обновени. Обновете справката, за да продължите.",
      "The data changed. Refresh this query to continue.",
    ],
    scope_not_indexed: [
      "Няма индексирани данни за този обхват.",
      "This scope has no indexed coverage.",
    ],
    record: [
      "Изберете конкретно гласуване или заседание от показаните записи.",
      "Choose a specific vote or sitting from the displayed records.",
    ],
    record_not_found: ["Записът не е намерен.", "The record was not found."],
    dates: [
      "Уточнете валиден период с начална и крайна дата.",
      "Specify a valid start and end date.",
    ],
    council: ["Изберете общински съвет.", "Choose a municipal council."],
    scope: [
      "Уточнете въпроса, лицето, периода или записа.",
      "Clarify the question, person, period or record.",
    ],
  };
  return (messages[reason || ""] || [
    "Справката не може да се изпълни с този обхват. Опитайте отново или уточнете параметрите.",
    "This scope could not be executed. Retry or clarify its parameters.",
  ])[lang === "bg" ? 0 : 1];
}
const primitive = (r: Record<string, unknown>): Row =>
  Object.fromEntries(
    Object.entries(r).filter(
      ([, v]) => v === null || ["string", "number"].includes(typeof v),
    ),
  ) as Row;
function failed(reason: string, ctx: ToolContext): Envelope {
  const answer = rollcallMessage(reason, ctx.lang);
  return {
    tool: "rollcallQuestion",
    kind: "scalar",
    title: answer,
    viz: "none",
    facts: { answer, status: "unsupported" },
    provenance: [],
  };
}
export async function rollcallQuery(
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> {
  const parsed =
    typeof args.query === "string"
      ? decodeRollcallQuery(args.query)
      : validateRollcallQuery(args);
  if (!parsed.ok) return failed("scope", ctx);
  const q = parsed.query;
  let result: RollcallResult;
  const coverageRegister =
    q.operation === "methodology" &&
    q.metric === "records" &&
    !q.from &&
    !q.key &&
    !q.parentQuery &&
    !q.sessionKey &&
    !q.seatIds &&
    !q.councilCastKeys &&
    !q.factionIds &&
    !q.topicIds &&
    !q.keyword &&
    !q.choice &&
    !q.outcome &&
    !q.named &&
    !q.tallyMethod &&
    !q.latestN &&
    !q.groupBy;
  try {
    if (coverageRegister) {
      const cap = await fetchDb<{
        assemblies?: Record<string, unknown>[];
        councils?: Record<string, unknown>[];
        revision?: string;
      }>("rollcall-capabilities", {});
      const rows = (
        q.corpus.startsWith("council")
          ? cap.councils || []
          : cap.assemblies || []
      )
        .filter(
          (r) =>
            !(q.councilIds || q.assemblyIds) ||
            (q.councilIds || q.assemblyIds)!.includes(String(r.id)),
        )
        .map((r) =>
          primitive({
            ...r,
            ...(r.year_only
              ? {
                  first: String(r.first ?? "").slice(0, 4),
                  latest: String(r.latest ?? "").slice(0, 4),
                  precision: ctx.lang === "bg" ? "Само година" : "Year only",
                }
              : {}),
            name: r.name || `${r.id} ${ctx.lang === "bg" ? "НС" : "Assembly"}`,
            records: r.resolutions ?? r.sessions,
          }),
        );
      result = {
        status:
          q.expectedRevision && q.expectedRevision !== cap.revision
            ? "stale"
            : rows.length
              ? "success"
              : "unavailable",
        ...(q.expectedRevision && q.expectedRevision !== cap.revision
          ? { reason: "revision_changed" }
          : {}),
        query: q,
        rows,
        totals: { records: rows.length, cohortRecords: rows.length },
        revision: cap.revision,
        coverage: {},
      };
    } else
      result = await fetchDb<RollcallResult>("rollcall-query", {
        query: JSON.stringify(q),
      });
  } catch {
    return failed("unavailable", ctx);
  }
  const applied = result.query ? validateRollcallQuery(result.query) : null;
  if (applied && !applied.ok) return failed("scope", ctx);
  const query = applied?.ok ? applied.query : q;
  // Only a backend-selected implicit assembly may differ from the requested scope.
  const expected = {
    ...q,
    ...(!q.assemblyIds &&
    !q.from &&
    !q.seatIds &&
    !q.key &&
    !q.sessionKey &&
    !q.parentQuery &&
    query.assemblyIds
      ? { assemblyIds: query.assemblyIds }
      : {}),
  };
  if (encodeRollcallQuery(expected) !== encodeRollcallQuery(query))
    return failed("scope", ctx);
  const bg = ctx.lang === "bg",
    scope = rollcallDisplayScope(query, ctx.lang, result.rows),
    available = ["success", "partial", "empty"].includes(result.status);
  const value = result.metrics?.percentage;
  const answer = available
    ? `${value !== undefined ? (value === null ? (bg ? "Неизчислим дял" : "Unknown share") : `${Number(value).toLocaleString(bg ? "bg-BG" : "en-GB", { maximumFractionDigits: 2 })}%`) : `${result.totals?.records ?? 0} ${coverageRegister ? (bg ? "органа в регистъра за покритие" : "bodies in the coverage register") : bg ? "индексирани записа" : "indexed records"}`}${result.status === "partial" ? (bg ? " · Непълно покритие" : " · Partial coverage") : ""}`
    : rollcallMessage(result.reason, ctx.lang);
  const rows = (query.groupBy ? result.groups || [] : result.rows || []).map(
    (r) => rollcallDisplayRow(r, ctx.lang),
  );
  return {
    tool: "rollcallQuery",
    domain: "people",
    kind: rows.length ? "table" : "scalar",
    title: scope,
    subtitle: scope,
    viz: "none",
    facts: {
      answer,
      status: result.status,
      scope,
      ...(result.metrics ? primitive(result.metrics) : {}),
      latestIndexed: rollcallDateLabel(
        result.coverage?.latestIndexed,
        result.coverage?.yearOnly,
      ),
      ...(args.notice === "record_scope_cleared"
        ? {
            scope_changes: bg
              ? "Периодът е променен; изчистен е несъвместимият конкретен запис или заседание."
              : "Period changed; incompatible record or sitting focus cleared.",
          }
        : {}),
      coverage_note: bg
        ? "Последни индексирани записи. Темите се търсят в изходните заглавия; липсващ вот не означава вот против."
        : "Latest indexed records. Topics match source titles; a missing cast does not mean against.",
    },
    rows,
    columns: Object.keys(rows[0] || {})
      .filter((k) =>
        [
          "date",
          "title",
          "name",
          "choice",
          "faction",
          "records",
          "key",
          "percentage",
          "item_count",
          "yes",
          "no",
          "abstain",
          "outcome",
          "revote",
          "first",
          "latest",
          "named",
          "precision",
        ].includes(k),
      )
      .map((key) => ({ key, label: rollcallColumn(key, ctx.lang) })),
    provenance: ["db:rollcall-query"],
    rollcall: { query, result },
  };
}
export async function rollcallQuestion(
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> {
  if (args.issue) return failed(String(args.issue), ctx);
  let catalog: RollcallCatalog = {};
  try {
    catalog = await fetchDb<RollcallCatalog>("rollcall-catalog", {});
  } catch {
    return failed("unavailable", ctx);
  }
  const previous =
    typeof args.previous === "string"
      ? decodeRollcallQuery(args.previous)
      : null;
  if (previous && !previous.ok) return failed("scope", ctx);
  const result = understandRollcall(String(args.question || ""), {
    catalog,
    previous: previous?.ok ? previous.query : undefined,
  });
  if (result.kind === "none") return failed("scope", ctx);
  const draft = result.draft;
  if (result.needs) {
    const env = failed(result.needs, ctx);
    if (result.needs === "council")
      env.clarify = {
        prompt: env.title,
        options: (catalog.councils || []).map((c) => ({
          label: c.name,
          tool: "rollcallQuestion",
          args: {
            question: args.question,
            previous: encodeRollcallQuery({ ...draft, councilIds: [c.id] }),
          },
        })),
      };
    return env;
  }
  let identityRevision: string | undefined = draft.expectedRevision;
  for (let i = 0; i < result.names.length; i++) {
    if (i > 1) return failed("scope", ctx);
    if (
      draft[i ? "comparatorSeatIds" : "seatIds"] &&
      String(args.resolvedNames || "").split("|")[i] === result.names[i]
    )
      continue;
    delete draft[i ? "comparatorSeatIds" : "seatIds"];
    type Candidate = { label: string; seatIds: string[]; verified: boolean };
    type Resolved = {
      candidates?: Candidate[];
      sourceRows?: {
        key: string;
        name: string;
        date: string;
        source_url: string;
      }[];
      revision?: string;
      reason?: string;
    };
    let people: Resolved;
    try {
      people = await fetchDb<Resolved>("rollcall-entities", {
        corpus: draft.corpus,
        name: result.names[i],
        ...(draft.councilIds ? { council: draft.councilIds[0] } : {}),
        ...(draft.assemblyIds?.length === 1
          ? { ns: draft.assemblyIds[0] }
          : {}),
        ...(draft.from
          ? { from: draft.from, toExclusive: draft.toExclusive! }
          : {}),
      });
    } catch {
      return failed("unavailable", ctx);
    }
    if (
      identityRevision &&
      people.revision &&
      identityRevision !== people.revision
    )
      return failed("revision_changed", ctx);
    if (people.revision) {
      identityRevision = people.revision;
      draft.expectedRevision = people.revision;
    }
    if (people.candidates?.length === 1 && people.candidates[0].verified) {
      draft[i ? "comparatorSeatIds" : "seatIds"] = people.candidates[0].seatIds;
      continue;
    }
    const env = failed("scope", ctx);
    env.clarify = {
      prompt:
        ctx.lang === "bg"
          ? "Изберете точното лице или конкретен публикуван глас."
          : "Choose the exact person or a specific published cast.",
      options:
        people.candidates?.map((c) => ({
          label: c.label,
          sublabel: c.seatIds.join(", "),
          tool: "rollcallQuestion",
          args: {
            question: args.question,
            resolvedNames: result.names.slice(0, i + 1).join("|"),
            previous: encodeRollcallQuery({
              ...draft,
              metric: "records",
              operation: "list",
              [i ? "comparatorSeatIds" : "seatIds"]: c.seatIds,
            }),
          },
        })) ||
        people.sourceRows?.map((r) => ({
          label: r.name,
          sublabel: r.date,
          tool: "rollcallQuery",
          args: {
            query: encodeRollcallQuery({ ...draft, councilCastKeys: [r.key] }),
          },
        })) ||
        [],
    };
    return env;
  }
  const env = await rollcallQuery(draft, ctx);
  if (args.notice === "body_changed")
    env.facts.scope_changes =
      ctx.lang === "bg"
        ? "Сменен орган: запазени са датите и темата; изчистени са лицата, групите и връзките към предишни записи."
        : "Body changed: dates and topic retained; people, factions and prior record relationships cleared.";
  return env;
}
export const ROLLCALL_TOOLS: ToolDef[] = [
  {
    name: "rollcallQuestion",
    domain: "people",
    description: {
      bg: "Разпознава целия въпрос за парламентарни и общински гласувания, лице, период и тема.",
      en: "Resolves a complete parliament or council roll-call question, person, period and topic.",
    },
    params: [
      {
        name: "question",
        type: "text",
        required: true,
        description: { bg: "Целият въпрос", en: "Complete question" },
      },
      {
        name: "previous",
        type: "text",
        description: {
          bg: "Кодиран предишен обхват",
          en: "Encoded previous scope",
        },
      },
      {
        name: "issue",
        type: "text",
        description: {
          bg: "Необходимо уточнение",
          en: "Clarification required",
        },
      },
      {
        name: "notice",
        type: "text",
        description: { bg: "Промяна на обхвата", en: "Scope change" },
      },
      {
        name: "resolvedNames",
        type: "text",
        description: { bg: "Избрани имена", en: "Resolved names" },
      },
      {
        name: "corpus",
        type: "text",
        description: { bg: "Източник", en: "Corpus" },
      },
    ],
    examples: [],
    run: rollcallQuestion,
  },
  {
    name: "rollcallQuery",
    domain: "people",
    description: {
      bg: "Изпълнява проверен каноничен обхват за гласувания.",
      en: "Executes a validated canonical roll-call scope.",
    },
    params: [
      {
        name: "notice",
        type: "text",
        description: { bg: "Промяна на обхвата", en: "Scope change" },
      },
      {
        name: "query",
        type: "text",
        required: true,
        description: {
          bg: "Кодиран каноничен обхват",
          en: "Encoded canonical query",
        },
      },
    ],
    examples: [],
    run: rollcallQuery,
  },
];
