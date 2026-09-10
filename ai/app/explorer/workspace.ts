import { validateArguments } from "../../orchestrator/validateArguments";
import type { Envelope, Lang, ToolArgs, ToolContext } from "../../tools/types";
import { LIBRARY } from "./library";
export type ToolIntent = { tool: string; args: ToolArgs; text: string };
export type RunSnapshot = {
  tool: string;
  args: ToolArgs;
  context: ToolContext;
  requestedAt: string;
  envelope: Envelope;
  draftKey: string;
};
export type WorkspaceState = { draft: ToolArgs; result?: RunSnapshot };
export const draftKey = (args: ToolArgs) =>
  JSON.stringify(
    Object.entries(args)
      .filter(([, v]) => v !== undefined && v !== "")
      .sort(([a], [b]) => a.localeCompare(b)),
  );
export const toolIntent = (
  name: string,
  draft: ToolArgs,
  lang: Lang,
): ToolIntent | null => {
  const { args, errors } = validateArguments(name, draft, { defaults: true });
  const entry = LIBRARY.find((e) => e.tool.name === name);
  if (!entry || Object.keys(errors).length) return null;
  const details = entry.tool.params
    .filter((p) => args[p.name] !== undefined)
    .map((p) => `${p.description[lang]}: ${String(args[p.name])}`);
  return { tool: name, args, text: [entry.title[lang], ...details].join("\n") };
};
export const emptyEnvelope = (env: Envelope) =>
  !env.clarify &&
  (env.kind === "table"
    ? !env.rows?.length
    : env.kind === "series"
      ? !env.series?.some((s) => s.points.some((p) => p.y !== null))
      : env.value === undefined && !Object.keys(env.facts).length);

// Navigation preserves the explicit area anchor used by deterministic execution.
export const navigationPath = (view: "chat" | "tools", search: string) => {
  const source = new URLSearchParams(search);
  const target = new URLSearchParams();
  for (const key of ["area", "lang"]) {
    const value = source.get(key);
    if (value) target.set(key, value);
  }
  return (
    (view === "tools" ? "/tools" : "/") + (target.size ? `?${target}` : "")
  );
};
export const resultIsStale = (
  result: RunSnapshot,
  draft: ToolArgs,
  lang: Lang,
) => result.draftKey !== draftKey(draft) || result.context.lang !== lang;
