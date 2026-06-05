// A plain dropdown UI that runs a deterministic tool and renders the result with
// the shared chart/table components. No LLM involved — proves the data + render
// layers end to end. Controls use the site's shared shadcn primitives.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  "place",
];
// Radix Select forbids an empty-string value, so the "(latest)" choice uses a
// sentinel that maps back to "" (which tools read as "use the default election").
const LATEST = "__latest__";

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
          <Select
            value={toolName}
            onValueChange={(v) => {
              setToolName(v);
              setArgs({});
              setEnv(null);
            }}
          >
            <SelectTrigger className="min-w-56 max-w-[28rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DOMAIN_ORDER.map((d) => (
                <SelectGroup key={d}>
                  <SelectLabel>{DOMAIN_LABELS[d][lang]}</SelectLabel>
                  {TOOLS.filter((tl) => tl.domain === d).map((tl) => (
                    <SelectItem key={tl.name} value={tl.name}>
                      {tl.name} — {tl.description[lang]}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </label>

        {tool.params.map((p) => {
          if (p.type === "election") {
            return (
              <label key={p.name} className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">
                  {p.description[lang]}
                </span>
                <Select
                  value={(args[p.name] as string) || LATEST}
                  onValueChange={(v) => setArg(p.name, v === LATEST ? "" : v)}
                >
                  <SelectTrigger className="min-w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={LATEST}>
                      {lang === "bg" ? "(последния)" : "(latest)"}
                    </SelectItem>
                    {ELECTIONS.map((name) => (
                      <SelectItem key={name} value={name}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            );
          }
          return (
            <label key={p.name} className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">
                {p.description[lang]}
              </span>
              <Input
                className="w-40"
                type={p.type === "count" ? "number" : "text"}
                placeholder={p.default != null ? String(p.default) : ""}
                value={(args[p.name] as string) ?? ""}
                onChange={(e) => setArg(p.name, e.target.value)}
              />
            </label>
          );
        })}

        <Button onClick={run} disabled={loading}>
          {loading ? "…" : lang === "bg" ? "Изпълни" : "Run"}
        </Button>
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
      {env && <AnswerView env={env} lang={lang} />}
    </div>
  );
};
