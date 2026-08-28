import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseOverrides, type OverrideRow } from "./overrides";

export const OVERRIDE_REGISTRY_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../data/person/link_overrides.json",
);

type JsonObject = Record<string, unknown>;

const object = (value: unknown, label: string): JsonObject => {
  if (value == null || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value as JsonObject;
};

const string = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.trim() === "")
    throw new Error(`${label} must be a non-empty string`);
  return value.trim();
};

const optionalString = (value: unknown, label: string): string | null =>
  value == null ? null : string(value, label);

const calendarDate = (value: unknown, label: string): string => {
  const text = string(value, label);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) throw new Error(`${label} must be a real YYYY-MM-DD date`);
  const [, yearText, monthText, dayText] = match;
  const [year, month, day] = [yearText, monthText, dayText].map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  if (
    year < 1 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    throw new Error(`${label} must be a real YYYY-MM-DD date`);
  return text;
};

const endpointKey = (row: OverrideRow): string => {
  const refs = [row.ref_a, row.ref_b].filter((v): v is string => v != null);
  if (refs.length) return `ref:${refs.sort().join("\u0000")}`;
  const folds = [row.fold_a, row.fold_b].filter((v): v is string => v != null);
  return `fold:${folds.sort().join("\u0000")}`;
};

/** Stable identity for deduping a committed decision against a DB hotfix. */
export const overrideKey = (row: OverrideRow): string =>
  `${row.kind}:${endpointKey(row)}`;

export function parseOverrideRegistry(value: unknown): OverrideRow[] {
  const root = object(value, "person override registry");
  if (root.schemaVersion !== 1)
    throw new Error("person override registry schemaVersion must be 1");
  if (!Array.isArray(root.overrides))
    throw new Error("person override registry overrides must be an array");

  const rows = root.overrides.map((raw, i): OverrideRow => {
    const label = `committed override ${i + 1}`;
    const entry = object(raw, label);
    const kind = string(entry.kind, `${label}.kind`);
    if (kind !== "merge" && kind !== "split")
      throw new Error(`${label}.kind must be merge or split`);
    string(entry.note, `${label}.note`);
    string(entry.decidedBy, `${label}.decidedBy`);
    calendarDate(entry.decidedAt, `${label}.decidedAt`);
    if (!Array.isArray(entry.evidence))
      throw new Error(`${label}.evidence must be an array`);
    entry.evidence.forEach((item, j) =>
      string(item, `${label}.evidence[${j}]`),
    );
    return {
      override_id: `committed:${i + 1}`,
      kind,
      fold_a: optionalString(entry.foldA, `${label}.foldA`),
      fold_b: optionalString(entry.foldB, `${label}.foldB`),
      ref_a: optionalString(entry.refA, `${label}.refA`),
      ref_b: optionalString(entry.refB, `${label}.refB`),
    };
  });

  // Reuse the runtime shape validator rather than maintaining a second account of the
  // four supported operations here.
  parseOverrides(rows);
  const seen = new Set<string>();
  for (const row of rows) {
    const key = overrideKey(row);
    if (seen.has(key))
      throw new Error(`duplicate committed person override: ${key}`);
    seen.add(key);
  }
  return rows;
}

export const loadOverrideRegistry = (
  file = OVERRIDE_REGISTRY_PATH,
): OverrideRow[] =>
  parseOverrideRegistry(JSON.parse(fs.readFileSync(file, "utf8")));

/** Committed decisions lead; an identical DB row is an emergency hotfix already promoted. */
export function mergeOverrideRows(
  committed: OverrideRow[],
  database: OverrideRow[],
): OverrideRow[] {
  const out: OverrideRow[] = [];
  const seen = new Set<string>();
  for (const row of [...committed, ...database]) {
    const key = overrideKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  parseOverrides(out);
  return out;
}
