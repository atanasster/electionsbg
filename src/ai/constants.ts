export type Language = "en" | "bg";

export type PromptQuestion = {
  [key in Language]: string;
};

export type PromptCategory = {
  topic: {
    [key in Language]: string;
  };
  questions: PromptQuestion[];
};

export const selectableParties = [
  { id: "gerb-sds", name: { en: "GERB-SDS", bg: "ГЕРБ-СДС" } },
  { id: "pp-db", name: { en: "PP-DB", bg: "ПП-ДБ" } },
  {
    id: "mrf",
    name: {
      en: "Movement for Rights and Freedoms",
      bg: "Движение за права и свободи",
    },
  },
  {
    id: "progress-party",
    name: { en: "Progress Party", bg: "Партия на Прогреса" },
  },
  { id: "civic-union", name: { en: "Civic Union", bg: "Граждански съюз" } },
];

export const prompts: Record<string, PromptCategory> = {
  fairness: {
    topic: {
      en: "Fairness & Anomaly Detection",
      bg: "Справедливост и Откриване на Аномалии",
    },
    questions: [
      {
        en: "Show me all polling stations from the 2023 election with a voter turnout over 95%.",
        bg: "Покажи ми всички избирателни секции от изборите през 2023 г. с избирателна активност над 95%.",
      },
      {
        en: "List the sections with the largest discrepancy between the initial vote count and the recount.",
        bg: "Изброй секциите с най-голямо несъответствие между първоначалното и повторното преброяване.",
      },
      {
        en: "Find polling stations where more than 10% of the votes came from voters on the additional list.",
        bg: "Намери избирателни секции, където повече от 10% от гласовете са дошли от гласоподаватели от допълнителния списък.",
      },
      {
        en: "Are there any polling stations where the number of votes from additional lists exceeds 100 people?",
        bg: "Има ли избирателни секции, където броят на гласовете от допълнителни списъци надхвърля 100 души?",
      },
      {
        en: "Are there any municipalities where one party received over 90% of the machine votes but less than 30% of the paper votes?",
        bg: "Има ли общини, в които една партия е получила над 90% от машинния вот, но под 30% от хартиения?",
      },
      {
        en: "Identify polling stations with an unusually high percentage of invalid ballots compared to the regional average.",
        bg: "Идентифицирай избирателни секции с необичайно висок процент невалидни бюлетини спрямо средния за региона.",
      },
      {
        en: "Identify sections where there's a significant difference between the machine vote count and paper vote count for the same party.",
        bg: "Идентифицирай секции, в които има значителна разлика между броя на машинните и хартиените гласове за една и съща партия.",
      },
      {
        en: "Flag any candidates who donated more than 10,000 BGN to their own campaign.",
        bg: "Открий кандидати, които са дарили повече от 10 000 лв. на собствената си кампания.",
      },
      {
        en: "For the last election, were there any differences between the machine votes recorded in the protocol and the data from the machine's flash memory?",
        bg: "За последните избори имаше ли разлики между машинните гласове, записани в протокола, и данните от флаш паметта на машините?",
      },
      {
        en: "Show me all parties from the October 2024 election where the SUEMG data (flash memory) differed from the official protocol's machine votes.",
        bg: "Покажи ми всички партии от изборите през октомври 2024 г., при които данните от СУЕМГ (флаш памет) се различават от официалните машинни гласове в протокола.",
      },
      {
        en: "List any discrepancies greater than 10 votes between the protocol machine count and the flash memory data for the June 2024 election.",
        bg: "Изброй всички несъответствия по-големи от 10 гласа между машинния брой в протокола и данните от флаш паметта за изборите през юни 2024 г.",
      },
    ],
  },
  statistics: {
    topic: {
      en: "Overall Statistics & Trends",
      bg: "Общи Статистики и Тенденции",
    },
    questions: [
      {
        en: "What was the national voter turnout in every election since 2020?",
        bg: "Каква е била националната избирателна активност на всички избори от 2020 г. насам?",
      },
      {
        en: "Chart the adoption of machine voting versus paper voting by region over the last three elections.",
        bg: "Покажи графика на приемането на машинно гласуване спрямо хартиено по региони за последните три избора.",
      },
      {
        en: "Which 5 parties have consistently improved their national results over the past 4 elections?",
        bg: "Кои 5 партии постоянно подобряват националните си резултати през последните 4 избора?",
      },
      {
        en: "What is the total amount of state subsidy received by all parties in 2023?",
        bg: "Каква е общата сума на държавната субсидия, получена от всички партии през 2023 г.?",
      },
      {
        en: "Show me a breakdown of total campaign spending by category (marketing, ads, events) for the top 3 parties in the last election.",
        bg: "Покажи разбивка на общите разходи за кампания по категории (маркетинг, реклама, събития) за топ 3 партиите на последните избори.",
      },
      {
        en: "Show me all elections that had a vote recount.",
        bg: "Покажи ми всички избори, на които е имало повторно преброяване на гласовете.",
      },
      {
        en: "Which elections have financial data available for the campaigns?",
        bg: "За кои избори има налични финансови данни за кампаниите?",
      },
      {
        en: "List all elections for which flash memory data (SUEMG) from the voting machines is available.",
        bg: "Изброй всички избори, за които са налични данни от флаш паметта (СУЕМГ) на машините за гласуване.",
      },
    ],
  },
  regional: {
    topic: {
      en: "Regional & Local Analysis",
      bg: "Регионален и Местен Анализ",
    },
    questions: [
      {
        en: "What were the election results in Sofia city for the last election?",
        bg: "Какви бяха изборните резултати в град София на последните избори?",
      },
      {
        en: "Show me the voter turnout for Sofia region in the October 2024 election.",
        bg: "Покажи ми избирателната активност за София област на изборите през октомври 2024 г.",
      },
      {
        en: "Compare the results for GERB-SDS in Sofia city and Plovdiv in the last election.",
        bg: "Сравни резултатите на ГЕРБ-СДС в град София и Пловдив на последните избори.",
      },
      {
        en: "Who won the election in the Burgas region?",
        bg: "Кой спечели изборите в област Бургас?",
      },
      {
        en: "Show me the party results for the Tsarevo municipality.",
        bg: "Покажи ми резултатите на партиите за община Царево.",
      },
      {
        en: "What were the election results in the Ahtopol settlement for the last election?",
        bg: "Какви бяха изборните резултати в населено място Ахтопол на последните избори?",
      },
    ],
  },
  strategy: {
    topic: {
      en: "Party Strategy & Improvement",
      bg: "Партийна Стратегия и Подобрение",
    },
    questions: [
      {
        en: "For '{partyName}', where are their 10 weakest municipalities where they lost the most votes compared to the previous election?",
        bg: "За '{partyName}', кои са 10-те им най-слаби общини, където са загубили най-много гласове в сравнение с предишните избори?",
      },
      {
        en: "Generate a profile of '{partyName}'s' strongest regions. Are they more popular in urban or rural settlements?",
        bg: "Създай профил на най-силните региони на '{partyName}'. По-популярни ли са в градски или селски населени места?",
      },
      {
        en: "What was the national 'cost per vote' for '{partyName}'? (Total expenses / Total national votes).",
        bg: "Каква е била националната 'цена на глас' за '{partyName}'? (Общо разходи / Общо гласове в страната).",
      },
      {
        en: "Based on the last election, which regions should '{partyName}' focus their marketing budget on for the next campaign to see the most growth?",
        bg: "Въз основа на последните избори, върху кои региони '{partyName}' трябва да съсредоточи маркетинговия си бюджет за следващата кампания, за да постигне най-голям растеж?",
      },
      {
        en: "Analyze the spending on 'Online Advertising' vs. 'TV Advertising' for '{partyName}' and their results in university cities.",
        bg: "Анализирай разходите за 'Онлайн реклама' срещу 'ТВ реклама' за '{partyName}' и техните резултати в университетските градове.",
      },
    ],
  },
  candidate: {
    topic: {
      en: "Candidate Popularity & Analysis",
      bg: "Популярност и Анализ на Кандидати",
    },
    questions: [
      {
        en: "Who was the most popular candidate in the country based on the number of preferences received?",
        bg: "Кой беше най-популярният кандидат в страната въз основа на броя получени преференции?",
      },
      {
        en: "List the top 5 candidates for the 'Civic Union' party by preference votes in the Varna region.",
        bg: "Изброй топ 5 кандидатите на партия 'Граждански съюз' по преференциални гласове в регион Варна.",
      },
      {
        en: "Is there any candidate who received more preference votes than the leader of their party's list in a specific region?",
        bg: "Има ли кандидат, който е получил повече преференциални гласове от водача на листата на своята партия в определен регион?",
      },
      {
        en: "Show me candidates who are also major financial donors to their own party's campaign.",
        bg: "Покажи ми кандидати, които са и големи финансови дарители на кампанията на собствената си партия.",
      },
      {
        en: "Compare the preference votes for candidate [Candidate Name] across different municipalities within their region. Where is their personal brand strongest?",
        bg: "Сравни преференциалните гласове за кандидат [Име на кандидат] в различните общини в неговия регион. Къде е най-силна личната му марка?",
      },
    ],
  },
  voter: {
    topic: {
      en: "Voter Behavior Analysis",
      bg: "Анализ на Поведението на Гласоподавателите",
    },
    questions: [
      {
        en: "Which 5 regions had the highest number of additional voters in total?",
        bg: "Кои 5 региона имаха най-голям общ брой гласоподаватели от допълнителни списъци?",
      },
      {
        en: "Is there a correlation between higher machine voting usage and support for newer political parties?",
        bg: "Има ли връзка между по-високото използване на машинно гласуване и подкрепата за по-нови политически партии?",
      },
      {
        en: "In regions with both recounts and high machine voting, did the recount change the outcome for machine votes or only paper ones?",
        bg: "В региони с повторно преброяване и високо машинно гласуване, промени ли повторното преброяване резултата от машинните гласове или само от хартиените?",
      },
      {
        en: "Show me the municipalities with the highest 'preference voting' activity, regardless of party.",
        bg: "Покажи ми общините с най-висока активност на 'преференциално гласуване', независимо от партията.",
      },
      {
        en: "What is the average number of preferences cast per voter in Sofia compared to Vidin?",
        bg: "Какъв е средният брой преференции, подадени от гласоподавател в София в сравнение с Видин?",
      },
    ],
  },
  none: {
    topic: {
      en: "'I Do Not Support Anyone' Votes",
      bg: "Гласове 'Не подкрепям никого'",
    },
    questions: [
      {
        en: "Which region had the most 'I do not support anyone' votes in the last election?",
        bg: "Коя област имаше най-много гласове 'Не подкрепям никого' на последните избори?",
      },
      {
        en: "Show me the top 5 municipalities where 'I do not support anyone' was most popular by percentage.",
        bg: "Покажи ми топ 5 общините, където 'Не подкрепям никого' беше най-популярно по процент.",
      },
      {
        en: "What percentage of voters in Sofia chose 'I do not support anyone' in the last election?",
        bg: "Какъв процент от гласоподавателите в София са избрали 'Не подкрепям никого' на последните избори?",
      },
    ],
  },
  financial: {
    topic: {
      en: "Financial Analysis & ROI",
      bg: "Финансов Анализ и Възвръщаемост на Инвестициите",
    },
    questions: [
      {
        en: "Which party had the most diverse funding sources in the last election (donors, candidates, subsidy)?",
        bg: "Коя партия имаше най-разнообразни източници на финансиране на последните избори (дарители, кандидати, субсидия)?",
      },
      {
        en: "Who are the top 10 individual donors across all parties for the 2023 campaign?",
        bg: "Кои са топ 10 индивидуални дарители за всички партии за кампанията през 2023 г.?",
      },
      {
        en: "Compare the total campaign income for GERB vs PP-DB for the last election.",
        bg: "Сравни общите приходи от кампании за ГЕРБ срещу ПП-ДБ за последните избори.",
      },
      {
        en: "Calculate the financial efficiency: Which party got the most votes per Leva spent on their campaign nationally?",
        bg: "Изчисли финансовата ефективност: Коя партия получи най-много гласове за лев, похарчен за кампанията си на национално ниво?",
      },
      {
        en: "Compare the campaign spending of 'GERB-SDS' in the last two elections.",
        bg: "Сравни разходите за кампания на 'ГЕРБ-СДС' на последните два избора.",
      },
      {
        en: "Compare the campaign income of 'PP-DB' in the last two elections.",
        bg: "Сравни приходите от кампанията на 'ПП-ДБ' на последните два избора.",
      },
    ],
  },
};

type TranslationContent = {
  title: string;
  inputPlaceholder: string;
  sendButton: string;
  welcomeMessage: string;
  sidebarHeader: string;
  errorMessagePrefix: string;
  thinkingMessage: string;
  stoppingMessage: string;
  generationStopped: string;
  sidebarPartySelectorLabel: string;
  linkQueries: {
    location: string;
    party: string;
    election: string;

    station: string;
    candidate: string;
    default: string;
  };
};

export const translations: Record<Language, TranslationContent> = {
  en: {
    title: "Bulgarian Election Data Chatbot",
    inputPlaceholder: "Ask a question or select one from the sidebar...",
    sendButton: "Send",
    welcomeMessage:
      "Hello! I am CIK-AI, your assistant for Bulgarian election data. How can I help you today?",
    sidebarHeader: "Example Prompts",
    errorMessagePrefix: "Sorry, I encountered an error",
    thinkingMessage:
      "I am gathering the necessary data. This may take a moment...",
    stoppingMessage: "Stopping...",
    generationStopped: "Generation stopped.",
    sidebarPartySelectorLabel: "Select a Party:",
    linkQueries: {
      location: 'Tell me more about the {locationType} "{locationName}".',
      party: 'Give me a profile of the party "{entityName}".',
      election: 'Summarize the election "{entityName}".',
      station: "Show details for polling station {entityName}.",
      candidate: 'Who is the candidate "{entityName}"?',
      default: 'Tell me more about {entityType} "{entityName}".',
    },
  },
  bg: {
    title: "Чатбот за Изборни Данни в България",
    inputPlaceholder: "Задайте въпрос или изберете от страничната лента...",
    sendButton: "Изпрати",
    welcomeMessage:
      "Здравейте! Аз съм ЦИК-АИ, вашият асистент за изборни данни в България. С какво мога да ви помогна днес?",
    sidebarHeader: "Примерни Въпроси",
    errorMessagePrefix: "Съжалявам, възникна грешка",
    thinkingMessage:
      "Събирам необходимите данни. Това може да отнеме малко време...",
    stoppingMessage: "Спиране...",
    generationStopped: "Генерирането е спряно.",
    sidebarPartySelectorLabel: "Изберете Партия:",
    linkQueries: {
      location: 'Разкажи ми повече за {locationType} "{locationName}".',
      party: 'Дай ми профил на партия "{entityName}".',
      election: 'Обобщи изборите "{entityName}".',
      station: "Покажи подробности за избирателна секция {entityName}.",
      candidate: 'Кой е кандидатът "{entityName}"?',
      default: 'Разкажи ми повече за {entityType} "{entityName}".',
    },
  },
};

export type Translations = (typeof translations)["en"];
