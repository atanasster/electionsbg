#!/usr/bin/env tsx
/** Dependency-free TypeScript peer of validate.py. */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type JsonObject = Record<string, unknown>;

export type FixtureResult = {
  id: string;
  schema_valid: boolean;
  semantic_valid: boolean;
  gold_eligible: boolean;
  error_codes: string[];
};

const ROOT = dirname(fileURLToPath(import.meta.url));
const SCHEMAS: Record<string, string> = {
  article_evaluation: join(ROOT, "article_evaluation.schema.json"),
  submission_request: join(ROOT, "submission_request.schema.json"),
  event: join(ROOT, "event.schema.json"),
  dataset_manifest: join(ROOT, "dataset_manifest.schema.json"),
};
const CONTRACT = object(
  JSON.parse(readFileSync(join(ROOT, "contract.json"), "utf8")),
);

function object(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function typeMatches(expected: string, value: unknown): boolean {
  if (expected === "null") return value === null;
  if (expected === "boolean") return typeof value === "boolean";
  if (expected === "object")
    return Object.keys(object(value)).length >= 0 && object(value) === value;
  if (expected === "array") return Array.isArray(value);
  if (expected === "string") return typeof value === "string";
  if (expected === "number") return isNumber(value);
  if (expected === "integer") return isNumber(value) && Number.isInteger(value);
  return false;
}

function pointer(root: JsonObject, reference: string): JsonObject {
  if (!reference.startsWith("#/")) {
    throw new Error(
      `only local JSON Schema references are supported: ${reference}`,
    );
  }
  let value: unknown = root;
  for (const raw of reference.slice(2).split("/")) {
    const key = raw.replaceAll("~1", "/").replaceAll("~0", "~");
    value = object(value)[key];
  }
  const resolved = object(value);
  if (resolved !== value) {
    throw new Error(
      `schema reference does not resolve to an object: ${reference}`,
    );
  }
  return resolved;
}

function formatMatches(name: string, value: string): boolean {
  if (name === "uri") {
    try {
      const parsed = new URL(value);
      return Boolean(parsed.protocol && parsed.host);
    } catch {
      return false;
    }
  }
  if (name === "date-time") {
    return (
      /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value))
    );
  }
  return true;
}

export function stableJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new Error("non-finite number is not canonical JSON");
    if (Number.isInteger(value) && !Number.isSafeInteger(value))
      throw new Error("integer exceeds the cross-language safe range");
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = object(value);
  const fields = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`);
  return `{${fields.join(",")}}`;
}

function equal(left: unknown, right: unknown): boolean {
  if (typeof left === "boolean" || typeof right === "boolean")
    return (
      typeof left === "boolean" && typeof right === "boolean" && left === right
    );
  if (typeof left === "number" || typeof right === "number")
    return (
      typeof left === "number" && typeof right === "number" && left === right
    );
  if (left === null || right === null) return left === null && right === null;
  if (typeof left === "string" || typeof right === "string")
    return (
      typeof left === "string" && typeof right === "string" && left === right
    );
  if (Array.isArray(left) || Array.isArray(right))
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => equal(item, right[index]))
    );
  if (
    left !== null &&
    right !== null &&
    typeof left === "object" &&
    typeof right === "object"
  ) {
    const leftRecord = object(left);
    const rightRecord = object(right);
    const keys = Object.keys(leftRecord);
    return (
      keys.length === Object.keys(rightRecord).length &&
      keys.every(
        (key) =>
          Object.hasOwn(rightRecord, key) &&
          equal(leftRecord[key], rightRecord[key]),
      )
    );
  }
  return false;
}

export function validateSchema(
  schema: JsonObject,
  value: unknown,
  root: JsonObject = schema,
  path = "$",
): string[] {
  const errors: string[] = [];
  if (typeof schema.$ref === "string") {
    errors.push(
      ...validateSchema(pointer(root, schema.$ref), value, root, path),
    );
  }
  for (const child of array(schema.allOf)) {
    errors.push(...validateSchema(object(child), value, root, path));
  }
  const anyOf = array(schema.anyOf);
  if (
    anyOf.length > 0 &&
    !anyOf.some(
      (child) => validateSchema(object(child), value, root, path).length === 0,
    )
  ) {
    errors.push(`${path}: no anyOf branch matched`);
  }
  if (
    schema.not &&
    validateSchema(object(schema.not), value, root, path).length === 0
  ) {
    errors.push(`${path}: forbidden schema matched`);
  }
  if (schema.if) {
    const branch =
      validateSchema(object(schema.if), value, root, path).length === 0
        ? "then"
        : "else";
    if (schema[branch])
      errors.push(...validateSchema(object(schema[branch]), value, root, path));
  }

  const rawType = schema.type;
  if (typeof rawType === "string" || Array.isArray(rawType)) {
    const allowed =
      typeof rawType === "string"
        ? [rawType]
        : rawType.filter((item): item is string => typeof item === "string");
    if (!allowed.some((item) => typeMatches(item, value))) {
      errors.push(`${path}: expected ${allowed.join("|")}`);
      return errors;
    }
  }
  if (Object.hasOwn(schema, "const") && !equal(value, schema.const)) {
    errors.push(`${path}: const mismatch`);
  }
  if (
    Array.isArray(schema.enum) &&
    !schema.enum.some((item) => equal(value, item))
  ) {
    errors.push(`${path}: value is outside enum`);
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const record = value as JsonObject;
    const properties = object(schema.properties);
    for (const key of array(schema.required).filter(
      (item): item is string => typeof item === "string",
    )) {
      if (!Object.hasOwn(record, key)) errors.push(`${path}.${key}: required`);
    }
    for (const [key, child] of Object.entries(properties)) {
      if (Object.hasOwn(record, key)) {
        errors.push(
          ...validateSchema(object(child), record[key], root, `${path}.${key}`),
        );
      }
    }
    const extras = Object.keys(record).filter(
      (key) => !Object.hasOwn(properties, key),
    );
    if (schema.additionalProperties === false) {
      errors.push(
        ...extras.map((key) => `${path}.${key}: additional property`),
      );
    } else if (
      schema.additionalProperties &&
      typeof schema.additionalProperties === "object"
    ) {
      for (const key of extras) {
        errors.push(
          ...validateSchema(
            object(schema.additionalProperties),
            record[key],
            root,
            `${path}.${key}`,
          ),
        );
      }
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems)
      errors.push(`${path}: too few items`);
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems)
      errors.push(`${path}: too many items`);
    if (schema.uniqueItems === true) {
      const normalized = value.map(stableJson);
      if (new Set(normalized).size !== normalized.length)
        errors.push(`${path}: duplicate items`);
    }
    if (schema.items && typeof schema.items === "object") {
      value.forEach((item, index) => {
        errors.push(
          ...validateSchema(
            object(schema.items),
            item,
            root,
            `${path}[${index}]`,
          ),
        );
      });
    }
    if (
      schema.contains &&
      typeof schema.contains === "object" &&
      !value.some(
        (item) =>
          validateSchema(object(schema.contains), item, root, `${path}[*]`)
            .length === 0,
      )
    ) {
      errors.push(`${path}: contains condition not met`);
    }
  }

  if (typeof value === "string") {
    const length = [...value].length;
    if (typeof schema.minLength === "number" && length < schema.minLength)
      errors.push(`${path}: string too short`);
    if (typeof schema.maxLength === "number" && length > schema.maxLength)
      errors.push(`${path}: string too long`);
    if (
      typeof schema.pattern === "string" &&
      !new RegExp(schema.pattern, "u").test(value)
    ) {
      errors.push(`${path}: pattern mismatch`);
    }
    if (
      typeof schema.format === "string" &&
      !formatMatches(schema.format, value)
    ) {
      errors.push(`${path}: invalid ${schema.format}`);
    }
  }
  if (isNumber(value)) {
    if (typeof schema.minimum === "number" && value < schema.minimum)
      errors.push(`${path}: below minimum`);
    if (typeof schema.maximum === "number" && value > schema.maximum)
      errors.push(`${path}: above maximum`);
  }
  return errors;
}

function sha256Json(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableJson(value), "utf8").digest("hex")}`;
}

function partyKey(value: JsonObject): string {
  if (typeof value.party_id === "string" && value.party_id)
    return `id:${value.party_id}`;
  return `surface:${String(value.party ?? "")
    .trim()
    .normalize("NFC")
    .toLowerCase()}`;
}

function partyCompletenessCodes(
  evaluation: JsonObject,
  task: JsonObject,
): Set<string> {
  const codes = new Set<string>();
  const modelKeys = new Set(
    array(object(task.model_labels).party_tones).map((item) =>
      partyKey(object(item)),
    ),
  );
  const retained = new Set<string>();
  for (const raw of array(evaluation.party_tones)) {
    const key = partyKey(object(raw));
    if (retained.has(key)) codes.add("duplicate_party");
    retained.add(key);
  }
  const removed = new Set<string>();
  for (const raw of array(evaluation.removed_model_parties)) {
    const key = partyKey(object(raw));
    if (removed.has(key)) codes.add("duplicate_removed_party");
    removed.add(key);
    if (!modelKeys.has(key)) codes.add("unknown_removed_party");
  }
  if ([...retained].some((key) => removed.has(key)))
    codes.add("party_retained_removed_overlap");
  if ([...modelKeys].some((key) => !retained.has(key) && !removed.has(key)))
    codes.add("unaccounted_model_party");
  return codes;
}

function reasonScopeCodes(evaluation: JsonObject): Set<string> {
  const codes = new Set<string>();
  const registry = object(CONTRACT.reason_codes);
  for (const field of ["leaning", "russia_stance"]) {
    for (const reason of array(object(evaluation[field]).reason_codes)) {
      const entry = object(registry[String(reason)]);
      if (!array(entry.scopes).includes(field))
        codes.add("invalid_reason_scope");
    }
  }
  for (const raw of array(evaluation.party_tones)) {
    for (const reason of array(object(raw).reason_codes)) {
      const entry = object(registry[String(reason)]);
      if (!array(entry.scopes).includes("party_tones"))
        codes.add("invalid_reason_scope");
    }
  }
  return codes;
}

function evaluationSemantics(
  value: JsonObject,
  task: JsonObject,
): [string[], boolean] {
  const codes = reasonScopeCodes(value);
  for (const code of partyCompletenessCodes(value, task)) codes.add(code);
  const model = object(task.model_labels);
  for (const field of ["leaning", "russia_stance"]) {
    const decision = object(value[field]);
    const expected =
      decision.label === null
        ? "unable_to_judge"
        : decision.label === model[field]
          ? "confirmed"
          : "changed";
    if (decision.disposition !== expected) codes.add("invalid_disposition");
  }
  const modelParties = new Map(
    array(model.party_tones).map((item) => [
      partyKey(object(item)),
      object(item),
    ]),
  );
  for (const raw of array(value.party_tones)) {
    const item = object(raw);
    const key = partyKey(item);
    const original = modelParties.get(key);
    const expected = !original
      ? "added"
      : original.tone === item.tone
        ? "confirmed"
        : "changed";
    if (item.disposition !== expected) codes.add("invalid_disposition");
  }
  const goldEligible =
    ["leaning", "russia_stance"].every(
      (field) => object(value[field]).disposition !== "unable_to_judge",
    ) && value.parties_confirmed_complete === true;
  return [[...codes].sort(), goldEligible];
}

function submissionSemantics(value: JsonObject, task: JsonObject): string[] {
  const evaluation = object(value.evaluation);
  const codes = reasonScopeCodes(evaluation);
  for (const code of partyCompletenessCodes(evaluation, task)) codes.add(code);
  if (value.article_key !== task.article_key) codes.add("article_key_conflict");
  if (value.base_task_revision !== task.revision)
    codes.add("task_revision_conflict");
  if (value.content_sha256 !== task.content_sha256) codes.add("stale_content");
  if (value.analysis_sha256 !== task.analysis_sha256)
    codes.add("stale_analysis");
  return [...codes].sort();
}

function eventSemantics(value: JsonObject): string[] {
  const codes = new Set<string>();
  const target = object(value.target);
  const submissions = new Set([
    "submission_quarantined",
    "submission_reviewed",
    "submission_rejected",
  ]);
  const adjudications = new Set([
    "adjudication_accepted",
    "adjudication_deferred",
    "adjudication_superseded",
    "adjudication_stale",
  ]);
  const expected = submissions.has(String(value.action))
    ? "submission"
    : adjudications.has(String(value.action))
      ? "adjudication"
      : value.action === "gold_promoted"
        ? "dataset"
        : null;
  const badArticle =
    (expected === "dataset" && target.article_key !== null) ||
    ((expected === "submission" || expected === "adjudication") &&
      !target.article_key);
  if ((expected && target.kind !== expected) || badArticle)
    codes.add("invalid_action_target");
  if (value.before_sha256 === null && value.after_sha256 === null)
    codes.add("missing_state_hash");
  return [...codes].sort();
}

function manifestSemantics(value: JsonObject, records: unknown): string[] {
  const codes = new Set<string>();
  const groups = new Map<string, unknown>();
  for (const raw of array(value.entries)) {
    const entry = object(raw);
    if (typeof entry.group_id !== "string" || !entry.group_id) {
      codes.add("missing_group_id");
      continue;
    }
    if (
      groups.has(entry.group_id) &&
      groups.get(entry.group_id) !== entry.split
    ) {
      codes.add("group_split_leakage");
    }
    groups.set(entry.group_id, entry.split);
  }
  if (records !== undefined) {
    try {
      if (value.records_sha256 !== sha256Json(records))
        codes.add("records_hash_mismatch");
    } catch {
      codes.add("noncanonical_record_number");
    }
    const rows = array(records);
    const statistics = object(value.label_statistics);
    if (statistics.total_records !== rows.length)
      codes.add("statistics_mismatch");
    if (
      rows.length > 0 &&
      rows.every(
        (row) => Object.keys(object(object(row).evaluation)).length > 0,
      ) &&
      !equal(statistics, labelStatistics(rows.map(object)))
    ) {
      codes.add("statistics_mismatch");
    }
  }
  return [...codes].sort();
}

function labelStatistics(records: JsonObject[]): JsonObject {
  const result: JsonObject = {
    total_records: records.length,
    leaning: {
      label_counts: {},
      missing_count: 0,
      unable_to_judge_count: 0,
    },
    russia_stance: {
      label_counts: {},
      missing_count: 0,
      unable_to_judge_count: 0,
    },
    party_tones: {
      label_counts: {},
      missing_count: 0,
      unable_to_judge_count: 0,
    },
  };
  for (const record of records) {
    const evaluation = object(record.evaluation);
    for (const field of ["leaning", "russia_stance"]) {
      const statistics = object(result[field]);
      const decision = object(evaluation[field]);
      if (Object.keys(decision).length === 0) {
        statistics.missing_count = Number(statistics.missing_count) + 1;
      } else if (decision.disposition === "unable_to_judge") {
        statistics.unable_to_judge_count =
          Number(statistics.unable_to_judge_count) + 1;
      } else {
        const counts = object(statistics.label_counts);
        const label = String(decision.label);
        counts[label] = Number(counts[label] ?? 0) + 1;
      }
    }
    const partyStatistics = object(result.party_tones);
    if (!Array.isArray(evaluation.party_tones)) {
      partyStatistics.missing_count = Number(partyStatistics.missing_count) + 1;
    } else {
      const counts = object(partyStatistics.label_counts);
      for (const raw of evaluation.party_tones) {
        const tone = String(object(raw).tone);
        counts[tone] = Number(counts[tone] ?? 0) + 1;
      }
    }
  }
  return result;
}

export function validateFixture(fixture: JsonObject): FixtureResult {
  const target = String(fixture.schema_target);
  const schema = object(JSON.parse(readFileSync(SCHEMAS[target], "utf8")));
  const value = object(fixture.value);
  const schemaErrors = validateSchema(schema, value);
  let semanticCodes: string[];
  let goldEligible = false;
  if (target === "article_evaluation") {
    [semanticCodes, goldEligible] = evaluationSemantics(
      value,
      object(fixture.task),
    );
    if (!goldEligible)
      semanticCodes = [
        ...new Set([...semanticCodes, "incomplete_for_gold"]),
      ].sort();
  } else if (target === "submission_request") {
    semanticCodes = submissionSemantics(value, object(fixture.task));
  } else if (target === "event") {
    semanticCodes = eventSemantics(value);
  } else {
    semanticCodes = manifestSemantics(value, fixture.records);
  }
  return {
    id: String(fixture.id),
    schema_valid: schemaErrors.length === 0,
    semantic_valid:
      semanticCodes.filter((code) => code !== "incomplete_for_gold").length ===
      0,
    gold_eligible:
      goldEligible &&
      schemaErrors.length === 0 &&
      semanticCodes.filter((code) => code !== "incomplete_for_gold").length ===
        0,
    error_codes: semanticCodes,
  };
}

export function validateFixtures(): FixtureResult[] {
  const fixtureRoot = join(ROOT, "fixtures");
  const manifest = object(
    JSON.parse(readFileSync(join(fixtureRoot, "manifest.json"), "utf8")),
  );
  return array(manifest.cases).map((name) =>
    validateFixture(
      object(JSON.parse(readFileSync(join(fixtureRoot, String(name)), "utf8"))),
    ),
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes("--fixture-stdin")) {
    const fixture = object(JSON.parse(readFileSync(0, "utf8")));
    process.stdout.write(`${JSON.stringify(validateFixture(fixture))}\n`);
  } else if (!process.argv.includes("--fixtures")) {
    process.stderr.write("--fixtures or --fixture-stdin is required\n");
    process.exitCode = 2;
  } else {
    const result = validateFixtures();
    process.stdout.write(
      `${JSON.stringify(result, null, process.argv.includes("--json") ? 0 : 2)}\n`,
    );
  }
}
