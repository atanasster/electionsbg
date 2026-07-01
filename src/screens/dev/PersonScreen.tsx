// DB-backed person page (/person/:name). Unlike the JSON-fed /procurement/people
// scanner, this queries Postgres live so it works for ANY TR officer, not just
// the political class:
//   • per-role history — the companies + roles the person holds/held, with the
//     from/to dates, current-vs-former status, procurement, and ownership share %,
//   • political connections (companies they're tied to that a politician is
//     curated-linked to — from company_politicians),
//   • a chronology of role events (added / removed),
//   • a custom connection check: enter any other name → shared companies.
// A person is identified only by folded name (TR has no person id), so rows may
// span more than one real individual sharing the name; and our TR store only
// covers ~2022+, so older participations may be missing. Served by /api/db — the
// Vite plugin in dev, the `db` Cloud Function (hosting rewrite) in prod.
// See docs/plans/postgres-migration-v1.md.

import { FC, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Building2, Clock, Landmark, Link2, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatEur } from "@/lib/currency";

interface RoleRow {
  uic: string;
  company: string | null;
  status: string | null;
  role: string | null;
  share: string | number | null;
  added_at: string | null;
  erased_at: string | null;
  active: boolean;
  contracts: string;
  contracts_eur: number;
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
const day = (s: string | null): string => (s ? String(s).slice(0, 10) : "—");
const pct = (s: string | number | null): string =>
  s === null || s === undefined || s === "" ? "—" : `${Math.round(Number(s))}%`;

export const PersonScreen: FC = () => {
  const { name = "" } = useParams();
  const person = decodeURIComponent(name);

  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [politicians, setPoliticians] = useState<PoliticianRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    fetch(`/api/db/person?name=${encodeURIComponent(person)}`)
      .then((r) => r.json())
      .then((j) => {
        if (!live) return;
        if (j.error) setError(j.error);
        else {
          setRoles(j.roles ?? []);
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
    const byUic = new Map<string, RoleRow>();
    for (const r of roles) if (!byUic.has(r.uic)) byUic.set(r.uic, r);
    let eur = 0;
    let contracts = 0;
    for (const r of byUic.values()) {
      eur += r.contracts_eur ?? 0;
      contracts += Number(r.contracts) || 0;
    }
    const active = roles.filter((r) => r.active).length;
    return { companies: byUic.size, eur, contracts, active };
  }, [roles]);

  // Chronology: an event per role opened (+) and closed (−), newest first.
  const chronology = useMemo(() => {
    const ev: Array<{
      date: string;
      sign: "+" | "−";
      role: string | null;
      company: string | null;
      uic: string;
      share: string | number | null;
    }> = [];
    for (const r of roles) {
      if (r.added_at)
        ev.push({
          date: r.added_at,
          sign: "+",
          role: r.role,
          company: r.company,
          uic: r.uic,
          share: r.share,
        });
      if (r.erased_at)
        ev.push({
          date: r.erased_at,
          sign: "−",
          role: r.role,
          company: r.company,
          uic: r.uic,
          share: r.share,
        });
    }
    ev.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return ev;
  }, [roles]);

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
      `/api/db/connection?a=${encodeURIComponent(person)}&b=${encodeURIComponent(b)}`,
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
            <span>{num.format(summary.active)} активни роли</span>
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
          {/* Roles / companies */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Building2 className="h-4 w-4" /> Участия (
                {num.format(roles.length)})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {roles.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  Няма намерени участия за това име.
                </div>
              ) : (
                <table className="w-full text-sm [&_td]:px-2 [&_td]:first:pl-0 [&_th]:px-2 [&_th]:first:pl-0">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="py-1">Фирма</th>
                      <th className="py-1">Роля</th>
                      <th className="py-1 text-right">Дял</th>
                      <th className="py-1">От</th>
                      <th className="py-1">Статус</th>
                      <th className="py-1 text-right">Договори</th>
                      <th className="py-1 text-right">Стойност</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roles.map((r, i) => (
                      <tr
                        key={`${r.uic}-${r.role}-${i}`}
                        className="border-t border-border"
                      >
                        <td className="py-1">
                          <Link
                            to={`/db/company/${r.uic}`}
                            className="text-accent hover:underline"
                          >
                            {r.company ?? r.uic}
                          </Link>
                        </td>
                        <td className="py-1 text-muted-foreground">{r.role}</td>
                        <td className="py-1 text-right tabular-nums">
                          {pct(r.share)}
                        </td>
                        <td className="py-1 tabular-nums text-muted-foreground">
                          {day(r.added_at)}
                        </td>
                        <td className="py-1">
                          {r.active ? (
                            <span className="text-emerald-600">активен</span>
                          ) : (
                            <span className="text-muted-foreground">
                              бивш · {day(r.erased_at)}
                            </span>
                          )}
                        </td>
                        <td className="py-1 text-right tabular-nums">
                          {num.format(Number(r.contracts))}
                        </td>
                        <td className="py-1 text-right tabular-nums">
                          {r.contracts_eur ? formatEur(r.contracts_eur) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="mt-3 text-xs text-muted-foreground/70">
                Дял (%) все още не се извлича при импорта на ТР — предстои.
              </p>
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
                          to={`/db/company/${p.via_eik}`}
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

          {/* Chronology */}
          {chronology.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Clock className="h-4 w-4" /> Хронология
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 text-sm">
                  {chronology.map((e, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="w-24 shrink-0 tabular-nums text-muted-foreground">
                        {day(e.date)}
                      </span>
                      <span
                        className={
                          e.sign === "+"
                            ? "text-emerald-600"
                            : "text-destructive"
                        }
                      >
                        {e.sign}
                      </span>
                      <span>
                        {e.role}
                        {e.share
                          ? ` (${Math.round(Number(e.share))}%)`
                          : ""}{" "}
                        <Link
                          to={`/db/company/${e.uic}`}
                          className="text-accent hover:underline"
                        >
                          {e.company ?? e.uic}
                        </Link>
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

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
                            to={`/db/company/${c.uic}`}
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
