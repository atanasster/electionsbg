// Repeat winners on a corridor — where one contractor holds a dominant share of
// the money spent on a single road corridor across multiple contracts. A high
// concentration on one corridor (e.g. the same builder taking consecutive lots
// of Струма) is a capture signal the corridor totals alone don't surface.
// Computed client-side from model.rows; no engine change.

import { FC, useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Repeat } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import type { RoadContract } from "@/lib/roadAttributes";

interface CorridorLeader {
  corridor: string;
  leaderEik: string;
  leaderName: string;
  leaderEur: number;
  leaderCount: number;
  corridorEur: number;
  share: number;
}

export const RoadRepeatWinnersTile: FC<{ rows: RoadContract[] }> = ({
  rows,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;

  const leaders = useMemo<CorridorLeader[]>(() => {
    // corridor -> total € + per-contractor { €, count, name }
    const byCorridor = new Map<
      string,
      {
        total: number;
        con: Map<string, { eur: number; n: number; name: string }>;
      }
    >();
    for (const r of rows) {
      const corridor = r.ref?.corridor;
      const eik = r.c.contractorEik;
      if (!corridor || !eik) continue;
      let c = byCorridor.get(corridor);
      if (!c) {
        c = { total: 0, con: new Map() };
        byCorridor.set(corridor, c);
      }
      c.total += r.amountEur;
      const e = c.con.get(eik) ?? {
        eur: 0,
        n: 0,
        name: r.c.contractorName || `ЕИК ${eik}`,
      };
      e.eur += r.amountEur;
      e.n += 1;
      c.con.set(eik, e);
    }
    const out: CorridorLeader[] = [];
    for (const [corridor, c] of byCorridor) {
      if (c.total <= 0) continue;
      let best: { eik: string; eur: number; n: number; name: string } | null =
        null;
      for (const [eik, e] of c.con)
        if (!best || e.eur > best.eur) best = { eik, ...e };
      // Only flag genuine repeat dominance: the leader won ≥2 contracts and
      // holds ≥40% of the corridor's money.
      if (!best || best.n < 2) continue;
      const share = best.eur / c.total;
      if (share < 0.4) continue;
      out.push({
        corridor,
        leaderEik: best.eik,
        leaderName: best.name,
        leaderEur: best.eur,
        leaderCount: best.n,
        corridorEur: c.total,
        share,
      });
    }
    return out.sort((a, b) => b.leaderEur - a.leaderEur).slice(0, 10);
  }, [rows]);

  if (leaders.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <Repeat className="h-4 w-4" />
          {lang === "bg"
            ? "Повтарящи се изпълнители по коридор"
            : "Repeat winners by corridor"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <ul className="divide-y divide-border text-sm">
          {leaders.map((l) => (
            <li key={l.corridor} className="py-2">
              <div className="flex items-center gap-2">
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs shrink-0">
                  {l.corridor}
                </span>
                <Link
                  to={`/company/${l.leaderEik}`}
                  className="min-w-0 flex-1 truncate font-medium hover:underline"
                  title={l.leaderName}
                >
                  {l.leaderName}
                </Link>
                <span
                  className={`shrink-0 tabular-nums font-semibold ${
                    l.share >= 0.6
                      ? "text-red-700 dark:text-red-400"
                      : "text-amber-700 dark:text-amber-400"
                  }`}
                >
                  {Math.round(l.share * 100)}%
                </span>
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                <span>
                  {l.leaderCount} {lang === "bg" ? "договора" : "contracts"}
                </span>
                <span className="ml-auto tabular-nums">
                  {formatEurCompact(l.leaderEur, lang)}
                  {" / "}
                  {formatEurCompact(l.corridorEur, lang)}
                </span>
              </div>
            </li>
          ))}
        </ul>
        <p className="pt-2 text-[11px] text-muted-foreground/80">
          {lang === "bg"
            ? "Коридори, в които един изпълнител държи ≥40% от вложените средства (≥2 договора). Делът е от общата сума за коридора."
            : "Corridors where one contractor holds ≥40% of the money (≥2 contracts). Share is of the corridor total."}
        </p>
      </CardContent>
    </Card>
  );
};
