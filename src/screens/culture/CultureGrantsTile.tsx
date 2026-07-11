// „Успеваемост на грантовете" — the НФК grant success rate (applied vs funded)
// per art discipline. The metric no BG culture source publishes (plan §3.1e·1):
// not just who won, but the application-to-award ratio. Each row is a ratio bar
// (funded / applied) with the funded € and counts. Reads /culture/grants.json.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Percent } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact, formatPct } from "@/lib/currency";
import { useCultureGrants } from "@/data/culture/useCulture";

export const CultureGrantsTile: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const { data } = useCultureGrants();
  if (!data || data.programs.length === 0) return null;

  // One row per programme (success rate varies a lot between them), sorted best
  // first. The flagship large-projects programme also splits by discipline —
  // surfaced as a caption note rather than its own rows.
  const rows = [...data.programs].sort((a, b) => b.successRate - a.successRate);
  const flagship = [...data.programs].sort((a, b) => b.applied - a.applied)[0];
  const worstDisc = flagship?.byDiscipline
    ?.filter((d) => d.applied >= 5)
    .sort((a, b) => a.funded / a.applied - b.funded / b.applied)[0];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Percent className="h-4 w-4" />
          {bg ? "Успеваемост на грантовете (НФК)" : "Grant success rate (НФК)"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <p className="mb-3 text-sm text-muted-foreground">
          {bg
            ? `${formatPct(data.overallSuccessRate, lang)} успеваемост — ${data.totalFunded} от ${data.totalApplied} кандидатствали проекта са финансирани, с ${formatEurCompact(data.totalFundedEur, lang)} от ${formatEurCompact(data.totalRequestedEur, lang)} искани.`
            : `${formatPct(data.overallSuccessRate, lang)} success rate — ${data.totalFunded} of ${data.totalApplied} applications funded, sharing ${formatEurCompact(data.totalFundedEur, lang)} of ${formatEurCompact(data.totalRequestedEur, lang)} requested.`}
        </p>
        <ul className="space-y-2.5">
          {rows.map((p) => {
            const rate = p.successRate;
            return (
              <li key={p.code} className="text-xs">
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate font-medium">
                    {bg ? p.label.bg : p.label.en}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {p.funded}/{p.applied}
                    <span className="ml-1 text-muted-foreground/70">
                      {formatPct(rate, lang)}
                    </span>
                    <span className="ml-2 text-foreground">
                      {formatEurCompact(p.fundedEur, lang)}
                    </span>
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full ${
                      rate >= 0.9
                        ? "bg-emerald-500"
                        : rate >= 0.75
                          ? "bg-primary"
                          : "bg-amber-500"
                    }`}
                    style={{ width: `${Math.max(2, rate * 100)}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-[11px] text-muted-foreground/80">
          {bg
            ? `Успеваемост = финансирани ÷ кандидатствали проекти, по програма (${data.programs.length} програми за ${flagship?.year}).`
            : `Success rate = funded ÷ applied projects, by programme (${data.programs.length} programmes, ${flagship?.year}).`}
          {worstDisc && (
            <>
              {" "}
              {bg
                ? `В „${flagship.label.bg}" най-ниска е успеваемостта за ${worstDisc.label.bg} (${formatPct(worstDisc.funded / worstDisc.applied, lang)}).`
                : `Within "${flagship.label.en}", ${worstDisc.label.en} has the lowest rate (${formatPct(worstDisc.funded / worstDisc.applied, lang)}).`}
            </>
          )}{" "}
          {bg
            ? "Обхватът са публикуваните класирания; сумите са конвертирани от лева."
            : "Coverage is the published rankings; amounts converted from leva."}{" "}
          <a
            href={data.source.url}
            target="_blank"
            rel="noreferrer"
            className="hover:text-primary hover:underline"
          >
            {bg ? "Източник: НФК" : "Source: НФК"}
          </a>
        </p>
      </CardContent>
    </Card>
  );
};
