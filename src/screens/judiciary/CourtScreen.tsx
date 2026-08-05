// /court/:bodyCode — one judicial body: a court, a prosecution office or an
// investigation service.
//
// THE ROUTE NAME IS NARROWER THAN ITS CONTENTS, deliberately. It covers all 279
// bodies (182 courts + 69 prosecution + 28 investigation), because those are
// exactly what a reader types — but "съд" is the guessable word, so the slug
// stays /court and the page title carries the real kind.
//
// THE DEGRADED CASE IS THE POINT. court_load publishes a workload series for 180
// bodies; the other 99 have none, and most prosecution offices have no
// coordinates either. This page NAMES that absence. Rendering an empty chart
// instead would read as "this body handled no cases", which is a false claim
// rather than a missing one.

import { FC } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Scale, Users, TrendingUp, MapPin } from "lucide-react";
import { Title } from "@/ux/Title";
import { StatCard } from "@/screens/dashboard/StatCard";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { useCourt } from "@/data/judiciary/useCourt";
// Shared with the prerender builder, so the static HTML a crawler reads and this
// page cannot call the same body two different things.
import { judicialKindLabel, judicialNum } from "@/lib/judicialKind";

export const CourtScreen: FC = () => {
  const { bodyCode } = useParams<{ bodyCode: string }>();
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const L = i18n.language;
  const { data, isLoading } = useCourt(bodyCode);

  const kind = data ? judicialKindLabel(data.kind) : null;
  const latest = data?.load?.[data.load.length - 1] ?? null;

  return (
    <>
      <Title
        description={
          data
            ? bg
              ? `${data.name} — натовареност по години, магистрати и седалище, по данни на ВСС и ИВСС.`
              : `${data.name} — workload by year, magistrates and seat, from the Supreme Judicial Council and the Judicial Inspectorate.`
            : bg
              ? "Орган на съдебната власт."
              : "A body of the judiciary."
        }
      >
        {data?.name ?? (bg ? "Непознат орган" : "Unknown body")}
      </Title>

      {isLoading ? (
        <div className="my-6 h-40 animate-pulse rounded-xl border bg-card" />
      ) : !data ? (
        // Soft 404. Do NOT reflect the raw slug into the heading — an unknown
        // path would otherwise mint an indexable page titled with whatever the
        // URL contained.
        <p className="my-8 text-center text-muted-foreground">
          {bg
            ? "Няма такъв орган в регистъра на съдебната власт."
            : "No such body in the judiciary register."}
        </p>
      ) : (
        <section aria-label={data.name} className="my-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label={bg ? "Вид" : "Kind"}>
              <div className="flex items-baseline gap-2">
                <Scale className="h-5 w-5 shrink-0 text-muted-foreground" />
                <span className="text-xl font-semibold">
                  {bg ? kind!.bg : kind!.en}
                </span>
              </div>
              {data.tier && (
                <span className="mt-1 block text-xs text-muted-foreground">
                  {data.tier}
                </span>
              )}
            </StatCard>
            <StatCard label={bg ? "Седалище" : "Seat"}>
              <div className="flex items-baseline gap-2">
                <MapPin className="h-5 w-5 shrink-0 text-muted-foreground" />
                <span className="text-xl font-semibold">
                  {data.place ?? "—"}
                </span>
              </div>
            </StatCard>
            <StatCard label={bg ? "Магистрати" : "Magistrates"}>
              <div className="flex items-baseline gap-2">
                <Users className="h-5 w-5 shrink-0 text-muted-foreground" />
                <span className="text-2xl font-bold tabular-nums">
                  {data.magistrates.toLocaleString(L)}
                </span>
              </div>
              <span className="mt-1 block text-xs text-muted-foreground">
                {bg ? "с декларации в ИВСС" : "declaring to the Inspectorate"}
              </span>
            </StatCard>
            {latest && (
              <StatCard label={bg ? "Постъпили/съдия/мес." : "Filed/judge/mo."}>
                <div className="flex items-baseline gap-2">
                  <TrendingUp className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <span className="text-2xl font-bold tabular-nums">
                    {judicialNum(latest.filedPerMonth, L)}
                  </span>
                </div>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {latest.year}
                </span>
              </StatCard>
            )}
          </div>

          {data.load && data.load.length > 0 ? (
            <DashboardSection
              id="court-load"
              title={bg ? "Натовареност по години" : "Workload by year"}
              icon={TrendingUp}
            >
              <div className="rounded-xl border bg-card p-3 shadow-sm md:p-4">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-muted-foreground">
                      <tr className="border-b">
                        <th className="py-1.5 pr-2 text-left font-normal">
                          {bg ? "Година" : "Year"}
                        </th>
                        <th className="py-1.5 pr-2 text-right font-normal">
                          {bg ? "Съдии" : "Judges"}
                        </th>
                        <th className="py-1.5 pr-2 text-right font-normal">
                          {bg ? "Постъпили" : "Filed"}
                        </th>
                        <th className="py-1.5 pr-2 text-right font-normal">
                          {bg ? "За разглеждане" : "For consideration"}
                        </th>
                        <th className="py-1.5 text-right font-normal">
                          {bg ? "Свършени" : "Resolved"}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {data.load.map((r) => (
                        <tr key={r.year} className="hover:bg-muted/40">
                          <td className="py-1.5 pr-2">{r.year}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">
                            {r.judges ?? "—"}
                          </td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">
                            {judicialNum(r.filedPerMonth, L)}
                          </td>
                          <td className="py-1.5 pr-2 text-right tabular-nums text-muted-foreground">
                            {judicialNum(r.considerPerMonth, L)}
                          </td>
                          <td className="py-1.5 text-right tabular-nums">
                            {judicialNum(r.resolvedPerMonth, L)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground/80">
                  {bg
                    ? "Действителна натовареност — брой дела на съдия на месец, по данни на ВСС."
                    : "Actual workload — cases per judge per month, from the Supreme Judicial Council."}
                </p>
              </div>
            </DashboardSection>
          ) : !data.sourcesBuilt ? (
            // "Not loaded" and "nothing published" are shape-identical in the
            // payload, so they must NOT share copy: without this branch a
            // database that has the function but not the bridge table asserts
            // that the ВСС publishes no workload for Софийски районен съд.
            <p className="my-6 rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground">
              {bg
                ? "Данните за натовареност още не са заредени на този сървър."
                : "Workload data is not loaded on this server yet."}
            </p>
          ) : (
            // NOT an empty chart: 99 of the 279 bodies publish no workload, and
            // rendering zeros for them would assert something the source does
            // not say.
            <p className="my-6 rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground">
              {bg
                ? "ВСС не публикува натовареност за този орган — статистиката обхваща съдилищата, не прокуратурите и следствените отдели."
                : "The Supreme Judicial Council publishes no workload for this body — the statistics cover the courts, not the prosecution offices or investigation services."}
            </p>
          )}

          <p className="mt-6 flex flex-wrap justify-center gap-x-4 gap-y-2 text-sm">
            {/* The magistrate roster filters on the institution NAME, not the
                body_code — see the URL contract in CLAUDE.md. */}
            <Link
              to={`/persons?court=${encodeURIComponent(data.name)}`}
              className="text-primary hover:underline"
            >
              {bg ? "Магистратите тук →" : "Magistrates here →"}
            </Link>
            <Link to="/judiciary" className="text-primary hover:underline">
              ← {bg ? "Съдебна власт" : "The judiciary"}
            </Link>
          </p>
        </section>
      )}
    </>
  );
};
