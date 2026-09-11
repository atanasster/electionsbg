import { resolveOblast } from "../../tools/place";
import type { Route } from "../../orchestrator/router";
import { validateArguments } from "../../orchestrator/validateArguments";
import { parseToolCall } from "../../orchestrator/toolSchema";
import type { FreshCase } from "./routingCases";
export function rawRoute(raw: string): Route {
  try {
    const o = JSON.parse(raw);
    if (o.tool === null) return null;
    if (Object.keys(validateArguments(o.tool, o.args).errors).length)
      return null;
  } catch {
    return null;
  }
  return parseToolCall(raw);
}
const normal = (key: string, value: unknown) =>
  key === "oblast"
    ? (resolveOblast(String(value))?.code ?? String(value).toLowerCase())
    : String(value).normalize("NFC").toLowerCase();
export function matchesExpected(c: FreshCase, r: Route): boolean {
  if (c.tool === null) return r === null;
  return (
    r?.tool === c.tool &&
    Object.keys(r.args).every((k) => k in c.args) &&
    Object.entries(c.args).every(([k, vs]) =>
      vs.some((v) => normal(k, v) === normal(k, r.args[k])),
    )
  );
}
export function explicitAbstention(raw: string): boolean {
  try {
    return JSON.parse(raw)?.tool === null;
  } catch {
    return false;
  }
}
