// Lean place dashboard for a Пловдив/Варна административен район ("PDV22-01"),
// rendered by MyAreaScreen when useAreaResolver returns kind:"rayon". Unlike a
// real obshtina (Sofia районите, every other município), a sub-city район has
// NO census / budget / officials / council grain — only what the section code
// yields: parliamentary results + turnout (from the derived rayon layer) and a
// directly-elected районен кмет (from the local-elections bundle). So this is a
// deliberately small dashboard: Парламент + Местни, plus links back up to the
// parent Община where the obshtina-grain views live.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Landmark, Vote } from "lucide-react";
import { SEO } from "@/ux/SEO";
import { H1 } from "@/ux/H1";
import { Link } from "@/ux/Link";
import { StatCard } from "@/screens/dashboard/StatCard";
import { formatPct, formatThousands } from "@/data/utils";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import {
  useCityRayonResults,
  useCityRayonHistory,
  useCityRayonSections,
} from "@/data/rayon/useCityRayons";
import { HistoricalTrendsTile } from "@/screens/dashboard/HistoricalTrendsTile";
import { SectionsMapTile } from "@/screens/dashboard/SectionsMapTile";
import { useLocalMunicipality } from "@/data/local/useLocalMunicipality";
import {
  findCityRayonByName,
  type CityRayon,
} from "@/data/local/cityRayonCatalog";
import { TopMayorsTile } from "@/screens/dashboard/local/TopMayorsTile";
import { LocalMayorRunoffBar } from "@/screens/dashboard/local/LocalMayorRunoffBar";
import { PlaceViewNav } from "@/screens/components/PlaceViewNav";

export const RayonAreaDashboard: FC<{ rayon: CityRayon }> = ({ rayon }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const { findParty } = usePartyInfo();
  const { displayNameFor } = useCanonicalParties();

  // Parliamentary results: the parent city's район layer, then this район by код.
  const { data: cityData } = useCityRayonResults(rayon.obshtina);
  const result = useMemo(
    () => cityData?.rayons.find((r) => r.key === rayon.code),
    [cityData, rayon.code],
  );
  // Cross-election trend for this район (ElectionInfo[] for HistoricalTrendsTile).
  const { data: history } = useCityRayonHistory(rayon.obshtina, rayon.code);
  // This район's own polling sections (parent МИР bundle filtered by the район
  // digits 5-6) for the "Карта на секциите" map — the same geographic view a
  // Sofia район carries, auto-fit to just this район.
  const { data: rayonSections } = useCityRayonSections(
    rayon.obshtina,
    rayon.code,
  );

  // Районен кмет: latest local cycle's bundle, district matched by name.
  const { municipality: localBundle, cycle } = useLocalMunicipality(
    rayon.obshtina,
  );
  const district = useMemo(
    () =>
      localBundle?.districts.find(
        (d) =>
          findCityRayonByName(rayon.obshtina, d.districtName)?.id === rayon.id,
      ),
    [localBundle, rayon.obshtina, rayon.id],
  );

  const name = lang === "bg" ? rayon.labelBg : rayon.labelEn;
  const muniLabel =
    lang === "bg" ? `Община ${rayon.cityBg}` : `${rayon.cityEn} municipality`;
  const seoTitle = `${t("rayon")} ${name} — ${muniLabel}`;

  const colorOf = (partyNum?: number) =>
    (partyNum != null ? findParty(partyNum)?.color : undefined) ?? "#9aa3ad";
  const nickOf = (partyNum?: number) => {
    const p = partyNum != null ? findParty(partyNum) : undefined;
    const nick =
      (lang === "bg" ? p?.nickName : p?.nickName_en || p?.nickName) ?? "";
    return displayNameFor(nick) ?? nick;
  };

  const parties = useMemo(() => {
    const votes = result?.results.votes ?? [];
    const valid = votes.reduce((s, v) => s + v.totalVotes, 0) || 1;
    return [...votes]
      .filter((v) => v.totalVotes > 0)
      .sort((a, b) => b.totalVotes - a.totalVotes)
      .slice(0, 8)
      .map((v) => ({ ...v, pct: (100 * v.totalVotes) / valid }));
  }, [result]);
  const maxVotes = parties[0]?.totalVotes || 1;
  const turnout = result?.results.protocol.totalActualVoters ?? 0;

  return (
    <>
      <SEO title={seoTitle} description={seoTitle} />
      <section className="my-4 flex flex-col gap-3">
        <div>
          <H1>
            {t("rayon")} {name}
          </H1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("admin_rayon")} ·{" "}
            <Link to={`/governance/${rayon.obshtina}`} underline>
              {muniLabel}
            </Link>{" "}
            · {rayon.mir.replace(/^0+/, "")} {t("mir")}
          </p>
        </div>

        {/* Same four-tab place switcher (Управление / Парламент / Местни /
            Потребление) the Sofia районите + the район's own parliamentary page
            carry — so the views are reachable from the governance tab too. */}
        <PlaceViewNav
          active="governance"
          level="municipality"
          obshtina={rayon.id}
          align="start"
        />

        {/* Карта на секциите — just this район's own polling stations (auto-fit
            to the район), the same map a Sofia район shows. Mounted only once
            the async section list resolves: SectionsMapTile measures its
            container in a mount-only layout effect, so an initially-undefined
            list would leave the map blank. */}
        {rayonSections && rayonSections.length ? (
          <SectionsMapTile sections={rayonSections} />
        ) : null}

        {/* Парламент — район-level party results + turnout, from the derived
            section-code layer. The geographic район choropleth lives on the
            parent city page (linked below). */}
        <StatCard
          label={
            <div className="flex items-center gap-2">
              <Vote className="h-4 w-4" />
              <span>{t("election_kind_parliament")}</span>
            </div>
          }
        >
          {parties.length ? (
            <div className="flex flex-col gap-2 mt-1">
              <div className="text-xs text-muted-foreground">
                {t("voted")}:{" "}
                <span className="font-semibold tabular-nums text-foreground">
                  {formatThousands(turnout)}
                </span>
              </div>
              {parties.map((v) => (
                <div
                  key={v.partyNum}
                  className="grid grid-cols-[minmax(0,1fr)_minmax(80px,1.4fr)_auto] gap-x-3 items-center text-sm"
                >
                  <span className="flex items-center gap-1.5 truncate">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-sm shrink-0"
                      style={{ backgroundColor: colorOf(v.partyNum) }}
                    />
                    <span className="truncate">{nickOf(v.partyNum)}</span>
                  </span>
                  <span className="h-2 rounded-full bg-muted overflow-hidden">
                    <span
                      className="block h-full rounded-full"
                      style={{
                        width: `${Math.max(3, (v.totalVotes / maxVotes) * 100)}%`,
                        backgroundColor: colorOf(v.partyNum),
                      }}
                    />
                  </span>
                  <span className="tabular-nums text-xs font-semibold text-right whitespace-nowrap">
                    {formatThousands(v.totalVotes)} · {formatPct(v.pct, 1)}
                  </span>
                </div>
              ))}
              <Link
                to={`/settlement/${rayon.obshtina}`}
                underline
                className="text-xs text-primary mt-1"
              >
                {lang === "bg"
                  ? `Картата на районите в Община ${rayon.cityBg} →`
                  : `District map of ${rayon.cityEn} municipality →`}
              </Link>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-2">
              {t("no_results")}
            </p>
          )}
        </StatCard>

        {/* Cross-election trend — same BubbleTimeline the município pages use,
            fed the район's per-cycle results. Self-hides with < 1 cycle. */}
        {history && history.length > 1 ? (
          <HistoricalTrendsTile stats={history} />
        ) : null}

        {/* Местни — the directly-elected районен кмет (R1 + runoff). Links to
            the city local page where the full район-mayor table lives. */}
        {district ? (
          <StatCard
            label={
              <div className="flex items-center gap-2">
                <Landmark className="h-4 w-4" />
                <span>{t("local_district_mayor")}</span>
              </div>
            }
          >
            <div className="flex flex-col gap-3 mt-1">
              {district.round2 && district.round2.length > 0 ? (
                <LocalMayorRunoffBar round2={district.round2} />
              ) : null}
              <TopMayorsTile
                candidates={district.candidates}
                electedName={district.elected?.candidateName ?? null}
                to={`/local/${cycle}/${rayon.obshtina}`}
              />
            </div>
          </StatCard>
        ) : null}

        <p className="text-xs text-muted-foreground">
          {lang === "bg"
            ? `Демографските и бюджетните данни се публикуват на ниво община, не по район — виж `
            : `Demographic and budget data are published at municipality level, not by district — see `}
          <Link to={`/governance/${rayon.obshtina}`} underline>
            {muniLabel}
          </Link>
          {lang === "bg" ? "." : "."}
        </p>
      </section>
    </>
  );
};
