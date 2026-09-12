import { useEffect, useMemo, useState, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  decodeProcurementQuery,
  encodeProcurementQuery,
  validateProcurementQuery,
} from "@/lib/procurementQuery";
import { procurementPageCsv } from "@/lib/procurementExport";
import { procurementQuery } from "../../../ai/tools/procurement";
import type { Envelope } from "../../../ai/tools/types";
export const ProcurementQueryScreen = () => {
  const [params, setParams] = useSearchParams(),
    { i18n } = useTranslation(),
    lang = i18n.language.startsWith("bg") ? "bg" : "en",
    bg = lang === "bg";
  const token = params.get("query") || "",
    decoded = useMemo(() => decodeProcurementQuery(token), [token]);
  const [env, setEnv] = useState<Envelope | null>(null),
    [offset, setOffset] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [retry, setRetry] = useState(0),
    [updated, setUpdated] = useState(false);
  const revision = useRef<string | null>(null);
  useEffect(() => {
    setOffset(0);
    revision.current = null;
    setEnv(null);
    setUpdated(false);
  }, [token]);
  useEffect(() => {
    if (!decoded.ok) return;
    let active = true;
    setBusy(true);
    setEnv(null);
    setError("");
    const parsed = validateProcurementQuery({ ...decoded.query, offset });
    if (!parsed.ok) {
      setError(bg ? "Невалидна страница" : "Invalid page");
      setBusy(false);
      return;
    }
    void procurementQuery(parsed.query, { lang, election: "" })
      .then((result) => {
        if (!active) return;
        if (result.procurement?.result.status === "unavailable") {
          setEnv(result);
          setError(
            bg
              ? "Справката временно не е налична. Филтрите са запазени."
              : "Query temporarily unavailable. Filters are preserved.",
          );
          return;
        }
        const next = JSON.stringify(result.procurement?.result.revision || {});
        if (revision.current && next !== revision.current && offset > 0) {
          setUpdated(true);
          setOffset(0);
          revision.current = next;
          return;
        }
        if (params.get("revision") && next !== params.get("revision"))
          setUpdated(true);
        revision.current = next;
        setEnv(result);
      })
      .catch(() => {
        if (active)
          setError(
            bg
              ? "Справката временно не е налична. Филтрите са запазени."
              : "Query temporarily unavailable. Filters are preserved.",
          );
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [decoded, offset, lang, bg, params, retry]);
  if (!decoded.ok)
    return (
      <main className="p-6">
        <h1>
          {bg
            ? "Невалидна или неподдържана справка"
            : "Invalid or unsupported query"}
        </h1>
      </main>
    );
  const result = env?.procurement?.result,
    rows = env?.rows || result?.rows || [],
    limit = Number(decoded.query.limit || 20);
  const exportPage = () => {
    const content = procurementPageCsv(
      rows,
      env?.subtitle || "",
      result?.revision,
    );
    const href = URL.createObjectURL(
      new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = href;
    a.download = "procurement-page.csv";
    a.click();
    URL.revokeObjectURL(href);
  };
  const columns = rows.length ? Object.keys(rows[0]) : [];
  return (
    <main className="space-y-4 p-4 sm:p-6" aria-busy={busy}>
      <h1 className="text-2xl font-semibold">
        {env?.title ||
          (bg ? "Обществени поръчки — справка" : "Procurement query")}
      </h1>
      <p>{env?.subtitle}</p>
      {decoded.query.status === "open" && (
        <button
          disabled={busy}
          onClick={() => {
            const next = new URLSearchParams(params);
            next.set(
              "query",
              encodeProcurementQuery({
                ...decoded.query,
                offset: 0,
                asOf: new Date().toISOString(),
              }),
            );
            next.delete("revision");
            setParams(next);
          }}
        >
          {bg ? "Обнови отворените към момента" : "Refresh open now"}
        </button>
      )}
      {updated && (
        <p role="status">
          {bg
            ? "Данните са обновени след първоначалния отговор. Страниците използват текущата версия."
            : "Data has changed since the original answer. Pages use the current revision."}
        </p>
      )}
      {error && (
        <>
          <p role="alert">{error}</p>
          <button onClick={() => setRetry((n) => n + 1)}>
            {bg ? "Опитай отново" : "Retry"}
          </button>
        </>
      )}
      {busy && <p role="status">{bg ? "Зареждане…" : "Loading…"}</p>}
      <p className="text-xl">{env?.facts?.answer}</p>
      <p>{env?.facts?.coverage_note}</p>
      {env?.rows && env.columns && (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr>
                {env.columns.map((c) => (
                  <th className="p-2" key={c.key}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {env.rows.map((r, i) => (
                <tr key={i}>
                  {env.columns!.map((c) => (
                    <td className="border-t p-2" key={c.key}>
                      {String(r[c.key] ?? "—")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!env?.rows && rows.length > 0 && (
        <details>
          <summary>
            {bg ? "Записи от същата справка" : "Records from this query"}
          </summary>
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th className="p-2" key={c}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    {columns.map((c) => (
                      <td className="p-2" key={c}>
                        {String(r[c] ?? "—")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      <div className="flex gap-3">
        <button
          disabled={
            busy || offset === 0 || decoded.query.operation === "compare"
          }
          onClick={() => setOffset(Math.max(0, offset - limit))}
        >
          {bg ? "Предишна страница" : "Previous page"}
        </button>
        <button
          disabled={
            busy ||
            !env ||
            decoded.query.operation === "compare" ||
            rows.length < limit ||
            offset + limit > 10000
          }
          onClick={() => setOffset(offset + limit)}
        >
          {bg ? "Следваща страница" : "Next page"}
        </button>
        <button disabled={busy || !rows.length} onClick={exportPage}>
          {bg ? "Изтегли тази страница (CSV)" : "Export this page (CSV)"}
        </button>
      </div>
    </main>
  );
};
