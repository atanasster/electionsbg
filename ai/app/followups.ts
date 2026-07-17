// Context-aware follow-up questions derived deterministically from an answer's
// tool + entities. Every suggestion is phrased so the router maps it to a real
// tool (so clicking it always works). Falls back to broad starters.

import type { Envelope } from "../tools/types";

export type FollowUp = { bg: string; en: string };

const fact = (env: Envelope, key: string): string | undefined =>
  env.facts?.[key] != null ? String(env.facts[key]) : undefined;

// "in {place}" with Bulgarian euphony: "във" before names starting with в/ф.
const vIn = (name: string): string =>
  `${/^[вфВФ]/.test(name.trim()) ? "във" : "в"} ${name}`;

export const followUps = (env: Envelope): FollowUp[] => {
  const party = fact(env, "party");
  const oblast = fact(env, "oblast") ?? fact(env, "strongest");
  const agency = fact(env, "agency") ?? fact(env, "most_accurate");
  const name = fact(env, "name") ?? fact(env, "mp");
  const out: FollowUp[] = [];

  switch (env.tool) {
    case "partyResult":
      if (party) {
        out.push({
          bg: `Къде е силна ${party}?`,
          en: `Where is ${party} strongest?`,
        });
        out.push({
          bg: `Кой гласува за ${party}?`,
          en: `Who votes for ${party}?`,
        });
      }
      break;
    case "partyTimeline":
      if (party)
        out.push({
          bg: `Къде е силна ${party}?`,
          en: `Where is ${party} strongest?`,
        });
      out.push({
        bg: "Какви са резултатите от последните избори?",
        en: "Results of the latest election?",
      });
      break;
    case "regionBreakdown": {
      // drill into the municipalities of the party's strongest oblast
      const strong = (fact(env, "strongest") ?? "")
        .replace(/\s*\(.*\)$/, "")
        .trim();
      if (party && strong)
        out.push({
          bg: `${party} по общини ${vIn(strong)}`,
          en: `${party} by municipality in ${strong}`,
        });
      if (party)
        out.push({
          bg: `Как се представя ${party} през годините?`,
          en: `How has ${party} done over the years?`,
        });
      out.push({
        bg: "Каква беше активността?",
        en: "What was the turnout?",
      });
      break;
    }
    case "municipalityBreakdown": {
      // drill into the settlements of the strongest municipality
      const strong = (fact(env, "strongest") ?? "")
        .replace(/\s*\(.*\)$/, "")
        .trim();
      if (party && strong)
        out.push({
          bg: `${party} по населени места в община ${strong}`,
          en: `${party} by settlement in ${strong} municipality`,
        });
      if (party && oblast)
        out.push({
          bg: `Къде е силна ${party}?`,
          en: `Where is ${party} strongest?`,
        });
      break;
    }
    case "settlementBreakdown":
      if (party)
        out.push({
          bg: `Къде е силна ${party}?`,
          en: `Where is ${party} strongest?`,
        });
      break;
    case "nationalResults":
      out.push({ bg: "Каква беше активността?", en: "What was the turnout?" });
      out.push({
        bg: "Покажи резултатите по области.",
        en: "Show the results by region.",
      });
      out.push({ bg: "Къде е силна ГЕРБ?", en: "Where is GERB strongest?" });
      out.push({
        bg: "Сравни последните избори",
        en: "Compare the recent elections",
      });
      break;
    case "regionWinners":
      out.push({
        bg: "Какви са резултатите от последните избори?",
        en: "Results of the latest election?",
      });
      out.push({ bg: "Къде е силна ГЕРБ?", en: "Where is GERB strongest?" });
      break;
    case "municipalityWinners":
      out.push({
        bg: "Покажи резултатите по области.",
        en: "Show the results by region.",
      });
      out.push({ bg: "Къде е силна ГЕРБ?", en: "Where is GERB strongest?" });
      break;
    case "settlementWinners": {
      const place = fact(env, "place");
      if (place)
        out.push({
          bg: `Покажи резултатите по секции ${vIn(place)}`,
          en: `Show the results by polling station in ${place}`,
        });
      out.push({
        bg: "Покажи резултатите по области.",
        en: "Show the results by region.",
      });
      break;
    }
    case "sectionWinners":
      out.push({
        bg: "Покажи резултатите по области.",
        en: "Show the results by region.",
      });
      out.push({
        bg: "Какви са резултатите от последните избори?",
        en: "Results of the latest election?",
      });
      break;
    case "sectionResults": {
      const sec = fact(env, "section");
      if (sec)
        out.push({
          bg: `Как е гласувала секция ${sec} през годините?`,
          en: `How has section ${sec} voted over the years?`,
        });
      out.push({
        bg: "Покажи резултатите по области.",
        en: "Show the results by region.",
      });
      break;
    }
    case "sectionHistory": {
      const sec = fact(env, "section");
      if (sec)
        out.push({
          bg: `Какви са резултатите в секция ${sec}?`,
          en: `What are the results in section ${sec}?`,
        });
      out.push({
        bg: "Какви са резултатите от последните избори?",
        en: "Results of the latest election?",
      });
      break;
    }
    case "settlementResults": {
      // facts.settlement keeps the BG "с."/"гр." marker, so the trend cross-jump
      // routes back to settlementHistory.
      const place = fact(env, "settlement");
      if (place)
        out.push({
          bg: `Резултатите в ${place} за последните 5 години`,
          en: `Results in ${place} over the last 5 years`,
        });
      out.push({
        bg: "Покажи резултатите по области.",
        en: "Show the results by region.",
      });
      break;
    }
    case "settlementHistory": {
      const place = fact(env, "settlement");
      if (place)
        out.push({
          bg: `Резултатите в ${place}`,
          en: `Results in ${place}`,
        });
      out.push({
        bg: "Какви са резултатите от последните избори?",
        en: "Results of the latest election?",
      });
      break;
    }
    case "municipalityResults": {
      // the "община" prefix routes the cross-jump back to municipalityHistory
      const place = fact(env, "municipality");
      if (place)
        out.push({
          bg: `Резултатите в община ${place} за последните 5 години`,
          en: `Results in ${place} municipality over the last 5 years`,
        });
      out.push({
        bg: "Покажи резултатите по области.",
        en: "Show the results by region.",
      });
      break;
    }
    case "municipalityHistory": {
      const place = fact(env, "municipality");
      if (place)
        out.push({
          bg: `Резултатите в община ${place}`,
          en: `Results in ${place} municipality`,
        });
      out.push({
        bg: "Какви са резултатите от последните избори?",
        en: "Results of the latest election?",
      });
      break;
    }
    case "regionResults":
      out.push({
        bg: "Какви са резултатите от последните избори?",
        en: "Results of the latest election?",
      });
      out.push({
        bg: "Покажи резултатите по области.",
        en: "Show the results by region.",
      });
      break;
    case "regionResultsTrend":
      out.push({
        bg: "Какви са резултатите от последните избори?",
        en: "Results of the latest election?",
      });
      break;
    case "parliamentSeats":
      out.push({
        bg: "Как се променят местата по партии последните 5 години?",
        en: "How have seats per party changed over the last 5 years?",
      });
      out.push({
        bg: "Какви са резултатите от последните избори?",
        en: "Results of the latest election?",
      });
      out.push({
        bg: "Кои депутати са най-богати?",
        en: "Which MPs are richest?",
      });
      break;
    case "seatsHistory":
      out.push({
        bg: "Колко места има всяка партия в парламента сега?",
        en: "How many seats does each party hold in parliament now?",
      });
      out.push({
        bg: "Какви са резултатите от последните избори?",
        en: "Results of the latest election?",
      });
      break;
    case "turnout":
      out.push({
        bg: "Как се променя активността през годините?",
        en: "How has turnout changed over time?",
      });
      out.push({
        bg: "Какъв беше делът на машинното гласуване?",
        en: "What was the machine-voting share?",
      });
      break;
    case "turnoutSeries":
      out.push({
        bg: "Какви са резултатите от последните избори?",
        en: "Results of the latest election?",
      });
      break;
    case "machineVoteShare":
    case "machineVoteSeries":
      out.push({ bg: "Каква беше активността?", en: "What was the turnout?" });
      break;
    case "compareElections":
      out.push({
        bg: "Какви са резултатите от последните избори?",
        en: "Results of the latest election?",
      });
      break;
    case "regionHistory":
      if (oblast)
        out.push({
          bg: `Къде е силна ГЕРБ?`,
          en: `Where is GERB strongest?`,
        });
      break;
    case "electionAnomalies":
      out.push({
        bg: "Какъв е индексът на изборния риск?",
        en: "What is the election risk index?",
      });
      out.push({
        bg: "Къде отидоха гласовете на последните избори?",
        en: "Where did the votes go in the latest election?",
      });
      break;
    case "problemSections":
      out.push({
        bg: "Коя партия печели ромския вот последните 5 години?",
        en: "Which party wins the Roma vote over the last 5 years?",
      });
      out.push({
        bg: "Какъв е индексът на изборния риск?",
        en: "What is the election risk index?",
      });
      out.push({
        bg: "Кои населени места са съмнителни?",
        en: "Which settlements are suspicious?",
      });
      break;
    case "romaVoteTrend":
      out.push({
        bg: "Как гласуват ромските квартали сега?",
        en: "How do the Roma neighbourhoods vote now?",
      });
      out.push({
        bg: "Има ли устойчиви рискови огнища?",
        en: "Are there persistent risk loci?",
      });
      break;
    case "riskIndex":
      out.push({
        bg: "Колко критични секции има?",
        en: "How many critical sections?",
      });
      out.push({
        bg: "Какво показва тестът на Бенфорд?",
        en: "What does the Benford test show?",
      });
      out.push({
        bg: "Кои населени места са съмнителни?",
        en: "Which settlements are suspicious?",
      });
      break;
    case "riskScore":
      out.push({
        bg: "Какъв е индексът на изборния риск?",
        en: "What is the election risk index?",
      });
      out.push({
        bg: "Има ли клъстери на изборния риск?",
        en: "Are there election-risk clusters?",
      });
      out.push({
        bg: "Какво показва тестът на Бенфорд?",
        en: "What does the Benford test show?",
      });
      break;
    case "riskClusters":
      out.push({
        bg: "Кои места са с устойчив изборен риск?",
        en: "Which places have persistent election risk?",
      });
      break;
    case "wastedVotes":
    case "suspiciousSettlements":
      out.push({
        bg: "Как гласуват ромските квартали?",
        en: "How do the Roma neighbourhoods vote?",
      });
      break;
    case "partyDemographics":
      out.push({
        bg: "Какво разделя гласоподавателите?",
        en: "What divides the electorate?",
      });
      break;
    case "voterPersistence":
      out.push({
        bg: "Къде отидоха гласовете на последните избори?",
        en: "Where did the votes go in the latest election?",
      });
      break;
    case "mpLoyalty":
      out.push({
        bg: "Кои депутати отсъстват най-много?",
        en: "Which MPs are most absent?",
      });
      out.push({
        bg: "Коя група гласува най-единно?",
        en: "Which group votes most cohesively?",
      });
      break;
    case "mpAttendance":
      out.push({
        bg: "Кои депутати са най-лоялни?",
        en: "Which MPs are most loyal?",
      });
      break;
    case "factionCohesion":
      out.push({
        bg: "Кои депутати са най-лоялни?",
        en: "Which MPs are most loyal?",
      });
      break;
    case "mpVotingProfile":
      if (name)
        out.push({
          bg: `Кой гласува като ${name}?`,
          en: `Who votes like ${name}?`,
        });
      break;
    case "partyMps":
      // Safe, always-routable follow-ups (the group's full name wouldn't be
      // recognised as a party token, so don't echo it back into a question).
      out.push({
        bg: "Колко места има всяка партия в парламента?",
        en: "How many seats does each party hold in parliament?",
      });
      out.push({
        bg: "Кои депутати са най-лоялни?",
        en: "Which MPs are most loyal?",
      });
      break;
    case "pollAccuracy":
      if (agency)
        out.push({
          bg: `Колко е точна ${agency}?`,
          en: `How accurate is ${agency}?`,
        });
      out.push({
        bg: "Какво показват последните проучвания?",
        en: "What do the latest polls show?",
      });
      break;
    case "agencyProfile":
      if (agency)
        out.push({
          bg: `История на проучванията на ${agency}`,
          en: `${agency} poll history`,
        });
      out.push({
        bg: "Коя социологическа агенция е най-точна?",
        en: "Which polling agency is most accurate?",
      });
      break;
    case "agencyPolls":
      if (agency)
        out.push({
          bg: `Как се променя точността на ${agency} през годините?`,
          en: `How has ${agency}'s accuracy changed over time?`,
        });
      out.push({
        bg: "Какво показват последните проучвания?",
        en: "What do the latest polls show?",
      });
      break;
    case "agencyAccuracyHistory":
      if (agency)
        out.push({
          bg: `История на проучванията на ${agency}`,
          en: `${agency} poll history`,
        });
      out.push({
        bg: "Как се променя точността на агенциите през годините?",
        en: "How has pollster accuracy changed over the years?",
      });
      break;
    case "accuracyTrend":
      out.push({
        bg: "Коя социологическа агенция е най-точна?",
        en: "Which polling agency is most accurate?",
      });
      out.push({
        bg: "Какво показват последните проучвания?",
        en: "What do the latest polls show?",
      });
      break;
    case "budgetOverview":
      out.push({
        bg: "За какво се харчи бюджетът?",
        en: "What is the budget spent on?",
      });
      out.push({
        bg: "Какво става, ако ДДС стане 22%?",
        en: "What if VAT goes to 22%?",
      });
      out.push({
        bg: "Кои са най-големите инвестиционни проекти?",
        en: "Biggest investment projects?",
      });
      break;
    case "simulateTaxChange":
      out.push({
        bg: "Колко струва необлагаем минимум от 620 €?",
        en: "What is the cost of a tax-free minimum of €620?",
      });
      out.push({
        bg: "Какво става, ако ДДС върху храните стане 9%?",
        en: "What if food VAT goes to 9%?",
      });
      out.push({
        bg: "Какъв е държавният бюджет?",
        en: "What is the state budget?",
      });
      break;
    case "governments":
      out.push({
        bg: "Кои министри са най-богати?",
        en: "Which ministers are richest?",
      });
      break;
    case "mpAssetsTop":
      out.push({
        bg: "Кои депутати имат най-много фирмени връзки?",
        en: "Which MPs have the most company ties?",
      });
      break;
    case "localCouncilVoteShare":
    case "localMayorsWon":
      out.push({
        bg: "Кой е кметът на Пловдив?",
        en: "Who is the mayor of Plovdiv?",
      });
      break;
    case "priceIndex":
      out.push({
        bg: "Кой град е най-евтин за пазаруване?",
        en: "Which town is cheapest to shop in?",
      });
      out.push({
        bg: "Коя верига е най-евтина?",
        en: "Which retail chain is the cheapest?",
      });
      out.push({
        bg: "Къде поскъпнаха цените най-много?",
        en: "Where did prices rise the most?",
      });
      break;
    case "settlementPrices": {
      const place = fact(env, "place");
      if (place)
        out.push({
          bg: `Коя верига е най-евтина ${vIn(place)}?`,
          en: `Which chain is cheapest in ${place}?`,
        });
      out.push({
        bg: "Колко поскъпна кошницата от въвеждането на еврото?",
        en: "How much has the basket risen since the euro?",
      });
      out.push({
        bg: "Кой град е най-евтин за пазаруване?",
        en: "Which town is cheapest to shop in?",
      });
      break;
    }
    case "cheapestChains":
      out.push({
        bg: "Кой град е най-евтин за пазаруване?",
        en: "Which town is cheapest to shop in?",
      });
      out.push({
        bg: "Колко поскъпна кошницата от въвеждането на еврото?",
        en: "How much has the basket risen since the euro?",
      });
      break;
    case "priceRanking":
      out.push({
        bg: "Колко поскъпна кошницата от въвеждането на еврото?",
        en: "How much has the basket risen since the euro?",
      });
      out.push({
        bg: "Коя верига е най-евтина?",
        en: "Which retail chain is the cheapest?",
      });
      out.push({
        bg: "Къде е най-достъпна кошницата спрямо доходите?",
        en: "Where is the basket most affordable relative to income?",
      });
      break;
    case "basketAffordability": {
      const place = fact(env, "place");
      if (place)
        out.push({
          bg: `Какви са цените ${vIn(place)}?`,
          en: `What are the prices in ${place}?`,
        });
      out.push({
        bg: "Кой град е най-евтин за пазаруване?",
        en: "Which town is cheapest to shop in?",
      });
      out.push({
        bg: "Изпреварва ли кошницата официалната инфлация?",
        en: "Is the basket outpacing official inflation?",
      });
      break;
    }
    case "basketVsInflation":
      out.push({
        bg: "Каква е инфлацията?",
        en: "What's inflation?",
      });
      out.push({
        bg: "Къде е най-достъпна кошницата спрямо доходите?",
        en: "Where is the basket most affordable relative to income?",
      });
      out.push({
        bg: "Колко поскъпна кошницата от въвеждането на еврото?",
        en: "How much has the basket risen since the euro?",
      });
      break;
    case "partyFinance":
      if (party) {
        out.push({
          bg: `Как се представя ${party} през годините?`,
          en: `How has ${party} done over the years?`,
        });
        out.push({
          bg: `Къде е силна ${party}?`,
          en: `Where is ${party} strongest?`,
        });
      }
      break;
    case "companyConnections":
      out.push({
        bg: "Поръчки към фирми, свързани с депутати",
        en: "Procurement to MP-connected companies",
      });
      out.push({
        bg: "Кои са най-големите изпълнители по обществени поръчки?",
        en: "Who are the biggest public-procurement contractors?",
      });
      break;
    case "topContractors":
      out.push({
        bg: "Покажи договорите на Софарма трейдинг",
        en: "Show the contracts won by Sofarma Trading",
      });
      out.push({
        bg: "Поръчки към фирми, свързани с депутати",
        en: "Procurement to MP-connected companies",
      });
      break;
    case "contractSearch":
      out.push({
        bg: "Кои са най-големите изпълнители по обществени поръчки?",
        en: "Who are the biggest public-procurement contractors?",
      });
      out.push({
        bg: "Поръчки към фирми, свързани с депутати",
        en: "Procurement to MP-connected companies",
      });
      break;
    case "mpProcurement":
      out.push({
        bg: "Кои са най-големите изпълнители по обществени поръчки?",
        en: "Who are the biggest public-procurement contractors?",
      });
      out.push({
        bg: "Свързана ли е фирма с ЕИК 831646048 с депутати?",
        en: "Is the company with EIK 831646048 connected to MPs?",
      });
      break;
    case "euComparison":
      out.push({ bg: "Макроикономически преглед", en: "Macro snapshot" });
      out.push({
        bg: "Държавният дълг спрямо ЕС",
        en: "Government debt vs the EU",
      });
      break;
    case "revenueBreakdown":
      out.push({
        bg: "Държавен бюджет — изпълнение",
        en: "State budget execution",
      });
      out.push({
        bg: "Деклариран ДДС по сектор",
        en: "Declared VAT by sector",
      });
      break;
    case "fundsProjects":
      out.push({
        bg: "Топ бенефициенти на европейски средства",
        en: "Top EU funds beneficiaries",
      });
      out.push({
        bg: "Колко са обществените поръчки?",
        en: "How much public procurement is there?",
      });
      break;
    case "municipalTransfers":
      out.push({
        bg: "Държавен бюджет — изпълнение",
        en: "State budget execution",
      });
      out.push({ bg: "Бюджет по функция", en: "Budget by function" });
      break;
    case "mrrbSpending":
      out.push({
        bg: "Усвоени ли са парите по „Развитие на регионите“?",
        en: "Are the „Развитие на регионите“ funds absorbed?",
      });
      out.push({
        bg: "Европейски средства по области",
        en: "EU funds by oblast",
      });
      break;
    case "cohesionAbsorption":
      out.push({
        bg: "Коя област получава най-много европейски пари на човек?",
        en: "Which oblast gets the most EU money per capita?",
      });
      out.push({ bg: "Поръчки на МРРБ", en: "МРРБ procurement" });
      break;
    case "regionalInvestment":
      out.push({
        bg: "Усвоени ли са кохезионните средства?",
        en: "Are the cohesion funds absorbed?",
      });
      out.push({
        bg: "БВП на човек по области",
        en: "GDP per capita by oblast",
      });
      break;
    case "localVoteFlows":
      out.push({
        bg: "Вот за общинските съвети",
        en: "Council results at the local elections",
      });
      out.push({
        bg: "Преливане на гласове на парламентарните избори",
        en: "Vote flow between the last two elections",
      });
      break;
  }

  if (out.length === 0) {
    out.push(
      {
        bg: "Какви са резултатите от последните избори?",
        en: "Results of the latest election?",
      },
      {
        bg: "Как се променя активността през годините?",
        en: "How has turnout changed over time?",
      },
    );
  }
  return out.slice(0, 3);
};
