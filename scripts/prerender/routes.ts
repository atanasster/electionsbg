// Routes for which we emit a per-route static HTML file with route-specific
// <title> and OG/Twitter meta tags. The Vite SPA build only produces a single
// index.html, but social-preview crawlers (Twitter, Telegram, Facebook,
// LinkedIn) and Google's first-pass indexer don't execute JavaScript, so they
// need the metadata to be present in the source HTML.

export type PrerenderRoute = {
  path: string; // "" for home, "about" for /about, "reports/section/turnout" for nested
  title: string;
  description: string;
  ogImage?: string; // absolute URL or path under /; defaults to site OG image
  jsonLd?: object[]; // optional schema.org structured data injected as <script type="application/ld+json">
  // Optional sanitized HTML inlined into the static body so non-JS crawlers
  // (most AI/LLM bots) can read actual content. The block is rendered into a
  // hidden #ssg-content element and is invisible to humans — React mounts
  // separately into #root. Pass only safe HTML; no scripts/styles.
  bodyHtml?: string;
  // If set, the emitted <link rel="canonical"> points here instead of the
  // route's own URL, and hreflang alternates are suppressed (the canonical
  // target carries them). Use for thin variants of a parent page (e.g.
  // candidate /sections, /donations) so crawlers consolidate signal to the
  // parent and stop reporting these as "Crawled - currently not indexed".
  canonicalUrl?: string;
  // English variant for /en/{path}. When present we also emit the EN file and
  // wire bidirectional hreflang alternates between the two URLs.
  english?: {
    title: string;
    description: string;
    bodyHtml?: string;
    jsonLd?: object[];
    canonicalUrl?: string;
  };
};

export const SITE_URL = "https://electionsbg.com";
export const DEFAULT_OG_IMAGE = `${SITE_URL}/images/og_image.png`;

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  buildBreadcrumbLd,
  buildDatasetLd,
  buildOrganizationLd,
  buildWebPageLd,
  buildWebSiteLd,
} from "./jsonLd";
import { buildHomeBody } from "./bodyBuilders";
import { getLatestElection } from "./dynamicRoutes";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const PUBLIC_FOLDER = path.join(PROJECT_ROOT, "public");
const ELECTIONS_FILE = path.join(PROJECT_ROOT, "src/data/json/elections.json");

const homeBody = (() => {
  if (!fs.existsSync(ELECTIONS_FILE)) return "";
  try {
    const latest = getLatestElection(ELECTIONS_FILE);
    return buildHomeBody(PUBLIC_FOLDER, latest);
  } catch {
    return "";
  }
})();

const HOME_TITLE =
  "Парламентарни избори в България — данни и анализ от 2005 | electionsbg.com";
const HOME_DESCRIPTION =
  "Платформа с отворен код за визуализация и анализ на резултатите от всички парламентарни избори в България от 2005 г. насам — по области, общини, населени места и секции.";
const HOME_TITLE_EN =
  "Bulgarian Parliamentary Elections — Data and Analysis Since 2005 | electionsbg.com";
const HOME_DESCRIPTION_EN =
  "Open-source platform for visualizing and analyzing every Bulgarian parliamentary election since 2005 — broken down by region, municipality, settlement, and polling section.";

// Reused as the body for /sofia and all /sofia/* sub-tabs so non-JS crawlers
// see indexable content under deep tab URLs without per-tab hand-written copy.
const SOFIA_BODY_BG = `
<h1>Резултати в София — парламентарни избори</h1>
<p>Столицата гласува в три многомандатни избирателни района (МИР 23, 24 и 25), всеки със собствен профил на електорално поведение. Тук са обединените резултати — гласуване по партии, преференции, обхват на машинното гласуване и засечени отклонения по секции.</p>
<h2>Какво ще намерите тук</h2>
<ul>
<li><a href="${SITE_URL}/sofia/parties">Резултати по партии</a> — гласове и проценти в трите столични района.</li>
<li><a href="${SITE_URL}/sofia/preferences">Преференции</a> — водещи кандидати с преференциален вот.</li>
<li><a href="${SITE_URL}/sofia/flash-memory">Машинно гласуване</a> — секции с/без флашка и хартиен заместител.</li>
<li><a href="${SITE_URL}/sofia/recount">Повторно преброяване</a> — отклонения между първо и второ броене.</li>
<li><a href="${SITE_URL}/sofia/timeline">Времева линия</a> — резултати в София от 2005 г. насам.</li>
</ul>`.trim();

const SOFIA_BODY_EN = `
<h1>Sofia — Bulgarian Parliamentary Election Results</h1>
<p>The capital votes across three multi-member districts (MIR 23, 24 and 25), each with a distinct electoral profile. This is the consolidated view — party shares, preference votes, machine-voting coverage, and section-level anomalies for the latest parliamentary election.</p>
<h2>Sections</h2>
<ul>
<li><a href="${SITE_URL}/en/sofia/parties">Results by party</a> — votes and percentages across the three Sofia districts.</li>
<li><a href="${SITE_URL}/en/sofia/preferences">Preference votes</a> — top candidates by within-list preference.</li>
<li><a href="${SITE_URL}/en/sofia/flash-memory">Machine voting</a> — sections with and without flash-memory machines.</li>
<li><a href="${SITE_URL}/en/sofia/recount">Recount</a> — discrepancies between first and second tallies.</li>
<li><a href="${SITE_URL}/en/sofia/timeline">Timeline</a> — Sofia results since 2005.</li>
</ul>`.trim();

type StaticPageOpts = {
  path: string;
  title: string;
  description: string;
  breadcrumbName: string;
  bodyHtml?: string;
  ogImage?: string;
  english?: {
    title: string;
    description: string;
    breadcrumbName: string;
    bodyHtml?: string;
  };
};

const staticPage = (opts: StaticPageOpts): PrerenderRoute => {
  const url = `${SITE_URL}/${opts.path}`;
  const enUrl = `${SITE_URL}/en/${opts.path}`;
  return {
    path: opts.path,
    title: opts.title,
    description: opts.description,
    ogImage: opts.ogImage,
    bodyHtml: opts.bodyHtml,
    jsonLd: [
      buildWebPageLd({
        title: opts.title,
        description: opts.description,
        url,
      }),
      buildBreadcrumbLd([
        { name: "Начало", url: `${SITE_URL}/` },
        { name: opts.breadcrumbName, url },
      ]),
    ],
    ...(opts.english
      ? {
          english: {
            title: opts.english.title,
            description: opts.english.description,
            bodyHtml: opts.english.bodyHtml,
            jsonLd: [
              buildWebPageLd({
                title: opts.english.title,
                description: opts.english.description,
                url: enUrl,
              }),
              buildBreadcrumbLd([
                { name: "Home", url: `${SITE_URL}/en/` },
                { name: opts.english.breadcrumbName, url: enUrl },
              ]),
            ],
          },
        }
      : {}),
  };
};

export const prerenderRoutes: PrerenderRoute[] = [
  {
    path: "",
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    ogImage: "/og/dashboard-2026-04-19.png",
    bodyHtml: homeBody,
    jsonLd: [
      buildWebSiteLd(),
      buildOrganizationLd(),
      buildDatasetLd({
        name: "Парламентарни избори в България — пълни резултати от 2005 г.",
        description: HOME_DESCRIPTION,
        url: `${SITE_URL}/`,
        spatialCoverage: "България",
        keywords: [
          "парламентарни избори",
          "България",
          "Bulgaria elections",
          "избирателна активност",
          "машинно гласуване",
          "повторно преброяване",
        ],
      }),
    ],
    english: {
      title: HOME_TITLE_EN,
      description: HOME_DESCRIPTION_EN,
      jsonLd: [
        buildWebSiteLd(),
        buildOrganizationLd(),
        buildDatasetLd({
          name: "Bulgarian parliamentary elections — full results since 2005",
          description: HOME_DESCRIPTION_EN,
          url: `${SITE_URL}/en/`,
          spatialCoverage: "Bulgaria",
          keywords: [
            "Bulgarian elections",
            "parliamentary elections",
            "turnout",
            "machine voting",
            "recount",
          ],
        }),
      ],
    },
  },
  staticPage({
    path: "sofia",
    title: "Резултати в София — Парламентарни избори | electionsbg.com",
    description:
      "Подробни резултати, обхват на машинното гласуване и отклонения по секции в трите столични района (23, 24 и 25 МИР).",
    breadcrumbName: "София",
    ogImage: "/og/sofia.png",
    bodyHtml: SOFIA_BODY_BG,
    english: {
      title:
        "Sofia — Bulgarian Parliamentary Election Results | electionsbg.com",
      description:
        "Detailed results, machine-voting coverage, and section-level anomalies across the three Sofia electoral districts (MIR 23, 24, and 25).",
      breadcrumbName: "Sofia",
      bodyHtml: SOFIA_BODY_EN,
    },
  }),
  staticPage({
    path: "about",
    title: "За проекта — electionsbg.com",
    description:
      "За екипа, методологията и източниците на electionsbg.com — независима платформа за анализ на парламентарните избори в България.",
    breadcrumbName: "За проекта",
    ogImage: "/og/about.png",
    bodyHtml: `
<h1>За проекта electionsbg.com</h1>
<p>electionsbg.com е независима платформа с отворен код за визуализация и анализ на парламентарните избори в България от 2005 г. насам. Целта е суровите данни на ЦИК и Сметната палата да станат достъпни и сравними — по области, общини, населени места и секции.</p>
<h2>Източници на данни</h2>
<ul>
<li>Резултати от <strong>Централната избирателна комисия (ЦИК)</strong> — протоколи на СИК и национално резюме.</li>
<li>Финансиране на кампаниите от <strong>Сметната палата</strong> — приходи, разходи, дарители.</li>
<li>Социологически проучвания, събрани от българската Уикипедия и сайтовете на агенциите.</li>
<li>Данни за народните представители — <a href="https://www.parliament.bg" rel="nofollow noopener">parliament.bg</a>.</li>
</ul>
<h2>Методология</h2>
<p>Всеки вот е обработен с един и същ pipeline — парсинг на сурови CSV/ZIP файлове, агрегиране на ниво секция → населено място → община → област → държава, плюс набор от независими доклади за отклонения (повторно преброяване, машинно срещу хартиено гласуване, прекомерна концентрация на гласове, изпратени допълнителни избиратели и т.н.).</p>
<p>Кодът е отворен и възпроизводим — приветстваме предложения и поправки.</p>`.trim(),
    english: {
      title: "About — electionsbg.com",
      description:
        "About the team, methodology, and data sources behind electionsbg.com — an independent platform analysing Bulgaria's parliamentary elections.",
      breadcrumbName: "About",
      bodyHtml: `
<h1>About electionsbg.com</h1>
<p>electionsbg.com is an independent open-source platform for visualising and analysing Bulgaria's parliamentary elections since 2005. The goal is to make raw data from the Central Electoral Commission and the National Audit Office accessible and comparable — by region, municipality, settlement, and polling section.</p>
<h2>Data sources</h2>
<ul>
<li>Results from the <strong>Central Electoral Commission (CEC/ЦИК)</strong> — section-level protocols and national summaries.</li>
<li>Campaign financing from the <strong>National Audit Office</strong> — income, expenses, donors.</li>
<li>Polling data from Bulgarian Wikipedia and pollster websites.</li>
<li>Member-of-parliament profiles — <a href="https://www.parliament.bg" rel="nofollow noopener">parliament.bg</a>.</li>
</ul>
<h2>Methodology</h2>
<p>Every vote is processed through the same pipeline — parsing raw CSV/ZIP files, aggregating from section → settlement → municipality → region → country, plus a battery of independent anomaly reports (recount, machine vs. paper voting, vote concentration, additional voters, and more).</p>
<p>The code is open and reproducible — contributions and corrections welcome.</p>`.trim(),
    },
  }),
  staticPage({
    path: "financing",
    title: "Финансиране на партии и предизборни кампании | electionsbg.com",
    description:
      "Декларирани приходи и разходи на политическите партии за всеки парламентарен вот — дарители, кандидати, медийни и други разходи.",
    breadcrumbName: "Финансиране",
    ogImage: "/og/financing.png",
    bodyHtml: `
<h1>Финансиране на партии и предизборни кампании</h1>
<p>Декларираните приходи и разходи на политическите партии и коалиции за всеки парламентарен вот — данни от Сметната палата, обединени и съпоставими между изборите. Включва общия размер на кампанията, разпределението по типове разходи (медии, реклама, печат, транспорт), индивидуални дарители и сумите по кандидати.</p>
<h2>Какво се вижда тук</h2>
<ul>
<li>Съвкупен приход и разход на всяка партия по години.</li>
<li>Топ дарители (физически и юридически лица) — суми и брой дарения.</li>
<li>Разходи по канали — телевизия, радио, интернет, печатни медии, билбордове.</li>
<li>Данни на ниво кандидат — индивидуални приходи/разходи, когато са декларирани.</li>
</ul>
<p>Източник: <a href="https://www.bulnao.government.bg" rel="nofollow noopener">Сметна палата на Република България</a>.</p>`.trim(),
    english: {
      title:
        "Party and Campaign Financing — Bulgarian Parliamentary Elections | electionsbg.com",
      description:
        "Declared income and expenditures of Bulgarian political parties for each parliamentary vote — donors, candidates, and media spending.",
      breadcrumbName: "Financing",
      bodyHtml: `
<h1>Party and campaign financing</h1>
<p>Declared income and expenditures of Bulgarian political parties and coalitions for each parliamentary vote — data from the National Audit Office, consolidated and comparable across elections. Includes total campaign size, breakdown by spending category (media, advertising, print, transport), individual donors, and per-candidate amounts.</p>
<h2>What you'll find</h2>
<ul>
<li>Aggregate income and expenditure per party, by year.</li>
<li>Top donors (individuals and legal entities) — totals and donation counts.</li>
<li>Spending by channel — TV, radio, internet, print, billboards.</li>
<li>Candidate-level data when declared.</li>
</ul>
<p>Source: <a href="https://www.bulnao.government.bg" rel="nofollow noopener">National Audit Office of Bulgaria</a>.</p>`.trim(),
    },
  }),
  staticPage({
    path: "simulator",
    title: "Симулатор на коалиции и разпределение на мандати | electionsbg.com",
    description:
      "Изследвайте как промяната на избирателния праг променя разпределението на 240-те мандата и кои коалиции могат да формират мнозинство от 121.",
    breadcrumbName: "Симулатор",
    ogImage: "/og/simulator.png",
    bodyHtml: `
<h1>Симулатор на коалиции и разпределение на мандати</h1>
<p>Българското Народно събрание има 240 места — за управляващо мнозинство са необходими 121. Изборният праг от 4% определя кои партии получават мандати, но числото не е природна константа. С този симулатор можете да видите как:</p>
<ul>
<li>Праг от 3%, 4%, 5% или произволна стойност променя броя на партиите в парламента.</li>
<li>Се преразпределят мандатите по метода на Хеър/Найемайер при различни прагове.</li>
<li>Кои потенциални коалиции достигат прага от 121 мандата.</li>
</ul>
<p>Симулаторът използва истинските регионални резултати — не пропорционално мащабиране, а същия алгоритъм на разпределение, който прилага ЦИК.</p>`.trim(),
    english: {
      title: "Coalition and Seat-Allocation Simulator | electionsbg.com",
      description:
        "Explore how changes to the electoral threshold reshape the allocation of the 240 parliamentary seats and which coalitions can form a 121-vote majority.",
      breadcrumbName: "Simulator",
      bodyHtml: `
<h1>Coalition and seat-allocation simulator</h1>
<p>Bulgaria's National Assembly has 240 seats — a governing majority needs 121. The 4% electoral threshold determines which parties receive seats, but the number isn't sacred. With this simulator you can explore:</p>
<ul>
<li>How thresholds of 3%, 4%, 5%, or any custom value change the number of parties in parliament.</li>
<li>How seats are reallocated under the Hare/Niemeyer method at different thresholds.</li>
<li>Which potential coalitions reach the 121-seat majority.</li>
</ul>
<p>The simulator uses the real regional results — not proportional scaling, but the same allocation algorithm the Central Electoral Commission applies.</p>`.trim(),
    },
  }),
  staticPage({
    path: "compare",
    title: "Сравнение на парламентарни избори в България | electionsbg.com",
    description:
      "Сравнете рамо до рамо два парламентарни вота — избирателна активност, дял на партиите, мандати и брой секции с отклонения.",
    breadcrumbName: "Сравнение",
    ogImage: "/og/compare.png",
    bodyHtml: `
<h1>Сравнение на парламентарни избори в България</h1>
<p>Изберете два парламентарни вота от 2005 г. насам и ги сравнете рамо до рамо — избирателна активност, дял и мандати на всяка партия, обхват на машинното гласуване, брой секции с отклонения. Полезно за бърз преглед на динамиката между ранна и късна изборна нощ или между два вота с различни управляващи мнозинства.</p>
<h2>Какво се сравнява</h2>
<ul>
<li>Обща избирателна активност и брой действителни гласове.</li>
<li>Гласове, проценти и мандати по партии.</li>
<li>Хартия срещу машинно гласуване — дял на всеки канал.</li>
<li>Брой секции с отклонения от стандартните доклади (повторно преброяване, концентрация на гласове, дописване на избиратели).</li>
</ul>`.trim(),
    english: {
      title: "Compare Bulgarian Parliamentary Elections | electionsbg.com",
      description:
        "Side-by-side comparison of any two parliamentary votes — turnout, party shares, seats, and section-level anomaly counts.",
      breadcrumbName: "Compare",
      bodyHtml: `
<h1>Compare Bulgarian parliamentary elections</h1>
<p>Pick any two parliamentary votes since 2005 and put them side by side — turnout, vote share and seats per party, machine-voting coverage, and section-level anomaly counts. Useful for a quick read on the gap between an early and late election night, or between two votes that produced different governing majorities.</p>
<h2>What's compared</h2>
<ul>
<li>Total turnout and valid-vote count.</li>
<li>Votes, percentages and seats by party.</li>
<li>Paper vs. machine voting — share of each channel.</li>
<li>Number of sections flagged in the anomaly reports (recount, concentration, additional voters).</li>
</ul>`.trim(),
    },
  }),
  staticPage({
    path: "timeline",
    title:
      "Възход и падение на политическите партии в България | electionsbg.com",
    description:
      "Балонна времева линия на всичките 13 парламентарни вота от 2005 г. насам — размерът на балона показва получените гласове, цветът — партията.",
    breadcrumbName: "Времева линия",
    ogImage: "/og/timeline.png",
    bodyHtml: `
<h1>Възход и падение на политическите партии в България</h1>
<p>Балонна времева линия на всичките парламентарни вота от 2005 г. насам. Всеки балон е една партия в един изборен ден — размерът показва получените гласове, цветът — партията. Хронологията позволява бърз поглед върху появата, разрастването, разпада и сливанията на основните политически сили.</p>
<h2>Кой период обхваща</h2>
<ul>
<li>40-то Народно събрание (2005) — НДСВ, ДПС, БСП, СДС, ВМРО, „Атака“.</li>
<li>41-во и 42-ро НС (2009 и 2013) — възход на ГЕРБ, спад на тройната коалиция.</li>
<li>43-то — 49-то НС (2014–2024) — фрагментация, нови партии, повторни вотове.</li>
<li>50-то — 51-во НС (2024–2026) — последните вотове и преходните мнозинства.</li>
</ul>`.trim(),
    english: {
      title: "Rise and Fall of Bulgarian Political Parties | electionsbg.com",
      description:
        "Bubble timeline of all 13 parliamentary votes since 2005 — bubble size shows votes won, colour shows party.",
      breadcrumbName: "Timeline",
      bodyHtml: `
<h1>Rise and fall of Bulgarian political parties</h1>
<p>Bubble timeline of every parliamentary vote since 2005. Each bubble is one party at one election — size shows votes received, colour shows the party. The chronology gives a quick read on the emergence, growth, collapse, and mergers of the main political forces.</p>
<h2>Period covered</h2>
<ul>
<li>40th National Assembly (2005) — NDSV, DPS, BSP, SDS, VMRO, Ataka.</li>
<li>41st and 42nd NA (2009 and 2013) — rise of GERB, decline of the tripartite coalition.</li>
<li>43rd — 49th NA (2014–2024) — fragmentation, new parties, repeat votes.</li>
<li>50th — 51st NA (2024–2026) — the most recent votes and transitional majorities.</li>
</ul>`.trim(),
    },
  }),
  staticPage({
    path: "parties",
    title:
      "Всички партии — резултати на парламентарните избори | electionsbg.com",
    description:
      "Пълен списък на партиите и коалициите, участвали в последния парламентарен вот — гласове, проценти и мандати, плюс линкове към подробни профили.",
    breadcrumbName: "Партии",
    bodyHtml: `
<h1>Всички партии на парламентарните избори</h1>
<p>Пълен списък на партиите и коалициите, участвали в последния парламентарен вот в България. За всяка партия са показани общите гласове, процентен дял и брой мандати, ако е преминала избирателния праг от 4%.</p>
<p>Кликнете името на партия, за да видите профила ѝ — резултати по области, общини и населени места, преференции, дарители и разходи за кампанията. Виж също <a href="${SITE_URL}/timeline">времевата линия</a> за съпоставка по години.</p>`.trim(),
    english: {
      title:
        "All Parties — Bulgarian Parliamentary Election Results | electionsbg.com",
      description:
        "Full list of parties and coalitions running in the latest parliamentary vote — votes, percentages, seats, and links to detailed profiles.",
      breadcrumbName: "Parties",
      bodyHtml: `
<h1>All parties in the parliamentary election</h1>
<p>Full list of parties and coalitions that ran in Bulgaria's latest parliamentary vote. For each party we show total votes, vote share, and seat count when the 4% electoral threshold was met.</p>
<p>Click a party name for its full profile — results by region, municipality and settlement, preference votes, donors, and campaign spending. See also the <a href="${SITE_URL}/en/timeline">timeline</a> for cross-year comparisons.</p>`.trim(),
    },
  }),
  staticPage({
    path: "regions",
    title:
      "Резултати по области в България — парламентарни избори | electionsbg.com",
    description:
      "Резултати на парламентарните избори в България по области (28 МИР) — победител, гласове и активност за всяка област.",
    breadcrumbName: "Области",
    bodyHtml: `
<h1>Резултати по области (28 МИР)</h1>
<p>Резултатите от последния парламентарен вот по 28 многомандатни избирателни района (МИР) в България. За всяка област се вижда коя партия е първа, броят гласове и процентният дял, плюс избирателната активност спрямо предходния вот.</p>
<p>Кликнете името на област, за да видите подробен разрез по общини, населени места, преференции и отклонения по секции.</p>`.trim(),
    english: {
      title:
        "Results by Region — Bulgarian Parliamentary Elections | electionsbg.com",
      description:
        "Bulgarian parliamentary election results across the 28 multi-member districts (MIR) — winner, votes and turnout per region.",
      breadcrumbName: "Regions",
      bodyHtml: `
<h1>Results by region (28 MIR)</h1>
<p>Results of the most recent parliamentary vote across Bulgaria's 28 multi-member districts (MIR). For each region you see the leading party, vote count and share, plus turnout against the previous vote.</p>
<p>Click a region for a deeper breakdown by municipality, settlement, preference votes, and section-level anomalies.</p>`.trim(),
    },
  }),
  staticPage({
    path: "governments",
    title:
      "Български правителства от 2005 г. — макроикономика и наблюдения | electionsbg.com",
    description:
      "Всички български кабинети от 2005 г. на фона на БВП, инфлацията, безработицата, индексите за управление и доверие, плюс наблюденията на ОССЕ/ОДИХР за всеки парламентарен вот.",
    breadcrumbName: "Правителства",
    ogImage: "/og/governments.png",
    bodyHtml: `
<h1>Български правителства от 2005 г.</h1>
<p>Всеки кабинет, заемал властта в България след 2005 г., представен като оцветена ивица на обща времева линия. Линиите налагат годишните макроикономически показатели — растеж на реалния БВП, хармонизирана инфлация (ХИПЦ) и безработица — за да личи кой мандат при какъв икономически контекст е управлявал.</p>
<h2>Какво ще намерите тук</h2>
<ul>
<li><strong>Икономика</strong> — БВП, инфлация и безработица по години (Евростат).</li>
<li><strong>Индекс за възприятие на корупцията</strong> — оценка на България по скалата 0–100 на Transparency International.</li>
<li><strong>Worldwide Governance Indicators</strong> — върховенство на закона, контрол върху корупцията и ефективност на управлението (Световна банка).</li>
<li><strong>Доверие в институциите</strong> — Евробарометър за доверието в Народното събрание, правителството и ЕС.</li>
<li><strong>Европейски средства</strong> — годишни постъпления в България спрямо вноските към бюджета на ЕС.</li>
<li><strong>Наблюдение от ОССЕ/ОДИХР</strong> — резюмета на международните докладите за всеки парламентарен вот.</li>
</ul>
<p>Източници: <a href="https://ec.europa.eu/eurostat/databrowser/" rel="nofollow noopener">Евростат</a>, <a href="https://databank.worldbank.org/source/worldwide-governance-indicators" rel="nofollow noopener">World Bank WGI</a>, <a href="https://www.transparency.org/en/cpi" rel="nofollow noopener">Transparency International CPI</a>, <a href="https://europa.eu/eurobarometer/" rel="nofollow noopener">Евробарометър</a>, <a href="https://www.osce.org/odihr/elections/bulgaria" rel="nofollow noopener">ОССЕ/ОДИХР</a>.</p>`.trim(),
    english: {
      title:
        "Bulgarian Governments Since 2005 — Macro Backdrop and Observations | electionsbg.com",
      description:
        "Every Bulgarian cabinet since 2005 set against GDP, inflation, unemployment, governance and trust indices, with OSCE/ODIHR observation reports for each parliamentary vote.",
      breadcrumbName: "Governments",
      bodyHtml: `
<h1>Bulgarian governments since 2005</h1>
<p>Every cabinet that has held power in Bulgaria since 2005, shown as a coloured band on a shared timeline. Overlaid lines plot the macroeconomic backdrop — real GDP growth, harmonised inflation (HICP), and unemployment — so each term sits next to the economic conditions in which it governed.</p>
<h2>What you'll find</h2>
<ul>
<li><strong>Economy</strong> — GDP, inflation and unemployment by year (Eurostat).</li>
<li><strong>Corruption Perceptions Index</strong> — Bulgaria's score on Transparency International's 0–100 scale.</li>
<li><strong>Worldwide Governance Indicators</strong> — rule of law, control of corruption and government effectiveness (World Bank).</li>
<li><strong>Trust in institutions</strong> — Eurobarometer trust shares for the National Assembly, the government and the EU.</li>
<li><strong>EU funds</strong> — annual inflows to Bulgaria against contributions to the EU budget.</li>
<li><strong>OSCE/ODIHR observation</strong> — summaries of the international reports on each parliamentary vote.</li>
</ul>
<p>Sources: <a href="https://ec.europa.eu/eurostat/databrowser/" rel="nofollow noopener">Eurostat</a>, <a href="https://databank.worldbank.org/source/worldwide-governance-indicators" rel="nofollow noopener">World Bank WGI</a>, <a href="https://www.transparency.org/en/cpi" rel="nofollow noopener">Transparency International CPI</a>, <a href="https://europa.eu/eurobarometer/" rel="nofollow noopener">Eurobarometer</a>, <a href="https://www.osce.org/odihr/elections/bulgaria" rel="nofollow noopener">OSCE/ODIHR</a>.</p>`.trim(),
    },
  }),
  staticPage({
    path: "demographics",
    title:
      "Демография на България — Преброяване 2021 и резултати по области | electionsbg.com",
    description:
      "Преброяването 2021 на НСИ наложено върху регионалните изборни данни — етнос, вероизповедание, образование, възраст и заетост по 28-те области и 265 общини, плюс корелации с резултатите на партиите.",
    breadcrumbName: "Демография",
    ogImage: "/og/demographics.png",
    bodyHtml: `
<h1>Демография на България — Преброяване 2021</h1>
<p>Окончателните резултати на Преброяване 2021 на НСИ (към 7 септември 2021 г.), представени паралелно с електоралните данни — за всяка от 28-те области и 265-те общини: етнически състав, вероизповедание, образование, възрастова структура, заетост и пол.</p>
<h2>Какво ще намерите тук</h2>
<ul>
<li><strong>Разбивка за цялата страна</strong> — общи дялове по етнос, вероизповедание, образование, възраст и пол (6 519 789 души).</li>
<li><strong>Карта по демографски показател</strong> — хороплет по 14 показателя на ниво област, превключваем чрез падащо меню.</li>
<li><strong>Резултат на партия спрямо демография</strong> — точкова диаграма на областно ниво с коефициент на корелация (Pearson r) — изборният резултат на избрана партия срещу избрана демографска променлива.</li>
<li><strong>Сравнение по области и общини</strong> — сортируема таблица с превключване между 28 области и 265 общини, с филтър по име.</li>
<li><strong>Демография на общинско и селищно ниво</strong> — отделни прозорци на страниците на областите, общините и населените места (за селищата НСИ публикува само население, възраст и пол).</li>
</ul>
<p>Източник: <a href="https://census2021.bg/" rel="nofollow noopener">Преброяване на населението и жилищния фонд 2021 г. на НСИ</a>.</p>`.trim(),
    english: {
      title:
        "Bulgaria Demographics — Census 2021 vs. Election Results by Oblast | electionsbg.com",
      description:
        "NSI Census 2021 mapped onto Bulgaria's regional electoral data — ethnicity, religion, education, age and employment across 28 oblasts and 265 municipalities, with party-level correlation crosstabs.",
      breadcrumbName: "Demographics",
      bodyHtml: `
<h1>Bulgaria demographics — Census 2021</h1>
<p>Final results of Bulgaria's 2021 Population and Housing Census (reference date 7 September 2021), shown alongside the electoral data — for each of the 28 oblasts and 265 municipalities: ethnic composition, religious denomination, education attainment, age structure, employment and sex.</p>
<h2>What you'll find</h2>
<ul>
<li><strong>Country breakdown</strong> — national shares by ethnicity, religion, education, age and sex (6,519,789 residents).</li>
<li><strong>Choropleth map</strong> — 14 toggleable demographic indicators at oblast level.</li>
<li><strong>Vote share vs. demographics</strong> — oblast-level scatter with Pearson correlation between any party's regional vote share and any demographic dimension.</li>
<li><strong>Oblast & municipality comparison table</strong> — sortable, with a level toggle between 28 oblasts and 265 obshtinas and a name filter.</li>
<li><strong>Per-oblast, per-obshtina and per-settlement dashboards</strong> — embedded demographic tile on every regional page (settlements show population, age and sex only — NSI doesn't publish ethnicity, religion or education at that granularity).</li>
</ul>
<p>Source: <a href="https://census2021.bg/" rel="nofollow noopener">NSI Population and Housing Census 2021</a>.</p>`.trim(),
    },
  }),
  staticPage({
    path: "preferences",
    title:
      "Преференциален вот по партии — парламентарни избори | electionsbg.com",
    description:
      "Топ кандидати с преференциален вот в българските парламентарни избори — преподредени листи и разлика спрямо подреждането на партията.",
    breadcrumbName: "Преференции",
    bodyHtml: `
<h1>Преференциален вот по партии</h1>
<p>В България избирателят може да даде преференция за конкретен кандидат от партийната листа. Когато преференциите за един кандидат надхвърлят 7% от гласовете на партията в съответния МИР, той се преподрежда напред в листата — често пред първоначалния номер 1.</p>
<p>Тук са обединените резултати от преференциалния вот за последния парламентарен вот — топ кандидати по партия, разлика между първоначалното и крайното подреждане, и кои народни представители влизат в Народното събрание единствено благодарение на преференцията.</p>`.trim(),
  }),
  staticPage({
    path: "flash-memory",
    title: "Машинно гласуване — обхват и отклонения | electionsbg.com",
    description:
      "Доклад за машинното гласуване в България — секции с/без флашка, добавени и липсващи СУЕМГ устройства, хартиен заместител.",
    breadcrumbName: "Машинно гласуване",
    bodyHtml: `
<h1>Машинно гласуване — обхват и отклонения</h1>
<p>Машинното гласуване в България използва специализирани устройства (СУЕМГ — Специализирано устройство за електронно машинно гласуване). На всеки парламентарен вот се обявява дали машината е била работеща в съответната секция и дали е било разпоредено връщане към хартия.</p>
<p>Този доклад показва обхвата на машинното гласуване по години — общо секции с/без машина, добавени машини в последния момент, липсващи устройства, и секции с разпоредено хартиено гласуване.</p>`.trim(),
  }),
  staticPage({
    path: "recount",
    title: "Повторно преброяване — отклонения по партии | electionsbg.com",
    description:
      "Доклад за повторното преброяване на бюлетините в българските парламентарни избори — секции с разлика между първо и второ броене.",
    breadcrumbName: "Повторно преброяване",
    bodyHtml: `
<h1>Повторно преброяване — отклонения по партии</h1>
<p>След първоначалното броене на гласовете в СИК, всички протоколи минават през второ броене в РИК. Когато двете броения дават различен резултат, се отчита отклонение.</p>
<p>Тук са секциите с най-голямо отклонение между двете броения — по обща сума, по партия и по тип разлика (партия → партия, партия → недействителна).</p>`.trim(),
  }),
];

const sofiaSubTabs: Array<{
  slug: string;
  bgLabel: string;
  enLabel: string;
  bgDesc: string;
  enDesc: string;
}> = [
  {
    slug: "parties",
    bgLabel: "по партии",
    enLabel: "by party",
    bgDesc: "Резултати по партии в трите столични района (МИР 23, 24, 25).",
    enDesc:
      "Results by party across Sofia's three multi-member districts (MIR 23, 24, 25).",
  },
  {
    slug: "preferences",
    bgLabel: "преференции",
    enLabel: "preference votes",
    bgDesc:
      "Преференциален вот по кандидати в София — преподредени листи и водещи имена.",
    enDesc:
      "Preference votes for candidates in Sofia — reordered party lists and top names.",
  },
  {
    slug: "flash-memory",
    bgLabel: "машинно гласуване",
    enLabel: "machine voting",
    bgDesc:
      "Обхват на машинното гласуване в София — секции с/без флашка и с хартиен заместител.",
    enDesc:
      "Machine-voting coverage in Sofia — sections with/without flash-memory devices and paper fallback.",
  },
  {
    slug: "recount",
    bgLabel: "повторно преброяване",
    enLabel: "recount",
    bgDesc:
      "Отклонения между първо и второ броене на бюлетините в столичните секции.",
    enDesc:
      "Discrepancies between first and second tally counts in Sofia's polling sections.",
  },
  {
    slug: "timeline",
    bgLabel: "времева линия",
    enLabel: "timeline",
    bgDesc:
      "Резултати в София от 2005 г. насам — партии и активност по години.",
    enDesc: "Sofia results since 2005 — parties and turnout by year.",
  },
];

for (const tab of sofiaSubTabs) {
  prerenderRoutes.push(
    staticPage({
      path: `sofia/${tab.slug}`,
      title: `София — ${tab.bgLabel} | Парламентарни избори | electionsbg.com`,
      description: tab.bgDesc,
      breadcrumbName: tab.bgLabel,
      ogImage: "/og/sofia.png",
      bodyHtml: SOFIA_BODY_BG,
      english: {
        title: `Sofia — ${tab.enLabel} | Bulgarian Parliamentary Elections | electionsbg.com`,
        description: tab.enDesc,
        breadcrumbName: tab.enLabel,
        bodyHtml: SOFIA_BODY_EN,
      },
    }),
  );
}
