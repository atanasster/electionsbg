// /consumption/eu — Bulgarian prices vs the EU, from official Eurostat Price
// Level Indices (EU27 = 100). Covers the whole household basket, not just food:
// a headline overall price level with an income-adjusted purchasing-power
// counterpoint, per-division diverging bars (food shown in full detail), a
// fresher household-energy block (electricity / gas / fuel, BG-vs-EU), and a
// convergence trend showing BG closing the gap to the EU average since 2010.
// Official PPP-programme statistics — VAT-handled and quality-adjusted at source,
// so no per-SKU caveats. See docs/plans/consumption-hub-v1.md §1.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Landmark, TrendingUp, Wallet } from "lucide-react";
import { SEO } from "@/ux/SEO";
import { ConsumptionBreadcrumb } from "@/screens/components/ConsumptionBreadcrumb";
import { Title } from "@/ux/Title";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { Card } from "@/components/ui/card";
import {
  usePricePli,
  type PeerGeo,
  type PricePliCategory,
} from "@/data/macro/useMacroPeers";
import { useEnergyPrices, useGasPrices } from "@/data/energy/useEnergyPrices";
import { latestCommonPrice } from "@/data/energy/types";
import { useFuel } from "@/data/prices/useFuel";
import { Flag } from "@/screens/components/euCompare/Flag";
import {
  GEO_SHORT_BG,
  GEO_SHORT_EN,
} from "@/screens/components/euCompare/usePeerSelection";
import {
  PriceTrendChart,
  type PriceRow,
} from "@/screens/consumption/PriceTrendChart";
import { cn } from "@/lib/utils";

// Diverging-bar domain around the EU=100 baseline. Divisions span ~40..101, food
// detail reaches ~142 (oils) — one shared domain keeps every bar comparable.
const DMIN = 30;
const DMAX = 150;
const barPos = (v: number) => ((v - DMIN) / (DMAX - DMIN)) * 100;
const CENTER = barPos(100);

// Hero scale: 0..EU-and-a-bit, so "60% of EU" reads proportionally from zero.
const SMAX = 112;
const scalePos = (v: number) => Math.min((v / SMAX) * 100, 100);

const PEER_ORDER: PeerGeo[] = ["BG", "RO", "GR", "HU", "HR", "EU27_2020"];
const TREND_GEOS: PeerGeo[] = ["BG", "EU27_2020", "RO", "GR", "HU", "HR"];

const cheaperText = "rgb(16 185 129)"; // emerald-500
const dearerText = "rgb(244 63 94)"; // rose-500

// A short gloss per category — the concrete prices each COICOP class covers, so
// the abstract labels ("Miscellaneous", "Recreation") are legible at a glance.
// Keyed by ppp_cat18 code; energy rows carry their own inline descriptions.
const CAT_DESC: Record<string, { bg: string; en: string }> = {
  // Divisions
  A0101: {
    bg: "Хляб, месо, млечни, плодове, зеленчуци, напитки",
    en: "Bread, meat, dairy, fruit, vegetables, drinks",
  },
  A0102: {
    bg: "Спиртни напитки, вино, бира, цигари",
    en: "Spirits, wine, beer, cigarettes",
  },
  A0103: {
    bg: "Дрехи, обувки и аксесоари",
    en: "Clothes, footwear and accessories",
  },
  A0104: {
    bg: "Наеми, вода, ток, газ, отопление, поддръжка",
    en: "Rent, water, electricity, gas, heating, upkeep",
  },
  A0105: {
    bg: "Мебели, домакински уреди, текстил, инструменти",
    en: "Furniture, appliances, textiles, tools",
  },
  A0106: {
    bg: "Лекарства, лекарски и болнични услуги",
    en: "Medicines, doctor and hospital services",
  },
  A0107: {
    bg: "Коли, горива, ремонти, билети за транспорт",
    en: "Cars, fuel, repairs, transport tickets",
  },
  A0108: {
    bg: "Телефон, интернет, поща, устройства",
    en: "Phone, internet, post, devices",
  },
  A0109: {
    bg: "Електроника, спорт, книги, туризъм, хоби",
    en: "Electronics, sport, books, holidays, hobbies",
  },
  A0110: {
    bg: "Такси за градина, училище, университет, курсове",
    en: "Preschool, school, university and course fees",
  },
  A0111: {
    bg: "Хранене навън, кафенета, хотели, настаняване",
    en: "Eating out, cafés, hotels, accommodation",
  },
  A0112: {
    bg: "Козметика, фризьор, застраховки, лични услуги",
    en: "Personal care, insurance, personal services",
  },
  // Food detail
  A01010101: {
    bg: "Хляб, брашно, тестени, ориз, зърнени закуски",
    en: "Bread, flour, pasta, rice, cereals",
  },
  A01010102: {
    bg: "Прясно, замразено и преработено месо",
    en: "Fresh, frozen and processed meat",
  },
  A01010103: {
    bg: "Прясна, замразена и консервирана риба и морски дарове",
    en: "Fresh, frozen and canned fish and seafood",
  },
  A01010104: {
    bg: "Мляко, сирене, кисело мляко, масло, яйца",
    en: "Milk, cheese, yoghurt, butter, eggs",
  },
  A01010105: {
    bg: "Олио, зехтин, масло, маргарин",
    en: "Cooking oils, olive oil, butter, margarine",
  },
  A01010106: {
    bg: "Пресни, сушени и замразени плодове и ядки",
    en: "Fresh, dried and frozen fruit and nuts",
  },
  A01010107: {
    bg: "Пресни зеленчуци, картофи, бобови",
    en: "Fresh vegetables, potatoes, pulses",
  },
  A01010108: {
    bg: "Захар, шоколад, сладкиши, сладолед",
    en: "Sugar, chocolate, sweets, ice cream",
  },
  A01010109: {
    bg: "Готови ястия, сосове, подправки, детски храни",
    en: "Ready meals, sauces, condiments, baby food",
  },
  A010102: {
    bg: "Кафе, чай, минерална вода, сокове, газирани",
    en: "Coffee, tea, water, juices, soft drinks",
  },
};

// One diverging bar around the EU=100 baseline. `desc` is a small, light gloss
// under the label naming the concrete prices the category covers. `inset`
// renders the food-detail rows a step in and a touch quieter than their parent.
const DivergingRow: FC<{
  label: string;
  value: number;
  desc?: string;
  inset?: boolean;
}> = ({ label, value, desc, inset }) => {
  const dearer = value > 100;
  const p = barPos(value);
  return (
    <div
      className={cn("flex items-center gap-2 text-sm", inset && "text-[13px]")}
    >
      <div className="w-36 shrink-0 sm:w-56">
        <div
          className={cn(
            "truncate",
            inset ? "text-muted-foreground" : "font-medium",
          )}
        >
          {label}
        </div>
        {desc ? (
          <div className="text-[11px] leading-snug text-muted-foreground/60">
            {desc}
          </div>
        ) : null}
      </div>
      <div className="relative h-4 flex-1 rounded-full bg-muted/50">
        <div
          className="absolute inset-y-0 w-px bg-foreground/25"
          style={{ left: `${CENTER}%` }}
          aria-hidden
        />
        <div
          className={cn(
            "absolute inset-y-[3px] rounded-full",
            inset ? "opacity-70" : "opacity-100",
          )}
          style={{
            left: `${Math.min(p, CENTER)}%`,
            width: `${Math.max(Math.abs(p - CENTER), 0.6)}%`,
            background: dearer
              ? "linear-gradient(90deg, rgb(251 113 133), rgb(244 63 94))"
              : "linear-gradient(90deg, rgb(52 211 153), rgb(16 185 129))",
          }}
          aria-hidden
        />
      </div>
      <span
        className="w-9 shrink-0 text-right font-semibold tabular-nums"
        style={{ color: dearer ? dearerText : cheaperText }}
      >
        {Math.round(value)}
      </span>
    </div>
  );
};

export const ConsumptionEuScreen: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const T = (b: string, e: string) => (bg ? b : e);
  const geoLabelShort = bg ? GEO_SHORT_BG : GEO_SHORT_EN;
  const pricePli = usePricePli();
  const elec = useEnergyPrices();
  const gas = useGasPrices();
  const fuel = useFuel();

  const bgVals = useMemo(() => pricePli?.values.BG ?? {}, [pricePli]);
  const bgVols = pricePli?.volumes.BG ?? {};
  const overall = bgVals["A01"];
  const consumption = bgVols["A01"];
  const deltaOverall =
    overall != null ? Math.round(Math.abs(overall - 100)) : null;
  const cheaper = overall != null && overall < 100;

  const cats = useMemo(() => pricePli?.categories ?? [], [pricePli]);
  const divisions = useMemo(
    () =>
      cats
        .filter((c) => c.kind === "division")
        .map((c) => ({ c, v: bgVals[c.code] }))
        .filter((r): r is { c: PricePliCategory; v: number } => r.v != null)
        .sort((a, b) => a.v - b.v),
    [cats, bgVals],
  );
  const foodDetail = useMemo(
    () =>
      cats
        .filter((c) => c.kind === "food" && c.code !== "A010101")
        .map((c) => ({ c, v: bgVals[c.code] }))
        .filter((r): r is { c: PricePliCategory; v: number } => r.v != null)
        .sort((a, b) => a.v - b.v),
    [cats, bgVals],
  );

  // Household energy & fuel, BG-vs-EU (EU=100) — a fresher, unit-price companion
  // to the annual PPP basket above. Electricity/gas are half-year; fuel weekly.
  const energyRows = useMemo(() => {
    const rows: { key: string; label: string; desc: string; value: number }[] =
      [];
    const e = elec.data ? latestCommonPrice(elec.data) : null;
    if (e)
      rows.push({
        key: "elec",
        label: T("Ток", "Electricity"),
        desc: T(
          "Битова цена на електроенергия с всички данъци",
          "Household electricity price, all taxes",
        ),
        value: e.pctOfEu,
      });
    const g = gas.data ? latestCommonPrice(gas.data) : null;
    if (g)
      rows.push({
        key: "gas",
        label: T("Природен газ", "Natural gas"),
        desc: T(
          "Битова цена на природен газ с всички данъци",
          "Household natural gas price, all taxes",
        ),
        value: g.pctOfEu,
      });
    const series = fuel.data?.series;
    if (series?.length) {
      for (let i = series.length - 1; i >= 0; i--) {
        const r = series[i];
        const pb = r.petrol?.BG,
          pe = r.petrol?.EU27_2020,
          db = r.diesel?.BG,
          de = r.diesel?.EU27_2020;
        if (pb != null && pe && db != null && de) {
          rows.push({
            key: "fuel",
            label: T("Горива (А95/дизел)", "Fuel (95/diesel)"),
            desc: T(
              "Бензин А95 и дизел на бензиностанция",
              "Petrol 95 and diesel at the pump",
            ),
            value: Math.round(((pb / pe + db / de) / 2) * 100),
          });
          break;
        }
      }
    }
    return rows;
  }, [elec.data, gas.data, fuel.data, bg]); // eslint-disable-line react-hooks/exhaustive-deps
  const energyPeriod = elec.data ? latestCommonPrice(elec.data)?.period : null;
  const fuelDate = fuel.data?.latestDate;

  const peerRows = pricePli
    ? PEER_ORDER.filter((g) => pricePli.values[g]?.["A01"] != null).map(
        (g) => ({ g, v: pricePli.values[g]["A01"] }),
      )
    : [];

  // Convergence trend rows: BG + peers per year; EU is the flat 100 benchmark.
  const trendRows: PriceRow[] = useMemo(() => {
    if (!pricePli) return [];
    const { years, values } = pricePli.trend;
    return years.map((y, i) => {
      const row: PriceRow = { x: String(y), date: `${y}-01-01` };
      for (const g of TREND_GEOS) {
        row[g] = g === "EU27_2020" ? 100 : (values[g]?.[i] ?? null);
      }
      return row;
    });
  }, [pricePli]);
  const trendFirstBg =
    pricePli?.trend.values.BG?.find((v) => v != null) ?? null;

  return (
    <>
      <SEO
        title={T(
          "Цените спрямо ЕС · Потребление",
          "Prices vs the EU · Consumption",
        )}
        description={T(
          "Цените в България спрямо средното за ЕС по цялата потребителска кошница (Евростат, ЕС=100) — храна, жилище, транспорт, услуги, енергия, плюс реалното потребление на човек.",
          "Bulgarian prices vs the EU average across the whole consumption basket (Eurostat, EU=100) — food, housing, transport, services, energy, plus real consumption per person.",
        )}
      />
      <ConsumptionBreadcrumb
        section={T("Спрямо ЕС", "vs the EU")}
        className="mt-4 mb-2"
      />
      <Title>{T("Цените спрямо ЕС", "Prices vs the EU")}</Title>

      {!pricePli ? null : (
        <>
          {/* ---------- Headline: overall price level + purchasing power ------ */}
          <DashboardSection
            id="macro"
            title={T("Общо ценово равнище", "Overall price level")}
            subtitle={T(
              "Индекс на ценовото равнище · ЕС = 100 · Евростат",
              "Price level index · EU = 100 · Eurostat",
            )}
            icon={Landmark}
          >
            <Card className="flex flex-col gap-6 p-5">
              {overall != null ? (
                <div className="flex items-end gap-3">
                  <div
                    className="text-5xl font-bold leading-none tabular-nums"
                    style={{ color: cheaper ? cheaperText : dearerText }}
                  >
                    {Math.round(overall)}
                  </div>
                  <div className="pb-1 text-sm text-muted-foreground">
                    {T(
                      `цените у нас са ${deltaOverall}% ${cheaper ? "под" : "над"} средното за ЕС (${pricePli.year})`,
                      `prices here are ${deltaOverall}% ${cheaper ? "below" : "above"} the EU average (${pricePli.year})`,
                    )}
                  </div>
                </div>
              ) : null}

              {/* Prices vs real consumption per capita — the income caveat, made
                  concrete: cheap prices, but people still consume less. */}
              <div className="flex flex-col gap-3">
                <ScaleRow
                  label={T("Цени (равнище)", "Prices (level)")}
                  value={overall}
                  accent={cheaperText}
                />
                {consumption != null ? (
                  <ScaleRow
                    label={T(
                      "Реално потребление / чов.",
                      "Real consumption / person",
                    )}
                    value={consumption}
                    accent="rgb(99 102 241)" // indigo-500
                  />
                ) : null}
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {consumption != null && overall != null
                    ? T(
                        `Цените са ниски (${Math.round(overall)}), но и доходите — затова реалното потребление на човек е ${Math.round(consumption)}% от средното за ЕС. Ниските цени не значат по-висок стандарт.`,
                        `Prices are low (${Math.round(overall)}), but so are incomes — real consumption per person is only ${Math.round(consumption)}% of the EU average. Cheap prices do not mean a higher standard of living.`,
                      )
                    : null}
                </p>
              </div>

              {/* Neighbours — overall price level */}
              {peerRows.length > 0 ? (
                <div>
                  <div className="mb-2 text-xs font-medium text-muted-foreground">
                    {T("Общо · съседи", "Overall · neighbours")}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                    {peerRows.map(({ g, v }) => (
                      <span
                        key={g}
                        className="inline-flex items-center gap-1.5 text-sm"
                      >
                        <Flag geo={g} size={12} title={geoLabelShort[g]} />
                        <span className="text-muted-foreground">
                          {geoLabelShort[g]}
                        </span>
                        <span className="font-semibold tabular-nums">
                          {Math.round(v)}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </Card>
          </DashboardSection>

          {/* ---------- By category — the full basket ----------------------- */}
          <DashboardSection
            id="prices"
            className="mt-12"
            title={T("Кошницата по категории", "The basket by category")}
            subtitle={T(
              "Спрямо ЕС = 100 · зелено = по-евтино, червено = по-скъпо",
              "Against EU = 100 · green = cheaper, red = dearer",
            )}
            icon={Wallet}
          >
            <Card className="flex flex-col gap-2.5 p-5">
              <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>{T("По-евтино", "Cheaper")}</span>
                <span>{T("ЕС = 100", "EU = 100")}</span>
                <span>{T("По-скъпо", "Dearer")}</span>
              </div>
              {divisions.map(({ c, v }) => (
                <div key={c.code}>
                  <DivergingRow
                    label={bg ? c.bg : c.en}
                    value={v}
                    desc={bg ? CAT_DESC[c.code]?.bg : CAT_DESC[c.code]?.en}
                  />
                  {/* Food shown in full — its detail always visible, indented. */}
                  {c.code === "A0101" && foodDetail.length > 0 ? (
                    <div className="mt-2 mb-1 ml-2 flex flex-col gap-2 border-l border-border/70 pl-3">
                      {foodDetail.map(({ c: fc, v: fv }) => (
                        <DivergingRow
                          key={fc.code}
                          label={bg ? fc.bg : fc.en}
                          value={fv}
                          desc={
                            bg ? CAT_DESC[fc.code]?.bg : CAT_DESC[fc.code]?.en
                          }
                          inset
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}

              {/* Fresher household energy & fuel prices, BG vs EU. */}
              {energyRows.length > 0 ? (
                <div className="mt-3 border-t border-border/60 pt-3">
                  <div className="mb-2 text-xs font-medium text-muted-foreground">
                    {T(
                      "Битови цени на енергия · спрямо ЕС",
                      "Household energy prices · vs the EU",
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    {energyRows.map((r) => (
                      <DivergingRow
                        key={r.key}
                        label={r.label}
                        desc={r.desc}
                        value={r.value}
                      />
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {T(
                      `Ток и газ: Евростат, битови цени с данъци${energyPeriod ? ` (${energyPeriod})` : ""}. Горива: Седмичен петролен бюлетин на ЕК${fuelDate ? ` (${fuelDate})` : ""} — по-нови от годишната кошница.`,
                      `Electricity & gas: Eurostat household prices incl. taxes${energyPeriod ? ` (${energyPeriod})` : ""}. Fuel: EC Weekly Oil Bulletin${fuelDate ? ` (${fuelDate})` : ""} — fresher than the annual basket.`,
                    )}
                  </p>
                </div>
              ) : null}
            </Card>
          </DashboardSection>

          {/* ---------- Convergence trend ----------------------------------- */}
          {trendRows.length > 1 ? (
            <DashboardSection
              id="macro"
              className="mt-12"
              title={T(
                "Догонваме ли цените в ЕС?",
                "Are we catching up to EU prices?",
              )}
              subtitle={T(
                "Общо ценово равнище · ЕС = 100 · от 2010 г.",
                "Overall price level · EU = 100 · since 2010",
              )}
              icon={TrendingUp}
            >
              <Card className="p-4">
                {overall != null && trendFirstBg != null ? (
                  <p className="mb-2 px-1 text-sm text-muted-foreground">
                    {T(
                      `Ценовото равнище у нас се покачи от ${Math.round(trendFirstBg)} (${pricePli.trend.years[0]}) до ${Math.round(overall)} (${pricePli.year}) спрямо ЕС = 100 — бавно догонване.`,
                      `The price level here rose from ${Math.round(trendFirstBg)} (${pricePli.trend.years[0]}) to ${Math.round(overall)} (${pricePli.year}) against EU = 100 — a slow catch-up.`,
                    )}
                  </p>
                ) : null}
                <PriceTrendChart
                  rows={trendRows}
                  geos={TREND_GEOS}
                  lang={bg ? "bg" : "en"}
                  formatValue={(v) => String(Math.round(v))}
                  formatY={(v) => String(Math.round(v))}
                  yWidth={32}
                />
              </Card>
            </DashboardSection>
          ) : null}

          <p className="mt-4 mb-8 px-1 text-xs text-muted-foreground">
            {T(
              "Официална статистика на Евростат (програма PPP), ЕС = 100 — годишни данни за ценовото равнище (последна година 2025; месечни сравнения между държави не се публикуват). Отчита ДДС и различията в качеството. „Реално потребление на човек“ = обемен индекс на индивидуалното потребление (PPS, ЕС = 100).",
              "Official Eurostat statistics (PPP programme), EU = 100 — annual price-level data (latest year 2025; monthly cross-country levels are not published). VAT- and quality-adjusted. “Real consumption per person” = volume index of actual individual consumption (PPS, EU = 100).",
            )}{" "}
            <a
              href={pricePli.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline"
            >
              {pricePli.source}
            </a>
          </p>
        </>
      )}
    </>
  );
};

// A single 0..EU-relative bar for the hero (prices vs real consumption). Shares
// one scale with a dashed EU=100 marker so the two rows read against each other.
const ScaleRow: FC<{ label: string; value?: number; accent: string }> = ({
  label,
  value,
  accent,
}) => {
  if (value == null) return null;
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-32 shrink-0 text-muted-foreground sm:w-44">
        {label}
      </span>
      <div className="relative h-5 flex-1 rounded-full bg-muted/50">
        <div
          className="absolute inset-y-0 z-10 flex items-center"
          style={{ left: `${scalePos(100)}%` }}
          aria-hidden
        >
          <div className="h-full w-px bg-foreground/40" />
        </div>
        <div
          className="absolute inset-y-[3px] left-0 rounded-full"
          style={{
            width: `${scalePos(value)}%`,
            background: accent,
            opacity: 0.85,
          }}
          aria-hidden
        />
      </div>
      <span
        className="w-9 shrink-0 text-right font-semibold tabular-nums"
        style={{ color: accent }}
      >
        {Math.round(value)}
      </span>
    </div>
  );
};
