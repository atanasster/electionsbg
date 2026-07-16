// "Какво плаща АСП на домакинствата" — the benefit-families overview (plan §4.6,
// generalised). For each annual benefit family (disability, child allowances, GMI)
// it pairs the € paid with the recipient/case count (the UK-DWP spend×caseload
// framing) plus the average per recipient — the actual disbursement story that the
// procurement corpus can't show. National/annual, from data/social/benefits.json.
// Heating aid has its own seasonal tile (SocialHeatingAidTile).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { HandCoins } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact, formatCount } from "@/lib/currency";
import { useSocialBenefits } from "@/data/social/useSocialBenefits";

const ANNUAL_ORDER = ["disability", "child", "gmi"] as const;

const BAR_COLOR: Record<string, string> = {
  disability: "bg-primary",
  child: "bg-sky-500/70",
  gmi: "bg-emerald-500/70",
};

export const SocialBenefitsTile: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const loc = bg ? "bg-BG" : "en-US";
  const { data } = useSocialBenefits();
  if (!data) return null;

  const rows = ANNUAL_ORDER.map((id) => {
    const fam = data.families.find((f) => f.id === id);
    if (!fam || !fam.series.length) return null;
    const latest = [...fam.series].sort((a, b) => a.year - b.year).at(-1)!;
    return { fam, latest };
  }).filter((r): r is NonNullable<typeof r> => r != null);
  if (!rows.length) return null;

  const maxEur = Math.max(...rows.map((r) => r.latest.amountEur), 1);

  return (
    <Card id="social-benefits">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <HandCoins className="h-4 w-4" />
          {bg ? "Какво плаща АСП на домакинствата" : "What АСП pays households"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        {rows.map(({ fam, latest }) => {
          const recip = latest.recipients ?? 0;
          const avgMonthly = recip > 0 ? latest.amountEur / recip / 12 : null;
          return (
            <div key={fam.id} className="text-xs">
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="font-medium">
                  {bg ? fam.label.bg : fam.label.en}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {formatEurCompact(latest.amountEur, lang)}
                  <span className="ml-1 text-muted-foreground/70">
                    {formatCount(recip, loc, 0)}{" "}
                    {bg ? fam.recipientNoun.bg : fam.recipientNoun.en}
                  </span>
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full ${BAR_COLOR[fam.id] ?? "bg-primary"}`}
                  style={{
                    width: `${Math.max(2, (latest.amountEur / maxEur) * 100)}%`,
                  }}
                />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[11px] text-muted-foreground">
                <span>{fam.law}</span>
                {avgMonthly != null && (
                  <span>
                    ~{formatEurCompact(avgMonthly, lang)}
                    {bg ? "/мес. на получател" : "/mo per recipient"}
                  </span>
                )}
              </div>
            </div>
          );
        })}

        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? `Средногодишни получатели/случаи и изплатена сума (${data.latestYear} г.). Тези помощи не са обществени поръчки — те са пряк трансфер към домакинствата. Само национално; по области не се публикува. Източник: Годишен отчет на АСП.`
            : `Monthly-average recipients/cases and amount paid (${data.latestYear}). These benefits are not public procurement — they are direct household transfers. National only. Source: АСП annual report.`}
        </p>
      </CardContent>
    </Card>
  );
};
