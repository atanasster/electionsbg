// SIGMA-parity entity breakdown: "Какво купува" (CPV sectors) + "Как купува /
// печели" (procedure mix) + an EU-funding share, for /company/:eik (kind "c")
// and /awarder/:eik (kind "a"). Reads the precomputed breakdown shard
// (derived/breakdowns/{kind}/<eik>.json). Renders nothing when the entity has
// no breakdown shard (too few CPV-coded contracts).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { PieChart } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useProcurementBreakdown } from "@/data/procurement/useProcurementBreakdown";
import {
  cpvDivisionName,
  procedureLabel,
  type ProcedureBucket,
} from "@/lib/cpvSectors";
import { formatEur } from "@/lib/currency";

const pct = (v: number, lang: string) =>
  (v * 100).toLocaleString(lang, { maximumFractionDigits: 1 }) + "%";

// A labelled share row with a thin proportion bar.
const Bar: FC<{ label: string; share: number; amount: string }> = ({
  label,
  share,
  amount,
}) => (
  <div className="flex items-center gap-2 text-xs">
    <span className="w-44 shrink-0 truncate" title={label}>
      {label}
    </span>
    <span className="flex-1 h-2 rounded bg-muted overflow-hidden">
      <span
        className="block h-full bg-primary/60"
        style={{ width: `${Math.max(2, Math.min(100, share * 100))}%` }}
      />
    </span>
    <span className="w-12 text-right tabular-nums text-muted-foreground">
      {amount}
    </span>
  </div>
);

export const ProcurementBreakdownTile: FC<{ kind: "c" | "a"; eik: string }> = ({
  kind,
  eik,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const { data: b } = useProcurementBreakdown(kind, eik);
  if (!b || b.cpv.length === 0) return null;

  const cpvTotal = b.cpvKnownEur || 1;
  const procTotal = b.proc.reduce((s, p) => s + p.eur, 0) || 1;
  const cpvTop = b.cpv.slice(0, 6);
  const cpvCoverage = b.totalEur > 0 ? b.cpvKnownEur / b.totalEur : 0;
  const euCoverage = b.totalEur > 0 ? b.euKnownEur / b.totalEur : 0;
  const euShare = b.euKnownEur > 0 ? b.euEur / b.euKnownEur : 0;

  const sectorsTitle =
    kind === "a"
      ? lang === "bg"
        ? "Какво купува"
        : "What it buys"
      : lang === "bg"
        ? "В кои сектори печели"
        : "Sectors won in";
  const procTitle =
    kind === "a"
      ? lang === "bg"
        ? "Как купува"
        : "How it buys"
      : lang === "bg"
        ? "Как печели"
        : "How it wins";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <PieChart className="h-4 w-4" />
          {sectorsTitle}
          <span className="text-xs text-muted-foreground font-normal">CPV</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <div className="space-y-1.5">
          {cpvTop.map((c) => (
            <Bar
              key={c.d}
              label={cpvDivisionName(c.d, lang)}
              share={c.eur / cpvTotal}
              amount={formatEur(c.eur)}
            />
          ))}
        </div>

        {/* Procedure mix */}
        <div className="pt-2 border-t">
          <div className="text-xs font-medium mb-1.5">{procTitle}</div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums">
            {b.proc.map((p) => (
              <span key={p.b}>
                {procedureLabel(p.b as ProcedureBucket, lang)}{" "}
                <span className="text-foreground">
                  {pct(p.eur / procTotal, lang)}
                </span>
              </span>
            ))}
          </div>
        </div>

        {/* EU-funding share — only where the known-status coverage is solid,
            so big legacy contracts missing from the EOP feed don't understate
            an entity's real EU share. */}
        {euCoverage >= 0.6 ? (
          <div className="pt-2 border-t flex items-baseline gap-2 text-xs">
            <span className="text-muted-foreground">
              {lang === "bg" ? "Финансиране от ЕС" : "EU funding"}
            </span>
            <span className="font-semibold tabular-nums">
              {pct(euShare, lang)}
            </span>
            <span className="text-muted-foreground">
              {lang === "bg" ? "от обема" : "of volume"}
            </span>
          </div>
        ) : null}

        {cpvCoverage < 0.9 ? (
          <p className="text-[11px] text-muted-foreground/80">
            {lang === "bg"
              ? `По ${pct(cpvCoverage, lang)} от обема с известен сектор.`
              : `Based on ${pct(cpvCoverage, lang)} of volume with a known sector.`}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
};
