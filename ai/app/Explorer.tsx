// M1 harness: a plain dropdown UI that runs a deterministic tool and renders the
// result with the shared chart/table components. No LLM involved — this proves
// the data + render layers end to end before the model is wired in (M3).

import { useState } from "react";
import { electionNames, latestElection } from "../tools/dataset";
import {
  DOMAIN_LABELS,
  runTool,
  TOOLS,
  TOOLS_BY_NAME,
} from "../tools/registry";
import type { Domain, Envelope, Lang, ToolArgs } from "../tools/types";
import { AnswerView } from "../render/AnswerView";

const ELECTIONS = electionNames();
const DOMAIN_ORDER: Domain[] = [
  "elections",
  "local",
  "fiscal",
  "people",
  "indicators",
];

export const Explorer = ({ lang }: { lang: Lang }) => {
  const [toolName, setToolName] = useState(TOOLS[0].name);
  const [args, setArgs] = useState<ToolArgs>({});
  const [env, setEnv] = useState<Envelope | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tool = TOOLS_BY_NAME[toolName];

  const setArg = (name: string, value: string) =>
    setArgs((a) => ({ ...a, [name]: value }));

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await runTool(toolName, args, {
        lang,
        election: latestElection(),
      });
      setEnv(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setEnv(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">
            {lang === "bg" ? "Инструмент" : "Tool"}
          </span>
          <select
            className="min-w-56 rounded-md border border-input bg-background px-2 py-1.5"
            value={toolName}
            onChange={(e) => {
              setToolName(e.target.value);
              setArgs({});
              setEnv(null);
            }}
          >
            {DOMAIN_ORDER.map((d) => (
              <optgroup key={d} label={DOMAIN_LABELS[d][lang]}>
                {TOOLS.filter((t) => t.domain === d).map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name} — {t.description[lang]}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>

        {tool.params.map((p) => {
          if (p.type === "election") {
            return (
              <label key={p.name} className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">
                  {p.description[lang]}
                </span>
                <select
                  className="rounded-md border border-input bg-background px-2 py-1.5"
                  value={(args[p.name] as string) ?? ""}
                  onChange={(e) => setArg(p.name, e.target.value)}
                >
                  <option value="">
                    {lang === "bg" ? "(последния)" : "(latest)"}
                  </option>
                  {ELECTIONS.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            );
          }
          return (
            <label key={p.name} className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">
                {p.description[lang]}
              </span>
              <input
                className="w-40 rounded-md border border-input bg-background px-2 py-1.5"
                type={p.type === "count" ? "number" : "text"}
                placeholder={p.default != null ? String(p.default) : ""}
                value={(args[p.name] as string) ?? ""}
                onChange={(e) => setArg(p.name, e.target.value)}
              />
            </label>
          );
        })}

        <button
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          onClick={run}
          disabled={loading}
        >
          {loading
            ? lang === "bg"
              ? "…"
              : "…"
            : lang === "bg"
              ? "Изпълни"
              : "Run"}
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {tool.examples.map((ex) => (
          <span
            key={ex.en}
            className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground"
          >
            {ex[lang]}
          </span>
        ))}
      </div>

      {error && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {env && <AnswerView env={env} />}
    </div>
  );
};
