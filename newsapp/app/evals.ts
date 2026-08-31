import { useEffect, useState } from "react";
import { useData, type Leaning, type RussiaStance, type Tone } from "./data";

export const EVAL_LEANING_VALUES: Leaning[] = [
  "strong_progressive",
  "progressive",
  "neutral",
  "conservative",
  "strong_conservative",
  "not_applicable",
];
export const EVAL_RUSSIA_VALUES: RussiaStance[] = [
  "strong_pro_russia",
  "pro_russia",
  "neutral",
  "anti_russia",
  "strong_anti_russia",
  "not_applicable",
];
export const EVAL_TONE_VALUES: Tone[] = [
  "favorable",
  "unfavorable",
  "neutral",
  "mixed",
];

export interface EvalPartyTone {
  party: string;
  party_id: string | null;
  tone: Tone;
}

export interface EvalTask {
  article_key: string;
  domain: string;
  article_id: string;
  url: string;
  title: string;
  published: string | null;
  story_id: string | null;
  primary_topic: string | null;
  outlet: string;
  content_sha256: string;
  analysis_sha256: string;
  model_labels: {
    leaning: Leaning;
    russia_stance: RussiaStance;
    party_tones: EvalPartyTone[];
  };
  review_fields: string[];
  dataset_ids: string[];
  task_revision: number;
}

export interface EvalQueue {
  schema_version: 1;
  generated_at: string;
  public_data_revision: string;
  rubric_version: "news-article-evaluation-v1";
  task_count: number;
  tasks_sha256: string;
  tasks: EvalTask[];
}

const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const ISO_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const QUEUE_FIELDS = [
  "schema_version",
  "generated_at",
  "public_data_revision",
  "rubric_version",
  "task_count",
  "tasks_sha256",
  "tasks",
] as const;
const TASK_FIELDS = [
  "article_key",
  "domain",
  "article_id",
  "url",
  "title",
  "published",
  "story_id",
  "primary_topic",
  "outlet",
  "content_sha256",
  "analysis_sha256",
  "model_labels",
  "review_fields",
  "dataset_ids",
  "task_revision",
] as const;
const LABEL_FIELDS = ["leaning", "russia_stance", "party_tones"] as const;
const PARTY_FIELDS = ["party", "party_id", "tone"] as const;

const exactFields = (
  value: Record<string, unknown>,
  fields: readonly string[],
): boolean => {
  const keys = Object.keys(value);
  return (
    keys.length === fields.length && keys.every((key) => fields.includes(key))
  );
};

const boundedText = (value: unknown, maximum: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= maximum;

const boundedStringList = (
  value: unknown,
  maximumItems: number,
  maximumLength: number,
): value is string[] =>
  Array.isArray(value) &&
  value.length <= maximumItems &&
  value.every((item) => boundedText(item, maximumLength)) &&
  new Set(value).size === value.length;

const normalizedTimestamp = (value: unknown): string | null => {
  if (typeof value !== "string" || !ISO_INSTANT.test(value)) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds)
    ? new Date(milliseconds).toISOString()
    : null;
};

const compareCodePoints = (left: string, right: string): number => {
  const a = [...left];
  const b = [...right];
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const difference = a[index]!.codePointAt(0)! - b[index]!.codePointAt(0)!;
    if (difference) return difference;
  }
  return a.length - b.length;
};

const requireUnicodeScalars = (value: string): void => {
  for (const character of value) {
    const point = character.codePointAt(0)!;
    if (point >= 0xd800 && point <= 0xdfff) {
      throw new Error("Невалиден Unicode низ в публичната опашка");
    }
  }
};

const canonicalJson = (value: unknown): string => {
  if (typeof value === "string") {
    requireUnicodeScalars(value);
    return JSON.stringify(value);
  }
  if (value === null || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
      throw new Error("Невалидно число в публичната опашка");
    }
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = object(value);
  if (!record) throw new Error("Неканонична стойност в публичната опашка");
  const keys = Object.keys(record);
  keys.forEach(requireUnicodeScalars);
  return `{${keys
    .sort(compareCodePoints)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
};

export const canonicalEvalSha256 = async (value: unknown): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalJson(value)),
  );
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
};

export const parseEvalQueue = async (value: unknown): Promise<EvalQueue> => {
  const queue = object(value);
  const tasks = queue?.tasks;
  const generatedAt = normalizedTimestamp(queue?.generated_at);
  const publicRevision = normalizedTimestamp(queue?.public_data_revision);
  if (
    !queue ||
    !exactFields(queue, QUEUE_FIELDS) ||
    queue.schema_version !== 1 ||
    queue.rubric_version !== "news-article-evaluation-v1" ||
    !generatedAt ||
    generatedAt !== publicRevision ||
    !Array.isArray(tasks) ||
    tasks.length > 200 ||
    queue.task_count !== tasks.length ||
    typeof queue.tasks_sha256 !== "string" ||
    !SHA256.test(queue.tasks_sha256)
  ) {
    throw new Error("Невалиден договор на публичната опашка за оценяване");
  }

  const seen = new Set<string>();
  const parsed = tasks.map((raw, index): EvalTask => {
    const task = object(raw);
    const labels = object(task?.model_labels);
    const parties = labels?.party_tones;
    const reviewFields = boundedStringList(task?.review_fields, 10, 64)
      ? task.review_fields
      : null;
    const datasetIds = boundedStringList(task?.dataset_ids, 50, 128)
      ? task.dataset_ids
      : null;
    let taskUrl: URL | null = null;
    try {
      taskUrl = new URL(String(task?.url ?? ""));
    } catch {
      taskUrl = null;
    }
    if (
      !task ||
      !exactFields(task, TASK_FIELDS) ||
      !boundedText(task.domain, 253) ||
      /[/\\]/.test(task.domain) ||
      task.domain.includes("..") ||
      !boundedText(task.article_id, 255) ||
      /[/\\]/.test(task.article_id) ||
      task.article_id.includes("..") ||
      task.article_key !== `${task.domain}/${task.article_id}` ||
      !boundedText(task.url, 2048) ||
      taskUrl?.protocol !== "https:" ||
      Boolean(taskUrl.username || taskUrl.password) ||
      !boundedText(task.title, 500) ||
      !task.title.trim() ||
      (task.published !== null &&
        (!boundedText(task.published, 80) ||
          !normalizedTimestamp(task.published))) ||
      (task.story_id !== null && !boundedText(task.story_id, 160)) ||
      (task.primary_topic !== null && !boundedText(task.primary_topic, 128)) ||
      !boundedText(task.outlet, 160) ||
      typeof task.content_sha256 !== "string" ||
      !SHA256.test(task.content_sha256) ||
      typeof task.analysis_sha256 !== "string" ||
      !SHA256.test(task.analysis_sha256) ||
      !labels ||
      !exactFields(labels, LABEL_FIELDS) ||
      !EVAL_LEANING_VALUES.includes(labels.leaning as Leaning) ||
      !EVAL_RUSSIA_VALUES.includes(labels.russia_stance as RussiaStance) ||
      !Array.isArray(parties) ||
      !reviewFields ||
      !datasetIds ||
      !Number.isSafeInteger(task.task_revision) ||
      Number(task.task_revision) < 1
    ) {
      throw new Error(`Невалидна задача ${index + 1} в опашката за оценяване`);
    }
    const partyIdentities = new Set<string>();
    if (parties.length > 30) {
      throw new Error(`Твърде много партии в задача ${index + 1}`);
    }
    const partyTones = parties.map((rawParty, partyIndex): EvalPartyTone => {
      const party = object(rawParty);
      if (
        !party ||
        !exactFields(party, PARTY_FIELDS) ||
        !boundedText(party.party, 160) ||
        !party.party.trim() ||
        (party.party_id !== null &&
          (!boundedText(party.party_id, 160) || !party.party_id.trim())) ||
        !EVAL_TONE_VALUES.includes(party.tone as Tone)
      ) {
        throw new Error(
          `Невалидна партия ${partyIndex + 1} в задача ${index + 1}`,
        );
      }
      const identity = party.party_id
        ? `id:${party.party_id}`
        : `surface:${party.party.toLocaleLowerCase("bg")}`;
      if (partyIdentities.has(identity)) {
        throw new Error(`Повторена партия в задача ${index + 1}`);
      }
      partyIdentities.add(identity);
      return {
        party: party.party,
        party_id: party.party_id as string | null,
        tone: party.tone as Tone,
      };
    });
    if (seen.has(task.article_key as string)) {
      throw new Error("Повторена задача в публичната опашка за оценяване");
    }
    seen.add(task.article_key as string);
    return {
      article_key: task.article_key as string,
      domain: task.domain,
      article_id: task.article_id,
      url: task.url,
      title: task.title,
      published: task.published as string | null,
      story_id: task.story_id as string | null,
      primary_topic: task.primary_topic as string | null,
      outlet: task.outlet,
      content_sha256: task.content_sha256,
      analysis_sha256: task.analysis_sha256,
      model_labels: {
        leaning: labels.leaning as Leaning,
        russia_stance: labels.russia_stance as RussiaStance,
        party_tones: partyTones,
      },
      review_fields: reviewFields,
      dataset_ids: datasetIds,
      task_revision: task.task_revision as number,
    };
  });

  if (queue.tasks_sha256 !== (await canonicalEvalSha256(parsed))) {
    throw new Error("Хешът на публичната опашка не съвпада");
  }
  return {
    schema_version: 1,
    generated_at: generatedAt,
    public_data_revision: publicRevision,
    rubric_version: "news-article-evaluation-v1",
    task_count: parsed.length,
    tasks_sha256: queue.tasks_sha256,
    tasks: parsed,
  };
};

export const useEvalQueue = () => {
  const state = useData<unknown>("/evals/queue.json");
  const [parsed, setParsed] = useState<{
    source: unknown;
    data: EvalQueue | null;
    error: Error | null;
  }>({ source: null, data: null, error: null });
  useEffect(() => {
    if (!state.data) return;
    const source = state.data;
    let current = true;
    void parseEvalQueue(source).then(
      (data) => {
        if (current) setParsed({ source, data, error: null });
      },
      (error: unknown) => {
        if (current) {
          setParsed({
            source,
            data: null,
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      },
    );
    return () => {
      current = false;
    };
  }, [state.data]);
  if (!state.data) return { ...state, data: null as EvalQueue | null };
  if (parsed.source !== state.data) {
    return {
      ...state,
      data: null as EvalQueue | null,
      error: null,
      loading: true,
    };
  }
  if (parsed.error) {
    return {
      ...state,
      data: null as EvalQueue | null,
      error: parsed.error,
      loading: false,
    };
  }
  return { ...state, data: parsed.data };
};

export type EvalPartyFilter = "all" | "with_party" | "without_party";
export type EvalDateFilter = "all" | "7" | "30" | "365";
export interface EvalFilters {
  leaning: Leaning | "all";
  russia: RussiaStance | "all";
  party: EvalPartyFilter;
  outlet: string;
  topic: string;
  dataset: string;
  reviewField: string;
  date: EvalDateFilter;
}

export const DEFAULT_EVAL_FILTERS: EvalFilters = {
  leaning: "all",
  russia: "all",
  party: "all",
  outlet: "all",
  topic: "all",
  dataset: "all",
  reviewField: "all",
  date: "all",
};

export const filterEvalTasks = (
  tasks: EvalTask[],
  filters: EvalFilters,
  now = Date.now(),
): EvalTask[] => {
  const cutoff =
    filters.date === "all"
      ? null
      : now - Number(filters.date) * 24 * 60 * 60 * 1_000;
  return tasks.filter((task) => {
    const partyCount = task.model_labels.party_tones.length;
    const published = task.published ? Date.parse(task.published) : NaN;
    return (
      (filters.leaning === "all" ||
        task.model_labels.leaning === filters.leaning) &&
      (filters.russia === "all" ||
        task.model_labels.russia_stance === filters.russia) &&
      (filters.party === "all" ||
        (filters.party === "with_party" ? partyCount > 0 : partyCount === 0)) &&
      (filters.outlet === "all" || task.outlet === filters.outlet) &&
      (filters.topic === "all" || task.primary_topic === filters.topic) &&
      (filters.dataset === "all" ||
        task.dataset_ids.includes(filters.dataset)) &&
      (filters.reviewField === "all" ||
        task.review_fields.includes(filters.reviewField)) &&
      (cutoff === null || (Number.isFinite(published) && published >= cutoff))
    );
  });
};

const strong = (task: EvalTask): boolean =>
  task.model_labels.leaning.startsWith("strong_") ||
  task.model_labels.russia_stance.startsWith("strong_");

export const orderEvalTasks = (tasks: EvalTask[]): EvalTask[] =>
  [...tasks].sort((left, right) => {
    const leftPriority =
      Number(left.review_fields.length > 0) * 4 +
      Number(strong(left)) * 2 +
      Number(left.model_labels.party_tones.length > 0);
    const rightPriority =
      Number(right.review_fields.length > 0) * 4 +
      Number(strong(right)) * 2 +
      Number(right.model_labels.party_tones.length > 0);
    if (leftPriority !== rightPriority) return rightPriority - leftPriority;
    const byDate =
      (right.published ? Date.parse(right.published) : -Infinity) -
      (left.published ? Date.parse(left.published) : -Infinity);
    if (byDate) return byDate;
    return left.article_key < right.article_key
      ? -1
      : left.article_key > right.article_key
        ? 1
        : 0;
  });

export const pickRandomEvalTask = (
  tasks: EvalTask[],
  unit = Math.random(),
): EvalTask | null => {
  if (!tasks.length) return null;
  const bounded = Math.max(0, Math.min(unit, 0.999999999999));
  return tasks[Math.floor(bounded * tasks.length)] ?? null;
};

export const evalTaskPath = (task: EvalTask): string =>
  `/evals/article/${encodeURIComponent(task.domain)}/${encodeURIComponent(task.article_id)}`;
