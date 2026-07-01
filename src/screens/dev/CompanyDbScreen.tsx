// DB-backed company page (/db/company/:eik). Works for ANY registered company —
// including the ~1M TR companies with no procurement (hence no JSON shard). Fed
// live from Postgres via /api/db/company: TR identity + capital, officers with
// ownership %, political connections, and a link out to the full procurement
// dashboard when the company has contracts. Served by /api/db — the Vite plugin
// in dev, the `db` Cloud Function (hosting rewrite) in prod.
// See docs/plans/postgres-migration-v1.md.

import { FC, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Building2, Landmark, Users, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEur } from "@/lib/currency";

interface Company {
  uic: string;
  name: string | null;
  legal_form: string | null;
  seat: string | null;
  status: string | null;
  funds_amount: string | number | null;
  funds_currency: string | null;
}
interface Summary {
  contracts: number;
  contracts_eur: number;
}
interface Officer {
  name: string;
  role: string | null;
  share: string | number | null;
  share_amount: string | number | null;
  share_currency: string | null;
  added_at: string | null;
  erased_at: string | null;
  active: boolean;
}
interface Politician {
  politician: string;
  ref: string;
  kind: string;
  role: string | null;
  total_eur: number | null;
}

const num = new Intl.NumberFormat("bg-BG");
const day = (s: string | null): string => (s ? String(s).slice(0, 10) : "—");
const pct = (s: string | number | null): string =>
  s === null || s === undefined || s === "" ? "—" : `${Math.round(Number(s))}%`;

export const CompanyDbScreen: FC = () => {
  const { eik = "" } = useParams();

  const [company, setCompany] = useState<Company | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [politicians, setPoliticians] = useState<Politician[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    fetch(`/api/db/company?eik=${encodeURIComponent(eik)}`)
      .then((r) => r.json())
      .then((j) => {
        if (!live) return;
        if (j.error) setError(j.error);
        else {
          setCompany(j.company);
          setSummary(j.summary);
          setOfficers(j.officers ?? []);
          setPoliticians(j.politicians ?? []);
        }
      })
      .catch((e) => live && setError(String(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [eik]);

  const contracts = Number(summary?.contracts ?? 0);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <div className="mb-6">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          Фирма (Търговски регистър)
        </div>
        <h1 className="text-2xl font-bold">
          {company?.name ?? eik}{" "}
          {company?.legal_form && (
            <span className="text-base font-normal text-muted-foreground">
              {company.legal_form}
            </span>
          )}
        </h1>
        {!loading && !error && (
          <div className="mt-2 flex flex-wrap gap-4 text-sm text-muted-foreground">
            <span>ЕИК {eik}</span>
            {company?.status && <span>{company.status}</span>}
            {company?.funds_amount != null && (
              <span>
                капитал {num.format(Number(company.funds_amount))}{" "}
                {company.funds_currency ?? ""}
              </span>
            )}
            <span>{num.format(contracts)} договора</span>
            {summary?.contracts_eur ? (
              <span>{formatEur(summary.contracts_eur)}</span>
            ) : null}
            <span>{num.format(politicians.length)} политически връзки</span>
          </div>
        )}
        {company?.seat && (
          <div className="mt-1 text-sm text-muted-foreground">
            {company.seat}
          </div>
        )}
        {contracts > 0 && (
          <Link
            to={`/company/${eik}`}
            className="mt-2 inline-flex items-center gap-1 text-sm text-accent hover:underline"
          >
            Обществени поръчки — пълно табло <ArrowRight className="h-3 w-3" />
          </Link>
        )}
      </div>

      {loading && <div className="text-muted-foreground">Зареждане…</div>}
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          {error}
        </div>
      )}
      {!loading && !error && !company && (
        <div className="text-sm text-muted-foreground">
          Няма фирма с ЕИК {eik} в базата.
        </div>
      )}

      {!loading && !error && company && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="h-4 w-4" /> Лица (
                {num.format(officers.length)})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {officers.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  Няма вписани лица.
                </div>
              ) : (
                <table className="w-full text-sm [&_td]:px-2 [&_td]:first:pl-0 [&_th]:px-2 [&_th]:first:pl-0">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="py-1">Лице</th>
                      <th className="py-1">Роля</th>
                      <th className="py-1 text-right">Дял</th>
                      <th className="py-1">От</th>
                      <th className="py-1">Статус</th>
                    </tr>
                  </thead>
                  <tbody>
                    {officers.map((o, i) => (
                      <tr
                        key={`${o.name}-${o.role}-${i}`}
                        className="border-t border-border"
                      >
                        <td className="py-1">
                          <Link
                            to={`/person/${encodeURIComponent(o.name)}`}
                            className="text-accent hover:underline"
                          >
                            {o.name}
                          </Link>
                        </td>
                        <td className="py-1 text-muted-foreground">{o.role}</td>
                        <td className="py-1 text-right tabular-nums">
                          {pct(o.share)}
                          {o.share_amount != null && (
                            <span className="ml-1 text-xs text-muted-foreground/70">
                              ({num.format(Number(o.share_amount))}
                              {o.share_currency ? ` ${o.share_currency}` : ""})
                            </span>
                          )}
                        </td>
                        <td className="py-1 tabular-nums text-muted-foreground">
                          {day(o.added_at)}
                        </td>
                        <td className="py-1">
                          {o.active ? (
                            <span className="text-emerald-600">активен</span>
                          ) : (
                            <span className="text-muted-foreground">
                              бивш · {day(o.erased_at)}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Landmark className="h-4 w-4" /> Политически връзки (
                {num.format(politicians.length)})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {politicians.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  Няма установени връзки с политици.
                </div>
              ) : (
                <ul className="space-y-2">
                  {politicians.map((p, i) => (
                    <li key={`${p.ref}-${i}`} className="text-sm">
                      <Link
                        to={p.ref}
                        className="font-medium text-accent hover:underline"
                      >
                        {p.politician}
                      </Link>
                      <span className="text-muted-foreground">
                        {" "}
                        · {p.kind === "mp" ? "депутат" : "служител"}
                        {p.role ? ` · ${p.role}` : ""}
                        {p.total_eur ? ` · ${formatEur(p.total_eur)}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {contracts === 0 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Building2 className="h-4 w-4" /> Фирмата няма обществени поръчки
              в базата.
            </div>
          )}
        </div>
      )}
    </div>
  );
};
