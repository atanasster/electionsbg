// /procurement/roads — АПИ (Агенция "Пътна инфраструктура") road-spending
// dashboard. Headline money comes from the awarder rollup (matches the site);
// the road breakdowns (corridors, €/km, build-vs-repair, integrity) are
// computed client-side from the per-contract rows by the roadAttributes engine.
// A defensible rebuild of the infographic mockup: every figure is either
// full-coverage (integrity) or confidence-gated (€/km) — no fabricated metrics.

import { FC, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
  Coins,
  FileText,
  Users,
  Gavel,
  Route as RouteIcon,
  MapPin,
  Waypoints,
  TriangleAlert,
} from "lucide-react";
import { Title } from "@/ux/Title";
import { StatCard } from "../dashboard/StatCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProcurementNav } from "../components/procurement/ProcurementNav";
import { ErrorSection } from "../components/ErrorSection";
import { MpAvatar } from "../components/candidates/MpAvatar";
import { useRoads, API_EIK } from "@/data/procurement/useRoads";
import { dataUrl } from "@/data/dataUrl";
import type { ProcurementMpConnectedFile } from "@/data/dataTypes";
import { formatEur, formatEurWithOther } from "@/lib/currency";
import { procedureLabel } from "@/lib/cpvSectors";
import { RoadCostPerKmTile } from "../components/procurement/roads/RoadCostPerKmTile";
import { RoadWorkGroupDonut } from "../components/procurement/roads/RoadWorkGroupDonut";
import {
  RoadNetworkMap,
  type RoadMetric,
} from "../components/procurement/roads/RoadNetworkMap";

const numFmt = new Intl.NumberFormat("bg-BG");
const pctFmt = (v: number | undefined, lang: string) =>
  v == null
    ? "—"
    : (v * 100).toLocaleString(lang, { maximumFractionDigits: 1 }) + "%";

const useMpConnected = () =>
  useQuery({
    queryKey: ["procurement", "mp_connected"] as const,
    queryFn: async () => {
      const r = await fetch(dataUrl("/procurement/derived/mp_connected.json"));
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`fetch failed: ${r.status} ${r.url}`);
      return (await r.json()) as ProcurementMpConnectedFile;
    },
    staleTime: Infinity,
  });

export const RoadsScreen: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const [mapMetric, setMapMetric] = useState<RoadMetric>("singleBid");
  const { rollup, model, isLoading } = useRoads();
  const { data: mpConnected } = useMpConnected();

  // АПИ contractors that are MP-connected, with the MPs behind them.
  const mpTied = useMemo(() => {
    if (!rollup || !mpConnected) return [];
    const byEik = new Map<string, { mpId: number; mpName: string }[]>();
    for (const e of mpConnected.entries) {
      const arr = byEik.get(e.contractorEik) ?? [];
      if (!arr.some((m) => m.mpId === e.mpId))
        arr.push({ mpId: e.mpId, mpName: e.mpName });
      byEik.set(e.contractorEik, arr);
    }
    return rollup.byContractor
      .filter((c) => byEik.has(c.eik))
      .map((c) => ({ contractor: c, mps: byEik.get(c.eik) ?? [] }));
  }, [rollup, mpConnected]);

  if (isLoading) {
    return (
      <>
        <Title description="АПИ road-spending dashboard">
          {lang === "bg" ? "Пътна инфраструктура" : "Road infrastructure"}
        </Title>
        <ProcurementNav />
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-5 my-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl border bg-card p-4 shadow-sm animate-pulse h-[120px]"
            />
          ))}
        </div>
      </>
    );
  }
  if (!rollup || !model) {
    return (
      <ErrorSection
        title={lang === "bg" ? "Няма данни" : "No data"}
        description={
          lang === "bg"
            ? "Не са намерени данни за АПИ. Стартирайте npm run bucket:sync."
            : "No АПИ procurement data found."
        }
      />
    );
  }

  const methodTotal = model.methods.reduce((s, m) => s + m.totalEur, 0) || 1;

  return (
    <>
      <Title
        description={
          lang === "bg"
            ? "Разходи и ефективност на АПИ по обществени поръчки"
            : "АПИ road-procurement spending and effectiveness"
        }
      >
        {lang === "bg"
          ? "Пътна инфраструктура — АПИ"
          : "Road infrastructure — АПИ"}
      </Title>
      <ProcurementNav />

      <div className="flex items-center gap-2 my-2 text-sm text-muted-foreground">
        <RouteIcon className="h-4 w-4" />
        <Link to={`/awarder/${API_EIK}`} className="hover:underline">
          {rollup.name}
        </Link>
        <span className="text-xs">· EIK {rollup.eik}</span>
      </div>

      {/* Headline KPIs */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5 my-4">
        <StatCard
          label={lang === "bg" ? "Общо възложено" : "Total awarded"}
          to={`/awarder/${API_EIK}`}
        >
          <div className="flex items-baseline gap-2">
            <Coins className="h-5 w-5 text-muted-foreground shrink-0" />
            <span className="text-base md:text-lg font-bold tabular-nums break-words">
              {formatEurWithOther(rollup.totalEur, rollup.totalOther, lang)}
            </span>
          </div>
        </StatCard>
        <StatCard label={lang === "bg" ? "Договори" : "Contracts"}>
          <div className="flex items-baseline gap-2">
            <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
            <span className="text-2xl font-bold tabular-nums">
              {numFmt.format(rollup.contractCount)}
            </span>
          </div>
        </StatCard>
        <StatCard
          label={lang === "bg" ? "Една оферта" : "Single bidder"}
          hint={
            lang === "bg"
              ? "Дял на договорите с един участник (където броят е известен)."
              : "Share of contracts with a single bidder (where the count is known)."
          }
          className={
            (model.singleBidShare ?? 0) > 0.3
              ? "ring-1 ring-amber-200/60 dark:ring-amber-800/40"
              : undefined
          }
        >
          <div className="flex items-baseline gap-2">
            <TriangleAlert className="h-5 w-5 text-amber-600 shrink-0" />
            <span className="text-2xl font-bold tabular-nums">
              {pctFmt(model.singleBidShare, lang)}
            </span>
          </div>
        </StatCard>
        <StatCard
          label={lang === "bg" ? "Без обявление" : "Direct award"}
          hint={
            lang === "bg"
              ? "Дял от обема, възложен пряко / без обявление."
              : "Share of volume awarded directly / without a notice."
          }
        >
          <div className="flex items-baseline gap-2">
            <Gavel className="h-5 w-5 text-muted-foreground shrink-0" />
            <span className="text-2xl font-bold tabular-nums">
              {pctFmt(model.directShare, lang)}
            </span>
          </div>
        </StatCard>
        <StatCard
          label={lang === "bg" ? "На разпознат път" : "On a named road"}
          hint={
            lang === "bg"
              ? "Дял от обема по договори с разпознаваема пътна референция (АМ или Път I/II/III)."
              : "Share of volume on contracts with a recognisable road reference."
          }
        >
          <div className="flex items-baseline gap-2">
            <MapPin className="h-5 w-5 text-muted-foreground shrink-0" />
            <span className="text-2xl font-bold tabular-nums">
              {pctFmt(model.refCoverageEur, lang)}
            </span>
          </div>
        </StatCard>
      </div>

      {/* Hero — motorway network coloured by the selected metric */}
      <Card className="my-4">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Waypoints className="h-4 w-4" />
              {lang === "bg" ? "Магистрална мрежа" : "Motorway network"}
            </CardTitle>
            <Select
              value={mapMetric}
              onValueChange={(v) => setMapMetric(v as RoadMetric)}
            >
              <SelectTrigger className="h-8 w-auto text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="singleBid">
                  {lang === "bg" ? "Една оферта" : "Single bidder"}
                </SelectItem>
                <SelectItem value="perKm">
                  {lang === "bg" ? "Цена на километър" : "Cost per kilometre"}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-3 md:p-4">
          <RoadNetworkMap corridors={model.corridors} metric={mapMetric} />
          <p className="text-[11px] text-muted-foreground/80 mt-2">
            {lang === "bg"
              ? "Показани са автомагистралите и финансираните републикански пътища (I и II клас). Дебелината на линията показва класа на пътя."
              : "Motorways and funded republican roads (class I and II) are shown. Line thickness reflects the road class."}
          </p>
        </CardContent>
      </Card>

      {/* Cost/km + build-vs-repair */}
      <div className="grid gap-4 xl:grid-cols-2 my-4">
        <RoadCostPerKmTile corridors={model.corridors} />
        <RoadWorkGroupDonut
          groups={model.workGroups}
          totalEur={model.totalEur}
        />
      </div>

      {/* Procedure mix + top projects */}
      <div className="grid gap-4 xl:grid-cols-2 my-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Gavel className="h-4 w-4" />
              {lang === "bg" ? "Как се възлага" : "How it is awarded"}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 md:p-4 space-y-2">
            {model.methods.map((m) => (
              <div key={m.bucket} className="flex items-center gap-2 text-xs">
                <span className="w-36 shrink-0 truncate">
                  {procedureLabel(m.bucket, lang)}
                </span>
                <span className="flex-1 h-2.5 rounded bg-muted overflow-hidden">
                  <span
                    className={`block h-full ${m.bucket === "direct" ? "bg-amber-500/70" : "bg-primary/60"}`}
                    style={{
                      width: `${Math.max(2, Math.min(100, (m.totalEur / methodTotal) * 100))}%`,
                    }}
                  />
                </span>
                <span className="w-14 text-right tabular-nums text-muted-foreground">
                  {((m.totalEur / methodTotal) * 100).toLocaleString(lang, {
                    maximumFractionDigits: 1,
                  })}
                  %
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" />
              {lang === "bg" ? "Най-големи проекти" : "Top projects"}
              <span className="text-xs text-muted-foreground font-normal">
                {lang === "bg" ? "по стойност" : "by value"}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 md:p-4">
            <ul className="divide-y divide-border text-sm">
              {model.topProjects.map((r) => (
                <li key={r.c.key} className="py-2">
                  <Link
                    to={`/contract/${r.c.key}`}
                    className="font-medium hover:underline line-clamp-1"
                    title={r.c.title}
                  >
                    {r.c.title}
                  </Link>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {r.ref ? (
                      <span className="rounded bg-muted px-1.5 py-0.5">
                        {r.ref.corridor}
                      </span>
                    ) : null}
                    <span className="truncate">{r.c.contractorName}</span>
                    <span className="ml-auto tabular-nums font-medium text-foreground">
                      {formatEur(r.amountEur)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* MP-connected contractors */}
      {mpTied.length > 0 ? (
        <Card className="my-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4 text-amber-600" />
              {lang === "bg"
                ? "Изпълнители със свързани лица в парламента"
                : "Contractors linked to MPs"}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 md:p-4">
            <div className="rounded-md border bg-card overflow-hidden">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-border">
                  {mpTied.map(({ contractor, mps }) => (
                    <tr key={contractor.eik}>
                      <td className="px-3 py-2">
                        <Link
                          to={`/company/${contractor.eik}`}
                          className="font-medium hover:underline"
                        >
                          {contractor.name}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          {mps.map((m) => (
                            <Link
                              key={m.mpId}
                              to={`/candidate/mp-${m.mpId}/procurement`}
                              className="hover:underline inline-flex items-center gap-1.5"
                            >
                              <MpAvatar mpId={m.mpId} name={m.mpName} />
                              {m.mpName}
                            </Link>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatEurWithOther(
                          contractor.totalEur,
                          contractor.totalOther,
                          lang,
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Key factors explainer (static context) */}
      <Card className="my-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {lang === "bg"
              ? "Какво влияе на цената на километър"
              : "What drives cost per kilometre"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 md:p-4 text-sm text-muted-foreground">
          {lang === "bg" ? (
            <>
              <p>
                Цената на километър не е сравнима между различни видове работа и
                терен. Ново строителство на автомагистрала, основен ремонт на
                път III клас и съоръжения (мостове, тунели) се различават
                многократно — тунелните участъци достигат десетки милиони на
                километър. Затова сравняваме всеки участък спрямо вътрешен
                еталон за същия клас път и вид работа, а не директно с други
                държави.
              </p>
              <p className="mt-2 text-xs">
                За груб ориентир (не пряко сравнение): ново строителство на
                магистрала в България е средно около €3–6 млн/км, в Румъния
                ~€6,3 млн/км, в Гърция ~€10 млн/км; базата на Световната банка
                (ROCKS) дава ~€1,4 млн/км за двулентов път без съоръжения.
              </p>
            </>
          ) : (
            <>
              <p>
                Cost per kilometre is not comparable across work types or
                terrain. New motorway construction, major rehabilitation of a
                class III road and structures (bridges, tunnels) differ by an
                order of magnitude — tunnel sections reach tens of millions per
                kilometre. Each segment is therefore benchmarked against an
                internal reference class for the same road class and work type,
                not directly against other countries.
              </p>
              <p className="mt-2 text-xs">
                As a rough, non-comparable benchmark: new motorway construction
                averages ~€3–6M/km in Bulgaria, ~€6.3M/km in Romania, ~€10M/km
                in Greece; the World Bank ROCKS database gives ~€1.4M/km for a
                two-lane road excluding structures.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <p className="text-[11px] text-muted-foreground/80 mt-4">
        {lang === "bg"
          ? "Източник: data.egov.bg (АОП OCDS). Пътните референции и дължини са разчетени от заглавията на договорите."
          : "Source: data.egov.bg (АОП OCDS). Road references and lengths parsed from contract titles."}
      </p>
    </>
  );
};
