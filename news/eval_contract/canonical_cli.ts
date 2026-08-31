#!/usr/bin/env node

import { readFileSync } from "node:fs";

import {
  analysisSha256,
  canonicalJson,
  canonicalSha256,
  contentSha256,
} from "./canonical.js";

try {
  const request: unknown = JSON.parse(readFileSync(0, "utf8"));
  if (request === null || typeof request !== "object" || Array.isArray(request))
    throw new Error("request must be an object");
  const { op, value } = request as Record<string, unknown>;
  let result: string;
  switch (op) {
    case "canonical":
      result = canonicalJson(value);
      break;
    case "canonical_sha256":
      result = canonicalSha256(value);
      break;
    case "content_sha256":
      result = contentSha256(value as string);
      break;
    case "analysis_sha256":
      result = analysisSha256(value as Record<string, unknown>);
      break;
    default:
      throw new Error(`unsupported operation: ${String(op)}`);
  }
  process.stdout.write(`${JSON.stringify({ result })}\n`);
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`,
  );
  process.exitCode = 2;
}
