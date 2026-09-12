import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  decodeRollcallQuery,
  encodeRollcallQuery,
  rollcallScope,
  validateRollcallQuery,
} from "@/lib/rollcallQuery";
import { procurementPageCsv } from "@/lib/procurementExport";
import { rollcallQuery, rollcallMessage } from "../../../ai/tools/rollcall";
import {
  rollcallDisplayScope,
  rollcallDateLabel,
  rollcallStatus,
} from "@/lib/rollcallPresentation";
import { refreshRollcall } from "@/lib/rollcallContinuations";
import type { Envelope } from "../../../ai/tools/types";
export function RollcallQueryScreen() {
  const [params, setParams] = useSearchParams(),
    { i18n } = useTranslation(),
    lang = i18n.language.startsWith("bg") ? "bg" : "en",
    bg = lang === "bg";
  const token = params.get("query") || "",
    parsed = useMemo(() => decodeRollcallQuery(token), [token]);
  const [env, setEnv] = useState<Envelope | null>(null),
    [busy, setBusy] = useState(false),
    [retry, setRetry] = useState(0),
    [error, setError] = useState("");
  useEffect(() => {
    if (!parsed.ok) return;
    let active = true;
    setEnv(null);
    setError("");
    setBusy(true);
    void rollcallQuery(parsed.query, { lang, election: "" })
      .then((e) => {
        if (active) setEnv(e);
      })
      .catch(() => {
        if (active)
          setError(bg ? "Справката не е налична." : "Query unavailable.");
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [parsed, lang, bg, retry]);
  if (!parsed.ok)
    return (
      <main className="p-6">
        <h1>
          {bg
            ? "Невалидна или неподдържана справка"
            : "Invalid or unsupported query"}
        </h1>
      </main>
    );
  const q = env?.rollcall?.query || parsed.query,
    result = env?.rollcall?.result,
    ready = !!result && ["success", "partial", "empty"].includes(result.status),
    rows = ready ? env?.rows || [] : [],
    revision = result?.revision;
  const stale =
    result?.status === "stale" ||
    (!!params.get("revision") &&
      !!revision &&
      params.get("revision") !== revision);
  const navigate = (offset: number) => {
    const next = validateRollcallQuery({
      ...q,
      offset,
      expectedRevision: revision,
    });
    if (!next.ok) return;
    setParams({
      query: encodeRollcallQuery(next.query),
      revision: revision || "",
    });
  };
  const restart = () => {
    const next = refreshRollcall(q);
    const encoded = encodeRollcallQuery(next);
    if (encoded === token) setRetry((n) => n + 1);
    else setParams({ query: encoded });
  };
  const exportPage = () => {
    if (!ready || busy || stale) return;
    const publicRows = rows.map((row) =>
      Object.fromEntries(
        (env?.columns || []).map((column) => [column.label, row[column.key]]),
      ),
    );
    const content = procurementPageCsv(
      publicRows,
      rollcallDisplayScope(q, lang, result?.rows),
      revision,
    );
    const url = URL.createObjectURL(
      new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "rollcall-page.csv";
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <main className="space-y-4 p-4 sm:p-6" aria-busy={busy}>
      <h1 className="text-2xl font-semibold">
        {env?.title || (bg ? "Гласувания — справка" : "Rollcall query")}
      </h1>
      <p>{rollcallDisplayScope(q, lang, result?.rows)}</p>
      {busy && <p role="status">{bg ? "Зареждане…" : "Loading…"}</p>}
      {stale && (
        <p role="status">
          {bg
            ? "Източникът е обновен след отговора."
            : "The source has changed since the answer."}
        </p>
      )}
      <p>{env?.facts.answer}</p>
      <p>{env?.facts.coverage_note}</p>
      {(error || (!busy && env && !ready)) && (
        <div role="alert">
          <p>
            {error ||
              (bg
                ? "Справката не е налична. Обхватът е запазен."
                : "Query unavailable. Scope is preserved.")}
          </p>
          <button onClick={() => setRetry((n) => n + 1)}>
            {bg ? "Опитай отново" : "Retry"}
          </button>
          <button onClick={restart}>
            {bg
              ? "Започни от текущата версия"
              : "Restart from current revision"}
          </button>
        </div>
      )}
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <caption>
              {bg ? "Записи от тази страница" : "Records on this page"}
            </caption>
            <thead>
              <tr>
                {env?.columns?.map((c) => (
                  <th scope="col" className="p-2" key={c.key}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={String(r.key ?? i)}>
                  {env?.columns?.map((c) => (
                    <td className="border-t p-2" key={c.key}>
                      {c.key === "title" &&
                      typeof result?.rows?.[i]?.key === "string" ? (
                        <a
                          href={
                            "/rollcall/query?" +
                            new URLSearchParams({
                              query: encodeRollcallQuery({
                                ...q,
                                operation: "detail",
                                key: String(result.rows[i].key),
                                offset: 0,
                                latestN: undefined,
                                expectedRevision: revision,
                              }),
                            })
                          }
                        >
                          {String(r[c.key] ?? "—")}
                        </a>
                      ) : (
                        String(r[c.key] ?? "—")
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {ready && result?.rows?.length ? (
        <ul aria-label={bg ? "Първоизточници" : "Primary sources"}>
          {result.rows.map((r, i) =>
            typeof r.source_url === "string" &&
            /^https?:\/\//.test(r.source_url) ? (
              <li key={String(r.key)}>
                <a href={r.source_url} target="_blank" rel="noreferrer">
                  {bg ? "Източник за запис" : "Source for record"} {i + 1}
                </a>
              </li>
            ) : null,
          )}
        </ul>
      ) : null}
      {result?.comparisons?.map((window, i) => (
        <section key={i}>
          <h2>{window.query ? rollcallScope(window.query, lang) : ""}</h2>
          <p>
            {window.totals?.records ?? "—"} {bg ? "записа" : "records"} ·{" "}
            {rollcallStatus(window.status, lang)}
            {window.metrics?.percentage != null
              ? ` · ${window.metrics.percentage}%`
              : ""}
          </p>
          {window.metrics && (
            <p>
              {bg ? "Числител / знаменател" : "Numerator / denominator"}:{" "}
              {window.metrics.numerator ?? "—"} /{" "}
              {window.metrics.denominator ?? "—"}
            </p>
          )}
          {window.reason && <p>{rollcallMessage(window.reason, lang)}</p>}
          <p>
            {bg
              ? "Решения без поименен вот"
              : "Resolutions without named rolls"}
            : {String(window.coverage?.missingRolls ?? "—")}
          </p>
        </section>
      ))}
      <div className="flex gap-3">
        <button
          disabled={
            busy || !ready || q.offset === 0 || q.operation === "compare"
          }
          onClick={() => navigate(Math.max(0, q.offset - q.limit))}
        >
          {bg ? "Предишна страница" : "Previous page"}
        </button>
        <button
          disabled={
            busy ||
            !ready ||
            q.operation === "compare" ||
            q.offset + q.limit >=
              (q.groupBy
                ? (result?.groupCount ?? 0)
                : (result?.totals?.records ?? 0)) ||
            q.offset + q.limit > 10000
          }
          onClick={() => navigate(q.offset + q.limit)}
        >
          {bg ? "Следваща страница" : "Next page"}
        </button>
        <button
          disabled={busy || !ready || stale || !rows.length}
          onClick={exportPage}
        >
          {bg ? "Изтегли тази страница (CSV)" : "Export this page (CSV)"}
        </button>
      </div>
      <details>
        <summary>
          {bg
            ? "Обхват, знаменател и липсващи данни"
            : "Scope, denominator and missing data"}
        </summary>
        <p>{env?.facts.coverage_note}</p>
        <p>
          {bg ? "Числител / знаменател" : "Numerator / denominator"}:{" "}
          {result?.metrics?.numerator ?? "—"} /{" "}
          {result?.metrics?.denominator ?? "—"}
        </p>
        <p>
          {bg ? "Последна индексирана дата" : "Latest indexed date"}:{" "}
          {rollcallDateLabel(
            result?.coverage?.latestIndexed,
            result?.coverage?.yearOnly,
          )}
        </p>
        <p>
          {bg
            ? "Решения без публикуван поименен вот"
            : "Resolutions without a published named roll"}
          : {String(result?.coverage?.missingRolls ?? "—")}
        </p>
        <p>
          {bg
            ? "Гласовете са публикувани записи, а не доказателство за физическо присъствие. Липсващи гласове и неизвестни стойности не са нули."
            : "Casts are published records, not proof of physical attendance. Missing casts and unknown values are not zeros."}
        </p>
      </details>
    </main>
  );
}
