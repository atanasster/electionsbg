// Template narrator: turns an Envelope's facts into a short bilingual sentence.
//
// This is the no-model narration path. In M3 the LLM narrates instead (handed
// the same facts), but the contract is identical: narration NEVER introduces a
// number that isn't already in `facts`.

import type { Envelope, Lang } from "../tools/types";

const f = (e: Envelope, key: string): string => String(e.facts[key] ?? "");

// Scope phrase for a trend series: a date window ("last N years") when one was
// requested, otherwise the election count ("last N elections").
const seriesScope = (e: Envelope, lang: Lang): string => {
  const wy = e.facts.window_years;
  if (typeof wy === "number")
    return lang === "bg" ? `последните ${wy} години` : `last ${wy} years`;
  const n = f(e, "elections_count");
  return lang === "bg" ? `последните ${n} избора` : `last ${n} elections`;
};

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
      const scope = seriesScope(env, lang);
      return lang === "bg"
        ? `Делът на машинното гласуване в ${scope} завършва на ${last} (${dir} спрямо началото).`
        : `Machine voting across the ${scope} ends at ${last} (${dir} from the start).`;
    }
    case "turnoutSeries": {
      const last = f(env, "latest");
      const scope = seriesScope(env, lang);
      return lang === "bg"
        ? `Избирателната активност в ${scope} завършва на ${last}.`
        : `Voter turnout across the ${scope} ends at ${last}.`;
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
    case "regionWinners":
      return lang === "bg"
        ? `Резултати по области за ${f(env, "election")}: ${f(env, "leading_party")} води в ${f(env, "leading_wins")} от ${f(env, "regions")} области. Таблицата показва водещата партия във всяка област.`
        : `Results by region for ${f(env, "election")}: ${f(env, "leading_party")} leads in ${f(env, "leading_wins")} of ${f(env, "regions")} regions. The table shows the leading party in each region.`;
    case "municipalityWinners":
      if (!env.facts.municipalities) return env.title;
      return lang === "bg"
        ? `${f(env, "oblast")}: ${f(env, "leading_party")} води в ${f(env, "leading_wins")} от ${f(env, "municipalities")} общини. Таблицата показва водещата партия във всяка община.`
        : `${f(env, "oblast")}: ${f(env, "leading_party")} leads in ${f(env, "leading_wins")} of ${f(env, "municipalities")} municipalities. The table shows the leading party in each.`;
    case "settlementWinners":
      if (!env.facts.settlements) return env.title;
      return lang === "bg"
        ? `${f(env, "place")}: ${f(env, "leading_party")} води в ${f(env, "leading_wins")} от ${f(env, "settlements")} населени места. Таблицата показва водещата партия във всяко.`
        : `${f(env, "place")}: ${f(env, "leading_party")} leads in ${f(env, "leading_wins")} of ${f(env, "settlements")} settlements. The table shows the leading party in each.`;
    case "sectionWinners":
      if (!env.facts.sections) return env.title;
      return lang === "bg"
        ? `${f(env, "place")}: ${f(env, "leading_party")} води в ${f(env, "leading_wins")} от ${f(env, "sections")} секции. Таблицата показва водещата партия във всяка секция.`
        : `${f(env, "place")}: ${f(env, "leading_party")} leads in ${f(env, "leading_wins")} of ${f(env, "sections")} sections. The table shows the leading party in each.`;
    case "sectionResults":
      if (!env.facts.winner) return env.title;
      return lang === "bg"
        ? `Секция ${f(env, "section")}${env.facts.settlement ? ` (${f(env, "settlement")})` : ""}, ${f(env, "election")}: води ${f(env, "winner")}; активност ${f(env, "turnout")}, ${f(env, "valid_votes")} действителни гласа.`
        : `Section ${f(env, "section")}${env.facts.settlement ? ` (${f(env, "settlement")})` : ""}, ${f(env, "election")}: ${f(env, "winner")} leads; turnout ${f(env, "turnout")}, ${f(env, "valid_votes")} valid votes.`;
    case "sectionHistory":
      if (!env.facts.elections_count) return env.title;
      return lang === "bg"
        ? `Секция ${f(env, "section")}${env.facts.settlement ? ` (${f(env, "settlement")})` : ""} през ${f(env, "elections_count")} избора: най-често води ${f(env, "most_frequent_winner")}; последно ${f(env, "latest")}.`
        : `Section ${f(env, "section")}${env.facts.settlement ? ` (${f(env, "settlement")})` : ""} across ${f(env, "elections_count")} elections: most often led by ${f(env, "most_frequent_winner")}; latest ${f(env, "latest")}.`;
    case "settlementResults":
      if (!env.facts.leading_party) return env.title;
      return lang === "bg"
        ? `${f(env, "settlement")} (${f(env, "election")}): води ${f(env, "leading_party")} с ${f(env, "leading_pct")}; общо ${f(env, "total_votes")} гласа${env.facts.turnout ? `, активност ${f(env, "turnout")}` : ""}.`
        : `${f(env, "settlement")} (${f(env, "election")}): ${f(env, "leading_party")} leads with ${f(env, "leading_pct")}; ${f(env, "total_votes")} votes total${env.facts.turnout ? `, turnout ${f(env, "turnout")}` : ""}.`;
    case "settlementHistory":
      if (!env.facts.elections_count) return env.title;
      return lang === "bg"
        ? `Резултати в ${f(env, "settlement")} (${f(env, "range")}): графиката проследява ${f(env, "parties_shown")} партии${env.facts.leader ? `; последно води ${f(env, "leader")}` : ""}.`
        : `Results in ${f(env, "settlement")} (${f(env, "range")}): the chart tracks ${f(env, "parties_shown")} parties${env.facts.leader ? `; latest leader ${f(env, "leader")}` : ""}.`;
    case "municipalityResults":
      if (!env.facts.leading_party) return env.title;
      return lang === "bg"
        ? `Община ${f(env, "municipality")} (${f(env, "election")}): води ${f(env, "leading_party")} с ${f(env, "leading_pct")}; общо ${f(env, "total_votes")} гласа${env.facts.turnout ? `, активност ${f(env, "turnout")}` : ""}.`
        : `${f(env, "municipality")} municipality (${f(env, "election")}): ${f(env, "leading_party")} leads with ${f(env, "leading_pct")}; ${f(env, "total_votes")} votes total${env.facts.turnout ? `, turnout ${f(env, "turnout")}` : ""}.`;
    case "municipalityHistory":
      if (!env.facts.elections_count) return env.title;
      return lang === "bg"
        ? `Резултати в община ${f(env, "municipality")} (${f(env, "range")}): графиката проследява ${f(env, "parties_shown")} партии${env.facts.leader ? `; последно води ${f(env, "leader")}` : ""}.`
        : `Results in ${f(env, "municipality")} municipality (${f(env, "range")}): the chart tracks ${f(env, "parties_shown")} parties${env.facts.leader ? `; latest leader ${f(env, "leader")}` : ""}.`;
    case "regionResults":
      if (!env.facts.leading_party) return env.title;
      return lang === "bg"
        ? `${f(env, "region")} (${f(env, "election")}): води ${f(env, "leading_party")} с ${f(env, "leading_pct")}; общо ${f(env, "total_votes")} гласа${env.facts.turnout ? `, активност ${f(env, "turnout")}` : ""}.`
        : `${f(env, "region")} (${f(env, "election")}): ${f(env, "leading_party")} leads with ${f(env, "leading_pct")}; ${f(env, "total_votes")} votes total${env.facts.turnout ? `, turnout ${f(env, "turnout")}` : ""}.`;
    case "regionResultsTrend":
      if (!env.facts.elections_count) return env.title;
      return lang === "bg"
        ? `Резултати в ${f(env, "region")} (${f(env, "range")}): графиката проследява ${f(env, "parties_shown")} партии${env.facts.leader ? `; последно води ${f(env, "leader")}` : ""}.`
        : `Results in ${f(env, "region")} (${f(env, "range")}): the chart tracks ${f(env, "parties_shown")} parties${env.facts.leader ? `; latest leader ${f(env, "leader")}` : ""}.`;
    case "parliamentSeats":
      if (!env.facts.total_seats) return env.title;
      return lang === "bg"
        ? `${f(env, "election")}: ${f(env, "total_seats")} места между ${f(env, "parties_seated")} партии; най-голяма ${f(env, "leader")}, ${f(env, "majority_status")} (мнозинство ${f(env, "majority")}).`
        : `${f(env, "election")}: ${f(env, "total_seats")} seats across ${f(env, "parties_seated")} parties; largest ${f(env, "leader")}, ${f(env, "majority_status")} (majority ${f(env, "majority")}).`;
    case "seatsHistory": {
      if (!env.facts.elections_count) return env.title;
      const leader = f(env, "leader");
      const range = f(env, "range");
      const count = f(env, "elections_count");
      // Parenthesise the range so any form reads cleanly. A "last N elections"
      // range already names the count, so only a years-window ("последните 5
      // години" / "last 5 years") or the full history ("от 2005 насам" / "since
      // 2005") gets the election count appended — avoids "за от 2005 насам" and
      // the redundant "last 4 elections, 4 elections".
      const rangePart =
        lang === "bg"
          ? range.includes("избора")
            ? range
            : `${range}, ${count} избора`
          : range.includes("elections")
            ? range
            : `${range}, ${count} elections`;
      return lang === "bg"
        ? `Места по партия (${rangePart}). Графиката проследява ${f(env, "parties_shown")} партии${leader ? `; най-голяма в последния избор е ${leader}` : ""}.`
        : `Seats per party (${rangePart}). The chart tracks ${f(env, "parties_shown")} parties${leader ? `; the largest in the latest election is ${leader}` : ""}.`;
    }
    case "candidateResult":
      if (env.facts.total_preferences == null) return env.title;
      return lang === "bg"
        ? `${f(env, "name")}${env.facts.party ? ` (${f(env, "party")})` : ""}: ${f(env, "total_preferences")} преференции в ${f(env, "regions")} района; най-много ${f(env, "top_region")}.`
        : `${f(env, "name")}${env.facts.party ? ` (${f(env, "party")})` : ""}: ${f(env, "total_preferences")} preferential votes across ${f(env, "regions")} regions; most ${f(env, "top_region")}.`;
    case "regionBreakdown":
      if (!env.facts.party)
        return lang === "bg"
          ? "Не намерих такава партия."
          : "I couldn't find that party.";
      return lang === "bg"
        ? `${f(env, "party")} е най-силна в ${f(env, "strongest")}, най-слаба в ${f(env, "weakest")}.`
        : `${f(env, "party")} is strongest in ${f(env, "strongest")}, weakest in ${f(env, "weakest")}.`;
    case "municipalityBreakdown":
      if (!env.facts.party)
        return lang === "bg"
          ? "Не намерих такава партия или област."
          : "I couldn't find that party or oblast.";
      return lang === "bg"
        ? `${f(env, "party")} в ${f(env, "oblast")}: най-силна в ${f(env, "strongest")}, най-слаба в ${f(env, "weakest")}.`
        : `${f(env, "party")} in ${f(env, "oblast")}: strongest in ${f(env, "strongest")}, weakest in ${f(env, "weakest")}.`;
    case "settlementBreakdown":
      if (!env.facts.party)
        return lang === "bg"
          ? "Не намерих такава партия или община."
          : "I couldn't find that party or municipality.";
      return lang === "bg"
        ? `${f(env, "party")} в ${f(env, "place")}: най-силна в ${f(env, "strongest")} (${f(env, "settlements")} населени места).`
        : `${f(env, "party")} in ${f(env, "place")}: strongest in ${f(env, "strongest")} (${f(env, "settlements")} settlements).`;
    case "electionAnomalies":
      return lang === "bg"
        ? `Сигнали за ${f(env, "election")}: ${f(env, "problem_sections")} проблемни секции (общо ${f(env, "total_flagged")} флага).`
        : `Anomaly signals for ${f(env, "election")}: ${f(env, "problem_sections")} problem sections (${f(env, "total_flagged")} flags total).`;
    case "flashMemoryByParty":
      if (!env.facts.biggest_loser) return env.title;
      return lang === "bg"
        ? `Разлика машинно срещу флаш памет (${f(env, "election")}): най-много губи ${f(env, "biggest_loser")}, най-много печели ${f(env, "biggest_gainer")}.`
        : `Machine vs flash memory (${f(env, "election")}): ${f(env, "biggest_loser")} lost the most, ${f(env, "biggest_gainer")} gained the most.`;
    case "machineVoteByParty":
      if (!env.facts.most_machine) return env.title;
      return lang === "bg"
        ? `Машинно гласуване по партия (${f(env, "election")}): най-висок дял ${f(env, "most_machine")}, най-нисък ${f(env, "most_paper")}.`
        : `Machine voting by party (${f(env, "election")}): highest share ${f(env, "most_machine")}, lowest ${f(env, "most_paper")}.`;
    case "wastedVotesByParty":
      if (!env.facts.top_wasted) return env.title;
      return lang === "bg"
        ? `Прахосани гласове по партия (${f(env, "election")}): най-много ${f(env, "top_wasted")}; общо ${f(env, "total_wasted")} (${f(env, "share")}).`
        : `Wasted votes by party (${f(env, "election")}): most ${f(env, "top_wasted")}; ${f(env, "total_wasted")} total (${f(env, "share")}).`;
    case "recountByParty":
      if (!env.facts.biggest_loser) return env.title;
      return lang === "bg"
        ? `Преброяване наново (${f(env, "election")}): най-много губи ${f(env, "biggest_loser")}, най-много печели ${f(env, "biggest_gainer")}.`
        : `Recount (${f(env, "election")}): ${f(env, "biggest_loser")} lost the most, ${f(env, "biggest_gainer")} gained the most.`;
    case "regionHistory":
      return lang === "bg"
        ? `Избирателна активност в ${f(env, "oblast")} през ${f(env, "elections")} избора; последно ${f(env, "latest_turnout")}.`
        : `Voter turnout in ${f(env, "oblast")} across ${f(env, "elections")} elections; latest ${f(env, "latest_turnout")}.`;
    case "voteTransitions":
      if (!env.facts.biggest) return env.title;
      return lang === "bg"
        ? `Преливане ${f(env, "pair")}: най-голям поток ${f(env, "biggest")}.`
        : `Transitions ${f(env, "pair")}: biggest flow ${f(env, "biggest")}.`;
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
    case "localMayorHistory":
      if (!env.facts.latest_mayor) return env.title;
      return lang === "bg"
        ? `Кметове на ${f(env, "place")}: настоящ ${f(env, "latest_mayor")} (${f(env, "latest_party")}); ${f(env, "terms")} мандата в данните.`
        : `Mayors of ${f(env, "place")}: current ${f(env, "latest_mayor")} (${f(env, "latest_party")}); ${f(env, "terms")} terms on record.`;
    case "comparePlaces":
      return lang === "bg"
        ? `Сравнение на ${f(env, "a")} и ${f(env, "b")} по ${f(env, "compared")} показателя.`
        : `Comparison of ${f(env, "a")} and ${f(env, "b")} across ${f(env, "compared")} indicators.`;
    case "localSubMayors":
      if (env.facts.total == null) return env.title;
      return lang === "bg"
        ? `${f(env, "place")}: ${f(env, "total")} ${f(env, "level")} (показани ${f(env, "shown")}).`
        : `${f(env, "place")}: ${f(env, "total")} ${f(env, "level")} (showing ${f(env, "shown")}).`;
    case "localOblastMayors":
      if (env.facts.total == null) return env.title;
      return lang === "bg"
        ? `${f(env, "oblast")} (${f(env, "cycle")}): ${f(env, "total")} ${f(env, "level")}; най-много — ${f(env, "leader")}.`
        : `${f(env, "oblast")} (${f(env, "cycle")}): ${f(env, "total")} ${f(env, "level")}; most — ${f(env, "leader")}.`;
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
    case "simulateTaxChange": {
      if (!env.facts.delta_per_year) return env.title;
      const note = env.facts.note ? ` ${f(env, "note")}` : "";
      // Expenditure levers (basis_id = "balance") move the budget BALANCE;
      // the tax levers move revenue. Same sign convention: + = improves.
      const onBalance = env.facts.basis_id === "balance";
      return lang === "bg"
        ? `${f(env, "change")}: ${f(env, "delta_per_year")} ${onBalance ? "по бюджетното салдо" : "приходи"} годишно (${f(env, "share_of_gdp")} от БВП).${note} Оценката е статична — базата е фиксирана към ${f(env, "baseline_year")}, без поведенчески реакции; пълният сценарий е в симулатора (линка по-долу).`
        : `${f(env, "change")}: ${f(env, "delta_per_year")} ${onBalance ? "on the budget balance" : "in revenue"} per year (${f(env, "share_of_gdp")} of GDP).${note} The estimate is static — the ${onBalance ? "base" : "tax base"} is held at ${f(env, "baseline_year")} with no behavioral response; the full scenario is in the simulator (link below).`;
    }
    case "budgetByFunction":
      return lang === "bg"
        ? `Най-голям разход по функция (${f(env, "year")}): ${f(env, "top_function")}. Общо: ${f(env, "total")}.`
        : `Largest spending function (${f(env, "year")}): ${f(env, "top_function")}. Total: ${f(env, "total")}.`;
    case "budgetFunction":
      return lang === "bg"
        ? `Разходи за ${f(env, "function")}: ${f(env, "amount")} (${f(env, "share_of_budget")} от бюджета) през ${f(env, "year")}; ${f(env, "rank")}-о място по размер.`
        : `Spending on ${f(env, "function")}: ${f(env, "amount")} (${f(env, "share_of_budget")} of the budget) in ${f(env, "year")}; ranked #${f(env, "rank")} by size.`;
    case "nzokBudget":
      if (!env.facts.total) return env.title;
      return lang === "bg"
        ? `Бюджет на НЗОК ${f(env, "year")}: ${f(env, "total")} общо. Най-голямо перо — ${f(env, "biggest_line")}: ${f(env, "biggest_amount")} (${f(env, "biggest_share")}).`
        : `NHIF budget ${f(env, "year")}: ${f(env, "total")} total. Biggest line — ${f(env, "biggest_line")}: ${f(env, "biggest_amount")} (${f(env, "biggest_share")}).`;
    case "judiciaryBudget":
      if (!env.facts.total) return env.title;
      return lang === "bg"
        ? `Бюджет на съдебната власт ${f(env, "year")}: ${f(env, "total")} общо. Най-голям орган — ${f(env, "biggest_body")}: ${f(env, "biggest_amount")} (${f(env, "biggest_share")}). Собствените приходи са ${f(env, "own_revenue")} (${f(env, "self_financing")} от разходите), от които съдебни такси ${f(env, "court_fees")}.`
        : `The judiciary's budget ${f(env, "year")}: ${f(env, "total")} total. Biggest body — ${f(env, "biggest_body")}: ${f(env, "biggest_amount")} (${f(env, "biggest_share")}). Own revenue is ${f(env, "own_revenue")} (${f(env, "self_financing")} of costs), of which ${f(env, "court_fees")} from court fees.`;
    // "законовия срок" / "the statutory deadline" rather than "3-месечния срок":
    // the 3 would be a number the narrator introduced, and `facts` carries only
    // the share (`within_deadline`), never the deadline's length.
    case "judiciaryCaseload":
      if (!env.facts.filed) return env.title;
      return lang === "bg"
        ? `През ${f(env, "year")} г. в съдилищата постъпват ${f(env, "filed")} дела и се свършват ${f(env, "resolved")} (приключваемост ${f(env, "clearance")}); ${f(env, "within_deadline")} от свършените са в законовия срок, а ${f(env, "pending")} дела остават висящи. Най-натоварени са ${f(env, "busiest_tier")}.`
        : `In ${f(env, "year")} the courts took in ${f(env, "filed")} cases and closed ${f(env, "resolved")} (clearance ${f(env, "clearance")}); ${f(env, "within_deadline")} of those closed inside the statutory deadline, and ${f(env, "pending")} remain pending. The busiest tier is ${f(env, "busiest_tier")}.`;
    case "judiciaryDeclarations": {
      if (!env.facts.declarations) return env.title;
      // The two counts describe DIFFERENT lists: `flagged_people` (the three
      // missed-deadline lists) and `discrepancy_people` (чл. 175ж — filed on
      // time, but with an unresolved discrepancy). Never subtract one from the
      // other, and never present the non-`filed_late` remainder as "never
      // filed" — these are named people.
      const flagged = Number(env.facts.flagged_people);
      const late = Number(env.facts.filed_late);
      const disc = Number(env.facts.discrepancy_people);
      // When every flagged person carries the ИВСС's "(1)" footnote, repeating
      // the same figure twice reads as an error; say "all of them" instead.
      const lateClause =
        flagged === late
          ? lang === "bg"
            ? "и всички те са подали декларация със закъснение"
            : "all of whom did file, late"
          : lang === "bg"
            ? `като ${f(env, "filed_late")} от тях са подали декларация със закъснение`
            : `${f(env, "filed_late")} of whom did file, late`;
      const discClause =
        disc > 0
          ? lang === "bg"
            ? ` Отделно, ${f(env, "discrepancy_people")} души са с установено несъответствие, неотстранено в срок.`
            : ` Separately, ${f(env, "discrepancy_people")} have a discrepancy that was found and left unresolved.`
          : "";
      return lang === "bg"
        ? `Регистърът на ИВСС съдържа ${f(env, "declarations")} декларации от ${f(env, "magistrates")} магистрати (${f(env, "first_year")}–${f(env, "last_year")}). ${f(env, "may_share")} от годишните декларации се подават през май — срокът е ${f(env, "deadline")}. В списъците на ИВСС за пропуснат срок са посочени ${f(env, "flagged_people")} души, ${lateClause}.${discClause}`
        : `The Inspectorate's register holds ${f(env, "declarations")} declarations from ${f(env, "magistrates")} magistrates (${f(env, "first_year")}–${f(env, "last_year")}). ${f(env, "may_share")} of annual declarations are filed in May — the deadline is ${f(env, "deadline")}. Its missed-deadline lists name ${f(env, "flagged_people")} people, ${lateClause}.${discClause}`;
    }
    case "judiciaryWorkload":
      if (!env.facts.national_actual) return env.title;
      return lang === "bg"
        ? `През ${f(env, "year")} г. ${f(env, "judges")} съдии по щат носят средно ${f(env, "national_per_post")} дела на месец по щат и ${f(env, "national_actual")} действително. Най-натоварени са ${f(env, "busiest_tier")} (${f(env, "busiest_load")}), най-малко — ${f(env, "quietest_tier")} (${f(env, "quietest_load")}).`
        : `In ${f(env, "year")}, ${f(env, "judges")} judge posts carried ${f(env, "national_per_post")} cases a month per post and ${f(env, "national_actual")} in actual terms. The busiest tier is ${f(env, "busiest_tier")} (${f(env, "busiest_load")}), the quietest ${f(env, "quietest_tier")} (${f(env, "quietest_load")}).`;
    case "nzokDrugs":
      if (!env.facts.top_inn) return env.title;
      return lang === "bg"
        ? `Най-много НЗОК плаща за ${f(env, "top_inn")} (${f(env, "top_product")}): ${f(env, "top_amount")}. Онкологията е ${f(env, "oncology_share")} от ${f(env, "total")} за ${f(env, "distinct_inn")} активни вещества (${f(env, "year")}).`
        : `The NHIF reimburses ${f(env, "top_inn")} (${f(env, "top_product")}) most: ${f(env, "top_amount")}. Oncology is ${f(env, "oncology_share")} of ${f(env, "total")} across ${f(env, "distinct_inn")} active substances (${f(env, "year")}).`;
    case "nzokDrugGrowth":
      if (!env.facts.top_riser) return env.title;
      return lang === "bg"
        ? `Най-бързо растящо лекарство (${f(env, "prior_year")}→${f(env, "year")}): ${f(env, "top_riser")}, ${f(env, "top_riser_change")} до ${f(env, "top_riser_amount")}; ${f(env, "newly_reimbursed")} новореимбурсирани.`
        : `Fastest-rising medicine (${f(env, "prior_year")}→${f(env, "year")}): ${f(env, "top_riser")}, ${f(env, "top_riser_change")} to ${f(env, "top_riser_amount")}; ${f(env, "newly_reimbursed")} newly reimbursed.`;
    case "nzokHospitals":
      if (!env.facts.top_hospital) return env.title;
      return lang === "bg"
        ? `Най-много от НЗОК получава ${f(env, "top_hospital")}: ${f(env, "top_amount")}. Общо ${f(env, "national_total")} към ${f(env, "facilities")} лечебни заведения (${f(env, "as_of")}).`
        : `The NHIF pays ${f(env, "top_hospital")} most: ${f(env, "top_amount")}. ${f(env, "national_total")} total across ${f(env, "facilities")} facilities (${f(env, "as_of")}).`;
    case "procurementTotals": {
      const offVal = f(env, "official_connected_value");
      const offBg = offVal ? ` и с длъжностни лица: ${offVal}` : "";
      const offEn = offVal ? ` and officials: ${offVal}` : "";
      return lang === "bg"
        ? `Обществени поръчки: ${f(env, "contracts")} договора за ${f(env, "total_value")}; свързани с депутати: ${f(env, "mp_connected_value")}${offBg}.`
        : `Public procurement: ${f(env, "contracts")} contracts worth ${f(env, "total_value")}; MP-connected: ${f(env, "mp_connected_value")}${offEn}.`;
    }
    case "openTenders": {
      const scope = String(env.facts.scope ?? "");
      const yr = env.facts.year ? String(env.facts.year) : "";
      const total = env.facts.total_estimated;
      const cancelledN = Number(env.facts.cancelled) || 0;
      const scopeBg = scope && scope !== "всички" ? ` за „${scope}“` : "";
      const scopeEn = scope && scope !== "all" ? ` for “${scope}”` : "";
      const cancelBg = cancelledN ? ` (${cancelledN} прекратени)` : "";
      const cancelEn = cancelledN ? ` (${cancelledN} cancelled)` : "";
      return lang === "bg"
        ? `Намерих ${f(env, "matches")} обявени поръчки${scopeBg}${yr ? ` през ${yr}` : ""}${cancelBg}${total ? `, обща прогнозна стойност ${f(env, "total_estimated")}` : ""}; най-голямата е ${f(env, "biggest_estimate")}. Прогнозни (обявени) стойности — не са похарчени средства.`
        : `Found ${f(env, "matches")} announced tenders${scopeEn}${yr ? ` in ${yr}` : ""}${cancelEn}${total ? `, total estimated ${f(env, "total_estimated")}` : ""}; the largest is ${f(env, "biggest_estimate")}. Estimated (announced) values — not money spent.`;
    }
    case "procurementAppeals": {
      const sinceBg = env.facts.since_year
        ? ` (от ${f(env, "since_year")} г. насам)`
        : "";
      const sinceEn = env.facts.since_year
        ? ` since ${f(env, "since_year")}`
        : "";
      // buyer-scoped answer: one entity's appeal / upheld counts
      if (env.facts.buyer)
        return lang === "bg"
          ? `${f(env, "buyer")}: ${f(env, "appeals")} ${f(env, "appeals") === "1" ? "жалба" : "жалби"} пред КЗК${sinceBg}, от които ${f(env, "upheld")} ${f(env, "upheld") === "1" ? "уважена" : "уважени"} (отменено решение на възложителя). За сравнение — ${f(env, "total_complaints")} жалби общо. Жалбата е преглед, не доказателство за нарушение.`
          : `${f(env, "buyer")}: ${f(env, "appeals")} КЗК appeals${sinceEn}, of which ${f(env, "upheld")} upheld (the buyer's decision was annulled). For context — ${f(env, "total_complaints")} appeals in total. An appeal is a review, not proof of wrongdoing.`;
      // buyer-scoped ask, but the entity isn't among the tracked top-appealed
      if (env.facts.buyer_query)
        return lang === "bg"
          ? `„${f(env, "buyer_query")}“ не е сред най-обжалваните възложители, които следя (класацията покрива само първите ${f(env, "tracked_buyers")}). Най-обжалван е ${f(env, "most_appealed_buyer")}; общо ${f(env, "total_complaints")} жалби пред КЗК${sinceBg}.`
          : `“${f(env, "buyer_query")}” isn't among the most-appealed buyers I track (the list covers only the top ${f(env, "tracked_buyers")}). The most-appealed is ${f(env, "most_appealed_buyer")}; ${f(env, "total_complaints")} КЗК appeals in total${sinceEn}.`;
      return lang === "bg"
        ? `${f(env, "total_complaints")} жалби пред КЗК срещу обществени поръчки${sinceBg}; с решение по същество: ${f(env, "with_outcome")} (${f(env, "upheld")} уважени, ${f(env, "rejected")} отхвърлени), ${f(env, "suspended")} спрени процедури. Най-често обжалван възложител: ${f(env, "most_appealed_buyer")}. Жалбата е преглед, не доказателство за нарушение.`
        : `${f(env, "total_complaints")} КЗК appeals against public procurement${sinceEn}; decided on the merits: ${f(env, "with_outcome")} (${f(env, "upheld")} upheld, ${f(env, "rejected")} rejected), ${f(env, "suspended")} suspended procedures. Most-appealed buyer: ${f(env, "most_appealed_buyer")}. An appeal is a review, not proof of wrongdoing.`;
    }
    case "tenderLookup": {
      if (!env.facts.unp)
        return lang === "bg"
          ? "Не открих такава поръчка сред най-големите."
          : "I couldn't find that tender among the largest.";
      return lang === "bg"
        ? `Поръчка ${f(env, "unp")} на ${f(env, "buyer")}: прогнозна стойност ${f(env, "estimated_value")}, ${f(env, "lots")} обособени позиции, статус „${f(env, "status")}“ (обявена на ${f(env, "announced")}). Прогнозна (обявена) стойност — не е похарчена.`
        : `Tender ${f(env, "unp")} by ${f(env, "buyer")}: estimated ${f(env, "estimated_value")}, ${f(env, "lots")} lots, status “${f(env, "status")}” (announced ${f(env, "announced")}). Estimated (announced) value — not money spent.`;
    }
    case "contractSearch": {
      if (!env.facts.company)
        return lang === "bg"
          ? "Не намерих такава фирма-изпълнител."
          : "I couldn't find that contractor.";
      const sb = Number(env.facts.single_bidder) || 0;
      const sbBg = sb ? ` ${sb} с един участник.` : "";
      const sbEn = sb ? ` ${sb} single-bidder.` : "";
      return lang === "bg"
        ? `${f(env, "company")}: ${f(env, "contracts")} договора за ${f(env, "total_value")}.${sbBg} Най-голям: ${f(env, "biggest_value")} от ${f(env, "biggest_awarder")}.`
        : `${f(env, "company")}: ${f(env, "contracts")} contracts worth ${f(env, "total_value")}.${sbEn} Largest: ${f(env, "biggest_value")} from ${f(env, "biggest_awarder")}.`;
    }
    case "fundsOverview":
      return lang === "bg"
        ? `Европейски средства: договорени ${f(env, "contracted")}, изплатени ${f(env, "paid")}. Топ бенефициент: ${f(env, "top")}.`
        : `EU funds: ${f(env, "contracted")} contracted, ${f(env, "paid")} paid. Top beneficiary: ${f(env, "top")}.`;
    case "subsidiesOverview":
      if (!env.facts.paid) return env.title;
      return lang === "bg"
        ? `Земеделски субсидии (${f(env, "scope")}): изплатени ${f(env, "paid")} на ${f(env, "recipients")} получатели — ${f(env, "companies")} фирми и ${f(env, "individuals")} физически лица. ${f(env, "top100Count")} най-големи фирми взимат ${f(env, "top100Share")} от парите за юридически лица. Най-голяма схема: ${f(env, "biggestScheme")}. Най-голям получател: ${f(env, "biggestRecipient")}.`
        : `Farm subsidies (${f(env, "scope")}): ${f(env, "paid")} paid to ${f(env, "recipients")} recipients — ${f(env, "companies")} companies and ${f(env, "individuals")} individuals. The ${f(env, "top100Count")} largest firms take ${f(env, "top100Share")} of the legal-entity money. Largest scheme: ${f(env, "biggestScheme")}. Largest recipient: ${f(env, "biggestRecipient")}.`;
    case "subsidiesByScheme":
      if (!env.facts.biggestScheme) return env.title;
      return lang === "bg"
        ? `Най-много пари по земеделските схеми (${f(env, "scope")}) отиват за ${f(env, "biggestScheme")}: ${f(env, "biggestAmount")}.`
        : `The largest farm-subsidy scheme (${f(env, "scope")}) is ${f(env, "biggestScheme")}: ${f(env, "biggestAmount")}.`;
    case "subsidiesForEntity": {
      if (!env.facts.total) return env.title;
      // Recipients recovered from the СЕУ years by name-match carry no EIK, and
      // individuals carry no oblast — drop whichever is missing rather than
      // render an empty "(ЕИК , —)".
      const idBg = [
        env.facts.eik ? `ЕИК ${f(env, "eik")}` : "",
        env.facts.oblast && env.facts.oblast !== "—" ? f(env, "oblast") : "",
      ].filter(Boolean);
      const idEn = [
        env.facts.eik ? `EIK ${f(env, "eik")}` : "",
        env.facts.oblast && env.facts.oblast !== "—" ? f(env, "oblast") : "",
      ].filter(Boolean);
      return lang === "bg"
        ? `${f(env, "recipient")}${idBg.length ? ` (${idBg.join(", ")})` : ""} е получил ${f(env, "total")} земеделски субсидии по ${f(env, "payments")} плащания през ${f(env, "period")} г. Най-голяма схема: ${f(env, "topScheme")}.`
        : `${f(env, "recipient")}${idEn.length ? ` (${idEn.join(", ")})` : ""} received ${f(env, "total")} in farm subsidies across ${f(env, "payments")} payments in ${f(env, "period")}. Largest scheme: ${f(env, "topScheme")}.`;
    }
    case "cultureOverview":
      if (!env.facts.total) return env.title;
      return lang === "bg"
        ? `Държавна субсидия за кино (НФЦ, ${f(env, "span")}): ${f(env, "total")} за ${f(env, "films")} проекта на ${f(env, "producers")} продуценти. Топ 10 продуценти държат ${f(env, "top10Share")} от парите. Най-финансиран: ${f(env, "biggestProducer")}.`
        : `State film subsidy (НФЦ, ${f(env, "span")}): ${f(env, "total")} across ${f(env, "films")} projects and ${f(env, "producers")} producers. The top 10 producers hold ${f(env, "top10Share")} of the money. Most-funded: ${f(env, "biggestProducer")}.`;
    case "topCultureGrantees":
      if (!env.facts.biggestProducer) return env.title;
      return lang === "bg"
        ? `Най-финансиран продуцент от НФЦ: ${f(env, "biggestProducer")} (${f(env, "biggestAmount")}). Топ 10 държат ${f(env, "top10Share")} от субсидията.`
        : `Top НФЦ-funded producer: ${f(env, "biggestProducer")} (${f(env, "biggestAmount")}). The top 10 hold ${f(env, "top10Share")} of the subsidy.`;
    case "filmSubsidyForProducer":
      if (!env.facts.total) return env.title;
      return lang === "bg"
        ? `${f(env, "producer")} е получил ${f(env, "total")} държавна субсидия за кино по ${f(env, "films")} проекта.`
        : `${f(env, "producer")} received ${f(env, "total")} in state film subsidy across ${f(env, "films")} projects.`;
    case "cultureGrantSuccess":
      if (!env.facts.rate) return env.title;
      return lang === "bg"
        ? `Успеваемост на грантовете на НФК: ${f(env, "rate")} — ${f(env, "funded")} от ${f(env, "applied")} проекта финансирани (${f(env, "totalFunded")}). Най-висока: ${f(env, "bestField")} (${f(env, "bestRate")}); най-ниска: ${f(env, "worstField")} (${f(env, "worstRate")}).`
        : `НФК grant success rate: ${f(env, "rate")} — ${f(env, "funded")} of ${f(env, "applied")} projects funded (${f(env, "totalFunded")}). Highest: ${f(env, "bestField")} (${f(env, "bestRate")}); lowest: ${f(env, "worstField")} (${f(env, "worstRate")}).`;
    case "cultureCommissions":
      if (!env.facts.members) return env.title;
      return lang === "bg"
        ? `${f(env, "commissions")} национални художествени комисии на НФЦ решават кои филми получават субсидия (мандат ${f(env, "mandate")}, ${f(env, "order")}). Председатели: игрално — ${f(env, "featureChair")}; документално — ${f(env, "documentaryChair")}; анимационно — ${f(env, "animationChair")}.`
        : `${f(env, "commissions")} НФЦ national artistic commissions decide which films get a subsidy (mandate ${f(env, "mandate")}, ${f(env, "order")}). Chairs: feature — ${f(env, "featureChair")}; documentary — ${f(env, "documentaryChair")}; animation — ${f(env, "animationChair")}.`;
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
        ? `Общински съвет на ${f(env, "municipality")}: ${f(env, "total_seats")} места; първа сила ${f(env, "leader")}; ${f(env, "control")} (мнозинство ${f(env, "majority")}).`
        : `${f(env, "municipality")} council: ${f(env, "total_seats")} seats; top force ${f(env, "leader")}; ${f(env, "control")} (majority ${f(env, "majority")}).`;
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
    case "rankPlaces":
      return lang === "bg"
        ? `${f(env, "indicator")} — ${f(env, "order")} ${f(env, "level")}. Начело: ${f(env, "leader")} (от ${f(env, "ranked")}).`
        : `${f(env, "indicator")} — ${f(env, "order")} ${f(env, "level")}. Top: ${f(env, "leader")} (of ${f(env, "ranked")}).`;
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
    case "mpAssetsByParty":
      if (!env.facts.richest_party) return env.title;
      return lang === "bg"
        ? `Най-богати депутати средно: ${f(env, "richest_party")}.`
        : `Richest MPs on average: ${f(env, "richest_party")}.`;
    case "mpConnectionsByParty":
      if (!env.facts.most_connected_party) return env.title;
      return lang === "bg"
        ? `Най-много бизнес връзки: ${f(env, "most_connected_party")}.`
        : `Most business connections: ${f(env, "most_connected_party")}.`;
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
        ? `Най-точна агенция: ${f(env, "most_accurate")} (оценка ${f(env, "best_grade")}, средна грешка ${f(env, "best_mae")}).`
        : `Most accurate pollster: ${f(env, "most_accurate")} (grade ${f(env, "best_grade")}, mean error ${f(env, "best_mae")}).`;
    case "agencyProfile":
      if (!env.facts.grade) return env.title;
      return lang === "bg"
        ? `Оценка ${f(env, "grade")}; средна грешка ${f(env, "mean_error")}; точност на прага ${f(env, "threshold_calls")}; покрити ${f(env, "elections_covered")} избора.`
        : `Grade ${f(env, "grade")}; mean error ${f(env, "mean_error")}; threshold-call rate ${f(env, "threshold_calls")}; ${f(env, "elections_covered")} elections covered.`;
    case "latestPolls":
      if (!env.facts.agency) return env.title;
      return lang === "bg"
        ? `Последно проучване (${f(env, "agency")}, ${f(env, "date")}): водач ${f(env, "leader")}.`
        : `Latest poll (${f(env, "agency")}, ${f(env, "date")}): leader ${f(env, "leader")}.`;
    case "agencyPolls":
      if (!env.facts.agency) return env.title;
      return lang === "bg"
        ? `${f(env, "agency")}: ${f(env, "polls")} проучвания (${f(env, "range")}); последно водач ${f(env, "latest_leader")}.`
        : `${f(env, "agency")}: ${f(env, "polls")} polls (${f(env, "range")}); latest leader ${f(env, "latest_leader")}.`;
    case "agencyAccuracyHistory":
      if (!env.facts.agency) return env.title;
      return lang === "bg"
        ? `${f(env, "agency")} — точност по избори: ${f(env, "trend")} (по-ниско = по-точно); най-добре ${f(env, "best_election")}.`
        : `${f(env, "agency")} — accuracy by election: ${f(env, "trend")} (lower = better); best ${f(env, "best_election")}.`;
    case "accuracyTrend":
      return lang === "bg"
        ? `Точност на ${f(env, "agencies_shown")} агенции през ${f(env, "elections")} избора; най-точна ${f(env, "most_accurate")}.`
        : `Accuracy of ${f(env, "agencies_shown")} agencies across ${f(env, "elections")} elections; most accurate ${f(env, "most_accurate")}.`;
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
    case "problemSections":
      if (!env.facts.neighborhoods) return env.title;
      return lang === "bg"
        ? `${f(env, "neighborhoods")} наблюдавани ромски квартала (${f(env, "total_sections")} секции); най-голям ${f(env, "top")}.`
        : `${f(env, "neighborhoods")} tracked Roma neighbourhoods (${f(env, "total_sections")} sections); largest ${f(env, "top")}.`;
    case "romaVoteTrend":
      if (!env.facts.elections_count) return env.title;
      return lang === "bg"
        ? `Ромският вот в ${seriesScope(env, lang)}: най-често води ${f(env, "most_frequent_winner")}; последно ${f(env, "latest")}.`
        : `The Roma vote across the ${seriesScope(env, lang)}: most often led by ${f(env, "most_frequent_winner")}; latest ${f(env, "latest")}.`;
    case "diasporaVoteTrend":
      if (!env.facts.elections_count) return env.title;
      return lang === "bg"
        ? `Гласът в чужбина в ${seriesScope(env, lang)}: най-често води ${f(env, "most_frequent_winner")}; последно ${f(env, "latest")}.`
        : `The diaspora vote across the ${seriesScope(env, lang)}: most often led by ${f(env, "most_frequent_winner")}; latest ${f(env, "latest")}.`;
    case "wastedVotesTrend":
      if (!env.facts.elections_count) return env.title;
      return lang === "bg"
        ? `Прахосани гласове под прага в ${seriesScope(env, lang)}: последно ${f(env, "latest")} (връх ${f(env, "peak_pct")}%, промяна ${f(env, "change_pts")} пр.п.).`
        : `Wasted votes below the threshold across the ${seriesScope(env, lang)}: latest ${f(env, "latest")} (peak ${f(env, "peak_pct")}%, change ${f(env, "change_pts")} pts).`;
    case "localCouncilTrend":
      if (!env.facts.cycles) return env.title;
      return lang === "bg"
        ? `Гласове за общинските съвети през ${f(env, "cycles")} цикъла; водач в последния ${f(env, "leader")}.`
        : `Council vote share across ${f(env, "cycles")} cycles; latest leader ${f(env, "leader")}.`;
    case "localMayorsTrend":
      if (!env.facts.cycles) return env.title;
      return lang === "bg"
        ? `Кметски места по партия през ${f(env, "cycles")} цикъла; водач в последния ${f(env, "leader")}.`
        : `Mayoralties by party across ${f(env, "cycles")} cycles; latest leader ${f(env, "leader")}.`;
    case "budgetTrend":
      if (!env.facts.years) return env.title;
      return lang === "bg"
        ? `Бюджет ${f(env, "span")}: през ${f(env, "latest_year")} приходи ${f(env, "latest_revenue")}, разходи ${f(env, "latest_expenditure")}, салдо ${f(env, "latest_balance")}.`
        : `Budget ${f(env, "span")}: in ${f(env, "latest_year")} revenue ${f(env, "latest_revenue")}, spending ${f(env, "latest_expenditure")}, balance ${f(env, "latest_balance")}.`;
    case "riskIndex":
      if (env.facts.index == null) return env.title;
      return lang === "bg"
        ? `Индекс на изборния риск (${f(env, "election")}): ${f(env, "index")}/100 — ${f(env, "band")}. Най-силен сигнал за цялост: ${f(env, "top_integrity")}. Контекстуални сигнали средно ${f(env, "context_score")} (екран за скрининг, не присъда).`
        : `Election risk index (${f(env, "election")}): ${f(env, "index")}/100 — ${f(env, "band")}. Strongest integrity signal: ${f(env, "top_integrity")}. Context signals average ${f(env, "context_score")} (a screening tool, not a verdict).`;
    case "riskScore":
      return lang === "bg"
        ? `Индекс на риска: ${f(env, "critical")} критични и ${f(env, "high")} високорискови секции от ${f(env, "total_sections")}.`
        : `Risk index: ${f(env, "critical")} critical and ${f(env, "high")} high-risk sections of ${f(env, "total_sections")}.`;
    case "riskClusters":
      return lang === "bg"
        ? `${f(env, "clusters")} клъстера на риска; най-голям: ${f(env, "biggest")}.`
        : `${f(env, "clusters")} risk clusters; biggest: ${f(env, "biggest")}.`;
    case "clusterPersistence":
      return lang === "bg"
        ? `${f(env, "loci")} устойчиви рискови огнища; най-устойчиво: ${f(env, "most_persistent")}.`
        : `${f(env, "loci")} persistent risk loci; most persistent: ${f(env, "most_persistent")}.`;
    case "benfordAnomalies":
      return lang === "bg"
        ? `Тест на Бенфорд за ${f(env, "parties_tested")} партии; най-голямо отклонение: ${f(env, "most_deviating")} (по-висок MAD = по-голямо отклонение, не е доказателство за измама).`
        : `Benford test across ${f(env, "parties_tested")} parties; largest deviation: ${f(env, "most_deviating")} (higher MAD = larger deviation, not proof of fraud).`;
    case "wastedVotes":
      return lang === "bg"
        ? `Прахосани под прага: ${f(env, "national_share")} национално; най-много в ${f(env, "top_region")}.`
        : `Wasted below threshold: ${f(env, "national_share")} nationally; most in ${f(env, "top_region")}.`;
    case "suspiciousSettlements":
      return lang === "bg"
        ? `${f(env, "concentrated")} места с концентриран вот, ${f(env, "invalid_ballots")} с високи невалидни, ${f(env, "additional_voters")} с дописани. Най-краен: ${f(env, "top_concentrated")}.`
        : `${f(env, "concentrated")} concentrated-vote, ${f(env, "invalid_ballots")} high-invalid, ${f(env, "additional_voters")} additional-voter settlements. Most extreme: ${f(env, "top_concentrated")}.`;
    case "diasporaVote":
      if (!env.facts.voters) return env.title;
      return lang === "bg"
        ? `Гласове в чужбина: ${f(env, "voters")} гласували; водач ${f(env, "leader")}.`
        : `Out-of-country vote: ${f(env, "voters")} voters; leader ${f(env, "leader")}.`;
    case "voterPersistence":
      if (!env.facts.national_stay_rate) return env.title;
      return lang === "bg"
        ? `Устойчивост ${f(env, "pair")}: ${f(env, "national_stay_rate")} останаха при същата партия; най-голямо преливане ${f(env, "top_defection")}.`
        : `Persistence ${f(env, "pair")}: ${f(env, "national_stay_rate")} stayed with the same party; top defection ${f(env, "top_defection")}.`;
    case "partyDemographics":
      if (!env.facts.party) return env.title;
      return lang === "bg"
        ? `${f(env, "party")}: най-силна положителна корелация с ${f(env, "strongest_positive")}; отрицателна с ${f(env, "strongest_negative")}.`
        : `${f(env, "party")}: strongest positive correlation with ${f(env, "strongest_positive")}; negative with ${f(env, "strongest_negative")}.`;
    case "demographicCleavages":
      return lang === "bg"
        ? `Най-силно разделящ показател: ${f(env, "most_divisive")}.`
        : `Most divisive metric: ${f(env, "most_divisive")}.`;
    case "mpLoyalty":
      if (!env.facts.most_loyal) return env.title;
      return lang === "bg"
        ? `Най-лоялен депутат: ${f(env, "most_loyal")}; най-малко: ${f(env, "least_loyal")}.`
        : `Most loyal MP: ${f(env, "most_loyal")}; least: ${f(env, "least_loyal")}.`;
    case "mpAttendance":
      if (!env.facts.best_attendance) return env.title;
      return lang === "bg"
        ? `Най-високо присъствие: ${f(env, "best_attendance")}; най-ниско: ${f(env, "worst_attendance")}.`
        : `Best attendance: ${f(env, "best_attendance")}; worst: ${f(env, "worst_attendance")}.`;
    case "factionCohesion":
      if (!env.facts.most_cohesive) return env.title;
      return lang === "bg"
        ? `Най-сплотена група: ${f(env, "most_cohesive")}; най-малко: ${f(env, "least_cohesive")}.`
        : `Most cohesive group: ${f(env, "most_cohesive")}; least: ${f(env, "least_cohesive")}.`;
    case "mpVotingProfile":
      if (!env.facts.name) return env.title;
      return lang === "bg"
        ? `${f(env, "name")}${env.facts.party ? ` (${f(env, "party")})` : ""}: лоялност ${f(env, "loyalty")}, присъствие ${f(env, "attendance")}.`
        : `${f(env, "name")}${env.facts.party ? ` (${f(env, "party")})` : ""}: loyalty ${f(env, "loyalty")}, attendance ${f(env, "attendance")}.`;
    case "mpSimilarity":
      if (!env.facts.closest) return env.title;
      return lang === "bg"
        ? `Най-близо до ${f(env, "mp")} гласува ${f(env, "closest")}.`
        : `Closest to ${f(env, "mp")} votes ${f(env, "closest")}.`;
    case "voteSearch":
      if (!env.facts.matches) return env.title;
      return lang === "bg"
        ? `${f(env, "matches")} гласувания; начело: ${f(env, "top")}.`
        : `${f(env, "matches")} votes; top: ${f(env, "top")}.`;
    case "partyMps":
      if (env.facts.count == null)
        return env.facts.available
          ? lang === "bg"
            ? `${env.title}. Налични групи: ${f(env, "available")}.`
            : `${env.title}. Available groups: ${f(env, "available")}.`
          : env.title;
      return lang === "bg"
        ? `${f(env, "group")} в ${f(env, "ns")}: ${f(env, "count")} депутати — ${f(env, "members")}`
        : `${f(env, "group")} in the ${f(env, "ns")}: ${f(env, "count")} MPs — ${f(env, "members")}`;
    case "schoolScores":
      if (!env.facts.top_school) return env.title;
      return lang === "bg"
        ? `Най-добро училище по ${f(env, "subject")} в ${f(env, "place")}: ${f(env, "top_school")} (от ${f(env, "schools")} училища).`
        : `Top school by ${f(env, "subject")} in ${f(env, "place")}: ${f(env, "top_school")} (of ${f(env, "schools")}).`;
    case "yearCompare": {
      // a multi-election year fanned out into one comparison (bar or table)
      const hi = f(env, "highest");
      const lo = f(env, "lowest");
      if (hi && lo)
        return lang === "bg"
          ? `${env.title}: най-високо ${hi}, най-ниско ${lo}.`
          : `${env.title}: highest ${hi}, lowest ${lo}.`;
      return env.subtitle ? `${env.title} — ${env.subtitle}.` : env.title;
    }
    case "roadsSpending":
      if (!env.facts.total_value) return env.title;
      return lang === "bg"
        ? `АПИ е възложила ${f(env, "total_value")} по ${f(env, "contracts")} договора (${f(env, "single_bid_share")} с една оферта, ${f(env, "direct_award_share")} без търг). Най-голям коридор: ${f(env, "top_corridor")}; пик: ${f(env, "peak_year")}. Най-„заключен“ пазар: ${f(env, "most_captured_work")}.`
        : `АПИ awarded ${f(env, "total_value")} across ${f(env, "contracts")} contracts (${f(env, "single_bid_share")} single-bid, ${f(env, "direct_award_share")} direct). Largest corridor: ${f(env, "top_corridor")}; peak year: ${f(env, "peak_year")}. Most captured market: ${f(env, "most_captured_work")}.`;
    case "schoolMatura": {
      if (!env.facts.matura_bel) return env.title;
      const pctPart = env.facts.percentile
        ? lang === "bg"
          ? ` — по-добре от ${f(env, "percentile")}% от училищата`
          : ` — above ${f(env, "percentile")}% of schools`
        : "";
      const ctxPart = env.facts.context
        ? lang === "bg"
          ? ` Средата на общината е ${f(env, "context")} (индекс ${f(env, "context_index")}).`
          : ` The municipality's context is ${f(env, "context")} (index ${f(env, "context_index")}).`
        : "";
      return lang === "bg"
        ? `${f(env, "school")} има среден успех ${f(env, "matura_bel")} на матурата по БЕЛ през ${f(env, "year")} г. (${f(env, "graduates")} зрелостници)${pctPart}.${ctxPart}`
        : `${f(env, "school")} averaged ${f(env, "matura_bel")} on the ${f(env, "year")} Bulgarian matura (${f(env, "graduates")} graduates)${pctPart}.${ctxPart}`;
    }
    default:
      return env.title;
  }
};
