// /education — the school-outcomes explorer. Search-first (find your school),
// with the national matura trend, the best/worst schools, and an oblast
// breakdown (the "by locality" cut). No geo map yet — per-school coordinates are
// a later phase — so the front door is a fast name search + place drill.
//
// The textbook-publisher concentration lives on the МОН pack (/awarder) and is
// linked from here rather than duplicated.

import { FC, useMemo, useState, useDeferredValue, lazy, Suspense } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  GraduationCap,
  Search,
  TrendingUp,
  Library,
  MapPin,
  Scale,
} from "lucide-react";
import { Title } from "@/ux/Title";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { Input } from "@/components/ui/input";
import { Sparkline } from "@/ux/Sparkline";
import { useRegions } from "@/data/regions/useRegions";
import {
  useSchoolDirectory,
  MIN_RANK_COHORT,
} from "@/data/schools/useSchoolDirectory";
import { MON_AWARDER_PATH } from "@/screens/components/procurement/sectorPacks";
import { searchSchools } from "./searchSchools";

// Leaflet + react-leaflet are heavy; keep them out of the /education chunk until
// the map actually renders.
const SchoolsMap = lazy(() =>
  import("./SchoolsMap").then((m) => ({ default: m.SchoolsMap })),
);
const ContextScatter = lazy(() =>
  import("./ContextScatter").then((m) => ({ default: m.ContextScatter })),
);

const MAP_LEGEND: { color: string; label: string }[] = [
  { color: "#b91c1c", label: "< 3.0" },
  { color: "#ea580c", label: "3.5" },
  { color: "#d97706", label: "4.0" },
  { color: "#65a30d", label: "4.5" },
  { color: "#16a34a", label: "5.0" },
  { color: "#047857", label: "≥ 5.0" },
  { color: "#94a3b8", label: "< 10" },
];

const fmt = (v: number, lang: string): string =>
  v.toLocaleString(lang === "bg" ? "bg-BG" : "en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

// Rebase the narrow matura band to the series range so the sparkline shape reads.
const rebase = (scores: number[]): number[] => {
  if (scores.length === 0) return scores;
  const lo = Math.min(...scores);
  return scores.map((s) => s - lo + 0.15);
};

export const EducationScreen: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const dir = useSchoolDirectory();
  const { regions } = useRegions();
  const [q, setQ] = useState("");
  const dq = useDeferredValue(q);

  const regionName = useMemo(() => {
    // regions.json uniquely prefixes Пловдив with "обл./prov."; strip it so the
    // oblast column reads consistently with the others.
    const clean = (s: string) => s.replace(/^(обл\.|prov\.)\s*/i, "");
    const m = new Map(
      (regions ?? []).map((r) => [r.oblast, clean(bg ? r.name : r.name_en)]),
    );
    // regions.json labels Sofia-city (S23) as "23"; give it a real name.
    m.set("S23", bg ? "София (град)" : "Sofia (city)");
    return (code: string) => m.get(code) ?? code;
  }, [regions, bg]);

  const results = useMemo(
    () => (dir ? searchSchools(dir.schools, dq) : []),
    [dir, dq],
  );

  if (!dir) {
    return (
      <div className="mx-auto w-full">
        <div className="my-8 h-40 animate-pulse rounded-xl border bg-card" />
      </div>
    );
  }

  const national = dir.nationalByYear;
  const latest = national[national.length - 1];
  const top = dir.rankable.slice(0, 8);
  const bottom = [...dir.rankable].reverse().slice(0, 8);

  return (
    <div className="mx-auto w-full">
      <Title
        description={
          bg
            ? "Резултатите от държавните зрелостни изпити (матура) по училища, общини и области — по данни на МОН."
            : "State matura results by school, municipality and province — sourced from the Ministry of Education."
        }
      >
        <span className="flex items-center gap-2">
          <GraduationCap className="h-6 w-6 text-muted-foreground" />
          {bg ? "Училища и матури" : "Schools & matura"}
        </span>
      </Title>

      {/* National headline + trend */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-muted-foreground" />
              {bg
                ? "Национален успех на матурата по БЕЛ"
                : "National matura average (Bulgarian)"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end justify-between gap-4">
              <div>
                <div className="text-4xl font-bold tabular-nums">
                  {latest?.avg != null ? fmt(latest.avg, lang) : "—"}
                </div>
                <div className="text-sm text-muted-foreground">
                  {latest?.year} ·{" "}
                  {latest?.examinees != null
                    ? `${latest.examinees.toLocaleString(bg ? "bg-BG" : "en-US")} ${bg ? "зрелостници" : "graduates"}`
                    : ""}
                </div>
              </div>
              <div className="w-40 text-primary">
                <Sparkline
                  values={rebase(national.map((n) => n.avg ?? 0))}
                  ariaLabel={bg ? "Национален тренд" : "National trend"}
                />
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums text-muted-foreground">
              {national.map((n) => (
                <span key={n.year}>
                  {n.year}: {n.avg != null ? fmt(n.avg, lang) : "—"}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Cross-link to the textbook market on the МОН pack */}
        <Link to={MON_AWARDER_PATH} className="block">
          <Card className="h-full transition-colors hover:border-primary/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Library className="h-5 w-5 text-muted-foreground" />
                {bg ? "Пазарът на учебници" : "The textbook market"}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {bg
                ? "Два издателя държат около 74% от пазара на учебници за €51 млн. Виж концентрацията на страницата на МОН →"
                : "Two publishers hold about 74% of the €51M textbook market. See the concentration on the МОН page →"}
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* School-finder map */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-muted-foreground" />
            {bg ? "Картата на училищата" : "The schools map"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div data-og="schools-map">
            <Suspense
              fallback={
                <div className="h-[460px] w-full animate-pulse rounded-xl border bg-card" />
              }
            >
              <SchoolsMap schools={dir.schools} />
            </Suspense>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{bg ? "среден успех:" : "average score:"}</span>
            {MAP_LEGEND.map((l) => (
              <span key={l.label} className="inline-flex items-center gap-1">
                <span
                  className="inline-block h-3 w-3 rounded-full"
                  style={{ backgroundColor: l.color }}
                />
                {l.label === "< 10"
                  ? bg
                    ? "< 10 зрел."
                    : "< 10 grads"
                  : l.label}
              </span>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground/70">
            {bg
              ? "Всяко училище е поставено по центъра на населеното си място; училищата в София са събрани в една точка (МОН публикува Столична община общо). Цветът е информативен, не присъда."
              : "Each school is placed at its settlement centroid; Sofia schools share one pin (МОН publishes the city as one aggregate). Colour is a finder aid, not a verdict."}
          </p>
        </CardContent>
      </Card>

      {/* Score vs context — the SEDA scatter + over-performers */}
      {dir.regression && (
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Scale className="h-5 w-5 text-muted-foreground" />
                {bg ? "Успех спрямо подобни училища" : "Score versus context"}
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                {bg
                  ? "Всяка точка е училище: наляво-надясно = условията в общината, нагоре = успех на матурата. Пунктирът е очакваното. Над линията = училището постига повече от очакваното за подобни училища."
                  : "Each dot is a school: left–right = its community's context, up = matura score. The dashed line is the expectation. Above it = the school beats what its context predicts."}
              </p>
            </CardHeader>
            <CardContent>
              <div data-og="context-scatter">
                <Suspense
                  fallback={
                    <div className="h-[300px] w-full animate-pulse rounded-xl border bg-card" />
                  }
                >
                  <ContextScatter dir={dir} />
                </Suspense>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {[
                  { c: "#16a34a", l: bg ? "над очакваното" : "above expected" },
                  { c: "#94a3b8", l: bg ? "близо" : "as expected" },
                  { c: "#dc2626", l: bg ? "под очакваното" : "below expected" },
                ].map((x) => (
                  <span key={x.l} className="inline-flex items-center gap-1">
                    <span
                      className="inline-block h-3 w-3 rounded-full"
                      style={{ backgroundColor: x.c }}
                    />
                    {x.l}
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                {bg ? "Постигат над очакваното" : "Punch above their context"}
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                {bg
                  ? "Най-голяма положителна разлика спрямо очакваното."
                  : "Largest positive gap vs the expectation."}
              </p>
            </CardHeader>
            <CardContent>
              <ol className="space-y-1">
                {dir.byResidual.slice(0, 8).map((s, i) => (
                  <li key={s.id} className="flex items-center gap-2 text-sm">
                    <span className="w-4 shrink-0 text-right text-xs text-muted-foreground">
                      {i + 1}
                    </span>
                    <Link
                      to={`/school/${s.id}`}
                      className="min-w-0 flex-1 truncate hover:text-primary"
                    >
                      {s.name}
                      <span className="ml-1 text-xs text-muted-foreground">
                        {s.obshtinaName}
                      </span>
                    </Link>
                    <span className="shrink-0 tabular-nums font-semibold text-emerald-600">
                      +{s.residual?.toFixed(2)}
                    </span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Finder */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-5 w-5 text-muted-foreground" />
            {bg ? "Намери своето училище" : "Find your school"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={
              bg ? "Име на училище или община…" : "School or municipality name…"
            }
            aria-label={bg ? "Търсене на училище" : "Search school"}
          />
          {dq.trim().length >= 2 && (
            <ul className="mt-3 divide-y">
              {results.length === 0 && (
                <li className="py-2 text-sm text-muted-foreground">
                  {bg ? "Няма съвпадения." : "No matches."}
                </li>
              )}
              {results.map((s) => (
                <li key={s.id}>
                  <Link
                    to={`/school/${s.id}`}
                    className="flex items-center justify-between gap-3 py-2 hover:text-primary"
                  >
                    <span className="min-w-0 truncate">
                      {s.name}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {s.obshtinaName}
                      </span>
                    </span>
                    {s.latestScore != null && (
                      <span className="shrink-0 tabular-nums text-sm text-muted-foreground">
                        {fmt(s.latestScore, lang)}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Best / worst schools */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <RankList
          title={bg ? "Най-висок успех" : "Highest results"}
          hint={
            bg
              ? `матура по БЕЛ, ${dir.latestYear} · ≥${MIN_RANK_COHORT} зрелостници`
              : `Bulgarian matura, ${dir.latestYear} · ≥${MIN_RANK_COHORT} graduates`
          }
          rows={top}
          lang={lang}
        />
        <RankList
          title={bg ? "Най-нисък успех" : "Lowest results"}
          hint={
            bg
              ? `матура по БЕЛ, ${dir.latestYear} · ≥${MIN_RANK_COHORT} зрелостници`
              : `Bulgarian matura, ${dir.latestYear} · ≥${MIN_RANK_COHORT} graduates`
          }
          rows={bottom}
          lang={lang}
        />
      </div>

      {/* Oblast breakdown — the "by locality" cut */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>{bg ? "По области" : "By province"}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1 pr-2">{bg ? "Област" : "Province"}</th>
                  <th className="py-1 pr-2 text-right">
                    {bg ? "Успех" : "Average"}
                  </th>
                  <th className="py-1 pr-2 text-right">
                    {bg ? "Училища" : "Schools"}
                  </th>
                  <th className="py-1 text-right">
                    {bg ? "Зрелостници" : "Graduates"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {dir.byOblast.map((o) => (
                  <tr key={o.oblast} className="border-t">
                    <td className="py-1.5 pr-2">{regionName(o.oblast)}</td>
                    <td className="py-1.5 pr-2 text-right font-semibold tabular-nums">
                      {fmt(o.avg, lang)}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums text-muted-foreground">
                      {o.schools}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                      {o.examinees.toLocaleString(bg ? "bg-BG" : "en-US")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <p className="mt-4 text-[11px] text-muted-foreground/80">
        {bg
          ? "Средният успех е претеглен по броя зрелостници. Училища с под 10 зрелостници не се класират (малка, несигурна извадка). Оценката на напредъка 7→12 клас — още по-справедливото сравнение с подобни по състав училища — предстои."
          : "Averages are weighted by the number of graduates. Schools with fewer than 10 graduates are not ranked (small, noisy sample). A context-adjusted comparison to similar schools is coming."}
      </p>
    </div>
  );
};

const RankList: FC<{
  title: string;
  hint: string;
  rows: {
    id: string;
    name: string;
    obshtinaName: string;
    latestScore: number | null;
  }[];
  lang: string;
}> = ({ title, hint, rows, lang }) => (
  <Card>
    <CardHeader>
      <CardTitle>{title}</CardTitle>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </CardHeader>
    <CardContent>
      <ol className="space-y-1">
        {rows.map((s, i) => (
          <li key={s.id} className="flex items-center gap-2 text-sm">
            <span className="w-5 shrink-0 text-right text-xs text-muted-foreground">
              {i + 1}
            </span>
            <Link
              to={`/school/${s.id}`}
              className="min-w-0 flex-1 truncate hover:text-primary"
            >
              {s.name}
              <span className="ml-2 text-xs text-muted-foreground">
                {s.obshtinaName}
              </span>
            </Link>
            <span className="shrink-0 tabular-nums font-semibold">
              {s.latestScore != null ? fmt(s.latestScore, lang) : "—"}
            </span>
          </li>
        ))}
      </ol>
    </CardContent>
  </Card>
);
