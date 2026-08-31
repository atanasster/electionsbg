import { createHash } from "node:crypto";

export const MAX_SAFE_INTEGER = 9_007_199_254_740_991;
export const UNICODE_SCALAR_ERROR = "string contains an unpaired surrogate";

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function compareCodePoints(left: string, right: string): number {
  const a = [...left];
  const b = [...right];
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const leftPoint = a[index]?.codePointAt(0);
    const rightPoint = b[index]?.codePointAt(0);
    if (leftPoint === undefined || rightPoint === undefined) break;
    const difference = leftPoint - rightPoint;
    if (difference !== 0) return difference;
  }
  return a.length - b.length;
}

export function requireUnicodeScalars(value: string): void {
  for (const character of value) {
    const point = character.codePointAt(0)!;
    if (point >= 0xd800 && point <= 0xdfff)
      throw new Error(UNICODE_SCALAR_ERROR);
  }
}

export function canonicalJson(value: unknown): string {
  if (typeof value === "string") {
    requireUnicodeScalars(value);
    return JSON.stringify(value);
  }
  if (value === null || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new Error("non-finite number is not canonical JSON");
    if (Number.isInteger(value) && !Number.isSafeInteger(value))
      throw new Error("integer exceeds the cross-language safe range");
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = object(value);
    const keys = Object.keys(record);
    keys.forEach(requireUnicodeScalars);
    const fields = keys
      .sort(compareCodePoints)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${fields.join(",")}}`;
  }
  throw new TypeError(`not a JSON value: ${typeof value}`);
}

function digest(payload: string): string {
  return `sha256:${createHash("sha256").update(payload, "utf8").digest("hex")}`;
}

export function canonicalSha256(value: unknown): string {
  return digest(canonicalJson(value));
}

export function contentSha256(content: string): string {
  if (typeof content !== "string")
    throw new TypeError("article content must be a string");
  requireUnicodeScalars(content);
  return digest(content);
}

export function analysisSha256(analysis: JsonObject): string {
  if (
    analysis === null ||
    typeof analysis !== "object" ||
    Array.isArray(analysis)
  )
    throw new TypeError("analysis must be an object");
  return canonicalSha256(analysis);
}
