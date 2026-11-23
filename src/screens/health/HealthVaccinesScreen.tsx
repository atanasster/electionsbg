// /sector/health/vaccines — the flu-vaccine season: what was planned, what НЗИС
// recorded and when, where, what was on the shortage list, the wave it is meant
// to precede, where the vaccines are dispatched from and what МЗ paid.
// Plan: docs/plans/vaccines-flow-v1.md §5.
//
// „БЕЗ ПЕРИОД" in the scope sense: the page has its own SEASON selector
// (`?season=`, page-local, validated against the seasons the data holds). A
// season runs 1 August → 31 July (flu_season() in 206).
//
// Every figure prints its own as-of: the sources have different clocks (§7.4).
// Three bases are never mixed — НЗИС's 60+ counts, the programme's 65+ plan and
// Eurostat's 65+ coverage (§7.2). "Recorded" is never "administered" (§7.3).
//
// Fragment ids: #head #when #who #where #shortage #incidence #imports #money
// #eu #gaps.

import { FC, ReactNode, useCallback, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { isBg } from "@/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact, formatInt } from "@/lib/currency";
import { Flag } from "@/screens/components/euCompare/Flag";
import type { PeerGeo } from "@/data/macro/useMacroPeers";
import { EntityFlowTile } from "@/screens/components/procurement/EntityFlowTile";
import {
  useVaccinesOblast,
  useVaccinesOverview,
  type VaccinePlanRow,
  type VaccinesOverview,
} from "@/data/health/useVaccines";
import { HealthPageFrame } from "./HealthPageFrame";
import { HealthNote } from "./HealthNote";
import { currentTotal, seasonLabel } from "@/lib/vaccineSeason";

type L = { bg: string; en: string };

/** МЗ — the awarder of the mandatory-calendar vaccine contracts. */
const MZ_EIK = "000695317";

/** The first season НЗИС flu recording is treated as complete enough to chart
 *  without a caveat (plan §8.2: 2023/24, with earlier seasons greyed). */
const COMPLETE_FROM_SEASON = 2023;

/** A season's month (August = 1) as a short month name. */
const seasonMonthName = (m: number, lang: string): string =>
  // `month: "short"` renders as a bare number („08") in Bulgarian.
  new Date(2000, (m + 6) % 12, 1)
    .toLocaleDateString(lang, { month: "long" })
    .slice(0, 3);

/** An as-of stamp as a date in the reader's locale; "" when absent. */
const asOfDate = (v: string | null | undefined, lang: string): string => {
  if (!v) return "";
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? v
    : d.toLocaleDateString(lang, {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
};

const monthName = (ym: string | null, lang: string): string => {
  if (!ym) return "";
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(lang, {
    month: "long",
    year: "numeric",
  });
};

const Section: FC<{ id: string; children: ReactNode }> = ({ id, children }) => (
  <section id={id} className="scroll-mt-24 space-y-4">
    {children}
  </section>
);

const AsOf: FC<{ label: L; value: string | null | undefined }> = ({
  label,
  value,
}) => {
  const { i18n } = useTranslation();
  const bg = isBg(i18n.language);
  const d = asOfDate(value, i18n.language);
  return (
    <p className="text-[11px] text-muted-foreground" data-testid="as-of">
      {bg ? label.bg : label.en}
      {d
        ? ` · ${bg ? "към" : "as of"} ${d}`
        : bg
          ? " · без дата"
          : " · undated"}
    </p>
  );
};

const SectionCard: FC<{ title: L; children: ReactNode }> = ({
  title,
  children,
}) => {
  const { i18n } = useTranslation();
  const bg = isBg(i18n.language);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{bg ? title.bg : title.en}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-3 text-sm md:p-4">
        {children}
      </CardContent>
    </Card>
  );
};

// ---------------------------------------------------------------- §1 head

const Figure: FC<{
  label: string;
  value: string;
  note?: string;
  asOf: ReactNode;
}> = ({ label, value, note, asOf }) => (
  <div className="rounded-xl border bg-card p-4">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="text-2xl font-bold tabular-nums">{value}</p>
    {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    {asOf}
  </div>
);

export const Head: FC<{ o: VaccinesOverview }> = ({ o }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  const total = currentTotal(o.plan.rows);
  const r = o.recorded;
  const daily = r.seasonToDate !== null;
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <Figure
        label={bg ? "Обявени дози за сезона" : "Doses announced for the season"}
        value={total ? formatInt(total.doses, lang) : "—"}
        note={
          total
            ? `${total.source}`
            : bg
              ? "Няма обявен общ брой за този сезон."
              : "No season total announced for this season."
        }
        asOf={
          <AsOf
            label={{ bg: "обявено", en: "announced" }}
            value={total?.sourceDate}
          />
        }
      />
      <Figure
        label={
          bg
            ? "Записани в НЗИС ваксинации срещу грип"
            : "Flu shots recorded in НЗИС"
        }
        value={formatInt(daily ? r.seasonToDate : r.total, lang)}
        note={
          daily
            ? bg
              ? "От началото на сезона (1 август), по дневния брояч на НЗИС. Записани, не непременно поставени."
              : "Since the season began (1 August), from НЗИС's daily counter. Recorded, not necessarily administered."
            : bg
              ? `Месечните данни на НЗИС до ${monthName(r.through, lang)} Записани, не непременно поставени.`
              : `НЗИС's monthly data through ${monthName(r.through, lang)}. Recorded, not necessarily administered.`
        }
        asOf={
          <AsOf
            label={
              daily
                ? { bg: "дневен брояч на НЗИС", en: "НЗИС daily counter" }
                : { bg: "месечни данни на НЗИС", en: "НЗИС monthly data" }
            }
            value={daily ? r.seasonToDateAsOf : r.asOf}
          />
        }
      />
      <Figure
        label={
          r.completeThrough
            ? bg
              ? `Август – ${monthName(r.completeThrough, lang)}: този / миналия сезон`
              : `August – ${monthName(r.completeThrough, lang)}: this / last season`
            : bg
              ? "Завършени месеци: този / миналия сезон"
              : "Complete months: this / last season"
        }
        value={
          r.completeTotal === null || r.sameMonthsLastSeason === null
            ? "—"
            : `${formatInt(r.completeTotal, lang)} / ${formatInt(r.sameMonthsLastSeason, lang)}`
        }
        note={
          r.completeThrough && r.completeTotal !== null
            ? bg
              ? "Едни и същи месеци в двата сезона, само завършени. Месечните данни изостават от дневния брояч, затова числото вляво е по-малко от горното."
              : "The same months in both seasons, complete months only. The monthly data lag the daily counter, which is why the left figure is smaller than the one above."
            : bg
              ? "Сезонът още няма завършен месец в месечните данни."
              : "The season has no complete month in the monthly data yet."
        }
        asOf={
          <AsOf
            label={{ bg: "месечни данни на НЗИС", en: "НЗИС monthly data" }}
            value={r.asOf}
          />
        }
      />
    </div>
  );
};

// ---------------------------------------------------------------- §2 curve

const SEASON_COLORS = ["#0d9488", "#64748b", "#94a3b8", "#cbd5e1"];

const Curve: FC<{ o: VaccinesOverview }> = ({ o }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  const seasons = o.curve.seasons;
  const data = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => {
        const m = i + 1;
        const row: Record<string, number | string> = {
          label: seasonMonthName(m, lang),
        };
        for (const s of seasons) {
          const p = s.points.find((x) => x.m === m);
          if (p) row[`s${s.season}`] = p.cum;
        }
        return row;
      }),
    [seasons, lang],
  );
  const daily = o.curve.daily?.at(-1) ?? null;
  if (!seasons.length)
    return (
      <HealthNote>
        {bg
          ? "Няма записани ваксинации срещу грип за избраните сезони."
          : "No flu shots recorded for these seasons."}
      </HealthNote>
    );
  return (
    <SectionCard title={{ bg: "Кога", en: "When" }}>
      <p className="text-muted-foreground">
        {bg
          ? "Натрупани записани ваксинации срещу грип по месец на сезона — този сезон спрямо предишните три. Месечни стъпки от НЗИС."
          : "Cumulative recorded flu shots by month of the season — this season against the previous three. Monthly steps from НЗИС."}
      </p>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, left: 0 }}>
            <CartesianGrid
              strokeDasharray="3 3"
              opacity={0.15}
              vertical={false}
            />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
            <YAxis
              tick={{ fontSize: 10 }}
              tickFormatter={(v: number) => v.toLocaleString(lang)}
              width={64}
            />
            <Tooltip
              formatter={(v: number, k: string) => [
                v.toLocaleString(lang),
                seasonLabel(Number(k.slice(1))),
              ]}
              contentStyle={{ fontSize: 12 }}
            />
            {seasons.map((s, i) => (
              <Line
                key={s.season}
                dataKey={`s${s.season}`}
                name={`s${s.season}`}
                type="monotone"
                stroke={SEASON_COLORS[i] ?? SEASON_COLORS.at(-1)}
                strokeWidth={i === 0 ? 3 : 1.5}
                strokeDasharray={
                  s.season < COMPLETE_FROM_SEASON ? "4 3" : undefined
                }
                dot={false}
                connectNulls={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {seasons.map((s, i) => (
          <li key={s.season} className="flex items-center gap-1.5">
            <span
              className="inline-block h-0.5 w-4"
              style={{
                backgroundColor: SEASON_COLORS[i] ?? SEASON_COLORS.at(-1),
              }}
            />
            {seasonLabel(s.season)}
            {s.season < COMPLETE_FROM_SEASON
              ? bg
                ? " (НЗИС още не записва всичко)"
                : " (НЗИС recording still incomplete)"
              : ""}
          </li>
        ))}
      </ul>
      {o.season === o.seasons[0] &&
      o.monthlyThrough &&
      o.recorded.completeThrough &&
      o.monthlyThrough > o.recorded.completeThrough ? (
        <p className="text-xs text-muted-foreground">
          {bg
            ? `Последната точка на текущия сезон (${monthName(o.monthlyThrough, lang)}) е непълен месец.`
            : `The current season's last point (${monthName(o.monthlyThrough, lang)}) is an incomplete month.`}
        </p>
      ) : null}
      {daily ? (
        <p className="text-xs text-muted-foreground">
          {bg
            ? `Дневният брояч на НЗИС е по-пресен: ${formatInt(daily.n, lang)} от началото на сезона към ${asOfDate(daily.asOf, lang)} Месечните данни изостават с дни.`
            : `НЗИС's daily counter is fresher: ${formatInt(daily.n, lang)} since the season began, as of ${asOfDate(daily.asOf, lang)}. The monthly data lag by days.`}
        </p>
      ) : null}
      <AsOf
        label={{ bg: "месечни данни на НЗИС", en: "НЗИС monthly data" }}
        value={o.curve.asOf}
      />
    </SectionCard>
  );
};

// ---------------------------------------------------------------- §3 who

const CHANNELS: { key: string; label: L }[] = [
  { key: "total", label: { bg: "Общо за сезона", en: "Season total" } },
  {
    key: "adults_65plus",
    label: { bg: "Хора на 65+ (по програма)", en: "People 65+ (programme)" },
  },
  {
    key: "adults_75plus_high_dose",
    label: {
      bg: "Високодозова за 75+",
      en: "High-dose for 75+",
    },
  },
  {
    key: "children",
    label: { bg: "Деца (по програма)", en: "Children (programme)" },
  },
  {
    key: "children_injectable",
    label: { bg: "Деца — инжекционна", en: "Children — injectable" },
  },
  {
    key: "children_nasal",
    label: { bg: "Деца — назална", en: "Children — nasal" },
  },
  {
    key: "free_market",
    label: { bg: "Свободен пазар (аптеки)", en: "Free market (pharmacies)" },
  },
];

const BASIS: Record<string, L> = {
  planned: { bg: "планирани", en: "planned" },
  contracted: { bg: "договорени", en: "contracted" },
  announced: { bg: "обявени", en: "announced" },
};

const channelLabel = (key: string, bg: boolean): string => {
  const c = CHANNELS.find((x) => x.key === key);
  return c ? (bg ? c.label.bg : c.label.en) : key;
};

/** The part nothing public measures: hatched and labelled, never blank and
 *  never inferred as a remainder (§7.5). */
export const UnknownSegment: FC<{ bg: boolean }> = ({ bg }) => (
  <span
    data-testid="unknown-segment"
    className="inline-block rounded px-2 py-0.5 text-[11px] text-muted-foreground"
    style={{
      backgroundImage:
        "repeating-linear-gradient(45deg, hsl(var(--muted)) 0 4px, transparent 4px 8px)",
    }}
  >
    {bg ? "няма публични данни" : "no public data"}
  </span>
);

export const PlanLedger: FC<{ rows: VaccinePlanRow[] }> = ({ rows }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  const max = Math.max(1, ...rows.map((r) => r.doses));
  const channels = CHANNELS.filter((c) =>
    rows.some((r) => r.channel === c.key),
  );
  if (!rows.length)
    return (
      <HealthNote>
        {bg
          ? "За този сезон няма записан план."
          : "No plan is recorded for this season."}
      </HealthNote>
    );
  return (
    <div className="space-y-4">
      {channels.map((c) => (
        <div key={c.key} className="space-y-1.5">
          <p className="font-medium">{bg ? c.label.bg : c.label.en}</p>
          {rows
            .filter((r) => r.channel === c.key)
            .map((r) => {
              const basis = BASIS[r.basis];
              const superseded = !!r.supersededBy;
              return (
                <div
                  key={r.id}
                  className={superseded ? "opacity-50" : undefined}
                >
                  <div className="flex items-center gap-2">
                    <div className="h-3 flex-1 rounded bg-muted">
                      <div
                        className="h-3 rounded bg-teal-600"
                        style={{ width: `${(100 * r.doses) / max}%` }}
                      />
                    </div>
                    <span className="w-28 shrink-0 text-right tabular-nums">
                      {r.qualifier === "over" ? (bg ? "над " : "over ") : ""}
                      {formatInt(r.doses, lang)}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {basis ? (bg ? basis.bg : basis.en) : r.basis}
                    {r.scope === "delivery"
                      ? bg
                        ? " · една доставка, не общо за сезона"
                        : " · one delivery, not a season total"
                      : ""}
                    {r.within
                      ? bg
                        ? ` · в рамките на „${channelLabel(r.within, bg)}"`
                        : ` · inside "${channelLabel(r.within, bg)}"`
                      : ""}
                    {superseded
                      ? bg
                        ? " · заменено с по-късно съобщение"
                        : " · superseded by a later announcement"
                      : ""}
                    {" · "}
                    <a
                      href={r.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-primary hover:underline"
                    >
                      {r.source}, {asOfDate(r.sourceDate, lang)}
                    </a>
                  </p>
                </div>
              );
            })}
          <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
            {bg
              ? "доставени / поставени по този канал:"
              : "delivered / given in this channel:"}{" "}
            <UnknownSegment bg={bg} />
          </p>
        </div>
      ))}
    </div>
  );
};

const Who: FC<{ o: VaccinesOverview }> = ({ o }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  const byAge = o.recorded.byAge;
  return (
    <SectionCard title={{ bg: "За кого", en: "For whom" }}>
      <p className="text-muted-foreground">
        {bg
          ? "Каналите, както са обявени — по програма (НЗОК), високодозовата и свободният пазар. Всеки ред е отделно съобщение с източник; нищо не е изчислено като остатък."
          : "The channels as announced — the programme (НЗОК), the high-dose vaccine and the free market. Each row is one announcement with its source; nothing is derived as a remainder."}
      </p>
      <PlanLedger rows={o.plan.rows} />
      {o.plan.events.length ? (
        <ul className="space-y-1 border-t pt-3 text-xs">
          {o.plan.events.map((e) => (
            <li key={`${e.date}-${e.kind}-${e.sourceUrl}`}>
              <span className="font-medium">{asOfDate(e.date, lang)}</span> —{" "}
              <a
                href={e.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="hover:text-primary hover:underline"
              >
                {bg ? e.textBg : e.textEn}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="border-t pt-3">
        <p className="mb-2 font-medium">
          {bg ? "Записани в НЗИС по възраст" : "Recorded in НЗИС by age"}
        </p>
        <p className="mb-2 text-[11px] text-muted-foreground">
          {bg
            ? "НЗИС публикува възрастови групи 60–79 и 80+, не 65+ на програмата — двете не се сравняват пряко. Каналът (програма или аптека) не се записва."
            : "НЗИС publishes the age bands 60–79 and 80+, not the programme's 65+ — the two are not compared directly. The channel (programme or pharmacy) is not recorded."}
        </p>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground">
              <th className="text-left font-normal">
                {bg ? "Възраст" : "Age"}
              </th>
              <th className="text-right font-normal">
                {bg ? "Инжекционна" : "Injectable"}
              </th>
              <th className="text-right font-normal">
                {bg ? "Назална" : "Nasal"}
              </th>
            </tr>
          </thead>
          <tbody>
            {byAge.map((a) => (
              <tr key={a.ageBand}>
                <td>{a.ageBand}</td>
                <td className="text-right tabular-nums">
                  {formatInt(a.flu, lang)}
                </td>
                <td className="text-right tabular-nums">
                  {formatInt(a.fluNasal, lang)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <AsOf
          label={{ bg: "месечни данни на НЗИС", en: "НЗИС monthly data" }}
          value={o.recorded.asOf}
        />
      </div>
      <AsOf
        label={{
          bg: "план, по последно съобщение",
          en: "plan, latest announcement",
        }}
        value={o.plan.asOf}
      />
    </SectionCard>
  );
};

// ---------------------------------------------------------------- §4 where

const Where: FC<{ season: number }> = ({ season }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  const { data, isError, isLoading } = useVaccinesOblast(season);
  if (isError)
    return (
      <HealthNote>
        {bg
          ? "Данните по области не можаха да се заредят."
          : "The data by oblast could not be loaded."}
      </HealthNote>
    );
  if (isLoading || data === undefined) return null;
  if (data === null)
    return (
      <HealthNote>
        {bg
          ? "За този сезон няма данни по области на този сървър."
          : "There are no data by oblast for this season on this server."}
      </HealthNote>
    );
  const rows = data.rows;
  const through = data.completeThrough;
  const max = Math.max(
    1,
    ...rows.map((r) => Math.max(r.per1000 ?? 0, r.prevPer1000 ?? 0)),
  );
  return (
    <SectionCard title={{ bg: "Къде", en: "Where" }}>
      <p className="text-muted-foreground">
        {through
          ? bg
            ? `Записани ваксинации срещу грип на 1000 души на 60+ години, сезон ${seasonLabel(season)}, август – ${monthName(through, lang)} Чертичката е миналият сезон за същите месеци. Населението е това, което НЗИС публикува; 60+ е групата на НЗИС, не 65+ на програмата. Процентът вдясно е октомври спрямо октомври на миналия сезон, всички възрасти.`
            : `Recorded flu shots per 1,000 people aged 60+, season ${seasonLabel(season)}, August – ${monthName(through, lang)}. The tick is last season over the same months. The population is the one НЗИС publishes; 60+ is НЗИС's band, not the programme's 65+. The percentage on the right is October against last season's October, all ages.`
          : bg
            ? "Сезонът още няма завършен месец в месечните данни на НЗИС."
            : "The season has no complete month in НЗИС's monthly data yet."}
      </p>
      {season < COMPLETE_FROM_SEASON ? (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {bg
            ? "За този сезон НЗИС още не записва всички ваксинации — разликите между областите може да отразяват въвеждането на системата, не обхвата."
            : "For this season НЗИС did not yet record every shot — the differences between oblasts may reflect the system's adoption rather than coverage."}
        </p>
      ) : null}
      {through ? (
        <ul className="space-y-1">
          {rows.map((r) => {
            const oct =
              r.octN !== null && r.prevOctN
                ? Math.round((100 * (r.octN - r.prevOctN)) / r.prevOctN)
                : null;
            return (
              <li
                key={r.oblastCode}
                className="grid grid-cols-[7rem_1fr_3.5rem_4.5rem] items-center gap-2 text-xs"
              >
                <span className="truncate">{bg ? r.nameBg : r.nameEn}</span>
                <span className="relative h-3 rounded bg-muted">
                  <span
                    className="absolute inset-y-0 left-0 rounded bg-teal-600"
                    style={{ width: `${(100 * (r.per1000 ?? 0)) / max}%` }}
                  />
                  {r.prevPer1000 !== null ? (
                    <span
                      className="absolute inset-y-[-2px] w-0.5 bg-foreground"
                      style={{ left: `${(100 * r.prevPer1000) / max}%` }}
                    />
                  ) : null}
                </span>
                <span className="text-right tabular-nums">
                  {r.per1000 === null ? "—" : Math.round(r.per1000)}
                </span>
                <span
                  className="text-right tabular-nums text-muted-foreground"
                  title={
                    bg
                      ? "Октомври спрямо октомври на миналия сезон, всички възрасти"
                      : "October against last season's October, all ages"
                  }
                >
                  {oct === null
                    ? ""
                    : `${oct > 0 ? "+" : ""}${oct}% ${bg ? "окт." : "Oct"}`}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      <p className="text-[11px] text-muted-foreground">
        {bg
          ? "Записаните ваксинации са долна граница: поставена ваксина, която не е въведена в НЗИС, не е тук."
          : "Recorded shots are a floor: a shot given but not entered in НЗИС is not here."}
      </p>
      <AsOf
        label={{ bg: "месечни данни на НЗИС", en: "НЗИС monthly data" }}
        value={data.asOf}
      />
    </SectionCard>
  );
};

// ---------------------------------------------------------------- §5 shortage

const Shortage: FC<{ o: VaccinesOverview }> = ({ o }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  const weeks = o.shortage.weeks;
  return (
    <SectionCard title={{ bg: "Какво липсва", en: "What is short" }}>
      <p className="text-muted-foreground">
        {bg
          ? "Ваксините в седмичния списък на лекарствата в недостиг (СЕСПА). Отсъствието от списъка не доказва, че ваксината я има."
          : "The vaccines on the weekly list of medicines in short supply (СЕСПА). Absence from the list is not evidence that the vaccine is available."}
      </p>
      {weeks.length ? (
        <ul className="space-y-1 text-xs">
          {weeks.map((w) => (
            <li key={w.validFrom} className="flex flex-wrap gap-x-2">
              <span className="font-medium tabular-nums">
                {asOfDate(w.validFrom, lang)} – {asOfDate(w.validTo, lang)}
              </span>
              <span>
                {w.vaccines.length
                  ? w.vaccines.join(", ")
                  : bg
                    ? "нито една ваксина"
                    : "no vaccine"}
              </span>
              <span className="text-muted-foreground">
                {bg
                  ? `(${formatInt(w.products, lang)} продукта в списъка)`
                  : `(${formatInt(w.products, lang)} products on the list)`}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <HealthNote>
          {bg
            ? "За този сезон няма записани седмици от списъка."
            : "No weeks of the list are recorded for this season."}
        </HealthNote>
      )}
      {o.shortage.firstWindow ? (
        <p className="text-[11px] text-muted-foreground">
          {bg
            ? `Списъкът не пази история; записваме го седмично от ${asOfDate(o.shortage.firstWindow, lang)}`
            : `The list keeps no history; we have recorded it weekly since ${asOfDate(o.shortage.firstWindow, lang)}.`}
        </p>
      ) : null}
      <AsOf label={{ bg: "СЕСПА", en: "СЕСПА" }} value={o.shortage.asOf} />
    </SectionCard>
  );
};

// ---------------------------------------------------------------- §6 incidence

const Incidence: FC<{ o: VaccinesOverview }> = ({ o }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  const weeks = o.incidence.weeks;
  return (
    <SectionCard title={{ bg: "Заболяемост", en: "Incidence" }}>
      <p className="text-muted-foreground">
        {bg
          ? "Седмична заболяемост от грип и остри респираторни заболявания на 10 000 души, цялата страна, по данни на НЦЗПБ — вълната, която ваксинацията трябва да изпревари."
          : "Weekly incidence of flu and acute respiratory illness per 10,000 people, nationwide, from НЦЗПБ — the wave vaccination is meant to precede."}
      </p>
      {weeks.length > 1 ? (
        <div className="h-48 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={weeks} margin={{ top: 4, right: 8, left: 0 }}>
              <CartesianGrid
                strokeDasharray="3 3"
                opacity={0.15}
                vertical={false}
              />
              <XAxis
                dataKey="isoWeek"
                tick={{ fontSize: 10 }}
                tickFormatter={(w: number) => `${bg ? "с." : "w"}${w}`}
              />
              <YAxis tick={{ fontSize: 10 }} width={40} />
              <Tooltip
                formatter={(v: number) => [
                  v.toLocaleString(lang),
                  bg ? "на 10 000" : "per 10,000",
                ]}
                contentStyle={{ fontSize: 12 }}
              />
              <Line
                dataKey="ratePer10k"
                type="monotone"
                stroke="#e11d48"
                strokeWidth={2}
                dot={{ r: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : null}
      {weeks.length ? (
        <ul className="space-y-0.5 text-xs">
          {weeks.slice(-4).map((w) => (
            <li key={w.weekStart}>
              {bg ? "Седмица" : "Week"} {w.isoWeek} (
              {asOfDate(w.weekStart, lang)}):{" "}
              <span className="tabular-nums">
                {w.ratePer10k.toLocaleString(lang)}
              </span>{" "}
              {bg ? "на 10 000" : "per 10,000"} · {formatInt(w.cases, lang)}{" "}
              {bg ? "случая" : "cases"}
            </li>
          ))}
        </ul>
      ) : (
        <HealthNote>
          {bg
            ? "За този сезон няма записани седмици."
            : "No weeks are recorded for this season."}
        </HealthNote>
      )}
      {o.incidence.virology.length ? (
        <p className="text-xs text-muted-foreground">
          {bg ? "Вирусология, последна седмица: " : "Virology, latest week: "}
          {(() => {
            const v = o.incidence.virology.at(-1);
            if (!v) return "";
            const parts = [
              ["A(H1N1)pdm09", v.aH1n1pdm09],
              ["A(H3N2)", v.aH3n2],
              ["B/Victoria", v.bVictoria],
            ]
              .filter(([, n]) => n !== null)
              .map(([k, n]) => `${k} ${n}`);
            return `${formatInt(v.tested, lang)} ${bg ? "изследвани" : "tested"}${parts.length ? `; ${parts.join(", ")}` : ""}`;
          })()}
        </p>
      ) : null}
      <AsOf label={{ bg: "НЦЗПБ", en: "НЦЗПБ" }} value={o.incidence.asOf} />
    </SectionCard>
  );
};

// ---------------------------------------------------------------- §7 imports

/** Eurostat's Greece is EL; Intl and the flags know it as GR. */
const isoRegion = (p: string): string => (p === "EL" ? "GR" : p);

const regionName = (code: string, lang: string): string => {
  try {
    return (
      new Intl.DisplayNames([lang], { type: "region" }).of(isoRegion(code)) ??
      code
    );
  } catch {
    return code;
  }
};

const Imports: FC<{ o: VaccinesOverview }> = ({ o }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  const monthly = o.imports.monthly.slice(-48);
  // The partner totals cover only the season months Eurostat has published.
  const seasonFrom = `${o.season}-08`;
  const seasonTo = `${o.season + 1}-07`;
  const partnersThrough =
    o.imports.monthly
      .map((m) => m.month.slice(0, 7))
      .filter((m) => m >= seasonFrom && m <= seasonTo)
      .at(-1) ?? null;
  return (
    <SectionCard title={{ bg: "Откъде", en: "From where" }}>
      <p className="text-muted-foreground">
        {bg
          ? "Месечен внос на ВСИЧКИ ваксини за хора (КН 3002 41), не само срещу грип. Държавата е тази, от която е изпратена пратката, не производителят."
          : "Monthly imports of ALL human vaccines (CN 3002 41), not flu alone. The country is where the consignment was dispatched from, not the manufacturer."}
      </p>
      {monthly.length ? (
        <div className="h-48 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthly} margin={{ top: 4, right: 8, left: 0 }}>
              <CartesianGrid
                strokeDasharray="3 3"
                opacity={0.15}
                vertical={false}
              />
              <XAxis
                dataKey="month"
                tick={{ fontSize: 10 }}
                interval="preserveStartEnd"
                minTickGap={24}
              />
              <YAxis
                tick={{ fontSize: 10 }}
                width={56}
                tickFormatter={(v: number) => formatEurCompact(v, lang)}
              />
              <Tooltip
                formatter={(v: number) => [formatEurCompact(v, lang), "€"]}
                contentStyle={{ fontSize: 12 }}
              />
              <Bar dataKey="eur" fill="#0d9488" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : null}
      {o.imports.partners.length ? (
        <div>
          <p className="mb-1 text-xs font-medium">
            {bg
              ? `Изпратени от, сезон ${seasonLabel(o.season)}${partnersThrough ? `, август – ${monthName(partnersThrough, lang)}` : ""}`
              : `Dispatched from, season ${seasonLabel(o.season)}${partnersThrough ? `, August – ${monthName(partnersThrough, lang)}` : ""}`}
          </p>
          <ul className="space-y-0.5 text-xs">
            {o.imports.partners.map((p) => (
              <li key={p.partner} className="flex justify-between gap-2">
                <span>{regionName(p.partner, lang)}</span>
                <span className="tabular-nums">
                  {formatEurCompact(p.eur, lang)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="text-[11px] text-muted-foreground">
        {bg
          ? "Износът включва и българско производство; той не е преизнесени дози срещу грип."
          : "Exports include domestic production; they are not re-exported flu doses."}
      </p>
      <AsOf
        label={{ bg: "Евростат, Comext", en: "Eurostat, Comext" }}
        value={o.imports.asOf}
      />
    </SectionCard>
  );
};

// ---------------------------------------------------------------- §8 money

const Money: FC<{ o: VaccinesOverview }> = ({ o }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  const rows = o.contracts.rows;
  const suppliers = useMemo(() => {
    const m = new Map<
      string,
      { eik: string; name: string; totalEur: number }
    >();
    for (const r of rows ?? []) {
      const cur = m.get(r.supplierEik) ?? {
        eik: r.supplierEik,
        name: r.supplierName,
        totalEur: 0,
      };
      cur.totalEur += r.eur;
      m.set(r.supplierEik, cur);
    }
    return [...m.values()].sort((a, b) => b.totalEur - a.totalEur);
  }, [rows]);
  const years = useMemo(() => {
    const m = new Map<number, { eur: number; n: number }>();
    for (const r of rows ?? []) {
      const cur = m.get(r.year) ?? { eur: 0, n: 0 };
      cur.eur += r.eur;
      cur.n += r.contracts;
      m.set(r.year, cur);
    }
    return [...m.entries()].sort((a, b) => b[0] - a[0]);
  }, [rows]);
  if (rows === null)
    return (
      <HealthNote>
        {bg
          ? "Договорите за ваксини не са заредени на този сървър."
          : "The vaccine contracts are not loaded on this server."}
      </HealthNote>
    );
  return (
    <div className="space-y-4">
      <SectionCard title={{ bg: "Парите", en: "The money" }}>
        <p className="text-muted-foreground">
          {bg
            ? "Договорите на Министерството на здравеопазването за ваксини за хора (CPV 336516, без ветеринарните) — задължителният имунизационен календар. Ваксините срещу грип по програмата се купуват от НЗОК и не са тук."
            : "The Ministry of Health's contracts for human vaccines (CPV 336516, veterinary excluded) — the mandatory immunisation calendar. The programme's flu vaccines are bought by НЗОК and are not here."}
        </p>
        <ul className="space-y-0.5 text-xs">
          {years.map(([y, v]) => (
            <li key={y} className="flex justify-between gap-2">
              <span>{y}</span>
              <span className="tabular-nums">
                {formatEurCompact(v.eur, lang)} · {formatInt(v.n, lang)}{" "}
                {bg
                  ? v.n === 1
                    ? "договор"
                    : "договора"
                  : v.n === 1
                    ? "contract"
                    : "contracts"}
              </span>
            </li>
          ))}
        </ul>
        <Link
          to={`/awarder/${MZ_EIK}`}
          className="inline-block text-xs font-medium text-primary hover:underline"
        >
          {bg ? "всички поръчки на МЗ →" : "all of МЗ's procurement →"}
        </Link>
      </SectionCard>
      {suppliers.length ? (
        <EntityFlowTile
          role="awarder"
          centerEik={MZ_EIK}
          centerName={
            bg ? "Министерство на здравеопазването" : "Ministry of Health"
          }
          counterparties={suppliers}
        />
      ) : null}
    </div>
  );
};

// ---------------------------------------------------------------- §9 EU

const PEERS: { code: string; geo: PeerGeo }[] = [
  { code: "BG", geo: "BG" },
  { code: "EU27_2020", geo: "EU27_2020" },
  { code: "RO", geo: "RO" },
  { code: "EL", geo: "GR" },
  { code: "HU", geo: "HU" },
  { code: "HR", geo: "HR" },
];

const Eu: FC<{ o: VaccinesOverview }> = ({ o }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  const latest = PEERS.flatMap((p) => {
    const r = o.euCoverage.rows
      .filter((x) => x.geo === p.code)
      .sort((a, b) => b.year - a.year)[0];
    return r ? [{ ...p, year: r.year, pct: r.pct }] : [];
  });
  if (!latest.length) return null;
  const max = Math.max(1, ...latest.map((r) => r.pct));
  return (
    <SectionCard title={{ bg: "Спрямо ЕС", en: "Against the EU" }}>
      <p className="text-muted-foreground">
        {bg
          ? "Обхват на хората на 65+ с ваксина срещу грип, по Евростат. Друга база от записаните в НЗИС 60+ — двете не се събират и не се сравняват."
          : "Flu-vaccine coverage of people aged 65+, from Eurostat. A different basis from НЗИС's recorded 60+ — the two are neither summed nor compared."}
      </p>
      <ul className="space-y-1 text-xs">
        {latest.map((r) => (
          <li
            key={r.code}
            className="grid grid-cols-[7rem_1fr_4.5rem] items-center gap-2"
          >
            <span className="flex items-center gap-1.5">
              <Flag geo={r.geo} />
              {r.code === "EU27_2020"
                ? bg
                  ? "ЕС-27"
                  : "EU-27"
                : regionName(r.code, lang)}
            </span>
            <span className="h-3 rounded bg-muted">
              <span
                className="block h-3 rounded bg-teal-600"
                style={{ width: `${(100 * r.pct) / max}%` }}
              />
            </span>
            <span className="text-right tabular-nums">
              {r.pct.toLocaleString(lang)}% ({r.year})
            </span>
          </li>
        ))}
      </ul>
      <AsOf
        label={{ bg: "Евростат", en: "Eurostat" }}
        value={o.euCoverage.asOf}
      />
    </SectionCard>
  );
};

// ---------------------------------------------------------------- §10 gaps

const GAPS: { what: L; who: L }[] = [
  {
    what: {
      bg: "Колко ваксини по програмата е платила НЗОК — месечните отчети на касата за лекарства не съдържат ваксини.",
      en: "How many programme vaccines НЗОК paid for — the fund's monthly medicine reports carry no vaccines.",
    },
    who: { bg: "НЗОК", en: "НЗОК" },
  },
  {
    what: {
      bg: "Кои ваксини са предписани и отпуснати — в НЗИС ваксините почти не минават през електронна рецепта.",
      en: "Which vaccines were prescribed and dispensed — in НЗИС vaccines barely pass through the e-prescription.",
    },
    who: { bg: "МЗ / НЗИС", en: "МЗ / НЗИС" },
  },
  {
    what: {
      bg: "Доставките по търговци на едро, аптеки, РЗИ и области, датите на освобождаване на партидите и наличностите.",
      en: "Deliveries by wholesaler, pharmacy, РЗИ and oblast, batch-release dates and stock.",
    },
    who: { bg: "ИАЛ, МЗ", en: "ИАЛ, МЗ" },
  },
];

const Gaps: FC = () => {
  const { i18n } = useTranslation();
  const bg = isBg(i18n.language);
  return (
    <SectionCard title={{ bg: "Какво не се знае", en: "What is not known" }}>
      <ul className="list-disc space-y-1 pl-5">
        {GAPS.map((g) => (
          <li key={g.what.en}>
            {bg ? g.what.bg : g.what.en}{" "}
            <span className="text-muted-foreground">
              ({bg ? "отговорът е у" : "held by"} {bg ? g.who.bg : g.who.en})
            </span>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
};

// ---------------------------------------------------------------- page

/** `?season=` read as a four-digit year; anything else is no choice. */
const parseSeason = (v: string | null): number | null =>
  v && /^\d{4}$/.test(v) ? Number(v) : null;

const SeasonPicker: FC<{
  seasons: number[];
  value: number;
  onChange: (s: number) => void;
}> = ({ seasons, value, onChange }) => {
  const { i18n } = useTranslation();
  const bg = isBg(i18n.language);
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">{bg ? "Сезон" : "Season"}</span>
      {seasons.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onChange(s)}
          aria-pressed={s === value}
          className={`rounded-full border px-2 py-0.5 hover:text-primary ${s === value ? "border-primary font-semibold" : "border-border"}`}
        >
          {seasonLabel(s)}
        </button>
      ))}
    </div>
  );
};

export const HealthVaccinesScreen: FC = () => {
  const { i18n } = useTranslation();
  const bg = isBg(i18n.language);
  const [params, setParams] = useSearchParams();
  // A season the data does not hold is resolved by the server to the latest,
  // and the picker shows THAT.
  const requested = parseSeason(params.get("season"));
  const overview = useVaccinesOverview(requested);
  const o = overview.data ?? null;
  const pick = useCallback(
    (s: number) => {
      const p = new URLSearchParams(params);
      p.set("season", String(s));
      setParams(p, { replace: true });
    },
    [params, setParams],
  );

  return (
    <HealthPageFrame
      title={{ bg: "Ваксините срещу грип", en: "The flu vaccines" }}
      description={{
        bg: "Сезонът на ваксините срещу грип — планираните дози, записаните в НЗИС ваксинации и кога, по области, недостигът, заболяемостта, вносът и договорите на МЗ.",
        en: "The flu-vaccine season — the doses planned, the shots recorded in НЗИС and when, by oblast, the shortages, the incidence, the imports and МЗ's contracts.",
      }}
      scoped={false}
      periodNote={
        o
          ? {
              bg: `Сезон ${seasonLabel(o.season)} (1 август – 31 юли).`,
              en: `Season ${seasonLabel(o.season)} (1 August – 31 July).`,
            }
          : null
      }
      controls={
        o && o.seasons.length > 1 ? (
          <SeasonPicker seasons={o.seasons} value={o.season} onChange={pick} />
        ) : null
      }
      ready={[o]}
      status={{ isLoading: overview.isLoading, isError: overview.isError }}
    >
      {o === null ? (
        <HealthNote>
          {bg
            ? "Данните за ваксините още не са заредени на този сървър."
            : "The vaccine data are not loaded on this server yet."}
        </HealthNote>
      ) : (
        <>
          <Section id="head">
            <Head o={o} />
          </Section>
          <Section id="when">
            <Curve o={o} />
          </Section>
          <Section id="who">
            <Who o={o} />
          </Section>
          <Section id="where">
            <Where season={o.season} />
          </Section>
          <Section id="shortage">
            <Shortage o={o} />
          </Section>
          <Section id="incidence">
            <Incidence o={o} />
          </Section>
          <Section id="imports">
            <Imports o={o} />
          </Section>
          <Section id="money">
            <Money o={o} />
          </Section>
          <Section id="eu">
            <Eu o={o} />
          </Section>
          <Section id="gaps">
            <Gaps />
          </Section>
        </>
      )}
    </HealthPageFrame>
  );
};
