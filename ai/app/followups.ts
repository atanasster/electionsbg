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
      out.push({
        bg: "Коя социологическа агенция е най-точна?",
        en: "Which polling agency is most accurate?",
      });
      break;
    case "budgetOverview":
      out.push({
        bg: "За какво се харчи бюджетът?",
        en: "What is the budget spent on?",
      });
      out.push({
        bg: "Кои са най-големите инвестиционни проекти?",
        en: "Biggest investment projects?",
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
