// Closed capabilities shared by metadata, validation and execution. No registry import.
import type { ToolArgs } from "./types";
export const RANKING_METRICS = {
  unemployment: { dataset: "muni", key: "unemployment" },
  matura: { dataset: "muni", key: "dzi" },
  populationChange: { dataset: "muni", key: "populationChange" },
  municipalMigration: { dataset: "muni", key: "netMigration" },
  gdpPerCapita: { dataset: "oblast", key: "gdpPerCapita" },
  population: { dataset: "oblast", key: "population" },
  regionalMigration: { dataset: "oblast", key: "netMigration" },
  longTermUnemployment: { dataset: "oblast", key: "ltUnemployment" },
  mortality: { dataset: "oblast", key: "deathRatePer1000" },
  hospitalBeds: { dataset: "oblast", key: "hospitalBedsPer1000" },
  transparency: { dataset: "lisi", key: "" },
} as const;
export const RANKING_VALUES = Object.keys(RANKING_METRICS);
// Compatibility for deterministic routes and previously saved free-text calls.
// Specific unsupported ratios must be rejected BEFORE matching their GDP noun.
export function normalizeRanking(args: ToolArgs): ToolArgs {
  const q = String(args.indicator ?? "").toLowerCase();
  if (RANKING_VALUES.includes(String(args.indicator))) return args;
  if (/кошниц|basket|европ|eu\b|fund|финанс|средств|пари|rain|валеж/.test(q))
    return args;
  const oblast = /област|region|oblast|nuts|нутс/.test(q);
  const indicator = /прозрачн|transparency|lisi|интегритет/.test(q)
    ? "transparency"
    : /матур|дзи|matura|\bdzi\b/.test(q)
      ? "matura"
      : /безработ|unemployment/.test(q)
        ? oblast
          ? "longTermUnemployment"
          : "unemployment"
        : /миграц|migration/.test(q)
          ? oblast
            ? "regionalMigration"
            : "municipalMigration"
          : /населен|population/.test(q)
            ? oblast
              ? "population"
              : "populationChange"
            : /бвп|gdp|богат|rich|бедн|poor|wealth/.test(q)
              ? "gdpPerCapita"
              : /смъртност|починал|mortality|death rate/.test(q)
                ? "mortality"
                : /легла|hospital beds/.test(q)
                  ? "hospitalBeds"
                  : undefined;
  if (!indicator) return args;
  return {
    ...args,
    indicator,
    order:
      args.order ??
      (/най-ниск|най-нисъ|най-малк|най-слаб|най-бедн|най-непрозрач|lowest|least|worst|smallest|poorest|bottom/.test(
        q,
      )
        ? "asc"
        : "desc"),
  };
}
