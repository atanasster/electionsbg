// The "Tools & data" reference, reached from the header ⓘ icon (chat is the
// main page). It runs a single deterministic tool — no LLM involved — and, for
// the selected tool, documents its description, parameters (with required +
// type), and example prompts. After a run it also shows the *live* shape of the
// returned Envelope (kind, facts, columns/series, data sources) — the actual
// contract the chat's narration reads from, so docs never drift from output.

import { lazy, Suspense, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { electionNames, latestElection } from "../tools/dataset";
import { DOMAIN_LABELS, runTool, TOOLS_BY_NAME } from "../tools/registry";
import type {
  Envelope,
  EnvelopeKind,
  Lang,
  ParamType,
  ToolArgs,
} from "../tools/types";
import { ToolLibrary } from "./explorer/ToolLibrary";
import { WelcomeGallery } from "./explorer/WelcomeGallery";
import { LIBRARY } from "./explorer/library";
import { AnswerView } from "../render/AnswerView";

const ELECTIONS = electionNames();
// Radix Select forbids an empty-string value, so the "(latest)" choice uses a
// sentinel that maps back to "" (which tools read as "use the default election").
const LATEST = "__latest__";

// Human labels for each param/argument type the tools accept.
const PARAM_TYPE_LABELS: Record<ParamType, { bg: string; en: string }> = {
  election: { bg: "избор (дата)", en: "election (date)" },
  electionList: { bg: "списък избори", en: "election list" },
  count: { bg: "число", en: "number" },
  party: { bg: "партия", en: "party" },
  company: { bg: "фирма / ЕИК", en: "company / EIK" },
  person: { bg: "лице (име)", en: "person (name)" },
  metric: { bg: "текст", en: "text" },
  region: { bg: "регион", en: "region" },
  cycle: { bg: "местен цикъл", en: "local cycle" },
  place: { bg: "населено място", en: "place" },
  oblast: { bg: "област", en: "oblast" },
  year: { bg: "година", en: "year" },
  indicator: { bg: "показател", en: "indicator" },
  text: { bg: "текст", en: "text" },
};

// Human labels for the Envelope's three return shapes.
const KIND_LABELS: Record<EnvelopeKind, { bg: string; en: string }> = {
  scalar: { bg: "единична стойност", en: "single value" },
  table: { bg: "таблица", en: "table" },
  series: { bg: "времеви ред", en: "time series" },
};

const ToolRunner = ({
  lang,
  toolName,
  initialArgs,
}: {
  lang: Lang;
  toolName: string;
  initialArgs: ToolArgs;
}) => {
  const [args, setArgs] = useState<ToolArgs>(initialArgs);
  const [env, setEnv] = useState<Envelope | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tool = TOOLS_BY_NAME[toolName];
  const t = (bg: string, en: string) => (lang === "bg" ? bg : en);
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
                      {t("(последния)", "(latest)")}
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
                {p.required && <span className="text-destructive"> *</span>}
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
          {loading ? "…" : t("Изпълни", "Run")}
        </Button>
      </div>

      {/* ---- documentation for the selected tool ---- */}
      <div className="space-y-4 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <code className="rounded bg-muted px-2 py-0.5 font-mono text-sm text-popover-foreground">
            {tool.name}
          </code>
          <Badge variant="secondary">{DOMAIN_LABELS[tool.domain][lang]}</Badge>
        </div>

        <p className="text-sm text-foreground">{tool.description[lang]}</p>

        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("Параметри", "Parameters")}
          </h3>
          {tool.params.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("Няма параметри.", "No parameters.")}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("Име", "Name")}</TableHead>
                  <TableHead>{t("Тип", "Type")}</TableHead>
                  <TableHead>{t("Задължителен", "Required")}</TableHead>
                  <TableHead>{t("По подразбиране", "Default")}</TableHead>
                  <TableHead>{t("Описание", "Description")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tool.params.map((p) => (
                  <TableRow key={p.name}>
                    <TableCell className="font-mono text-xs">
                      {p.name}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {PARAM_TYPE_LABELS[p.type][lang]}
                    </TableCell>
                    <TableCell>
                      {p.required ? (
                        <Badge variant="destructive">{t("да", "yes")}</Badge>
                      ) : (
                        <span className="text-muted-foreground">
                          {t("не", "no")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {p.default != null ? String(p.default) : "—"}
                    </TableCell>
                    <TableCell>{p.description[lang]}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {tool.examples.length > 0 && (
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("Примерни въпроси", "Example prompts")}
            </h3>
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
          </div>
        )}
      </div>

      {error && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {env && (
        <>
          <AnswerView env={env} lang={lang} />
          <ReturnShape env={env} lang={lang} />
        </>
      )}
    </div>
  );
};

// Renders the live shape of the Envelope a run produced — the actual contract
// the chat narrates from. Sourced from the result itself, so it can't drift.
const ReturnShape = ({ env, lang }: { env: Envelope; lang: Lang }) => {
  const t = (bg: string, en: string) => (lang === "bg" ? bg : en);
  const factEntries = Object.entries(env.facts);
  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("Какво връща (от резултата)", "Return shape (from this result)")}
        </h3>
        <Badge variant="outline">{KIND_LABELS[env.kind][lang]}</Badge>
        {env.viz !== "none" && <Badge variant="outline">{env.viz}</Badge>}
      </div>

      {env.columns && env.columns.length > 0 && (
        <div>
          <h4 className="mb-1 text-xs font-medium text-muted-foreground">
            {t("Колони", "Columns")}
          </h4>
          <div className="flex flex-wrap gap-2">
            {env.columns.map((c) => (
              <span
                key={c.key}
                className="rounded-md bg-muted px-2 py-0.5 text-xs"
              >
                <span className="font-mono">{c.key}</span>
                <span className="text-muted-foreground">
                  {" "}
                  — {c.label}
                  {c.format ? ` · ${c.format}` : ""}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {env.series && env.series.length > 0 && (
        <div>
          <h4 className="mb-1 text-xs font-medium text-muted-foreground">
            {t("Редове (серии)", "Series")}
          </h4>
          <div className="flex flex-wrap gap-2">
            {env.series.map((s) => (
              <span
                key={s.key}
                className="rounded-md bg-muted px-2 py-0.5 text-xs"
              >
                <span className="font-mono">{s.key}</span>
                <span className="text-muted-foreground"> — {s.label}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {factEntries.length > 0 && (
        <div>
          <h4 className="mb-1 text-xs font-medium text-muted-foreground">
            {t("Факти (за наративa)", "Facts (narrated)")}
          </h4>
          <Table>
            <TableBody>
              {factEntries.map(([k, v]) => (
                <TableRow key={k}>
                  <TableCell className="w-1/3 font-mono text-xs">{k}</TableCell>
                  <TableCell className="text-sm">{String(v)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {env.provenance.length > 0 && (
        <div>
          <h4 className="mb-1 text-xs font-medium text-muted-foreground">
            {t("Източници на данни", "Data sources")}
          </h4>
          <div className="flex flex-wrap gap-2">
            {env.provenance.map((p) => (
              <span
                key={p}
                className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground"
              >
                {p}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const SqlLibrary = lazy(() => import("./explorer/SqlLibrary"));
export const Explorer = ({ lang }: { lang: Lang }) => {
  const [selection, setSelection] = useState<{
    name: string;
    args: ToolArgs;
    key: number;
  } | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [sql, setSql] = useState(false);
  const select = (name: string, args: ToolArgs = {}) => {
    setSql(false);
    setSelection((s) => ({ name, args, key: (s?.key ?? 0) + 1 }));
    setRecent((r) => [name, ...r.filter((n) => n !== name)].slice(0, 8));
  };
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-title text-3xl">
          {lang === "bg" ? "Инструменти и данни" : "Tools & data"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {lang === "bg"
            ? "Изберете въпрос и проверете данните зад отговора."
            : "Choose a question and explore the data behind the answer."}
        </p>
      </header>
      <div className="grid items-start gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <ToolLibrary
          lang={lang}
          selected={selection?.name}
          recent={recent}
          onSelect={select}
          sql={sql}
          onSql={() => setSql(true)}
        />
        <div className="min-w-0">
          {sql ? (
            <Suspense
              fallback={
                <p role="status">{lang === "bg" ? "Зареждане…" : "Loading…"}</p>
              }
            >
              <SqlLibrary lang={lang} />
            </Suspense>
          ) : selection ? (
            <>
              <h2 className="mb-4 font-title text-2xl">
                {
                  LIBRARY.find((e) => e.tool.name === selection.name)?.title[
                    lang
                  ]
                }
              </h2>
              <ToolRunner
                key={selection.key}
                lang={lang}
                toolName={selection.name}
                initialArgs={selection.args}
              />
            </>
          ) : (
            <WelcomeGallery lang={lang} onSelect={select} />
          )}
        </div>
      </div>
    </div>
  );
};
