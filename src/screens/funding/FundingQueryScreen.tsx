import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  type FundingQuery,
  decodeFundingQuery,
  encodeFundingQuery,
  validateFundingQuery,
} from "@/lib/fundingQuery";
import { procurementPageCsv } from "@/lib/procurementExport";
import { fundingQuery, fundingScope } from "../../../ai/tools/funding";
import type { Envelope } from "../../../ai/tools/types";
export function FundingQueryScreen() {
  const [params, setParams] = useSearchParams(),
    { i18n } = useTranslation(),
    lang = i18n.language.startsWith("bg") ? "bg" : "en",
    bg = lang === "bg";
  const token = params.get("query") || "",
    parsed = useMemo(() => decodeFundingQuery(token), [token]);
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
    void fundingQuery(parsed.query, { lang, election: "" })
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
  const q = parsed.query,
    result = env?.funding?.result,
    ready = !!result && ["success", "partial", "empty"].includes(result.status),
    rows = ready ? env?.rows || [] : [],
    revision = result?.revision;
  const stale =
    !!params.get("revision") &&
    !!revision &&
    params.get("revision") !== revision;
  const navigate = (offset: number) => {
    const next = validateFundingQuery({
      ...q,
      offset,
      expectedRevision: revision,
    });
    if (!next.ok) return;
    setParams({
      query: encodeFundingQuery(next.query),
      revision: revision || "",
    });
  };
  const restart = () => {
    const next: FundingQuery = { ...q, offset: 0 };
    delete next.expectedRevision;
    if (next.parentQuery) {
      const p = decodeFundingQuery(next.parentQuery);
      if (p.ok) {
        const parent: FundingQuery = { ...p.query };
        delete parent.expectedRevision;
        next.parentQuery = encodeFundingQuery(parent);
      }
    }
    const encoded = encodeFundingQuery(next);
    if (encoded === token) setRetry((n) => n + 1);
    else setParams({ query: encoded });
  };
  const exportPage = () => {
    if (!ready || busy) return;
    const content = procurementPageCsv(
      rows,
      fundingScope(q, { lang }),
      revision,
    );
    const url = URL.createObjectURL(
      new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "funding-page.csv";
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <main className="space-y-4 p-4 sm:p-6" aria-busy={busy}>
      <h1 className="text-2xl font-semibold">
        {env?.title || (bg ? "Финансиране — справка" : "Funding query")}
      </h1>
      <p>{fundingScope(q, { lang })}</p>
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
                      {String(r[c.key] ?? "—")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
            rows.length < q.limit ||
            q.offset + q.limit > 10000
          }
          onClick={() => navigate(q.offset + q.limit)}
        >
          {bg ? "Следваща страница" : "Next page"}
        </button>
        <button disabled={busy || !ready || !rows.length} onClick={exportPage}>
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
          {bg
            ? "Сумите са по посочената парична основа. Липсващи стойности не са нули. Партньорският бюджет е различен от целия бюджет на операцията."
            : "Amounts use the stated money basis. Missing values are not zeros. Partner budgets differ from whole operation budgets."}
        </p>
      </details>
    </main>
  );
}
