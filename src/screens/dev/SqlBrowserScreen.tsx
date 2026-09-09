// Public SQL browser (/db) over the Postgres source of truth (contracts +
// tr_companies/tr_officers + contractor_search + ingest tracking — one database).
// A Datasette-style read-only console: CodeMirror editor with SQL syntax
// highlighting + schema-aware autocomplete, EXPLAIN, query history + saved
// queries (localStorage), and a sortable / expandable / exportable results grid.
// Backed by /api/sql/* — the Vite plugin in dev, the hardened `sql` Cloud
// Function (read-only tx + statement_timeout + row cap + rate limit) in prod.
//
// See docs/plans/postgres-migration-v1.md.

import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView, keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { sql, PostgreSQL } from "@codemirror/lang-sql";
import { oneDark } from "@codemirror/theme-one-dark";
import { Button } from "@/components/ui/button";
import { useQuestionLookupAdapters } from "@/components/questions/useQuestionLookupAdapters";
import { QuestionSelector } from "@/lib/questions/selector";
import { SQL_QUESTION_CATALOG } from "@/lib/questions/sql/catalog";
import { renderSqlQuestion } from "@/lib/questions/sql/render";
import {
  catalogForServerCapabilities,
  isGuardedSqlExecutionBlocked,
  parseSqlServerCapabilities,
} from "@/lib/questions/sql/capabilities";
import {
  parseSqlQuestionUrl,
  writeSqlQuestionUrl,
} from "@/lib/questions/sql/url";
import type { RenderedSqlQuestion } from "@/lib/questions/sql/types";
import { ALL_QUERIES, LIBRARY } from "./sqlLibrary";
import { Input } from "@/components/ui/input";
import { useNoindex } from "@/lib/useNoindex";

interface IndexInfo {
  name: string;
  unique: boolean;
  columns: string[];
}
interface ColumnInfo {
  name: string;
  type: string;
  pk: boolean;
  notnull: boolean;
  indexed: boolean;
}
type RelationVisibility = "data" | "derived" | "internal";
interface TableInfo {
  db: string;
  table: string;
  /** Meaningless for views; an ESTIMATE otherwise, stale until autovacuum. */
  rowCount: number;
  /** n_live_tup is an ESTIMATE and reads 0 until autovacuum runs. */
  rowCountIsEstimate?: boolean;
  kind?: string;
  visibility?: RelationVisibility;
  columns: ColumnInfo[];
  indexes: IndexInfo[];
}
interface SchemaResponse {
  databases: Array<{ name: string; file: string }>;
  tables: TableInfo[];
  questionCapabilities?: unknown;
}
interface QueryResult {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  truncated: boolean;
  elapsedMs: number;
  plan?: boolean;
}

interface SavedQuery {
  name: string;
  sql: string;
}

const HISTORY_KEY = "sqlbrowser.history.v1";
const SAVED_KEY = "sqlbrowser.saved.v1";
const HISTORY_MAX = 50;

// ---- result cell → app deep-links -----------------------------------------
// Make entity columns clickable: an EIK/UIC opens the company (or awarder) page;
// a name opens the person scanner for officer rows, else its own entity page.
// Opens in a new tab so the query stays put. Heuristic on column name + the
// row's `kind` (present in search_all / the search functions).

const rowCompanyEik = (row: Record<string, unknown>): string | null => {
  for (const k of ["contractor_eik", "eik", "uic"]) {
    const v = row[k];
    if (typeof v === "string" && v) return v;
  }
  return null;
};

const cellLink = (
  col: string,
  row: Record<string, unknown>,
  value: unknown,
): string | null => {
  if (value === null || value === undefined || value === "") return null;
  const s = String(value);
  const kind = typeof row.kind === "string" ? row.kind : null;
  if (col === "awarder_eik") return `/awarder/${encodeURIComponent(s)}`;
  // recent_updates `id` column = the record's own id → route to the record page
  // by kind. (Guarded by kind, so a plain `id` column on any other table stays
  // unlinked.)
  if (col === "id") {
    if (kind === "contract")
      return `/procurement/contract/${encodeURIComponent(s)}`;
    if (kind === "tender") return `/tenders/${encodeURIComponent(s)}`;
    if (kind === "fund_project")
      return `/funds/contract/${encodeURIComponent(s)}`;
    return null;
  }
  // Party columns (eik / name). A tender's party is its buyer (an institution →
  // /awarder); everyone else is a company → /company.
  if (col === "eik" || col === "uic" || col === "contractor_eik")
    return kind === "tender"
      ? `/awarder/${encodeURIComponent(s)}`
      : `/company/${encodeURIComponent(s)}`;
  if (col === "name" || col === "officer" || col === "contractor_name") {
    if (kind === "officer") return `/person/${encodeURIComponent(s)}`;
    const eik = rowCompanyEik(row);
    if (!eik) return null;
    return kind === "tender"
      ? `/awarder/${encodeURIComponent(eik)}`
      : `/company/${encodeURIComponent(eik)}`;
  }
  if (col === "awarder_name") {
    const a = row.awarder_eik;
    return typeof a === "string" && a
      ? `/awarder/${encodeURIComponent(a)}`
      : null;
  }
  return null;
};

// ---- localStorage helpers -------------------------------------------------

const loadJson = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};
const saveJson = (key: string, v: unknown): void => {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* quota / disabled — non-fatal for a dev tool */
  }
};

// ---- cell / export helpers ------------------------------------------------

const cellText = (v: unknown): string =>
  v === null || v === undefined ? "" : String(v);

const toCsv = (r: QueryResult): string => {
  const esc = (v: unknown) => {
    const s = cellText(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    r.columns.join(","),
    ...r.rows.map((row) => r.columns.map((c) => esc(row[c])).join(",")),
  ].join("\n");
};

const download = (name: string, mime: string, data: string): void => {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
};

const useDarkMode = (): boolean => {
  const [dark, setDark] = useState(
    () =>
      typeof document !== "undefined" &&
      document.documentElement.classList.contains("dark"),
  );
  useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() =>
      setDark(el.classList.contains("dark")),
    );
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return dark;
};

// ---------------------------------------------------------------------------

export const SqlBrowserScreen = () => {
  // Public and linked from the footer on every page, but there is nothing
  // stable to index: the body is a query console whose content is whatever the
  // reader typed. Not prerendered, not in the sitemap (site-hygiene-v1 T2).
  useNoindex();
  const { i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const questionLookupAdapters = useQuestionLookupAdapters();
  const [schema, setSchema] = useState<SchemaResponse | null>(null);
  // `?q=<library id>` seeds the editor, so the map's "Links to" rows can offer
  // "run this query" and the map's claim ("these two join on ЕИК") becomes
  // executable in one click rather than a diagram. Only a KNOWN id is honoured
  // — never raw SQL from the URL, which would let a link hand a visitor a
  // query written by whoever sent it.
  const [searchParams, setSearchParams] = useSearchParams();
  const parsedUrl = useMemo(
    () => parseSqlQuestionUrl(searchParams),
    [searchParams],
  );
  const seeded = parsedUrl.kind === "valid" ? parsedUrl.rendered : undefined;
  const urlError =
    parsedUrl.kind === "invalid"
      ? lang === "bg"
        ? `Невалидна връзка към SQL справка: ${parsedUrl.error}`
        : `Invalid SQL question link: ${parsedUrl.error}`
      : null;
  const [sqlText, setSqlText] = useState(
    () => seeded?.sql ?? LIBRARY[0].queries[0].sql,
  );
  const [activeRendered, setActiveRendered] =
    useState<RenderedSqlQuestion | null>(seeded ?? null);
  const serverCapabilities = useMemo(
    () => parseSqlServerCapabilities(schema?.questionCapabilities),
    [schema?.questionCapabilities],
  );
  const activeCapabilityBlocked = isGuardedSqlExecutionBlocked(
    activeRendered,
    serverCapabilities,
  );
  const viewRef = useRef<EditorView | null>(null);

  /**
   * Set the editor AND keep `?q=` honest. Anything that is not a library pick
   * clears the param, because otherwise the URL keeps naming a query the
   * editor no longer holds — and that URL is shareable, so it would hand
   * somebody else different SQL from what the sender was looking at.
   */
  const setSql = useCallback(
    (sql: string, rendered?: RenderedSqlQuestion) => {
      setSqlText(sql);
      setActiveRendered(rendered ?? null);
      setSearchParams((current) => writeSqlQuestionUrl(current, rendered), {
        replace: !rendered,
      });
    },
    [setSearchParams],
  );
  const [limit, setLimit] = useState(1000);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [tab, setTab] = useState<"schema" | "history" | "saved">("schema");
  const [showDerived, setShowDerived] = useState(false);
  const [filter, setFilter] = useState("");
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<string[]>(() =>
    loadJson<string[]>(HISTORY_KEY, []),
  );
  const [saved, setSaved] = useState<SavedQuery[]>(() =>
    loadJson<SavedQuery[]>(SAVED_KEY, []),
  );

  const [sort, setSort] = useState<{ col: string; dir: 1 | -1 } | null>(null);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  const runRef = useRef<(explain: boolean) => void>(() => {});
  const dark = useDarkMode();

  const loadSchema = useCallback((reopen = false) => {
    fetch(`/api/sql/schema${reopen ? "?reopen=1" : ""}`)
      .then((r) => r.json())
      .then((j) => (j.error ? setError(j.error) : setSchema(j)))
      .catch((e) => setError(String(e)));
  }, []);
  useEffect(() => loadSchema(), [loadSchema]);

  useEffect(() => {
    if (!seeded) return;
    setActiveRendered(seeded);
    if (seeded.sql === sqlText) return;
    setSqlText(seeded.sql);
    viewRef.current?.dispatch({ selection: { anchor: 0 } });
    // `seeded` changes on browser Back/Forward or a valid shared URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seeded]);

  const generateSql = useCallback(
    (selection: {
      questionId: string;
      parameters: Record<string, unknown>;
    }) => {
      try {
        const rendered = renderSqlQuestion(
          selection.questionId,
          selection.parameters,
        );
        setError(null);
        setSql(rendered.sql, rendered);
        viewRef.current?.dispatch({ selection: { anchor: 0 } });
      } catch (generationError) {
        setError(String(generationError));
      }
    },
    [setSql],
  );

  const execute = useCallback(
    async (text: string, plan: boolean) => {
      const trimmed = text.trim().replace(/;\s*$/, "");
      if (!trimmed) return;
      if (activeCapabilityBlocked) {
        setError(
          lang === "bg"
            ? "Тази справка ще може да се изпълнява, след като сървърът потвърди точната версия на схемата и данните."
            : "This query can run after the server confirms the exact schema and data version.",
        );
        setResult(null);
        return;
      }
      const finalSql = plan ? `EXPLAIN ${trimmed}` : trimmed;
      setLoading(true);
      setError(null);
      setExpandedRow(null);
      setSort(null);
      try {
        const r = await fetch("/api/sql/query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sql: finalSql, limit }),
        });
        const j = await r.json();
        if (!r.ok || j.error) {
          setError(j.error || `HTTP ${r.status}`);
          setResult(null);
        } else {
          setResult({ ...j, plan });
          if (!plan) {
            setHistory((h) => {
              const next = [trimmed, ...h.filter((q) => q !== trimmed)].slice(
                0,
                HISTORY_MAX,
              );
              saveJson(HISTORY_KEY, next);
              return next;
            });
          }
        }
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    },
    [activeCapabilityBlocked, lang, limit],
  );

  // Run the current selection if any, else the whole editor.
  const runCurrent = useCallback(
    (plan: boolean) => {
      const view = viewRef.current;
      let text = sqlText;
      if (view) {
        const { from, to } = view.state.selection.main;
        const sel = view.state.sliceDoc(from, to);
        if (sel.trim()) text = sel;
      }
      void execute(text, plan);
    },
    [execute, sqlText],
  );
  runRef.current = runCurrent;

  const insertAtCursor = useCallback((text: string) => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch(view.state.replaceSelection(text));
    view.focus();
  }, []);

  // CodeMirror schema for autocomplete (bare names for the public schema,
  // qualified for any other).
  const cmSchema = useMemo(() => {
    const s: Record<string, string[]> = {};
    for (const t of schema?.tables ?? []) {
      const key = t.db === "public" ? t.table : `${t.db}.${t.table}`;
      s[key] = t.columns.map((c) => c.name);
    }
    return s;
  }, [schema]);

  const extensions = useMemo(
    () => [
      sql({ dialect: PostgreSQL, schema: cmSchema, upperCaseKeywords: true }),
      EditorView.lineWrapping,
      Prec.highest(
        keymap.of([
          { key: "Mod-Enter", run: () => (runRef.current(false), true) },
          { key: "Shift-Mod-Enter", run: () => (runRef.current(true), true) },
        ]),
      ),
    ],
    [cmSchema],
  );

  const toggleTable = (key: string) =>
    setExpandedTables((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const f = filter.trim().toLowerCase();
  // 57 of production's 265 relations are not data — scratch a human left
  // behind, ingest plumbing, extension views, precomputes and serving blobs.
  // `_pwy_before` (33,026 rows) was the first entry a visitor saw.
  //
  // Hiding is a LISTING decision, never a security one: app_readonly holds
  // SELECT on everything, so a hidden relation stays queryable by name — and a
  // filter typed by hand still finds it, which is why the search below ignores
  // visibility entirely.
  const filteredTables = (schema?.tables ?? []).filter((t) => {
    const matches =
      !f ||
      `${t.db}.${t.table}`.toLowerCase().includes(f) ||
      t.columns.some((c) => c.name.toLowerCase().includes(f));
    if (!matches) return false;
    if (f) return true; // an explicit search sees everything
    const v = t.visibility ?? "data";
    return v === "data" || (v === "derived" && showDerived);
  });
  const hiddenCount = (schema?.tables ?? []).filter((t) => {
    const v = t.visibility ?? "data";
    return v === "internal" || (v === "derived" && !showDerived);
  }).length;
  const serverQuestionCatalog = useMemo(
    () =>
      catalogForServerCapabilities(SQL_QUESTION_CATALOG, serverCapabilities),
    [serverCapabilities],
  );

  // Sorted view of result rows.
  const displayRows = useMemo(() => {
    if (!result) return [];
    if (!sort) return result.rows;
    const { col, dir } = sort;
    return [...result.rows].sort((a, b) => {
      const av = a[col];
      const bv = b[col];
      if (av === bv) return 0;
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === "number" && typeof bv === "number")
        return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [result, sort]);

  const clickSort = (col: string) =>
    setSort((s) =>
      s && s.col === col
        ? s.dir === 1
          ? { col, dir: -1 }
          : null
        : { col, dir: 1 },
    );

  const saveCurrent = () => {
    const name = prompt("Save query as:");
    if (!name) return;
    setSaved((s) => {
      const next = [
        { name, sql: sqlText },
        ...s.filter((q) => q.name !== name),
      ];
      saveJson(SAVED_KEY, next);
      return next;
    });
  };

  const tabBtn = (id: typeof tab, label: string) => (
    <button
      onClick={() => setTab(id)}
      aria-pressed={tab === id}
      className={`rounded px-2 py-1 text-xs ${
        tab === id
          ? "bg-accent-strong text-accent-strong-foreground"
          : "hover:bg-muted"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex min-h-[540px] w-full flex-col bg-background text-foreground lg:h-[calc(100dvh-8rem)] lg:flex-row">
      {/* Sidebar */}
      <aside className="flex max-h-72 w-full shrink-0 flex-col border-b border-border bg-muted/20 lg:max-h-none lg:w-80 lg:border-b-0 lg:border-r">
        <div
          className="flex items-center gap-1 border-b border-border p-2"
          role="group"
          aria-label={lang === "bg" ? "Панели с данни" : "Data panels"}
        >
          {tabBtn("schema", "Schema")}
          {tabBtn(
            "history",
            `History${history.length ? ` (${history.length})` : ""}`,
          )}
          {tabBtn("saved", `Saved${saved.length ? ` (${saved.length})` : ""}`)}
          <button
            className="ml-auto text-xs text-accent hover:underline"
            onClick={() => loadSchema(true)}
            title="Refresh schema (after a reload)"
          >
            refresh
          </button>
        </div>

        {tab === "schema" && (
          <>
            <div className="p-2">
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="filter tables / columns…"
                className="h-7 text-xs"
              />
              {schema && (
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {schema.databases.map((d) => d.name).join(" · ")}
                </div>
              )}
              {!f && hiddenCount > 0 && (
                <button
                  className="mt-1 text-[11px] text-accent hover:underline"
                  onClick={() => setShowDerived((v) => !v)}
                  title={
                    showDerived
                      ? "Hide precomputes, serving blobs and search indexes"
                      : "Show precomputes, serving blobs and search indexes. Scratch and ingest plumbing stay hidden — but every relation is still queryable by name, and searching finds it."
                  }
                >
                  {showDerived
                    ? "Hide derived tables"
                    : `Show derived tables (${hiddenCount} hidden)`}
                </button>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-2 pb-3 text-sm">
              {filteredTables.map((t) => {
                const key = `${t.db}.${t.table}`;
                const open = !!f || expandedTables.has(key);
                const label = t.db === "public" ? t.table : key;
                return (
                  <div key={key} className="mb-1">
                    <div className="flex items-center gap-1">
                      <button
                        className="flex-1 truncate text-left font-mono text-[13px] font-medium hover:text-accent"
                        onClick={() => toggleTable(key)}
                        title={
                          t.kind === "v"
                            ? "view — no row count"
                            : `~${t.rowCount.toLocaleString()} rows (estimate; stale until autovacuum runs)`
                        }
                      >
                        {open ? "▾ " : "▸ "}
                        {label}{" "}
                        <span className="text-muted-foreground">
                          {t.kind === "v"
                            ? "—"
                            : `~${t.rowCount.toLocaleString()}`}
                        </span>
                      </button>
                      <button
                        className="text-[11px] text-accent hover:underline"
                        title="Insert SELECT *"
                        onClick={() =>
                          insertAtCursor(`SELECT * FROM ${label} LIMIT 100;`)
                        }
                      >
                        query
                      </button>
                    </div>
                    {open && (
                      <ul className="ml-3 border-l border-border pl-2">
                        {t.columns
                          .filter(
                            (c) =>
                              !f ||
                              `${t.db}.${t.table}`.toLowerCase().includes(f) ||
                              c.name.toLowerCase().includes(f),
                          )
                          .map((c) => (
                            <li key={c.name} className="leading-5">
                              <button
                                className="font-mono text-[11px] hover:text-accent"
                                title={`Insert "${c.name}"`}
                                onClick={() => insertAtCursor(c.name)}
                              >
                                <span className={c.pk ? "font-bold" : ""}>
                                  {c.name}
                                </span>
                                <span className="ml-1 text-muted-foreground opacity-70">
                                  {c.type || "?"}
                                  {c.pk ? " pk" : c.indexed ? " idx" : ""}
                                </span>
                              </button>
                            </li>
                          ))}
                        {t.indexes.length > 0 && (
                          <li className="mt-0.5 text-[10px] italic text-muted-foreground/70">
                            {t.indexes.length} index
                            {t.indexes.length === 1 ? "" : "es"}
                          </li>
                        )}
                      </ul>
                    )}
                  </div>
                );
              })}
              {schema && filteredTables.length === 0 && (
                <div className="text-xs text-muted-foreground">No matches.</div>
              )}
            </div>
          </>
        )}

        {tab === "history" && (
          <div className="min-h-0 flex-1 overflow-auto p-2 text-xs">
            {history.length === 0 && (
              <div className="text-muted-foreground">No history yet.</div>
            )}
            {history.length > 0 && (
              <button
                className="mb-2 text-accent hover:underline"
                onClick={() => {
                  setHistory([]);
                  saveJson(HISTORY_KEY, []);
                }}
              >
                clear history
              </button>
            )}
            {history.map((q, i) => (
              <button
                key={i}
                className="mb-1 block w-full truncate rounded border border-border bg-background/50 px-2 py-1 text-left font-mono hover:bg-muted"
                title={q}
                onClick={() => setSql(q)}
              >
                {q.replace(/\s+/g, " ")}
              </button>
            ))}
          </div>
        )}

        {tab === "saved" && (
          <div className="min-h-0 flex-1 overflow-auto p-2 text-xs">
            <button
              className="mb-2 text-accent hover:underline"
              onClick={saveCurrent}
            >
              + save current query
            </button>
            {saved.length === 0 && (
              <div className="text-muted-foreground">Nothing saved.</div>
            )}
            {saved.map((q) => (
              <div key={q.name} className="mb-1 flex items-center gap-1">
                <button
                  className="flex-1 truncate rounded border border-border bg-background/50 px-2 py-1 text-left hover:bg-muted"
                  title={q.sql}
                  onClick={() => setSql(q.sql)}
                >
                  {q.name}
                </button>
                <button
                  className="text-muted-foreground hover:text-destructive"
                  title="Delete"
                  onClick={() =>
                    setSaved((s) => {
                      const next = s.filter((x) => x.name !== q.name);
                      saveJson(SAVED_KEY, next);
                      return next;
                    })
                  }
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </aside>

      {/* Main */}
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-border p-2">
          <QuestionSelector
            key={`${seeded?.recipeId ?? "new"}:${JSON.stringify(seeded?.parameters ?? {})}`}
            catalog={serverQuestionCatalog}
            surface="sql"
            lang={lang}
            lookupAdapters={questionLookupAdapters}
            initialQuestionId={seeded?.questionId}
            initialParameterValues={seeded?.parameters}
            onSelect={generateSql}
          />
          <p
            id="sql-capability-status"
            className="mt-1 text-[11px] text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            {ALL_QUERIES.length} {lang === "bg" ? "SQL справки" : "SQL queries"}
            {serverCapabilities &&
              ` · ${lang === "bg" ? "схема" : "schema"} ${serverCapabilities.schemaVersion ?? (lang === "bg" ? "стара" : "legacy")} · ${lang === "bg" ? "данни" : "data"} ${serverCapabilities.sourceVersion?.slice(0, 8) ?? (lang === "bg" ? "неизвестни" : "unknown")}`}
            {activeCapabilityBlocked &&
              ` · ${lang === "bg" ? "изпълнението на избраната справка изчаква потвърждение от сървъра" : "the selected query is waiting for server confirmation"}`}
          </p>
        </div>

        <div className="border-b border-border">
          <CodeMirror
            value={sqlText}
            height="34vh"
            theme={dark ? oneDark : undefined}
            extensions={extensions}
            onChange={(value) => {
              if (activeRendered?.sql === value) {
                setSqlText(value);
                return;
              }
              setSql(value);
            }}
            onCreateEditor={(view) => (viewRef.current = view)}
            basicSetup={{ autocompletion: true }}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 border-b border-border p-2">
          <Button
            onClick={() => runCurrent(false)}
            disabled={loading || activeCapabilityBlocked}
            aria-describedby="sql-capability-status"
            size="sm"
          >
            {loading ? "Running…" : "Run"}
          </Button>
          <Button
            onClick={() => runCurrent(true)}
            disabled={loading || activeCapabilityBlocked}
            aria-describedby="sql-capability-status"
            size="sm"
            variant="outline"
          >
            Explain
          </Button>
          <span className="text-xs text-muted-foreground">
            ⌘/Ctrl+Enter · selection runs if any
          </span>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            limit
            <Input
              type="number"
              value={limit}
              min={1}
              max={5000}
              onChange={(e) => setLimit(Number(e.target.value) || 1000)}
              className="h-7 w-20"
            />
          </label>
          {result && (
            <span className="text-xs text-muted-foreground">
              {result.plan ? "query plan · " : ""}
              {result.rowCount.toLocaleString()} row
              {result.rowCount === 1 ? "" : "s"} · {result.elapsedMs}ms
              {result.truncated ? " · truncated" : ""}
            </span>
          )}
          {result && result.rows.length > 0 && (
            <span className="ml-auto flex gap-2 text-xs">
              <button
                className="text-accent hover:underline"
                onClick={() => navigator.clipboard.writeText(toCsv(result))}
              >
                copy CSV
              </button>
              <button
                className="text-accent hover:underline"
                onClick={() => download("query.csv", "text/csv", toCsv(result))}
              >
                CSV
              </button>
              <button
                className="text-accent hover:underline"
                onClick={() =>
                  download(
                    "query.json",
                    "application/json",
                    JSON.stringify(result.rows, null, 2),
                  )
                }
              >
                JSON
              </button>
            </span>
          )}
        </div>

        {(error || urlError) && (
          <pre className="m-2 whitespace-pre-wrap rounded border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            {error || urlError}
          </pre>
        )}

        <div className="min-h-0 flex-1 overflow-auto">
          {result && result.rows.length > 0 ? (
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 z-10 bg-muted">
                <tr>
                  <th className="border-b border-border px-2 py-1 text-right text-muted-foreground">
                    #
                  </th>
                  {result.columns.map((c) => (
                    <th
                      key={c}
                      onClick={() => clickSort(c)}
                      className="cursor-pointer select-none border-b border-border px-2 py-1 text-left font-mono font-semibold hover:bg-muted-foreground/10"
                      title="Click to sort"
                    >
                      {c}
                      {sort?.col === c ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayRows.map((row, i) => (
                  <Fragment key={i}>
                    <tr
                      onClick={() =>
                        setExpandedRow((r) => (r === i ? null : i))
                      }
                      className="cursor-pointer odd:bg-muted/20 hover:bg-accent/10"
                    >
                      <td className="px-2 py-0.5 text-right text-muted-foreground">
                        {i + 1}
                      </td>
                      {result.columns.map((c) => {
                        const v = row[c];
                        const isNull = v === null || v === undefined;
                        const href = isNull ? null : cellLink(c, row, v);
                        const text = isNull ? "NULL" : String(v);
                        return (
                          <td
                            key={c}
                            className={`max-w-[28rem] truncate px-2 py-0.5 font-mono ${
                              typeof v === "number"
                                ? "text-right tabular-nums"
                                : ""
                            } ${isNull ? "italic text-muted-foreground/50" : ""}`}
                            title={isNull ? "NULL" : String(v)}
                          >
                            {href ? (
                              <a
                                href={href}
                                target="_blank"
                                rel="noreferrer"
                                className="text-accent hover:underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {text}
                              </a>
                            ) : (
                              text
                            )}
                          </td>
                        );
                      })}
                    </tr>
                    {expandedRow === i && (
                      <tr className="bg-muted/40">
                        <td />
                        <td colSpan={result.columns.length} className="p-2">
                          <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-[11px]">
                            {JSON.stringify(row, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-4 text-sm text-muted-foreground">
              {result
                ? "No rows."
                : "Run a query (⌘/Ctrl+Enter) to see results."}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};
