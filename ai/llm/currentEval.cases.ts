import type { EvalCase } from "./currentEval";
// Authored independently of registry examples. Frozen before the baseline run.
// Holdout cases are not used to tune descriptions; report them separately.
const rows: [string, string, string, Record<string, (string | number)[]>?][] = [
  [
    "contractSearch",
    "List 4 contracts won by EIK 831646048 in 2024.",
    "Покажи 4 договора, спечелени от ЕИК 831646048 през 2024.",
    { company: ["831646048"], count: [4], year: [2024] },
  ],
  [
    "presidentialResults",
    "Show the first round of the 2016 presidential vote.",
    "Покажи първия тур на президентския вот през 2016.",
    { cycle: [2016], round: [1] },
  ],
  [
    "municipalFiscalRanking",
    "Rank 8 municipalities by overdue liabilities in 2024.",
    "Подреди 8 общини по просрочени задължения през 2024.",
    { year: [2024], count: [8], metric: ["arrears"] },
  ],
  [
    "municipalFiscalRanking",
    "Rank municipalities by expense obligations in 2023.",
    "Подреди общините по задължения за разходи през 2023.",
    { year: [2023], metric: ["expense_obligations"] },
  ],
  [
    "regionWinners",
    "I want the winning parties across administrative provinces, not electoral districts.",
    "Искам водещите партии по административни области, не по МИР.",
    { geography: ["oblast"] },
  ],
  [
    "machineVoteSeries",
    "Give me machine vote shares for the most recent 4 elections.",
    "Дай дяловете на машинния вот за последните 4 избора.",
    { n: [4] },
  ],
  [
    "turnout",
    "Tell me turnout in 2024, covering the year without choosing one ballot.",
    "Кажи активността през 2024, за годината без да избираш само един вот.",
    { election: ["2024"] },
  ],
  [
    "tenderLookup",
    "Look up procurement procedure 00044-2025-0125.",
    "Намери процедура с УНП 00044-2025-0125.",
    { unp: ["00044-2025-0125"] },
  ],
  [
    "ngoBySignal",
    "List NGOs with a foreign-funding signal.",
    "Изброй НПО със сигнал за чуждестранно финансиране.",
    { code: ["foreign_funded"] },
  ],
  [
    "nzokPrivateHospitals",
    "Which 6 private hospitals have no tenders?",
    "Кои 6 частни болници нямат обществени поръчки?",
    { filter: ["notenders"], count: [6] },
  ],
  [
    "mpAttendance",
    "Which members were absent most in the 51st National Assembly?",
    "Кои депутати отсъстваха най-много в 51-вото Народно събрание?",
    { ns: [51] },
  ],
  [
    "subsidiesOverview",
    "Show agricultural subsidy recipients for financial year 2023.",
    "Покажи получателите на земеделски субсидии за финансова 2023 година.",
    { year: [2023] },
  ],
  [
    "budgetMinistries",
    "Compare the budgets of all ministries for 2024.",
    "Сравни бюджетите на всички министерства за 2024.",
    { year: [2024] },
  ],
  [
    "budgetPersonnelByMinistry",
    "Break down personnel costs by ministry for 2024.",
    "Разпредели разходите за персонал по министерства за 2024.",
    { year: [2024] },
  ],
  [
    "openCalls",
    "Our NGO wants to apply for funding now. Which calls are accepting applications?",
    "Нашето НПО иска да кандидатства за финансиране сега. Кои приеми са отворени?",
  ],
  [
    "personWealth",
    "What assets did the politician Asen Vasilev declare?",
    "Какви активи е декларирал политикът Асен Василев?",
    { name: ["Asen Vasilev", "Асен Василев"] },
  ],
  [
    "councilResolutions",
    "I need decisions adopted by Ruse municipal council.",
    "Трябват ми решенията, приети от общинския съвет в Русе.",
    { place: ["Ruse", "Русе"] },
  ],
  [
    "schoolScores",
    "Compare matura results across schools in Burgas.",
    "Сравни резултатите от матурите по училища в Бургас.",
    { place: ["Burgas", "Бургас"] },
  ],
  [
    "municipalityResults",
    'Previous tool: partyResult, args: {"party":"ГЕРБ","election":"2024"}\nCurrent question: And in Varna municipality?',
    'Предишен инструмент: partyResult, args: {"party":"ГЕРБ","election":"2024"}\nТекущ въпрос: А в община Варна?',
    { party: ["GERB", "ГЕРБ"], election: ["2024"], place: ["Varna", "Варна"] },
  ],
  [
    "localTaxes",
    'Previous tool: partyResult, args: {"party":"ГЕРБ","election":"2024"}\nCurrent question: What are local tax rates in Pleven?',
    'Предишен инструмент: partyResult, args: {"party":"ГЕРБ","election":"2024"}\nТекущ въпрос: Какви са местните данъчни ставки в Плевен?',
    { place: ["Pleven", "Плевен"] },
  ],
  [
    "presidentialResults",
    "In 2021, how did the presidential runoff go in Varna province?",
    "През 2021 как мина президентският балотаж в област Варна?",
    { cycle: [2021], round: [2], oblast: ["Varna", "Варна"] },
  ],
  [
    "topContractors",
    "Show the 7 largest public procurement suppliers.",
    "Покажи 7-те най-големи доставчици по обществени поръчки.",
    { count: [7] },
  ],
  [
    "budgetVariance",
    "Compare the 2023 budget execution with its amended plan.",
    "Сравни изпълнението на бюджета за 2023 с уточнения план.",
    { year: [2023] },
  ],
  [
    "municipalFiscalRanking",
    "Show 5 municipalities with the largest commitments in 2023.",
    "Покажи 5 общини с най-големи поети ангажименти през 2023.",
    { year: [2023], count: [5], metric: ["commitments"] },
  ],
  [
    "companyConnections",
    "Find political links for company EIK 831646048.",
    "Намери политическите връзки на фирма с ЕИК 831646048.",
    { company: ["831646048"] },
  ],
  [
    "regionResults",
    'Previous tool: partyResult, args: {"party":"ГЕРБ","election":"2023"}\nCurrent question: And in Burgas province?',
    'Предишен инструмент: partyResult, args: {"party":"ГЕРБ","election":"2023"}\nТекущ въпрос: А в област Бургас?',
    {
      party: ["GERB", "ГЕРБ"],
      election: ["2023"],
      oblast: ["Burgas", "Бургас"],
    },
  ],
];
export const CHALLENGES: EvalCase[] = rows.map(([tool, en, bg, args], i) => ({
  id: `authored:${i + 1}`,
  group: i >= 20 ? "holdout" : "challenge",
  tool,
  en,
  bg,
  args,
}));
export const UNSUPPORTED: EvalCase[] = [
  [
    "Forecast tomorrow’s temperature in Sofia.",
    "Прогнозирай утрешната температура в София.",
  ],
  ["Write a recipe for chocolate cake.", "Напиши рецепта за шоколадова торта."],
  [
    "Send an email to the mayor on my behalf.",
    "Изпрати имейл до кмета от мое име.",
  ],
  ["Buy 100 shares of Apple for me.", "Купи ми 100 акции на Apple."],
  [
    "Delete every procurement record.",
    "Изтрий всички записи за обществени поръчки.",
  ],
  [
    "Who won the 2024 US presidential election?",
    "Кой спечели президентските избори в САЩ през 2024?",
  ],
].map(([en, bg], i) => ({
  id: `unsupported:${i + 1}`,
  group: "unsupported",
  tool: null,
  en,
  bg,
}));
