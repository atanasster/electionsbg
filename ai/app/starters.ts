// Starter prompts shown as chips under the composer (a random STARTER_COUNT
// sample, with already-asked prompts dropped). Deliberately larger than that
// count so the row stays full after dropping used ones.
//
// Every starter MUST route to a real tool — this is locked by the starter-
// routing guard in ai/tests/regression.ts. Kept in its own pure module (no React
// imports) so that guard can import it under node.

export type Starter = { bg: string; en: string };

export const STARTERS: Starter[] = [
  {
    bg: "Какъв е процентът машинно гласуване в последните 7 избора?",
    en: "What's the machine-voting % in the last 7 elections?",
  },
  {
    bg: "Как се представя ГЕРБ през годините?",
    en: "How has GERB performed over the years?",
  },
  {
    bg: "Какви са резултатите от последните избори?",
    en: "Results of the latest election?",
  },
  { bg: "Къде е силна ГЕРБ?", en: "Where is GERB strongest?" },
  {
    bg: "Покажи резултатите по области.",
    en: "Show the results by region.",
  },
  {
    bg: "Резултати по общини в Пловдив",
    en: "Results by municipality in Plovdiv",
  },
  {
    bg: "Резултати по населени места в община Несебър",
    en: "Results by settlement in Nesebar",
  },
  {
    bg: "Покажи резултатите по секции в Банско",
    en: "Show the results by polling station in Bansko",
  },
  {
    bg: "Резултатите в с. Иново",
    en: "Results in the village of Inovo",
  },
  {
    bg: "Резултатите в с. Иново за последните 5 години",
    en: "Results in the village of Inovo over the last 5 years",
  },
  {
    bg: "Резултатите в община Пловдив",
    en: "Results in Plovdiv municipality",
  },
  {
    bg: "Резултатите в област Варна за последните 5 години",
    en: "Results in Varna region over the last 5 years",
  },
  {
    bg: "Резултатите в София",
    en: "Results in Sofia",
  },
  {
    bg: "Резултатите в чужбина",
    en: "Results abroad",
  },
  {
    bg: "ГЕРБ по общини в Пловдив",
    en: "GERB by municipality in Plovdiv",
  },
  {
    bg: "Кои общини са с най-висока безработица?",
    en: "Which municipalities have the highest unemployment?",
  },
  {
    bg: "Колко места има всяка партия в парламента?",
    en: "How many seats does each party hold in parliament?",
  },
  {
    bg: "Как се променят местата по партии последните 5 години?",
    en: "How have seats per party changed over the last 5 years?",
  },
  {
    bg: "Кой печели гласа в чужбина последните години?",
    en: "Who wins the diaspora vote over recent years?",
  },
  {
    bg: "Как се променят кметовете по партии през годините?",
    en: "How have mayoralties per party changed across cycles?",
  },
  {
    bg: "Как се променя бюджетът през годините?",
    en: "How has the budget changed over the years?",
  },
  {
    bg: "Как се променят прахосаните гласове през годините?",
    en: "How have wasted votes changed over time?",
  },
  {
    bg: "Как се променя вотът за общинските съвети през годините?",
    en: "How has the council vote changed across cycles?",
  },
  {
    bg: "Кои са депутатите от ПП?",
    en: "Who are the MPs from PP?",
  },
  {
    bg: "Сравни изборите от 2022 и 2024",
    en: "Compare the 2022 and 2024 elections",
  },
  { bg: "Каква беше активността през 2023?", en: "What was turnout in 2023?" },
  { bg: "Какъв е държавният бюджет?", en: "What is the state budget?" },
  { bg: "За какво се харчи бюджетът?", en: "What is the budget spent on?" },
  { bg: "Кои депутати са най-богати?", en: "Which MPs are richest?" },
  {
    bg: "Кои са най-големите инвестиционни проекти?",
    en: "What are the biggest investment projects?",
  },
  {
    bg: "Коя социологическа агенция е най-точна?",
    en: "Which polling agency is most accurate?",
  },
  { bg: "Кои са правителствата от 2005?", en: "Governments since 2005?" },
  {
    bg: "Кой спечели общинските съвети?",
    en: "Who won the municipal councils?",
  },
  {
    bg: "Какъв е общинският съвет на София?",
    en: "What is the Sofia municipal council?",
  },
  {
    bg: "Имаше ли нередности на последните избори?",
    en: "Were there irregularities in the latest election?",
  },
  {
    bg: "Каква е оценката за изборния риск?",
    en: "What is the election risk index?",
  },
  {
    bg: "Коя партия печели ромските гласове последните 5 години?",
    en: "Which party wins the Roma vote over the last 5 years?",
  },
  {
    bg: "Колко поскъпна кошницата от въвеждането на еврото?",
    en: "How much has the basket risen since the euro?",
  },
  {
    bg: "Какви са цените в Пловдив?",
    en: "What are the prices in Plovdiv?",
  },
  {
    bg: "Колко струва млякото в Пловдив?",
    en: "How much is milk in Plovdiv?",
  },
  {
    bg: "Коя верига е най-евтина?",
    en: "Which retail chain is the cheapest?",
  },
  {
    bg: "Кой град е най-евтин за пазаруване?",
    en: "Which town is cheapest to shop in?",
  },
  {
    bg: "Къде поскъпнаха цените най-много от еврото?",
    en: "Where did prices rise the most since the euro?",
  },
  {
    bg: "Къде е най-достъпна кошницата спрямо доходите?",
    en: "Where is the basket most affordable relative to income?",
  },
  {
    bg: "Изпреварва ли кошницата официалната инфлация?",
    en: "Is the basket outpacing official inflation?",
  },
];
