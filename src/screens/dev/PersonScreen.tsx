// Dev-only, DB-backed person page (/person/:name). Unlike the JSON-fed
// /procurement/people scanner, this queries Postgres live (via the /__db dev API)
// so it works for ANY TR officer, not just the political class:
//   • the companies the person is an officer of (+ roles + procurement),
//   • political connections (companies they're tied to that a politician is
//     curated-linked to — from company_politicians),
//   • a custom connection check: enter any other name and see the companies
//     where both are co-officers.
// A person is identified only by folded name (TR has no person id), so rows may
// span more than one real individual sharing the name. Route is DEV-gated in
// routes.tsx (the /__db API only exists on the dev server) — the seam a deployed
// Cloud Function would later fill. See docs/plans/postgres-migration-v1.md.

import { FC, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Building2, Landmark, Link2, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatEur } from "@/lib/currency";

interface ProfileRow {
  uic: string;
  company: string | null;
  status: string | null;
  roles: string | null;
  active: number | null;
  contracts: string;
  contracts_eur: number;
  politician_links: string;
}
interface PoliticianRow {
  politician: string;
  ref: string;
  kind: string;
  role: string | null;
  via_eik: string;
  via_company: string | null;
  total_eur: number | null;
}
interface ConnRow {
  uic: string;
  company: string | null;
  status: string | null;
  a_roles: string | null;
  b_roles: string | null;
}

const num = new Intl.NumberFormat("bg-BG");

export const PersonScreen: FC = () => {
  const { name = "" } = useParams();
  const person = decodeURIComponent(name);

  const [profile, setProfile] = useState<ProfileRow[]>([]);
  const [politicians, setPoliticians] = useState<PoliticianRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    fetch(`/__db/person?name=${encodeURIComponent(person)}`)
      .then((r) => r.json())
      .then((j) => {
        if (!live) return;
        if (j.error) setError(j.error);
        else {
          setProfile(j.profile ?? []);
          setPoliticians(j.politicians ?? []);
        }
      })
      .catch((e) => live && setError(String(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [person]);

  const summary = useMemo(() => {
    const byUic = new Map<string, ProfileRow>();
    for (const r of profile) if (!byUic.has(r.uic)) byUic.set(r.uic, r);
    let eur = 0;
    let contracts = 0;
    for (const r of byUic.values()) {
      eur += r.contracts_eur ?? 0;
      contracts += Number(r.contracts) || 0;
    }
    return { companies: byUic.size, eur, contracts };
  }, [profile]);

  // Custom connection check.
  const [other, setOther] = useState("");
  const [conn, setConn] = useState<ConnRow[] | null>(null);
  const [connLoading, setConnLoading] = useState(false);
  const checkConnection = useCallback(() => {
    const b = other.trim();
    if (!b) return;
    setConnLoading(true);
    setConn(null);
    fetch(
      `/__db/connection?a=${encodeURIComponent(person)}&b=${encodeURIComponent(b)}`,
    )
      .then((r) => r.json())
      .then((j) => setConn(j.shared ?? []))
      .catch(() => setConn([]))
      .finally(() => setConnLoading(false));
  }, [other, person]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <div className="mb-6">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          Лице (Търговски регистър)
        </div>
        <h1 className="text-2xl font-bold">{person}</h1>
        {!loading && !error && (
          <div className="mt-2 flex flex-wrap gap-4 text-sm text-muted-foreground">
            <span>{num.format(summary.companies)} фирми</span>
            <span>{num.format(summary.contracts)} договора</span>
            <span>{formatEur(summary.eur)}</span>
            <span>{num.format(politicians.length)} политически връзки</span>
          </div>
        )}
      </div>

      {loading && <div className="text-muted-foreground">Зареждане…</div>}
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          {error}
        </div>
      )}

      {!loading && !error && (
        <div className="space-y-6">
          {/* Companies */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Building2 className="h-4 w-4" /> Фирми (
                {num.format(summary.companies)})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {profile.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  Няма намерени фирми за това име.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="py-1">Фирма</th>
                      <th className="py-1">Роля</th>
                      <th className="py-1 text-right">Договори</th>
                      <th className="py-1 text-right">Стойност</th>
                      <th className="py-1 text-right">Политици</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profile.map((r, i) => (
                      <tr
                        key={`${r.uic}-${i}`}
                        className="border-t border-border"
                      >
                        <td className="py-1">
                          <Link
                            to={`/company/${r.uic}`}
                            className="text-accent hover:underline"
                          >
                            {r.company ?? r.uic}
                          </Link>
                          {r.status && r.status !== "active" && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              {r.status}
                            </span>
                          )}
                        </td>
                        <td className="py-1 text-muted-foreground">
                          {r.roles}
                        </td>
                        <td className="py-1 text-right tabular-nums">
                          {num.format(Number(r.contracts))}
                        </td>
                        <td className="py-1 text-right tabular-nums">
                          {r.contracts_eur ? formatEur(r.contracts_eur) : "—"}
                        </td>
                        <td className="py-1 text-right tabular-nums">
                          {Number(r.politician_links) > 0
                            ? r.politician_links
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          {/* Political connections */}
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
                  Няма установени връзки с политици през общите фирми.
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
                        {p.role ? ` · ${p.role}` : ""} · през{" "}
                        <Link
                          to={`/company/${p.via_eik}`}
                          className="hover:underline"
                        >
                          {p.via_company ?? p.via_eik}
                        </Link>
                        {p.total_eur ? ` · ${formatEur(p.total_eur)}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Custom connection check */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Link2 className="h-4 w-4" /> Проверка на връзка
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-3 flex gap-2">
                <Input
                  value={other}
                  onChange={(e) => setOther(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && checkConnection()}
                  placeholder="друго име (напр. политик или лице)…"
                  className="h-9 max-w-md"
                />
                <Button onClick={checkConnection} disabled={connLoading}>
                  <Search className="mr-1 h-4 w-4" /> Провери
                </Button>
              </div>
              {conn !== null &&
                (conn.length === 0 ? (
                  <div className="text-sm text-muted-foreground">
                    Няма общи фирми между „{person}“ и „{other}“.
                  </div>
                ) : (
                  <div className="text-sm">
                    <div className="mb-1 text-muted-foreground">
                      Общи фирми ({num.format(conn.length)}):
                    </div>
                    <ul className="space-y-1">
                      {conn.map((c, i) => (
                        <li key={`${c.uic}-${i}`}>
                          <Link
                            to={`/company/${c.uic}`}
                            className="text-accent hover:underline"
                          >
                            {c.company ?? c.uic}
                          </Link>
                          <span className="text-muted-foreground">
                            {" "}
                            — „{person}“: {c.a_roles} · „{other}“: {c.b_roles}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};
