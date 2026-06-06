// M5 — synthesize a fine-tuning dataset of (question -> {tool,args}) pairs from
// the tool registry, so a small Bulgarian-native model (BgGPT/EuroLLM) becomes
// reliable at tool selection over the fixed tool surface (74 tools).
//
// Run: npx tsx ai/m5/gen_dataset.ts
// Writes chat-format JSONL (messages: system + user + assistant) to
// ai/m5/dataset/toolcalls.{train,eval}.jsonl — usable by HF/PEFT/unsloth/axolotl
// LoRA tooling, then convert the adapter and compile per ai/m0/README.md.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildToolTrainSystemPrompt } from "../orchestrator/prompts";
import { OBLASTS } from "../tools/place";

type Lang = "bg" | "en";
type Args = Record<string, string | number>;
type Ex = { lang: Lang; q: string; tool: string; args: Args };

const out: Ex[] = [];
const add = (lang: Lang, q: string, tool: string, args: Args = {}) =>
  out.push({ lang, q, tool, args });

// fill `{x}` in each phrasing with a token, for both languages
const expand = (
  tool: string,
  pool: { tok: string; args: Args }[],
  bg: string[],
  en: string[],
) => {
  for (const { tok, args } of pool) {
    for (const t of bg) add("bg", t.replace("{x}", tok), tool, args);
    for (const t of en) add("en", t.replace("{x}", tok), tool, args);
  }
};

// ---- entity pools -----------------------------------------------------------

const PARTIES = [
  "ГЕРБ",
  "ГЕРБ-СДС",
  "ПП-ДБ",
  "ДПС",
  "БСП",
  "Възраждане",
  "ИТН",
  "МЕЧ",
  "Величие",
  "ВМРО",
  "GERB",
  "DPS",
];
const PLACES = [
  "Пловдив",
  "Варна",
  "Бургас",
  "Русе",
  "Стара Загора",
  "Плевен",
  "Сливен",
  "Добрич",
  "Шумен",
  "Перник",
  "Хасково",
  "Благоевград",
  "Велико Търново",
  "Габрово",
  "Видин",
  "Кърджали",
  "Казанлък",
  "Асеновград",
];
const OBLAST_NAMES = [
  "Варна",
  "Пловдив",
  "Бургас",
  "Хасково",
  "Русе",
  "Стара Загора",
  "Велико Търново",
  "Благоевград",
  "Видин",
  "Сливен",
  "Плевен",
  "Шумен",
];
const AGENCIES = [
  "Алфа Рисърч",
  "Тренд",
  "Галъп",
  "Маркет ЛИНКС",
  "Сова Харис",
  "Медиана",
  "Екзакта",
];
const MINISTRIES = [
  "транспорта",
  "здравеопазването",
  "образованието",
  "отбраната",
  "финансите",
  "правосъдието",
  "енергетиката",
];
const MACRO = [
  "инфлацията",
  "безработицата",
  "БВП",
  "държавния дълг",
  "бедността",
  "доверието в правителството",
  "неравенството",
  "корупцията",
];
const CATEGORIES = [
  "икономика",
  "фискалните показатели",
  "управление",
  "обществото",
];
const YEAR_EL: Record<string, string> = {
  "2009": "2009_07_05",
  "2013": "2013_05_12",
  "2014": "2014_10_05",
  "2017": "2017_03_26",
  "2021": "2021_11_14",
  "2022": "2022_10_02",
  "2023": "2023_04_02",
  "2024": "2024_10_27",
};

const partyPool = PARTIES.map((p) => ({ tok: p, args: { party: p } }));
const placePool = PLACES.map((p) => ({ tok: p, args: { place: p } }));
const oblastPool = OBLAST_NAMES.map((o) => ({ tok: o, args: { oblast: o } }));

// ---- elections ---------------------------------------------------------------

expand(
  "partyResult",
  partyPool,
  [
    "Колко гласа взе {x}?",
    "Какъв е резултатът на {x}?",
    "Колко гласа събра {x} на последните избори?",
  ],
  ["How many votes did {x} get?", "What was {x}'s result?"],
);
expand(
  "partyTimeline",
  partyPool,
  [
    "Как се представя {x} през годините?",
    "Покажи историята на {x}",
    "{x} през всички избори",
  ],
  ["How has {x} performed over the years?", "Show {x} over time"],
);
expand(
  "regionBreakdown",
  partyPool,
  ["Къде е силна {x}?", "{x} по области", "В кои области печели {x}?"],
  ["Where is {x} strongest?", "{x} by oblast"],
);
for (const n of [5, 6, 7, 8, 10])
  expand(
    "machineVoteSeries",
    [{ tok: String(n), args: { n } }],
    [
      "Какъв е процентът машинно гласуване в последните {x} избора?",
      "Тренд на машинното гласуване за {x} избора",
    ],
    ["What's the machine-voting % in the last {x} elections?"],
  );
add(
  "bg",
  "Как се променя избирателната активност през годините?",
  "turnoutSeries",
);
add("en", "How has turnout changed over the years?", "turnoutSeries");
add("bg", "Тренд на активността", "turnoutSeries");
for (const [y, el] of Object.entries(YEAR_EL)) {
  expand(
    "machineVoteShare",
    [{ tok: y, args: { election: el } }],
    ["Какъв беше делът на машинното гласуване през {x}?"],
    ["Machine-voting share in {x}?"],
  );
  expand(
    "turnout",
    [{ tok: y, args: { election: el } }],
    ["Каква беше активността през {x}?"],
    ["What was the turnout in {x}?"],
  );
}
const yearPairs = [
  ["2022", "2024"],
  ["2021", "2023"],
  ["2023", "2024"],
  ["2017", "2021"],
];
for (const [a, b] of yearPairs)
  expand(
    "compareElections",
    [{ tok: `${a} и ${b}`, args: { a: YEAR_EL[a], b: YEAR_EL[b] } }],
    ["Сравни изборите от {x}", "Разлика между изборите {x}"],
    ["Compare the {x} elections"],
  );
add("bg", "Какви са резултатите от последните избори?", "nationalResults");
add("bg", "Кой спечели последните избори?", "nationalResults");
add("en", "What were the results of the latest election?", "nationalResults");
add("bg", "Имаше ли нередности на последните избори?", "electionAnomalies");
add("bg", "Сигнали за манипулации на изборите?", "electionAnomalies");
add("en", "Were there anomalies in the latest election?", "electionAnomalies");
add(
  "bg",
  "Кои партии загубиха най-много от липсваща флаш памет?",
  "flashMemoryByParty",
);
add("bg", "Машинни срещу флаш памет по партия", "flashMemoryByParty");
add(
  "en",
  "Which parties lost the most from missing flash memory?",
  "flashMemoryByParty",
);
expand(
  "regionHistory",
  oblastPool,
  [
    "Как се променя активността в {x}?",
    "Избирателната активност в {x} през годините",
  ],
  ["How has turnout changed in {x}?"],
);
add("bg", "Къде отидоха гласовете на последните избори?", "voteTransitions");
add("bg", "Преливане на гласове между изборите", "voteTransitions");
add("en", "Where did votes move in the latest election?", "voteTransitions");

// ---- polls ------------------------------------------------------------------

add("bg", "Коя социологическа агенция е най-точна?", "pollAccuracy");
add("bg", "Класация на агенциите по точност", "pollAccuracy");
add("en", "Which pollster is most accurate?", "pollAccuracy");
expand(
  "agencyProfile",
  AGENCIES.map((a) => ({ tok: a, args: { agency: a } })),
  ["Колко е точна {x}?", "Профил на {x}", "Каква е грешката на {x}?"],
  ["How accurate is {x}?", "Profile of {x}"],
);
add("bg", "Какво показват последните проучвания?", "latestPolls");
add("bg", "Какво би станало ако изборите бяха сега?", "latestPolls");
add("en", "What do the latest polls show?", "latestPolls");

// ---- local elections --------------------------------------------------------

add("bg", "Кой спечели общинските съвети?", "localCouncilVoteShare");
add("en", "Who won the municipal councils?", "localCouncilVoteShare");
add("bg", "Колко кмета спечели ГЕРБ на местните избори?", "localMayorsWon");
add("bg", "Кметове по партия на местните избори", "localMayorsWon");
expand(
  "localMunicipality",
  placePool,
  ["Кой е кметът на {x}?", "Резултати за местните избори в {x}"],
  ["Who is the mayor of {x}?"],
);
expand(
  "localMayorRace",
  placePool,
  ["Кои бяха кандидатите за кмет на {x}?"],
  ["Who ran for mayor of {x}?"],
);
expand(
  "localCouncil",
  placePool,
  ["Какъв е общинският съвет на {x}?", "Състав на ОбС {x}"],
  ["What's the {x} council composition?"],
);
add("bg", "Има ли частични местни избори?", "chmiEvents");
add("en", "Any partial local elections?", "chmiEvents");

// ---- fiscal -----------------------------------------------------------------

add("bg", "Какъв е държавният бюджет?", "budgetOverview");
add("en", "What's the state budget?", "budgetOverview");
add("bg", "За какво се харчи бюджетът?", "budgetByFunction");
add("bg", "Бюджетни разходи по функция", "budgetByFunction");
add("bg", "Покажи изпълнението на бюджета по месеци", "budgetExecution");
add("en", "Show monthly budget execution", "budgetExecution");
expand(
  "ministryBudget",
  MINISTRIES.map((m) => ({ tok: m, args: { ministry: m } })),
  [
    "Какъв е бюджетът на министерството на {x}?",
    "Колко харчи министерството на {x}?",
  ],
  ["What's the budget of the ministry of {x}?"],
);
add("bg", "Кои са най-големите инвестиционни проекти?", "investmentProjects");
add("bg", "Колко са обществените поръчки?", "procurementTotals");
add("en", "How much public procurement is there?", "procurementTotals");
expand(
  "procurementBySettlement",
  placePool,
  ["Колко обществени поръчки има в {x}?"],
  ["How much procurement in {x}?"],
);
add("bg", "Кой получава най-много европейски средства?", "fundsOverview");
add("bg", "Какви са последните емисии на държавен дълг?", "govDebt");
add("bg", "Колко харчи НОИ за пенсии?", "noiFunds");

// ---- people -----------------------------------------------------------------

add("bg", "Кои са правителствата от 2005?", "governments");
add("en", "What governments since 2005?", "governments");
add("bg", "Кои депутати са най-богати?", "mpAssetsTop");
add("en", "Which MPs are richest?", "mpAssetsTop");
add("bg", "Кои депутати имат най-много фирмени връзки?", "mpConnectionsTop");
add("bg", "Кои министри са най-богати?", "officialsAssetsTop");
add("bg", "Партиите подават ли финансови отчети навреме?", "financingOverview");

// ---- indicators -------------------------------------------------------------

expand(
  "macroIndicator",
  MACRO.map((m) => ({ tok: m, args: { indicator: m } })),
  ["Каква е {x}?", "Покажи {x} през времето"],
  ["What is {x}?"],
);
add("bg", "Как е икономиката?", "macroOverview");
expand(
  "macroByCategory",
  CATEGORIES.map((c) => ({ tok: c, args: { category: c } })),
  ["Покажи показателите за {x}"],
  ["Show the {x} indicators"],
);
expand(
  "subnationalIndicator",
  placePool.slice(0, 10),
  ["Каква е безработицата в {x}?"],
  ["Unemployment in {x}?"],
);
expand(
  "regionIndicator",
  oblastPool,
  ["Какъв е БВП на човек във {x}?"],
  ["GDP per capita in {x}?"],
);
expand(
  "transparencyScore",
  placePool,
  ["Колко прозрачна е община {x}?"],
  ["How transparent is {x}?"],
);
expand(
  "localTaxes",
  placePool,
  ["Какви са данъците в {x}?", "Местни данъци в {x}"],
  ["What are the taxes in {x}?"],
);

// ---- place ------------------------------------------------------------------

expand(
  "governanceProfile",
  placePool,
  ["Разкажи ми за {x}", "Всичко за {x}"],
  ["Tell me about {x}"],
);
expand(
  "census",
  placePool,
  ["Колко жители има {x}?", "Етнически състав на {x}"],
  ["What's the population of {x}?"],
);
expand(
  "graoPopulation",
  placePool.slice(0, 10),
  ["Какво е регистрираното население на {x}?"],
  ["Registered population of {x}?"],
);
expand(
  "airQuality",
  placePool,
  ["Какъв е въздухът в {x}?", "Замърсяване на въздуха в {x}"],
  ["How's the air in {x}?"],
);
expand(
  "councilResolutions",
  placePool.slice(0, 12),
  ["Какво реши общинският съвет на {x}?"],
  ["What did {x} council decide?"],
);
add("bg", "Колко гора има в България?", "landUse");
add("en", "How much forest is in Bulgaria?", "landUse");
void OBLASTS; // OBLASTS kept available for future oblast-name expansion

// ---- extra phrasings for the no-arg tools (so they aren't under-represented) -

const more: [string, Lang, string][] = [
  ["Кои са най-скъпите инвестиционни проекти?", "bg", "investmentProjects"],
  ["Капиталови проекти на държавата", "bg", "investmentProjects"],
  ["Biggest capital projects?", "en", "investmentProjects"],
  ["Кои са топ бенефициентите по еврофондове?", "bg", "fundsOverview"],
  ["Усвояване на европейските средства", "bg", "fundsOverview"],
  ["Top EU-funds beneficiaries?", "en", "fundsOverview"],
  ["Какъв е държавният дълг?", "bg", "govDebt"],
  ["Емисии еврооблигации", "bg", "govDebt"],
  ["Government debt issuances?", "en", "govDebt"],
  ["Социалноосигурителни фондове", "bg", "noiFunds"],
  ["Изпълнение на бюджета на НОИ", "bg", "noiFunds"],
  ["Social-security funds?", "en", "noiFunds"],
  ["Депутати с най-много бизнес връзки", "bg", "mpConnectionsTop"],
  ["Кои народни представители имат най-много фирми?", "bg", "mpConnectionsTop"],
  ["MPs with the most company links?", "en", "mpConnectionsTop"],
  ["Най-богатите висши служители", "bg", "officialsAssetsTop"],
  ["Активи на министрите", "bg", "officialsAssetsTop"],
  ["Richest officials?", "en", "officialsAssetsTop"],
  ["Партийно финансиране", "bg", "financingOverview"],
  ["Кои партии не подадоха финансови отчети?", "bg", "financingOverview"],
  ["Party financing reports?", "en", "financingOverview"],
  ["Преглед на макроикономиката", "bg", "macroOverview"],
  ["Ключови икономически показатели", "bg", "macroOverview"],
  ["Macro snapshot?", "en", "macroOverview"],
  ["Кой спечели изборите?", "bg", "nationalResults"],
  ["Резултати по партии", "bg", "nationalResults"],
  ["Тренд на машинното гласуване", "bg", "machineVoteSeries"],
  ["Колко кмета има всяка партия?", "bg", "localMayorsWon"],
  ["Mayors won by party", "en", "localMayorsWon"],
];
for (const [q, lang, tool] of more) add(lang, q, tool);

// ---- write JSONL ------------------------------------------------------------

const toLine = (e: Ex): string =>
  JSON.stringify({
    messages: [
      { role: "system", content: buildToolTrainSystemPrompt(e.lang) },
      { role: "user", content: e.q },
      {
        role: "assistant",
        content: JSON.stringify({ tool: e.tool, args: e.args }),
      },
    ],
  });

// deterministic 90/10 split (every 10th example -> eval)
const train: string[] = [];
const evalSet: string[] = [];
out.forEach((e, i) => (i % 10 === 9 ? evalSet : train).push(toLine(e)));

const dir = join(dirname(new URL(import.meta.url).pathname), "dataset");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "toolcalls.train.jsonl"), train.join("\n") + "\n");
writeFileSync(join(dir, "toolcalls.eval.jsonl"), evalSet.join("\n") + "\n");

const byTool = new Map<string, number>();
out.forEach((e) => byTool.set(e.tool, (byTool.get(e.tool) ?? 0) + 1));
console.log(`Generated ${out.length} examples across ${byTool.size} tools`);
console.log(`  train: ${train.length}  eval: ${evalSet.length}`);
console.log(`  -> ${join(dir, "toolcalls.train.jsonl")}`);
const missing = Array.from(byTool.entries())
  .filter(([, c]) => c < 2)
  .map(([t]) => t);
if (missing.length) console.log(`  thin coverage (<2): ${missing.join(", ")}`);
