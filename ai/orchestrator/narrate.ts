// Template narrator: turns an Envelope's facts into a short bilingual sentence.
//
// This is the no-model narration path. In M3 the LLM narrates instead (handed
// the same facts), but the contract is identical: narration NEVER introduces a
// number that isn't already in `facts`.

import type { Envelope, Lang } from "../tools/types";

const f = (e: Envelope, key: string): string => String(e.facts[key] ?? "");

export const narrate = (env: Envelope, lang: Lang): string => {
  switch (env.tool) {
    case "machineVoteSeries": {
      const last = f(env, "latest");
      const ch = env.facts.change_pts;
      const locale = lang === "bg" ? "bg-BG" : "en-US";
      const mag =
        typeof ch === "number" ? Math.abs(ch).toLocaleString(locale) : "";
      const dir =
        typeof ch === "number"
          ? lang === "bg"
            ? ch >= 0
              ? `с ${mag} пр.п. нагоре`
              : `с ${mag} пр.п. надолу`
            : ch >= 0
              ? `up ${mag} pts`
              : `down ${mag} pts`
          : "";
      return lang === "bg"
        ? `Делът на машинното гласуване в последните ${f(env, "elections_count")} избора завършва на ${last} (${dir} спрямо началото).`
        : `Machine voting across the last ${f(env, "elections_count")} elections ends at ${last} (${dir} from the start).`;
    }
    case "turnoutSeries": {
      const last = f(env, "latest");
      return lang === "bg"
        ? `Избирателната активност в последните ${f(env, "elections_count")} избора завършва на ${last}.`
        : `Voter turnout across the last ${f(env, "elections_count")} elections ends at ${last}.`;
    }
    case "machineVoteShare":
      return lang === "bg"
        ? `Машинното гласуване е ${f(env, "machine_share")} (${f(env, "machine_votes")} машинни срещу ${f(env, "paper_votes")} хартиени действителни гласа).`
        : `Machine voting was ${f(env, "machine_share")} (${f(env, "machine_votes")} machine vs ${f(env, "paper_votes")} paper valid votes).`;
    case "turnout":
      return lang === "bg"
        ? `Избирателната активност е ${f(env, "turnout")} (${f(env, "voters")} от ${f(env, "registered")} избиратели).`
        : `Turnout was ${f(env, "turnout")} (${f(env, "voters")} of ${f(env, "registered")} registered).`;
    case "partyResult":
      if (!env.facts.party)
        return lang === "bg"
          ? "Не намерих такава партия."
          : "I couldn't find that party.";
      return lang === "bg"
        ? `${f(env, "party")} получава ${f(env, "votes")} гласа (${f(env, "pct")}) и ${f(env, "seats")} мандата.`
        : `${f(env, "party")} got ${f(env, "votes")} votes (${f(env, "pct")}) and ${f(env, "seats")} seats.`;
    case "partyTimeline":
      if (!env.facts.party)
        return lang === "bg"
          ? "Не намерих такава партия."
          : "I couldn't find that party.";
      return lang === "bg"
        ? `${f(env, "party")} се явява на ${f(env, "appearances")} избора; връх ${f(env, "peak_pct")}%, последно ${f(env, "latest_pct")}%.`
        : `${f(env, "party")} appears in ${f(env, "appearances")} elections; peak ${f(env, "peak_pct")}%, latest ${f(env, "latest_pct")}%.`;
    case "nationalResults":
      return lang === "bg"
        ? `Резултати за ${f(env, "election")}: ${env.facts.parties_over_threshold} партии над прага. Таблицата е подредена по гласове.`
        : `Results for ${f(env, "election")}: ${env.facts.parties_over_threshold} parties over threshold. Table sorted by votes.`;
    case "compareElections":
      return lang === "bg"
        ? `Активност: ${f(env, "turnout_a")} срещу ${f(env, "turnout_b")}. Машинно гласуване: ${f(env, "machine_a")} срещу ${f(env, "machine_b")}.`
        : `Turnout: ${f(env, "turnout_a")} vs ${f(env, "turnout_b")}. Machine voting: ${f(env, "machine_a")} vs ${f(env, "machine_b")}.`;
    case "localCouncilVoteShare":
      return lang === "bg"
        ? `Водеща сила за общинските съвети (${f(env, "cycle")}): ${f(env, "leader")}.`
        : `Top force in the municipal councils (${f(env, "cycle")}): ${f(env, "leader")}.`;
    case "localMayorsWon":
      return lang === "bg"
        ? `Най-много кметове (${f(env, "cycle")}): ${f(env, "leader")}.`
        : `Most mayors won (${f(env, "cycle")}): ${f(env, "leader")}.`;
    case "localMunicipality":
      if (!env.facts.municipality)
        return lang === "bg"
          ? "Не намерих такава община."
          : "I couldn't find that municipality.";
      return lang === "bg"
        ? `Кмет на ${f(env, "municipality")}: ${f(env, "mayor")} (${f(env, "mayor_pct")}). Водеща сила в съвета: ${f(env, "top_council_party")}. Активност: ${f(env, "turnout")}.`
        : `Mayor of ${f(env, "municipality")}: ${f(env, "mayor")} (${f(env, "mayor_pct")}). Top council party: ${f(env, "top_council_party")}. Turnout: ${f(env, "turnout")}.`;
    case "budgetOverview":
      return lang === "bg"
        ? `Бюджет ${f(env, "year")}: приходи ${f(env, "revenue")}, разходи ${f(env, "expenditure")}, салдо ${f(env, "balance")}.`
        : `Budget ${f(env, "year")}: revenue ${f(env, "revenue")}, expenditure ${f(env, "expenditure")}, balance ${f(env, "balance")}.`;
    case "budgetByFunction":
      return lang === "bg"
        ? `Най-голям разход по функция (${f(env, "year")}): ${f(env, "top_function")}. Общо: ${f(env, "total")}.`
        : `Largest spending function (${f(env, "year")}): ${f(env, "top_function")}. Total: ${f(env, "total")}.`;
    case "procurementTotals":
      return lang === "bg"
        ? `Обществени поръчки: ${f(env, "contracts")} договора за ${f(env, "total_value")}; свързани с депутати: ${f(env, "mp_connected_value")}.`
        : `Public procurement: ${f(env, "contracts")} contracts worth ${f(env, "total_value")}; MP-connected: ${f(env, "mp_connected_value")}.`;
    case "fundsOverview":
      return lang === "bg"
        ? `Европейски средства: договорени ${f(env, "contracted")}, изплатени ${f(env, "paid")}. Топ бенефициент: ${f(env, "top")}.`
        : `EU funds: ${f(env, "contracted")} contracted, ${f(env, "paid")} paid. Top beneficiary: ${f(env, "top")}.`;
    case "governments":
      return lang === "bg"
        ? `${f(env, "count")} правителства от 2005. Настоящо: ${f(env, "current_pm")} (${f(env, "current_parties")}).`
        : `${f(env, "count")} governments since 2005. Current: ${f(env, "current_pm")} (${f(env, "current_parties")}).`;
    case "macroIndicator":
      return lang === "bg"
        ? `${f(env, "indicator")}: последно ${f(env, "latest_value")} (${f(env, "latest_period")}).`
        : `${f(env, "indicator")}: latest ${f(env, "latest_value")} (${f(env, "latest_period")}).`;
    case "macroOverview":
      return lang === "bg"
        ? "Ключови макроикономически показатели — виж таблицата."
        : "Key macro indicators — see the table.";
    case "localMayorRace":
      if (!env.facts.municipality)
        return lang === "bg"
          ? "Не намерих такава община."
          : "I couldn't find that municipality.";
      return lang === "bg"
        ? `Кмет на ${f(env, "municipality")}: ${f(env, "winner")} (${f(env, "winner_pct")}), от ${f(env, "candidates")} кандидати.`
        : `Mayor of ${f(env, "municipality")}: ${f(env, "winner")} (${f(env, "winner_pct")}), of ${f(env, "candidates")} candidates.`;
    case "localCouncil":
      if (!env.facts.municipality)
        return lang === "bg"
          ? "Не намерих такава община."
          : "I couldn't find that municipality.";
      return lang === "bg"
        ? `Общински съвет на ${f(env, "municipality")}: ${f(env, "total_seats")} места, първа сила ${f(env, "leader")}.`
        : `${f(env, "municipality")} council: ${f(env, "total_seats")} seats, top force ${f(env, "leader")}.`;
    case "chmiEvents":
      return lang === "bg"
        ? `Извънредни местни избори: ${f(env, "total")} събития, последно на ${f(env, "latest")}.`
        : `Extraordinary local elections: ${f(env, "total")} events, latest on ${f(env, "latest")}.`;
    case "subnationalIndicator":
      if (!env.facts.indicator)
        return lang === "bg"
          ? "Няма данни за това място."
          : "No data for that place.";
      return lang === "bg"
        ? `${f(env, "indicator")} в ${f(env, "place")}: ${f(env, "latest_value")} (${f(env, "latest_year")}).`
        : `${f(env, "indicator")} in ${f(env, "place")}: ${f(env, "latest_value")} (${f(env, "latest_year")}).`;
    case "regionIndicator":
      if (!env.facts.indicator)
        return lang === "bg"
          ? "Няма данни за тази област."
          : "No data for that oblast.";
      return lang === "bg"
        ? `${f(env, "indicator")} (${f(env, "oblast")}): ${f(env, "latest_value")} (${f(env, "latest_year")}).`
        : `${f(env, "indicator")} (${f(env, "oblast")}): ${f(env, "latest_value")} (${f(env, "latest_year")}).`;
    case "transparencyScore":
      if (env.facts.composite == null) return env.title;
      return lang === "bg"
        ? `Прозрачност (LISI) на ${f(env, "place")}: ${f(env, "composite")} — ${f(env, "national_rank")}-о място (средно ${f(env, "national_average")}).`
        : `Transparency (LISI) for ${f(env, "place")}: ${f(env, "composite")} — rank ${f(env, "national_rank")} (avg ${f(env, "national_average")}).`;
    case "localTaxes":
      if (!env.facts.place) return env.title;
      return lang === "bg"
        ? `Местни данъци за ${f(env, "place")} — ${f(env, "indicators")} ставки спрямо средното (виж таблицата).`
        : `Local taxes for ${f(env, "place")} — ${f(env, "indicators")} rates vs the national average (see table).`;
    case "census":
      if (!env.facts.population) return env.title;
      return lang === "bg"
        ? `${f(env, "place")}: ${f(env, "population")} жители; най-голяма група: ${f(env, "largest_group")}.`
        : `${f(env, "place")}: ${f(env, "population")} people; largest group: ${f(env, "largest_group")}.`;
    case "procurementBySettlement":
      if (!env.facts.total) return env.title;
      return lang === "bg"
        ? `Обществени поръчки в ${f(env, "place")}: ${f(env, "total")} (${f(env, "contracts")} договора); водещ възложител ${f(env, "top_buyer")}.`
        : `Public procurement in ${f(env, "place")}: ${f(env, "total")} (${f(env, "contracts")} contracts); top buyer ${f(env, "top_buyer")}.`;
    case "macroByCategory":
      return lang === "bg"
        ? `Показатели за „${f(env, "category")}“ — ${f(env, "indicators")} (виж таблицата).`
        : `Indicators for "${f(env, "category")}" — ${f(env, "indicators")} (see table).`;
    case "mpAssetsTop":
      return lang === "bg"
        ? `Най-богат депутат: ${f(env, "richest")} (${f(env, "richest_assets")} активи).`
        : `Richest MP: ${f(env, "richest")} (${f(env, "richest_assets")} assets).`;
    case "mpConnectionsTop":
      return lang === "bg"
        ? `Най-свързан депутат: ${f(env, "most_connected")} (${f(env, "links")} връзки).`
        : `Most-connected MP: ${f(env, "most_connected")} (${f(env, "links")} links).`;
    case "officialsAssetsTop":
      return lang === "bg"
        ? `Най-богат служител: ${f(env, "richest")} (${f(env, "richest_assets")}).`
        : `Richest official: ${f(env, "richest")} (${f(env, "richest_assets")}).`;
    case "financingOverview":
      return lang === "bg"
        ? `${f(env, "distinct_parties")} партии, ${f(env, "total_filings")} отчета; през ${f(env, "latest_year")} — ${f(env, "latest_on_time")} навреме.`
        : `${f(env, "distinct_parties")} parties, ${f(env, "total_filings")} filings; in ${f(env, "latest_year")} — ${f(env, "latest_on_time")} on time.`;
    case "pollAccuracy":
      return lang === "bg"
        ? `Най-точна агенция: ${f(env, "most_accurate")} (средна грешка ${f(env, "best_mae")}).`
        : `Most accurate pollster: ${f(env, "most_accurate")} (mean error ${f(env, "best_mae")}).`;
    case "govDebt":
      return lang === "bg"
        ? `Последни ${f(env, "shown")} емисии на държавен дълг (общо ${f(env, "total_recent")}); най-нова на ${f(env, "latest")}.`
        : `Last ${f(env, "shown")} government-debt issuances (${f(env, "total_recent")} total); latest on ${f(env, "latest")}.`;
    case "noiFunds":
      return lang === "bg"
        ? `Социалноосигурителни фондове (${f(env, "year")}): разходи ${f(env, "expenditure")}.`
        : `Social-security funds (${f(env, "year")}): expenditure ${f(env, "expenditure")}.`;
    case "budgetExecution":
      return lang === "bg"
        ? `Изпълнение на бюджета — ${f(env, "series")}: към ${f(env, "latest_period")} ${f(env, "latest")} (месечно).`
        : `Budget execution — ${f(env, "series")}: ${f(env, "latest")} as of ${f(env, "latest_period")} (monthly).`;
    case "ministryBudget":
      if (!env.facts.ministry) return env.title;
      return lang === "bg"
        ? `${f(env, "ministry")} (${f(env, "year")}): разходи ${f(env, "expenditure")}, ${f(env, "programs")} програми.`
        : `${f(env, "ministry")} (${f(env, "year")}): expenditure ${f(env, "expenditure")}, ${f(env, "programs")} programmes.`;
    case "investmentProjects":
      return lang === "bg"
        ? `Инвестиционна програма ${f(env, "year")}: ${f(env, "project_count")} проекта за ${f(env, "grand_total")}.`
        : `Investment programme ${f(env, "year")}: ${f(env, "project_count")} projects worth ${f(env, "grand_total")}.`;
    case "airQuality":
      if (!env.facts.place) return env.title;
      return lang === "bg"
        ? `Качество на въздуха в ${f(env, "place")}: ФПЧ10 до ${f(env, "worst_pm10")} µg/m³ (${f(env, "over_limit")}; норма ${f(env, "eu_limit_pm10")}).`
        : `Air quality in ${f(env, "place")}: PM10 up to ${f(env, "worst_pm10")} µg/m³ (${f(env, "over_limit")}; limit ${f(env, "eu_limit_pm10")}).`;
    case "landUse":
      return lang === "bg"
        ? `Земеползване (${f(env, "scope")}): ${f(env, "total_km2")} km²; най-голям дял — ${f(env, "largest")}.`
        : `Land use (${f(env, "scope")}): ${f(env, "total_km2")} km²; largest share — ${f(env, "largest")}.`;
    case "graoPopulation":
      if (!env.facts.permanent) return env.title;
      return lang === "bg"
        ? `${f(env, "place")}: ${f(env, "permanent")} по постоянен и ${f(env, "current")} по настоящ адрес (ГРАО).`
        : `${f(env, "place")}: ${f(env, "permanent")} permanent and ${f(env, "current")} current-address residents (GRAO).`;
    case "councilResolutions":
      if (!env.facts.total) return env.title;
      return lang === "bg"
        ? `ОбС ${f(env, "place")}: ${f(env, "total")} индексирани решения; последно на ${f(env, "latest")}.`
        : `${f(env, "place")} council: ${f(env, "total")} indexed resolutions; latest on ${f(env, "latest")}.`;
    case "governanceProfile": {
      const parts: string[] = [];
      if (env.facts.population)
        parts.push(
          lang === "bg"
            ? `население ${f(env, "population")}`
            : `population ${f(env, "population")}`,
        );
      if (env.facts.mayor)
        parts.push(
          lang === "bg"
            ? `кмет ${f(env, "mayor")}`
            : `mayor ${f(env, "mayor")}`,
        );
      if (env.facts.unemployment)
        parts.push(
          lang === "bg"
            ? `безработица ${f(env, "unemployment")}`
            : `unemployment ${f(env, "unemployment")}`,
        );
      if (env.facts.air_pm10)
        parts.push(
          lang === "bg"
            ? `ФПЧ10 ${f(env, "air_pm10")}`
            : `PM10 ${f(env, "air_pm10")}`,
        );
      if (env.facts.transparency)
        parts.push(
          lang === "bg"
            ? `прозрачност ${f(env, "transparency")}`
            : `transparency ${f(env, "transparency")}`,
        );
      const head =
        lang === "bg"
          ? `Профил на ${f(env, "place")} (${f(env, "oblast")})`
          : `${f(env, "place")} (${f(env, "oblast")})`;
      return parts.length ? `${head}: ${parts.join(", ")}.` : head;
    }
    default:
      return env.title;
  }
};
