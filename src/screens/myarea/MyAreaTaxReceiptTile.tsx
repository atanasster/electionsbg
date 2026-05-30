// "Where do my taxes go" personalized receipt — Civio-style. The user
// enters their MONTHLY gross salary (the way Bulgarians actually think about
// pay); we compute their headline 10% flat personal income tax and split it
// across COFOG functional categories using the latest gov_10a_exp shares.
//
// Two questions answered on one card:
//   1. WHERE NATIONALLY does my income tax go — the COFOG breakdown, shown
//      per month so the figures are tangible ("12 €/мес for defence").
//   2. HOW MUCH COMES BACK to my município — the per-resident state transfer
//      envelope (Article 53 of the State Budget Law) ÷ registered population.
//
// Honest framing matters here:
//   - We model PERSONAL INCOME TAX only (the 10% flat rate). VAT, social
//     security contributions, and corporate tax are NOT included.
//   - The COFOG allocation reflects total gov spending mix, not how each
//     individual ден is earmarked.
//   - The municipal-return figure is a STATE TRANSFER funded from the whole
//     tax mix (VAT dominates) — NOT "your income tax coming back". Personal
//     income tax is a central tax in BG; 0% is assigned directly to munis.
//     We word it as "the state sends X per resident", never "your tax".

import { FC, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, Calculator, HardHat, Home, Landmark } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { dataUrl } from "@/data/dataUrl";
import {
  useCapitalProgramsTopProjects,
  useMunicipalTransfersForOblast,
} from "@/data/budget/useBudget";
import { useGraoMunicipalitySlice } from "@/data/grao/useGraoPopulation";
import { useLocalTaxes } from "@/data/local_taxes/useLocalTaxes";

const PERSONAL_INCOME_TAX_RATE = 0.1; // BG flat 10%

// Stylised-household constants for the "local taxes you pay" estimate.
// The figures are intentionally round so the caveat copy can call them
// out as ESTIMATES — the user's actual bill depends on their property's
// данъчна оценка and vehicle kW. ~30 000 € is a representative residential
// tax valuation for an oblast-capital apartment; 85 kW is the midpoint of
// the 74-110 kW vehicle-tax band that ИПИ tracks.
const TYPICAL_VEHICLE_KW = 85;
const TYPICAL_PROPERTY_VALUATION_EUR = 30_000;

type CofogSeriesPoint = { year: number; valueEur: number };
type CofogFile = {
  latestYear: number;
  cofogTopLevel: string[];
  series: Record<string, CofogSeriesPoint[]>;
};

// COFOG codes → display labels. Lazy-loaded inside the function so locale
// switches re-render with the right copy.
const cofogLabel = (
  code: string,
  lang: "bg" | "en",
): { label: string; color: string } => {
  const m: Record<string, { bg: string; en: string; color: string }> = {
    GF01: {
      bg: "Общи държавни услуги",
      en: "General public services",
      color: "#8E8E93",
    },
    GF02: { bg: "Отбрана", en: "Defence", color: "#7B5E57" },
    GF03: {
      bg: "Обществен ред и сигурност",
      en: "Public order and safety",
      color: "#5A5A5A",
    },
    GF04: {
      bg: "Икономическа политика",
      en: "Economic affairs",
      color: "#5E8AC7",
    },
    GF05: {
      bg: "Околна среда",
      en: "Environmental protection",
      color: "#56A86F",
    },
    GF06: {
      bg: "Жилищно стр-во и комун.",
      en: "Housing and community",
      color: "#A6792F",
    },
    GF07: { bg: "Здравеопазване", en: "Health", color: "#D74A56" },
    GF08: {
      bg: "Култура, спорт, религия",
      en: "Recreation, culture, religion",
      color: "#C97AAA",
    },
    GF09: { bg: "Образование", en: "Education", color: "#3D8DBA" },
    GF10: {
      bg: "Социална защита",
      en: "Social protection",
      color: "#E08F2C",
    },
  };
  const entry = m[code];
  if (!entry) return { label: code, color: "#888" };
  return { label: entry[lang], color: entry.color };
};

// Bulgaria adopted the euro on 2026-01-01, so all amounts are in €. Match
// the app-wide convention (see MyAreaProjectsMapTile): number-then-€ in BG,
// €-then-number in EN.
const formatEur = (n: number, lang: "bg" | "en"): string => {
  const num = new Intl.NumberFormat(lang === "bg" ? "bg-BG" : "en-GB", {
    maximumFractionDigits: 0,
  }).format(Math.round(n));
  return lang === "bg" ? `${num} €` : `€${num}`;
};

// Locale-aware decimal formatting for rate values surfaced inside i18n
// interpolations. Without this, i18next stringifies floats with their
// full machine precision (`1.875` → "1.875" in BG, where the convention
// is "1,875"). Cap at 3 decimals — enough for promils, transfer-tax %
// (one decimal in practice), and €/kW vehicle-tax rates.
const formatRate = (n: number, lang: "bg" | "en"): string =>
  new Intl.NumberFormat(lang === "bg" ? "bg-BG" : "en-GB", {
    maximumFractionDigits: 3,
  }).format(n);

// Append a /мес or /год period suffix to a formatted € amount.
const formatEurPer = (
  n: number,
  lang: "bg" | "en",
  period: "mo" | "yr",
): string => {
  const suffix =
    lang === "bg"
      ? period === "mo"
        ? "/мес"
        : "/год"
      : period === "mo"
        ? "/mo"
        : "/yr";
  return `${formatEur(n, lang)}${suffix}`;
};

// Derive the 3-letter oblast shard code from an obshtina code as a fallback
// when the resolved area didn't carry one. (BLG03 → BLG, S2309/SOF00 → SOF.)
const oblastFromObshtina = (code: string): string | null => {
  if (/^S2\d{3}$/.test(code)) return "SOF";
  if (/^SOF\d*$/.test(code)) return "SOF";
  const m = code.match(/^([A-Z]{3})\d{2}$/);
  return m ? m[1] : null;
};

const fetchCofog = async (): Promise<CofogFile> => {
  const r = await fetch(dataUrl("/cofog.json"));
  if (!r.ok) throw new Error("cofog fetch failed");
  return r.json();
};

export const MyAreaTaxReceiptTile: FC<{
  obshtina: string;
  oblast: string;
}> = ({ obshtina, oblast }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const [income, setIncome] = useState<string>("");
  const { data: cofog } = useQuery({
    queryKey: ["cofog"],
    queryFn: fetchCofog,
    staleTime: Infinity,
  });

  // Place-based municipal-return inputs. Both are small/cached: the ГРАО
  // slice is already fetched by MyAreaHero, and the oblast transfer shard is
  // a ~5-50 KB file shared with the region/município dashboards.
  const oblastCode = oblast || oblastFromObshtina(obshtina) || undefined;
  const { data: transfersShard } = useMunicipalTransfersForOblast(oblastCode);
  const { data: graoSlice } = useGraoMunicipalitySlice(obshtina);

  // Latest-year transfer total (€) for THIS município ÷ registered
  // (permanent-address) population — the same denominator the equalization
  // grant formula uses. We match the shard row by obshtina code, so Sofia
  // districts (whose slice is district-only) find no row and the line auto-hides
  // rather than dividing a city-wide total by a район population.
  const municipalReturn = useMemo(() => {
    if (!transfersShard || !graoSlice) return null;
    const years = transfersShard.years;
    if (years.length === 0) return null;
    const latest = years[years.length - 1];
    const row = latest.municipalities.find((m) => m.obshtinaCode === obshtina);
    const totalEur = row?.total?.amountEur ?? 0;
    if (!row || totalEur <= 0) return null;
    const population = Object.values(graoSlice.settlements).reduce(
      (sum, s) => sum + (s.permanent ?? 0),
      0,
    );
    if (population <= 0) return null;
    const perYear = totalEur / population;
    return {
      year: latest.fiscalYear,
      nameBg: row.nameBg,
      nameEn: row.nameEn,
      perYear,
      perMonth: perYear / 12,
    };
  }, [transfersShard, graoSlice, obshtina]);

  // Top capital-programme projects for THIS município — answers "where
  // does my município actually spend the money it raises and receives".
  // Coverage limited to the 26 wired municípios (oblast capitals + a few
  // tier-2 cities); other municípios get nothing (hook returns null).
  // Sofia districts roll up to the city-wide programme.
  const { data: capitalPrograms } = useCapitalProgramsTopProjects(obshtina, 3);

  // Local-tax estimate — bills the user actually pays to THIS município
  // (property tax, vehicle tax, transfer tax, residential garbage fee).
  // Driven by the município's own rates from useLocalTaxes; renders only
  // the rows we have data for, so small municípios with no Tier-B naredba
  // block still get the IPI-tier rows (vehicle / transfer).
  const { score: localTaxScore } = useLocalTaxes(obshtina);
  const localTaxEstimate = useMemo(() => {
    if (!localTaxScore) return null;
    const ipi = localTaxScore.ipi ?? {};
    const naredba = localTaxScore.naredba;

    const vehicleRate = ipi.vehicle_tax_74_110kw?.latestValue ?? null;
    const vehicleAnnual =
      vehicleRate != null ? vehicleRate * TYPICAL_VEHICLE_KW : null;

    const transferRate = ipi.transfer_tax?.latestValue ?? null;

    const pti = naredba?.propertyTaxIndividuals;
    const propertyAnnual = pti
      ? (pti.rate * TYPICAL_PROPERTY_VALUATION_EUR) / 1000
      : null;

    type TboRender =
      | { kind: "promil_rate"; rate: number; annual: number }
      | { kind: "promil_no_rate"; url?: string }
      | { kind: "other_basis"; basis: "users" | "area" | "volume" };
    let tbo: TboRender | null = null;
    const tboSrc = naredba?.tboResidential;
    if (tboSrc) {
      if (tboSrc.basis === "promil") {
        if (tboSrc.rate != null) {
          tbo = {
            kind: "promil_rate",
            rate: tboSrc.rate,
            annual: (tboSrc.rate * TYPICAL_PROPERTY_VALUATION_EUR) / 1000,
          };
        } else {
          tbo = { kind: "promil_no_rate", url: naredba?.url };
        }
      } else {
        tbo = { kind: "other_basis", basis: tboSrc.basis };
      }
    }

    const hasAnyRow =
      vehicleAnnual != null ||
      transferRate != null ||
      propertyAnnual != null ||
      tbo != null;
    if (!hasAnyRow) return null;
    return {
      vehicleRate,
      vehicleAnnual,
      transferRate,
      propertyRate: pti?.rate ?? null,
      propertyAnnual,
      tbo,
    };
  }, [localTaxScore]);

  // Compute allocation. TOTAL is the denominator; each GF0n category gives
  // its share. Filter to non-zero categories and sort by share descending.
  const allocation = useMemo(() => {
    if (!cofog) return null;
    const latest = cofog.latestYear;
    const totalSeries = cofog.series["TOTAL"];
    const total = totalSeries?.find((p) => p.year === latest)?.valueEur ?? 0;
    if (total === 0) return null;
    const rows: Array<{ code: string; share: number }> = [];
    for (const code of cofog.cofogTopLevel) {
      if (code === "TOTAL") continue;
      const s = cofog.series[code];
      const v = s?.find((p) => p.year === latest)?.valueEur ?? 0;
      if (v <= 0) continue;
      rows.push({ code, share: v / total });
    }
    rows.sort((a, b) => b.share - a.share);
    return { year: latest, rows };
  }, [cofog]);

  // Input is MONTHLY gross salary. Annual tax = monthly × 12 × 10%.
  const monthlyGross = (() => {
    const n = Number(income.replace(/\s+/g, "").replace(",", "."));
    return Number.isFinite(n) && n > 0 ? n : 0;
  })();
  const monthlyTax = monthlyGross * PERSONAL_INCOME_TAX_RATE;
  const annualTax = monthlyTax * 12;
  const hasIncome = monthlyGross > 0;

  const muniName = municipalReturn
    ? lang === "bg"
      ? municipalReturn.nameBg
      : municipalReturn.nameEn
    : "";

  return (
    <Card className="p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Calculator className="size-4 text-primary" />
        <h2 className="text-sm font-semibold flex-1">
          {t("my_area_tax_receipt_title")}
        </h2>
      </div>

      <p className="text-xs text-muted-foreground">
        {t("my_area_tax_receipt_explainer")}
      </p>

      {/* Headline — how much the state sends back to this município per
          resident. Place-based, independent of the income input. */}
      {municipalReturn ? (
        <div className="rounded-md border bg-muted/40 p-3 flex flex-col gap-1">
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
            <Landmark className="size-3.5" aria-hidden />
            <span className="truncate">
              {t("my_area_tax_receipt_municipal_return_label", {
                name: muniName,
              })}
            </span>
          </div>
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-lg font-semibold tabular-nums">
              {formatEurPer(municipalReturn.perYear, lang, "yr")}
            </span>
            <span className="text-xs text-muted-foreground">
              {t("my_area_tax_receipt_per_resident")}
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              · {formatEurPer(municipalReturn.perMonth, lang, "mo")}
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground leading-snug">
            {t("my_area_tax_receipt_municipal_return_note", {
              year: municipalReturn.year,
            })}
          </p>
        </div>
      ) : null}

      {/* Income input — monthly gross salary. Entering it switches the
          breakdown below from %-of-budget to your personal лв./мес amounts. */}
      <div className="flex items-center gap-2">
        <label
          htmlFor="myarea-tax-income"
          className="text-sm whitespace-nowrap"
        >
          {t("my_area_tax_receipt_income_label")}
        </label>
        <input
          id="myarea-tax-income"
          type="number"
          inputMode="numeric"
          min={0}
          step={100}
          value={income}
          onChange={(e) => setIncome(e.target.value)}
          placeholder="1500"
          className="flex-1 min-w-0 border rounded px-2 py-1 text-sm bg-background"
        />
        <span className="text-xs text-muted-foreground">
          {t("my_area_tax_receipt_income_suffix")}
        </span>
      </div>

      {hasIncome ? (
        <div className="text-sm">
          {t("my_area_tax_receipt_income_label")}:{" "}
          <span className="font-semibold">
            {formatEurPer(monthlyGross, lang, "mo")}
          </span>{" "}
          · {lang === "bg" ? "данък общ доход (10%)" : "income tax (10%)"}:{" "}
          <span className="font-semibold">
            {formatEurPer(monthlyTax, lang, "mo")}
          </span>{" "}
          <span className="text-muted-foreground">
            ({formatEurPer(annualTax, lang, "yr")})
          </span>
        </div>
      ) : null}

      {/* Breakdown — ALWAYS shown once the budget mix loads. Without an
          income it's the national budget split (% only); with an income
          each row also carries the personal лв./мес amount. */}
      {allocation ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-[11px] text-muted-foreground">
            {hasIncome
              ? lang === "bg"
                ? `Разпределение според бюджет ${allocation.year} (на месец):`
                : `Allocated per ${allocation.year} budget mix (per month):`
              : lang === "bg"
                ? `Бюджетен микс ${allocation.year} (въведете заплата за вашите суми):`
                : `${allocation.year} budget mix (enter salary for your amounts):`}
          </p>
          {allocation.rows.map((r) => {
            const { label, color } = cofogLabel(r.code, lang);
            const amountMonthly = monthlyTax * r.share;
            return (
              <div key={r.code} className="flex items-center gap-2 text-xs">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm shrink-0"
                  style={{ backgroundColor: color }}
                  aria-hidden
                />
                <span className="flex-1 truncate" title={label}>
                  {label}
                </span>
                {hasIncome ? (
                  <span className="tabular-nums shrink-0 font-medium">
                    {formatEurPer(amountMonthly, lang, "mo")}
                  </span>
                ) : null}
                <span className="tabular-nums text-muted-foreground shrink-0 text-[10px] w-10 text-right">
                  {(r.share * 100).toFixed(1)}%
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">
          {t("my_area_tax_receipt_loading")}
        </div>
      )}

      {/* Local taxes you pay to your município — paired with the COFOG
          breakdown above so the user reads "national tax I pay" next to
          "local tax I pay" right next to "what the state returns to my
          município" at the top of the card. */}
      {localTaxEstimate ? (
        <div className="rounded-md border bg-muted/30 p-3 flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
            <Home className="size-3.5" aria-hidden />
            <span>{t("my_area_tax_receipt_local_taxes_heading")}</span>
          </div>

          {/* Row layout note: grid-cols-[1fr_auto] lets the (often long
              Bulgarian) label wrap across multiple lines on narrow
              viewports without truncating, while the amount/explainer
              hugs the right edge. The ТБО no-rate / other-basis rows
              stack vertically instead because their right-side text is a
              long explainer link, not a price — grid would squeeze the
              label to zero width on mobile. */}
          {localTaxEstimate.propertyRate != null &&
          localTaxEstimate.propertyAnnual != null ? (
            <div className="grid grid-cols-[1fr_auto] items-baseline gap-x-2 text-xs">
              <span className="leading-snug">
                {t("my_area_tax_receipt_property_tax_row", {
                  rate: formatRate(localTaxEstimate.propertyRate, lang),
                })}
              </span>
              <span className="tabular-nums font-medium">
                ~{formatEurPer(localTaxEstimate.propertyAnnual, lang, "yr")}
              </span>
            </div>
          ) : null}

          {localTaxEstimate.tbo ? (
            localTaxEstimate.tbo.kind === "promil_rate" ? (
              <div className="grid grid-cols-[1fr_auto] items-baseline gap-x-2 text-xs">
                <span className="leading-snug">
                  {t("my_area_tax_receipt_tbo_promil_row", {
                    rate: formatRate(localTaxEstimate.tbo.rate, lang),
                  })}
                </span>
                <span className="tabular-nums font-medium">
                  ~{formatEurPer(localTaxEstimate.tbo.annual, lang, "yr")}
                </span>
              </div>
            ) : localTaxEstimate.tbo.kind === "promil_no_rate" ? (
              <div className="flex flex-col gap-0.5 text-xs">
                <span className="leading-snug">
                  {t("my_area_tax_receipt_tbo_no_rate_row")}
                </span>
                {localTaxEstimate.tbo.url ? (
                  <a
                    href={localTaxEstimate.tbo.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-[10px] text-primary hover:underline leading-snug"
                  >
                    {t("my_area_tax_receipt_tbo_council_decides")}
                  </a>
                ) : (
                  <span className="text-[10px] text-muted-foreground leading-snug">
                    {t("my_area_tax_receipt_tbo_council_decides")}
                  </span>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-0.5 text-xs">
                <span className="leading-snug">
                  {t("my_area_tax_receipt_tbo_no_rate_row")}
                </span>
                <span className="text-[10px] text-muted-foreground leading-snug">
                  {t(
                    `my_area_tax_receipt_tbo_basis_${localTaxEstimate.tbo.basis}`,
                  )}
                </span>
              </div>
            )
          ) : null}

          {localTaxEstimate.vehicleRate != null &&
          localTaxEstimate.vehicleAnnual != null ? (
            <div className="grid grid-cols-[1fr_auto] items-baseline gap-x-2 text-xs">
              <span className="leading-snug">
                {t("my_area_tax_receipt_vehicle_tax_row", {
                  rate: formatRate(localTaxEstimate.vehicleRate, lang),
                })}
              </span>
              <span className="tabular-nums font-medium">
                ~{formatEurPer(localTaxEstimate.vehicleAnnual, lang, "yr")}
              </span>
            </div>
          ) : null}

          {localTaxEstimate.transferRate != null ? (
            <div className="grid grid-cols-[1fr_auto] items-baseline gap-x-2 text-xs">
              <span className="leading-snug">
                {t("my_area_tax_receipt_transfer_tax_row", {
                  rate: formatRate(localTaxEstimate.transferRate, lang),
                })}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {t("my_area_tax_receipt_transfer_tax_note")}
              </span>
            </div>
          ) : null}

          <p className="text-[10px] text-muted-foreground italic mt-0.5">
            {t("my_area_tax_receipt_local_taxes_caveat")}
          </p>
          <a
            href="#myarea-local-taxes"
            className="text-[10px] text-primary hover:underline self-start"
          >
            {t("my_area_tax_receipt_local_taxes_full_link")}
          </a>
        </div>
      ) : null}

      {/* Top-3 capital-programme projects — closes the loop on "where
          does my municipality spend". Renders only for the 26 municípios
          with a parsed capital programme on disk; everyone else gets
          nothing here. */}
      {capitalPrograms && capitalPrograms.topProjects.length > 0 ? (
        <div className="rounded-md border bg-muted/30 p-3 flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
            <HardHat className="size-3.5" aria-hidden />
            <span>
              {capitalPrograms.scope === "rayon"
                ? t("my_area_tax_receipt_capital_programs_heading_rayon", {
                    year: capitalPrograms.fiscalYear,
                  })
                : t("my_area_tax_receipt_capital_programs_heading", {
                    year: capitalPrograms.fiscalYear,
                  })}
            </span>
          </div>
          {capitalPrograms.topProjects.map((p, i) => (
            <div
              key={p.id ?? i}
              className="grid grid-cols-[auto_1fr_auto] items-baseline gap-x-2 text-xs"
            >
              <span className="text-muted-foreground tabular-nums" aria-hidden>
                {i + 1}.
              </span>
              <span className="line-clamp-2 leading-snug" title={p.name}>
                {p.name}
              </span>
              <span className="tabular-nums font-medium">
                {formatEur(p.totalEur, lang)}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <p className="text-[10px] text-muted-foreground italic">
        {t("my_area_tax_receipt_disclaimer")}
      </p>

      {/* Bridge to the full calculator — picks up where this tile stops:
          social-security contributions, VAT estimate, and pension
          projection. */}
      <Link
        to="/budget/tax-calculator"
        className="text-xs text-primary hover:underline self-start inline-flex items-center gap-1"
      >
        {t("my_area_tax_receipt_calculator_cta")}
        <ArrowRight className="size-3" aria-hidden />
      </Link>
    </Card>
  );
};
