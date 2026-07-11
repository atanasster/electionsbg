// „Културните пари — по източник" — the annual culture-money streams by scale, so
// the film subsidies this page details (~€8M/yr) read against the bigger, less-
// visible lines: читалища and the scenic-arts delegated budgets (~€85-88M each).
// The honest scale anchor the dedicated view otherwise lacks (the МК budget page
// owns the full picture). Independent magnitude bars per stream (each scaled to
// the biggest line) — NOT a stacked share, since the streams aren't a partition
// of one budget and don't sum to a meaningful whole. A sourced legend follows.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Scale } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import { useCultureFundingStreams } from "@/data/culture/useCulture";

// Fixed hue per stream id (magnitude order roughly, but keyed to id not rank).
const STREAM_COLOR: Record<string, string> = {
  chitalishta: "bg-primary",
  scenic: "bg-sky-500",
  film: "bg-violet-500",
  ncf: "bg-amber-500",
  sofia: "bg-teal-500",
};

export const CultureScaleTile: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const { data } = useCultureFundingStreams();
  if (!data || data.streams.length === 0) return null;

  const streams = [...data.streams].sort((a, b) => b.annualEur - a.annualEur);
  const film = streams.find((s) => s.id === "film");
  const biggest = streams[0];
  const maxEur = Math.max(1, biggest.annualEur);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Scale className="h-4 w-4" />
          {bg ? "Културните пари — по източник" : "Culture money — by stream"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <p className="mb-3 text-sm text-muted-foreground">
          {bg
            ? `Филмовите субсидии (~${formatEurCompact(film?.annualEur ?? 0, lang)}/год.) са малка част от парите за култура. Най-голямата линия е „${biggest.bg}" — ~${formatEurCompact(biggest.annualEur, lang)} годишно.`
            : `Film subsidies (~${formatEurCompact(film?.annualEur ?? 0, lang)}/yr) are a small slice of culture money. The biggest stream is "${biggest.en}" — ~${formatEurCompact(biggest.annualEur, lang)} a year.`}
        </p>
        <ul className="space-y-2.5">
          {streams.map((s) => (
            <li key={s.id} className="text-sm">
              <div className="flex items-center gap-2">
                <span
                  className={`h-2.5 w-2.5 shrink-0 rounded-sm ${STREAM_COLOR[s.id] ?? "bg-muted-foreground/50"}`}
                />
                <span className="min-w-0 flex-1 truncate">
                  {bg ? s.bg : s.en}
                  <span className="ml-1 text-[11px] text-muted-foreground/70">
                    {bg ? s.sourceBg : s.sourceEn}
                  </span>
                </span>
                <span className="w-20 shrink-0 text-right tabular-nums font-medium">
                  {formatEurCompact(s.annualEur, lang)}
                </span>
              </div>
              <div className="mt-1 ml-4 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full ${STREAM_COLOR[s.id] ?? "bg-muted-foreground/50"}`}
                  style={{ width: `${(s.annualEur / maxEur) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] text-muted-foreground/80">
          {bg
            ? `${data.note.bg} Общ бюджет на Министерството на културата: ~${formatEurCompact(data.mkTotalEur, lang)} (2026).`
            : `${data.note.en} Total Ministry of Culture budget: ~${formatEurCompact(data.mkTotalEur, lang)} (2026).`}
        </p>
      </CardContent>
    </Card>
  );
};
