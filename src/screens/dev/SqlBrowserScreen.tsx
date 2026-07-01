// Dev-only SQL browser over the procurement source-of-truth SQLite (with the
// TR commerce-registry DB attached as `tr`). Talks to the /__sql/* endpoints
// served by vite/sql-browser.ts — dev server only. The route is registered in
// routes.tsx only under import.meta.env.DEV, so this never ships to production.
//
// See docs/plans/sql-migration-v1.md.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";

interface ColumnInfo {
  name: string;
  type: string;
  pk: boolean;
  notnull: boolean;
}
interface TableInfo {
  db: string;
  table: string;
  rowCount: number;
  columns: ColumnInfo[];
}
interface SchemaResponse {
  databases: Array<{ name: string; file: string }>;
  tables: TableInfo[];
}
interface QueryResult {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  truncated: boolean;
  elapsedMs: number;
}

const SAMPLES: Array<{ label: string; sql: string }> = [
  {
    label: "Top contractors by spend",
    sql: `SELECT contractor_eik, contractor_name,
       ROUND(SUM(amount_eur)) AS eur, COUNT(*) AS n
FROM contracts
WHERE tag = 'contract'
GROUP BY contractor_eik
ORDER BY eur DESC
LIMIT 25;`,
  },
  {
    label: "Contractors × TR officers (join)",
    sql: `SELECT c.contractor_eik, c.contractor_name,
       p.role, p.name AS officer,
       ROUND(SUM(c.amount_eur)) AS eur, COUNT(*) AS n
FROM contracts c
JOIN tr.company_persons p ON p.uic = c.contractor_eik
WHERE c.tag = 'contract' AND p.erased_at IS NULL
GROUP BY c.contractor_eik, p.role, p.name
ORDER BY eur DESC
LIMIT 50;`,
  },
  {
    label: "Contractor → TR company record",
    sql: `SELECT co.uic, co.name, co.legal_form, co.status,
       ROUND(SUM(c.amount_eur)) AS eur
FROM contracts c
JOIN tr.companies co ON co.uic = c.contractor_eik
WHERE c.tag = 'contract'
GROUP BY co.uic
ORDER BY eur DESC
LIMIT 50;`,
  },
  {
    label: "Single-bidder contracts",
    sql: `SELECT date, awarder_name, contractor_name, amount_eur
FROM contracts
WHERE tag = 'contract' AND number_of_tenderers = 1
ORDER BY amount_eur DESC
LIMIT 50;`,
  },
  {
    label: "Top awarders",
    sql: `SELECT awarder_eik, awarder_name,
       ROUND(SUM(amount_eur)) AS eur, COUNT(*) AS n
FROM contracts
WHERE tag = 'contract'
GROUP BY awarder_eik
ORDER BY eur DESC
LIMIT 25;`,
  },
];

const fmtCell = (
  v: unknown,
): { text: string; muted: boolean; num: boolean } => {
  if (v === null || v === undefined)
    return { text: "NULL", muted: true, num: false };
  if (typeof v === "number")
    return { text: String(v), muted: false, num: true };
  return { text: String(v), muted: false, num: false };
};

export const SqlBrowserScreen = () => {
  const [schema, setSchema] = useState<SchemaResponse | null>(null);
  const [sql, setSql] = useState(SAMPLES[0].sql);
  const [limit, setLimit] = useState(1000);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const loadSchema = useCallback((reopen = false) => {
    fetch(`/__sql/schema${reopen ? "?reopen=1" : ""}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.error) setError(j.error);
        else setSchema(j);
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => loadSchema(), [loadSchema]);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/__sql/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql, limit }),
      });
      const j = await r.json();
      if (!r.ok || j.error) {
        setError(j.error || `HTTP ${r.status}`);
        setResult(null);
      } else {
        setResult(j);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [sql, limit]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void run();
    }
  };

  const insert = (text: string) => {
    setSql(text);
    taRef.current?.focus();
  };

  const csv = useMemo(() => {
    if (!result) return "";
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [
      result.columns.join(","),
      ...result.rows.map((row) =>
        result.columns.map((c) => esc(row[c])).join(","),
      ),
    ].join("\n");
  }, [result]);

  if (!import.meta.env.DEV) {
    return <div className="p-8 text-foreground">SQL browser is dev-only.</div>;
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] w-full text-foreground">
      {/* Schema sidebar */}
      <aside className="w-72 shrink-0 overflow-auto border-r border-border bg-muted/30 p-3 text-sm">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-semibold">Schema</span>
          <button
            className="text-xs text-accent hover:underline"
            onClick={() => loadSchema(true)}
            title="Reopen the DB (after db:load) and refresh"
          >
            reopen
          </button>
        </div>
        {schema?.databases.map((d) => (
          <div key={d.name} className="mb-1 text-xs text-muted-foreground">
            {d.name}
          </div>
        ))}
        <div className="mt-2 space-y-3">
          {schema?.tables.map((t) => (
            <div key={`${t.db}.${t.table}`}>
              <button
                className="w-full text-left font-mono text-[13px] font-medium hover:text-accent"
                onClick={() =>
                  insert(
                    `SELECT * FROM ${t.db === "main" ? "" : `${t.db}.`}${t.table} LIMIT 100;`,
                  )
                }
                title={`${t.rowCount.toLocaleString()} rows — click to query`}
              >
                {t.db === "main" ? "" : `${t.db}.`}
                {t.table}{" "}
                <span className="text-muted-foreground">
                  ({t.rowCount.toLocaleString()})
                </span>
              </button>
              <ul className="ml-2 mt-0.5 border-l border-border pl-2">
                {t.columns.map((c) => (
                  <li
                    key={c.name}
                    className="font-mono text-[11px] leading-5 text-muted-foreground"
                  >
                    {c.name}
                    <span className="ml-1 opacity-60">
                      {c.type || "?"}
                      {c.pk ? " · pk" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </aside>

      {/* Editor + results */}
      <main className="flex min-w-0 flex-1 flex-col p-3">
        <div className="mb-2 flex flex-wrap gap-1">
          {SAMPLES.map((s) => (
            <button
              key={s.label}
              onClick={() => insert(s.sql)}
              className="rounded border border-border bg-muted/40 px-2 py-1 text-xs hover:bg-muted"
            >
              {s.label}
            </button>
          ))}
        </div>

        <Textarea
          ref={taRef}
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          className="h-40 resize-y font-mono text-[13px]"
        />

        <div className="my-2 flex items-center gap-3">
          <Button onClick={() => void run()} disabled={loading} size="sm">
            {loading ? "Running…" : "Run"}
          </Button>
          <span className="text-xs text-muted-foreground">⌘/Ctrl+Enter</span>
          <label className="ml-2 flex items-center gap-1 text-xs text-muted-foreground">
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
              {result.rowCount.toLocaleString()} row
              {result.rowCount === 1 ? "" : "s"} · {result.elapsedMs}ms
              {result.truncated ? " · truncated" : ""}
            </span>
          )}
          {result && result.rows.length > 0 && (
            <button
              className="text-xs text-accent hover:underline"
              onClick={() => navigator.clipboard.writeText(csv)}
            >
              copy CSV
            </button>
          )}
        </div>

        {error && (
          <pre className="mb-2 whitespace-pre-wrap rounded border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            {error}
          </pre>
        )}

        <div className="min-h-0 flex-1 overflow-auto rounded border border-border">
          {result && result.rows.length > 0 ? (
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 bg-muted">
                <tr>
                  <th className="border-b border-border px-2 py-1 text-right text-muted-foreground">
                    #
                  </th>
                  {result.columns.map((c) => (
                    <th
                      key={c}
                      className="border-b border-border px-2 py-1 text-left font-mono font-semibold"
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, i) => (
                  <tr key={i} className="odd:bg-muted/20">
                    <td className="px-2 py-0.5 text-right text-muted-foreground">
                      {i + 1}
                    </td>
                    {result.columns.map((c) => {
                      const cell = fmtCell(row[c]);
                      return (
                        <td
                          key={c}
                          className={`max-w-[28rem] truncate px-2 py-0.5 font-mono ${
                            cell.num ? "text-right tabular-nums" : ""
                          } ${cell.muted ? "italic text-muted-foreground/60" : ""}`}
                          title={cell.text}
                        >
                          {cell.text}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-4 text-sm text-muted-foreground">
              {result ? "No rows." : "Run a query to see results."}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};
