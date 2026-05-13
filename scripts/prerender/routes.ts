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
// Per-election data JSON ships from the GCS bucket (post-migration), not
// from the site origin. JSON-LD Dataset distribution URLs need to point at
// the bucket so Google Dataset Search can actually fetch the data — pointing
// at electionsbg.com/2026_04_19/...json would 404 since those files are no
// longer served by Firebase Hosting.
export const DATA_URL = "https://storage.googleapis.com/data-electionsbg-com";
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
    path: "observations",
    title:
      "Доклади на ОССЕ/ОДИХР за парламентарните избори в България | electionsbg.com",
    description:
      "Резюмета на международните доклади за наблюдение на парламентарните избори в България след 2005 г. — констатации, повтарящи се препоръки и връзки към пълните доклади на ОССЕ/ОДИХР.",
    breadcrumbName: "Доклади ОССЕ/ОДИХР",
    ogImage: "/og/observations.png",
    bodyHtml: `
<h1>Доклади за наблюдение на изборите в България — ОССЕ/ОДИХР</h1>
<p>Всеки парламентарен вот в България след 2005 г. е наблюдаван от мисия на ОССЕ/ОДИХР — пълноценна Мисия за наблюдение на избори (EOM), Ограничена мисия (LEOM) или Мисия за оценка (EAM). Тази страница обединява всички публикувани доклади на едно място, с кратко резюме на ключовите констатации и линк към пълния документ.</p>
<h2>Какво ще намерите тук</h2>
<ul>
<li><strong>Тип на мисията</strong> — EOM, LEOM или EAM, с дата на провеждане и обхват.</li>
<li><strong>Резюме на констатациите</strong> — кратки тематични обобщения (поведение на кампанията, медийно отразяване, регистрация на избиратели, прозрачност на финансирането, купуване на гласове).</li>
<li><strong>Повтарящи се препоръки</strong> — теми, които ОДИХР продължава да повдига от един вот към следващия.</li>
<li><strong>Връзки към пълните доклади</strong> на сайта на ОССЕ/ОДИХР.</li>
</ul>
<p>Резюметата са генерирани от Claude AI на база публичните доклади. За официалните оценки винаги се обръщайте към оригиналните документи на <a href="https://www.osce.org/odihr/elections/bulgaria" rel="nofollow noopener">www.osce.org/odihr/elections/bulgaria</a>.</p>`.trim(),
    english: {
      title:
        "OSCE/ODIHR Reports on Bulgarian Parliamentary Elections | electionsbg.com",
      description:
        "Summaries of international election-observation reports for every Bulgarian parliamentary vote since 2005 — findings, recurring recommendations, and links to the full OSCE/ODIHR publications.",
      breadcrumbName: "OSCE/ODIHR reports",
      bodyHtml: `
<h1>OSCE/ODIHR election observation reports — Bulgaria</h1>
<p>Every Bulgarian parliamentary vote since 2005 has been observed by an OSCE/ODIHR mission — either a full Election Observation Mission (EOM), a Limited Election Observation Mission (LEOM), or an Election Assessment Mission (EAM). This page collects all published reports in one place, with a short summary of the key findings and a link to the full document.</p>
<h2>What you'll find</h2>
<ul>
<li><strong>Mission type</strong> — EOM, LEOM, or EAM, with the election date and scope.</li>
<li><strong>Findings summary</strong> — short thematic recaps (campaign conduct, media coverage, voter registration, campaign-finance transparency, vote buying).</li>
<li><strong>Recurring recommendations</strong> — issues ODIHR keeps raising election after election.</li>
<li><strong>Links to the full reports</strong> on the OSCE/ODIHR website.</li>
</ul>
<p>Summaries are generated by Claude AI from the public reports. For the official assessments always refer to the original documents at <a href="https://www.osce.org/odihr/elections/bulgaria" rel="nofollow noopener">www.osce.org/odihr/elections/bulgaria</a>.</p>`.trim(),
    },
  }),
  staticPage({
    path: "data-changes",
    title: "Промени в данните на electionsbg.com | electionsbg.com",
    description:
      "Дневник на обновяванията — кога и какво е обновено в наборите от данни на сайта: парламентарни гласувания, имуществени декларации, социологически проучвания, макро и регионални индикатори.",
    breadcrumbName: "Промени в данните",
    ogImage: "/og/data-changes.png",
    bodyHtml: `
<h1>Промени в данните на electionsbg.com</h1>
<p>Сайтът публикува редовно нови или актуализирани набори от данни — от парламентарни гласувания и имуществени декларации на народните представители до макроикономически и регионални индикатори. Тази страница е публичният дневник на тези обновявания: коя дата кое е било подменено и накъде може да се отиде, за да се види то в действие.</p>
<h2>Какво се проследява</h2>
<ul>
<li><strong>Парламентарни гласувания</strong> — нови сесии с поименни гласувания, лоялност, кохезия и сходство по групи.</li>
<li><strong>Народни представители</strong> — биографии, снимки и разпределение на местата след обновяване от parliament.bg.</li>
<li><strong>Бизнес интереси на НП</strong> — нови декларации от Сметната палата и роли в Търговския регистър.</li>
<li><strong>Финансиране на партии</strong> — нови годишни финансови отчети, публикувани от Сметната палата.</li>
<li><strong>Социологически проучвания</strong> — нови предизборни и общи проучвания, добавени към таблицата за точност.</li>
<li><strong>Макро и регионални индикатори</strong> — нови серии от Евростат, Световна банка, Eurobarometer и НСИ.</li>
</ul>
<p>Записите се добавят автоматично от скриптовете в pipeline-а — всеки път, когато един от тях успешно обнови съответната част от данните.</p>`.trim(),
    english: {
      title: "Data Changes on electionsbg.com | electionsbg.com",
      description:
        "Public update log — when and what was refreshed in the site's datasets: roll-call votes, MP property declarations, polling, macro and regional indicators.",
      breadcrumbName: "Data changes",
      bodyHtml: `
<h1>Data changes on electionsbg.com</h1>
<p>The site regularly publishes new or updated datasets — from parliamentary roll-call votes and MP property declarations through macroeconomic and regional indicators. This page is the public log of those refreshes: on which date what was replaced, and where to look to see it in action.</p>
<h2>What is tracked</h2>
<ul>
<li><strong>Parliamentary roll-call votes</strong> — new sessions with loyalty, cohesion, and group-similarity metrics.</li>
<li><strong>Members of Parliament</strong> — biographies, photos, and seat allocations after a refresh from parliament.bg.</li>
<li><strong>MP business interests</strong> — new declarations filed with the Court of Audit and Commerce Registry roles.</li>
<li><strong>Party financing</strong> — new annual financial reports published by the Court of Audit.</li>
<li><strong>Opinion polls</strong> — new pre-election and general-track polls added to the accuracy table.</li>
<li><strong>Macro and regional indicators</strong> — new series from Eurostat, the World Bank, Eurobarometer, and the NSI.</li>
</ul>
<p>Entries are added automatically by the pipeline scripts — each time one of them successfully refreshes the corresponding slice of the data.</p>`.trim(),
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
<li><strong>Резултат на партия спрямо демография</strong> — точкова графика на областно ниво с коефициент на корелация (Pearson r) — изборният резултат на избрана партия срещу избрана демографска променлива.</li>
<li><strong>Сравнение по области</strong> и <strong>сравнение по общини</strong> — отделни сортируеми таблици на дъщерни страници (<code>/demographics/regions</code> и <code>/demographics/municipalities</code>) с филтър по име.</li>
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
<li><strong>Oblast comparison table</strong> and <strong>municipality comparison table</strong> — sortable, paginated tables on dedicated subpages (<code>/demographics/regions</code> and <code>/demographics/municipalities</code>) with a name filter.</li>
<li><strong>Per-oblast, per-obshtina and per-settlement dashboards</strong> — embedded demographic tile on every regional page (settlements show population, age and sex only — NSI doesn't publish ethnicity, religion or education at that granularity).</li>
</ul>
<p>Source: <a href="https://census2021.bg/" rel="nofollow noopener">NSI Population and Housing Census 2021</a>.</p>`.trim(),
    },
  }),
  staticPage({
    path: "demographics/regions",
    title: "Демография на 28-те области — Преброяване 2021 | electionsbg.com",
    description:
      "Сортируема таблица с демографските показатели на 28-те административни области от Преброяване 2021 на НСИ — население, етнос, вероизповедание, образование, възраст и заетост.",
    breadcrumbName: "Области — демография",
    bodyHtml: `
<h1>Демография по области — Преброяване 2021</h1>
<p>Преброяване 2021 на НСИ за 28-те административни области на България — население, етнически състав, вероизповедание, образование, възрастова структура и заетост, в сортируема таблица. София-град е представена като една област; областните данни не следят разделението на трите столични МИР, които съществуват само в електоралната статистика.</p>
<p>Източник: <a href="https://census2021.bg/" rel="nofollow noopener">Преброяване на населението и жилищния фонд 2021 г. на НСИ</a>.</p>`.trim(),
    english: {
      title: "Bulgaria oblast demographics — Census 2021 | electionsbg.com",
      description:
        "Sortable table with Census 2021 demographics for Bulgaria's 28 administrative oblasts — population, ethnicity, religion, education, age and employment.",
      breadcrumbName: "Oblast demographics",
      bodyHtml: `
<h1>Bulgaria oblast demographics — Census 2021</h1>
<p>NSI Census 2021 data for Bulgaria's 28 administrative oblasts — population, ethnic composition, religion, education attainment, age structure and employment, in a sortable table. Sofia City is represented as a single oblast; the three Sofia electoral districts (MIRs) only exist in the election dataset.</p>
<p>Source: <a href="https://census2021.bg/" rel="nofollow noopener">NSI Population and Housing Census 2021</a>.</p>`.trim(),
    },
  }),
  staticPage({
    path: "demographics/municipalities",
    title: "Демография на 265-те общини — Преброяване 2021 | electionsbg.com",
    description:
      "Сортируема таблица с демографските показатели на 265-те общини на България от Преброяване 2021 на НСИ — население, етнос, вероизповедание, образование, възраст и заетост, с филтър по име.",
    breadcrumbName: "Общини — демография",
    bodyHtml: `
<h1>Демография по общини — Преброяване 2021</h1>
<p>Преброяване 2021 на НСИ за 265-те общини на България — население, етнически състав, вероизповедание, образование, възрастова структура и заетост. Таблицата поддържа сортиране по всяка колона, филтър по име на общината и страниране (по 30 общини на страница).</p>
<p>Източник: <a href="https://census2021.bg/" rel="nofollow noopener">Преброяване на населението и жилищния фонд 2021 г. на НСИ</a>.</p>`.trim(),
    english: {
      title:
        "Bulgaria municipality demographics — Census 2021 | electionsbg.com",
      description:
        "Sortable table with Census 2021 demographics for Bulgaria's 265 municipalities — population, ethnicity, religion, education, age and employment, with a name filter.",
      breadcrumbName: "Municipality demographics",
      bodyHtml: `
<h1>Bulgaria municipality demographics — Census 2021</h1>
<p>NSI Census 2021 data for Bulgaria's 265 municipalities — population, ethnic composition, religion, education attainment, age structure and employment. The table supports per-column sorting, a name filter and pagination (30 municipalities per page).</p>
<p>Source: <a href="https://census2021.bg/" rel="nofollow noopener">NSI Population and Housing Census 2021</a>.</p>`.trim(),
    },
  }),
  staticPage({
    path: "risk-analysis",
    title: "Анализ на изборния риск — обобщен скрининг | electionsbg.com",
    description:
      "Композитен индекс на изборния риск плюс шест независими статистически сигнала: секционен скрининг, тест на Бенфорд, разлики с флаш паметта, концентрация на гласове, рискови махали и съответствие със социологията.",
    breadcrumbName: "Анализ на риска",
    ogImage: "/og/risk-analysis.png",
    bodyHtml: `
<h1>Анализ на изборния риск</h1>
<p>Тази страница обединява всеки статистически сигнал за рисково поведение, който публикуваме за избрания парламентарен вот. Композитният индекс на изборния риск дава една обобщена оценка от 0 до 100, а тилите под него позволяват разглеждане на всеки от отделните сигнали, които я съставят.</p>
<h2>Какво включва</h2>
<ul>
<li><a href="${SITE_URL}/risk-score">Скрининг на риска по секции</a> — композитна оценка от шест независими статистически теста за всяка избирателна секция.</li>
<li><a href="${SITE_URL}/benford">Закон на Бенфорд</a> — разпределение на първата и втората цифра в броя гласове по партии.</li>
<li>Машинно гласуване — секции с разминаване между протокола от флаш паметта и официалния протокол.</li>
<li>Концентрация на гласовете — секции с подозрително висок дял за една партия.</li>
<li>Рискови махали — секции в Ромските махали с исторически тренд.</li>
<li>Съпоставка със социологията — средни предизборни прогнози срещу окончателен резултат.</li>
</ul>
<p>Това е инструмент за <strong>скрининг</strong>, не присъда. Всеки сигнал има невинни обяснения и трябва да се чете в контекст. Виж <a href="${SITE_URL}/risk-analysis/methodology">пълната методология</a> за детайли.</p>`.trim(),
    english: {
      title:
        "Election Risk Analysis — Consolidated Screening | electionsbg.com",
      description:
        "Composite Election Risk Index plus six independent statistical signals: section-level risk score, Benford digit distributions, flash-memory drift, vote concentration, at-risk neighborhoods, and polling expectation gap.",
      breadcrumbName: "Risk analysis",
      bodyHtml: `
<h1>Election risk analysis</h1>
<p>This page consolidates every statistical screening signal we publish for the selected parliamentary vote. The Election Risk Index gives one rolled-up 0–100 reading, and the tiles below let you drill into each of the underlying signals that feed it.</p>
<h2>What's included</h2>
<ul>
<li><a href="${SITE_URL}/en/risk-score">Section-level risk screening</a> — composite score from six independent statistical tests per polling section.</li>
<li><a href="${SITE_URL}/en/benford">Benford's law</a> — first- and second-digit distributions of per-section vote counts, by party.</li>
<li>Machine voting — sections where the flash-memory protocol disagrees with the official protocol.</li>
<li>Vote concentration — sections with a suspiciously high single-party share.</li>
<li>At-risk neighborhoods — sections inside Roma neighborhoods with historical trend.</li>
<li>Polling expectation gap — pre-election poll averages against the final result.</li>
</ul>
<p>This is a <strong>screening</strong> tool, not a verdict. Each signal has innocent explanations and must be read in context. See the <a href="${SITE_URL}/en/risk-analysis/methodology">full methodology</a> for details.</p>`.trim(),
    },
  }),
  staticPage({
    path: "risk-analysis/methodology",
    title: "Индекс на изборния риск — методология | electionsbg.com",
    description:
      "Как се изчислява композитният индекс на изборния риск: тегла на шестте сигнала, скали, бенчмаркове и ограничения.",
    breadcrumbName: "Методология на анализа",
    ogImage: "/og/risk-analysis-methodology.png",
    bodyHtml: `
<h1>Индекс на изборния риск — методология</h1>
<p>Композитният Индекс на изборния риск свежда шест независими сигнала до една обобщена оценка от 0 до 100. Тази страница описва точно как се изчислява всеки от компонентите, как се претеглят и какво НЕ показва числото.</p>
<h2>Какво обхваща страницата</h2>
<ul>
<li>Кои са шестте сигнала и как се изчислява всеки поотделно.</li>
<li>Как се нормализират към единна 0–100 скала, преди да се обединят.</li>
<li>Тегла, прагове и категории (Нисък / Умерен / Висок / Критичен).</li>
<li>Кога индексът подвежда — малки извадки, демографски ефекти, законни корекции.</li>
</ul>
<p>Виж самата страница <a href="${SITE_URL}/risk-analysis">Анализ на изборния риск</a> за приложение върху последните избори.</p>`.trim(),
    english: {
      title: "Election Risk Index — Methodology | electionsbg.com",
      description:
        "How the composite Election Risk Index is built: weights on six signals, normalization, benchmarks, and limitations.",
      breadcrumbName: "Risk analysis methodology",
      bodyHtml: `
<h1>Election Risk Index — methodology</h1>
<p>The composite Election Risk Index distils six independent screening signals into a single 0–100 reading. This page documents exactly how each component is computed, how they are weighted, and what the number does not say.</p>
<h2>What this page covers</h2>
<ul>
<li>The six underlying signals and how each is computed.</li>
<li>How signals are normalized to a common 0–100 scale before they are combined.</li>
<li>Weights, thresholds, and bands (Low / Moderate / High / Critical).</li>
<li>When the index misleads — small samples, demographic effects, lawful recount corrections.</li>
</ul>
<p>See the <a href="${SITE_URL}/en/risk-analysis">Election Risk Analysis</a> page for the index applied to the latest election.</p>`.trim(),
    },
  }),
  staticPage({
    path: "risk-score",
    title:
      "Скрининг на риска по секции — парламентарни избори | electionsbg.com",
    description:
      "Композитна оценка 0–100 за всяка избирателна секция, която обединява шест независими сигнала: разлики при преброяване, разминаване с флаш паметта, дял невалидни бюлетини, допълнително вписани, концентрация и отклонение спрямо съседни секции.",
    breadcrumbName: "Скрининг на секциите",
    ogImage: "/og/risk-score.png",
    bodyHtml: `
<h1>Скрининг на риска по секции</h1>
<p>За всяка избирателна секция изчисляваме композитна оценка от 0 до 100, която обединява шест независими статистически сигнала, вече публикувани като отделни доклади. Висока оценка означава, че секцията заслужава по-внимателен преглед — не присъда.</p>
<h2>Шестте сигнала</h2>
<ul>
<li><strong>Разлики при преброяване</strong> — разлики между първото и второто броене на бюлетините.</li>
<li><strong>Разминаване с флаш паметта</strong> — несъответствие между официалния протокол и протокола от устройството за машинно гласуване.</li>
<li><strong>Дял невалидни бюлетини</strong> — секции с необичайно висок дял на недействителни гласове.</li>
<li><strong>Допълнително вписани</strong> — секции с непропорционално много дописани в избирателния списък.</li>
<li><strong>Концентрация</strong> — секции с подозрително висок дял за една партия.</li>
<li><strong>Отклонение спрямо съседни секции</strong> — резултати, които се различават статистически от близките секции в същото населено място.</li>
</ul>
<p>Виж <a href="${SITE_URL}/risk-score/methodology">пълната методология</a> за прагове, формули и категории.</p>`.trim(),
    english: {
      title:
        "Section-level Risk Screening — Bulgarian Parliamentary Elections | electionsbg.com",
      description:
        "Composite 0–100 score per polling section, combining six independent signals: recount delta, flash-memory mismatch, invalid-ballot share, additional voters, single-party concentration, and outlier vs. peer sections.",
      breadcrumbName: "Section risk screening",
      bodyHtml: `
<h1>Section-level risk screening</h1>
<p>Each polling section receives a composite 0–100 score combining six independent statistical signals already published as standalone reports. A high score means the section is statistically unusual along multiple dimensions and warrants a closer look — that is all.</p>
<h2>The six signals</h2>
<ul>
<li><strong>Recount delta</strong> — discrepancies between the first and second tally of ballots.</li>
<li><strong>Flash-memory mismatch</strong> — gap between the official protocol and the machine-voting device's protocol.</li>
<li><strong>Invalid-ballot share</strong> — sections with an unusually high share of invalid ballots.</li>
<li><strong>Additional voters</strong> — sections with a disproportionately high count of voters added on election day.</li>
<li><strong>Vote concentration</strong> — sections with a suspiciously high single-party share.</li>
<li><strong>Peer-section outliers</strong> — results that diverge statistically from nearby sections in the same settlement.</li>
</ul>
<p>See the <a href="${SITE_URL}/en/risk-score/methodology">full methodology</a> for thresholds, formulas, and bands.</p>`.trim(),
    },
  }),
  staticPage({
    path: "risk-score/methodology",
    title: "Скрининг на секциите — методология | electionsbg.com",
    description:
      "Точните дефиниции, прагове и формули зад секционния скрининг — как всеки от шестте сигнала се изчислява и как се обединяват в обща оценка.",
    breadcrumbName: "Методология на скрининга",
    ogImage: "/og/risk-score-methodology.png",
    bodyHtml: `
<h1>Скрининг на секциите — методология</h1>
<p>Тази страница описва как се изчислява композитната оценка за всяка избирателна секция: какво измерва всеки от шестте сигнала, какви прагове прилагаме и как се обединяват в едно число от 0 до 100.</p>
<h2>Шестте сигнала</h2>
<ul>
<li><strong>Разлики при преброяване</strong> — статистическо отклонение между първото и второто броене.</li>
<li><strong>Разминаване с флаш паметта</strong> — несъответствия между двата протокола.</li>
<li><strong>Дял невалидни бюлетини</strong> — секции, чийто дял е значително над общинския медиан.</li>
<li><strong>Допълнително вписани</strong> — % допълнителни избиратели спрямо първоначалния списък.</li>
<li><strong>Концентрация</strong> — индекс на Хърфиндал–Хиршман по партии.</li>
<li><strong>Отклонение спрямо съседни секции</strong> — z-score спрямо съседи в същото населено място.</li>
</ul>
<p>За резюме виж главната страница <a href="${SITE_URL}/risk-score">Скрининг на риска по секции</a>.</p>`.trim(),
    english: {
      title: "Section Risk Screening — Methodology | electionsbg.com",
      description:
        "Exact definitions, thresholds, and formulas behind the section-level risk screening — how each of the six signals is computed and how they are combined into a single score.",
      breadcrumbName: "Risk screening methodology",
      bodyHtml: `
<h1>Section risk screening — methodology</h1>
<p>This page documents how the composite score per polling section is built: what each of the six signals measures, the thresholds we apply, and how they are combined into a single 0–100 reading.</p>
<h2>The six signals</h2>
<ul>
<li><strong>Recount delta</strong> — statistical departure between the first and second tally.</li>
<li><strong>Flash-memory mismatch</strong> — discrepancies between the two protocols.</li>
<li><strong>Invalid-ballot share</strong> — sections significantly above the municipal median.</li>
<li><strong>Additional voters</strong> — share of voters added on top of the initial roll.</li>
<li><strong>Vote concentration</strong> — Herfindahl–Hirschman index across parties.</li>
<li><strong>Peer-section outliers</strong> — z-score against neighboring sections in the same settlement.</li>
</ul>
<p>For the live screen see <a href="${SITE_URL}/en/risk-score">Section-level risk screening</a>.</p>`.trim(),
    },
  }),
  staticPage({
    path: "benford",
    title:
      "Законът на Бенфорд по партии — парламентарни избори | electionsbg.com",
    description:
      "Разпределение на първата и втората цифра в броя гласове по секции, по партии. Сравнява наблюдаваните дялове с очакваната крива на Бенфорд, с обяснение защо отклонението не е доказателство за фалшификация.",
    breadcrumbName: "Закон на Бенфорд",
    ogImage: "/og/benford.png",
    bodyHtml: `
<h1>Законът на Бенфорд по партии</h1>
<p>Законът на Бенфорд описва закономерност в естествени числови масиви: водещата цифра не се появява с еднаква честота. Изборната криминалистика заимства теста с хипотезата, че изфабрикуваните резултати трудно биха следвали тази крива.</p>
<p>Тук показваме разпределението на първата и втората цифра в броя гласове по секции за всяка партия и го сравняваме с очакваната крива на Бенфорд. Литературата (Mebane) препоръчва теста за втора цифра (2BL) пред теста за първа цифра при изборни данни, тъй като броят на гласовете в секция е ограничен в малък диапазон.</p>
<p><strong>Това не е доказателство за фалшификация.</strong> Много чисти изборни данни не преминават теста за първа цифра. Виж <a href="${SITE_URL}/benford/methodology">пълната методология</a> за нюансите.</p>`.trim(),
    english: {
      title:
        "Benford's Law by Party — Bulgarian Parliamentary Elections | electionsbg.com",
      description:
        "First- and second-digit distributions of per-section vote counts, by party. Compares observed shares against the Benford-expected curve, with the caveats explaining why deviation is not evidence of fraud.",
      breadcrumbName: "Benford's law",
      bodyHtml: `
<h1>Benford's law by party</h1>
<p>Benford's law describes a regularity in many naturally-occurring numerical datasets: the leading digit does not appear with equal frequency. Election forensics borrowed the test on the hypothesis that fabricated results would struggle to follow the same curve.</p>
<p>This page shows the first- and second-digit distribution of per-section vote counts for each party against the Benford-expected curve. The literature (Mebane) recommends the second-digit test (2BL) over the first-digit test for election data, because per-section vote counts are range-bounded.</p>
<p><strong>This is not evidence of fraud.</strong> Plenty of clean electoral data fails the first-digit test. See the <a href="${SITE_URL}/en/benford/methodology">full methodology</a> for the nuances.</p>`.trim(),
    },
  }),
  staticPage({
    path: "benford/methodology",
    title: "Законът на Бенфорд — методология | electionsbg.com",
    description:
      "Защо съществува тестът на Бенфорд, какво показват резултатите му, защо предпочитаме теста за втора цифра (2BL) и кога отклоненията не бива да ни подвеждат.",
    breadcrumbName: "Методология на Бенфорд",
    ogImage: "/og/benford-methodology.png",
    bodyHtml: `
<h1>Законът на Бенфорд — методология</h1>
<p>Тази страница обяснява защо съществува тестът на Бенфорд, защо предпочитаме теста за втора цифра (2BL) пред този за първа цифра при изборни данни, какви прагове прилагаме и как се четат показателите MAD и χ². Целта е да направим прозрачно както какво може, така и какво не може да каже тестът.</p>
<h2>Какво ще намерите тук</h2>
<ul>
<li>Защо тестът за първа цифра често дава „отклонение“ при чисти изборни данни.</li>
<li>Защо 2BL (втора цифра) е препоръчителен — линията на Mebane.</li>
<li>Прагове: минимум 10 гласа на секция, минимум 30 секции на партия.</li>
<li>Категории по MAD: Близо до Бенфорд / Умерено / Силно отклонение.</li>
</ul>
<p>За приложението виж <a href="${SITE_URL}/benford">Закон на Бенфорд по партии</a>.</p>`.trim(),
    english: {
      title: "Benford's Law — Methodology | electionsbg.com",
      description:
        "Why this test exists, what its results actually tell us, why we prefer the second-digit test (2BL), and when deviations should not mislead us.",
      breadcrumbName: "Benford methodology",
      bodyHtml: `
<h1>Benford's law — methodology</h1>
<p>This page explains why the Benford test exists, why we prefer the second-digit test (2BL) to the first-digit test for election data, what thresholds we apply, and how MAD and χ² should be read. The goal is to make transparent both what the test can and cannot say.</p>
<h2>What you'll find</h2>
<ul>
<li>Why the first-digit test often shows "deviation" on clean electoral data.</li>
<li>Why 2BL (second digit) is preferred — Mebane's line of work.</li>
<li>Thresholds: minimum 10 votes per section, minimum 30 sections per party.</li>
<li>MAD bands: Close to Benford / Moderate / Strong deviation.</li>
</ul>
<p>For the live screen see <a href="${SITE_URL}/en/benford">Benford's law by party</a>.</p>`.trim(),
    },
  }),
  staticPage({
    path: "persistence",
    title:
      "Лоялност на гласоподавателите — парламентарни избори | electionsbg.com",
    description:
      "Дял на гласоподавателите за идентифицирани партии, които остават при същата партия между два последователни избора — измерено по секции с регресия Goodman и мащабиране RAS.",
    breadcrumbName: "Лоялност",
    ogImage: "/og/persistence.png",
    bodyHtml: `
<h1>Лоялност на гласоподавателите</h1>
<p>За всеки парламентарен вот изчисляваме каква част от гласоподавателите за идентифицирани партии са останали при същата партия между двата последователни избора. Това отделя партийната лоялност от колебанията в избирателната активност.</p>
<h2>Как се чете</h2>
<ul>
<li><strong>Дял на лоялните</strong> — % гласоподаватели, които са избрали същата партия и на двата вота.</li>
<li><strong>Сменили партия</strong> — % гласоподаватели, които са преминали при друга партия между двата избора.</li>
<li><strong>Най-голям преход</strong> — единичното най-голямо движение партия → партия (източник, цел, дял от изходящите гласове на партията-източник).</li>
<li><strong>По МИР</strong> — лоялност за всеки многомандатен район, плюс най-стабилните и най-колебливите.</li>
</ul>
<p>Лоялността е оценена от поток на гласовете по секции (NNLS Goodman регресия + RAS мащабиране). Сигналът е устойчив на регионално ниво, но е <strong>агрегирана оценка</strong>, не индивидуално измерване.</p>`.trim(),
    english: {
      title:
        "Voter Persistence — Bulgarian Parliamentary Elections | electionsbg.com",
      description:
        "Share of named-party voters who stayed with the same party across two consecutive elections — estimated from per-section vote flow with NNLS Goodman regression and RAS scaling.",
      breadcrumbName: "Voter persistence",
      bodyHtml: `
<h1>Voter persistence</h1>
<p>For each parliamentary vote we estimate what share of named-party voters stayed with the same party across two consecutive elections. This isolates party loyalty from swings in turnout.</p>
<h2>How to read it</h2>
<ul>
<li><strong>Stay rate</strong> — share of voters who chose the same named party in both elections.</li>
<li><strong>Churn</strong> — share of named-party voters who switched parties between cycles.</li>
<li><strong>Top defection</strong> — the single largest party-to-party movement (source, destination, share of source-party outflow).</li>
<li><strong>By region</strong> — loyalty per multi-mandate region, plus the most stable and most volatile regions.</li>
</ul>
<p>Persistence is estimated from per-section voter flow (NNLS Goodman regression + RAS scaling). The signal is robust at the regional level but is an <strong>aggregate estimate</strong>, not an individual-voter measurement.</p>`.trim(),
    },
  }),
  staticPage({
    path: "wasted-vote",
    title:
      "Изгубени гласове за партии под 4% — парламентарни избори | electionsbg.com",
    description:
      "Дял на действителните гласове, подадени за партии под прага от 4% — гласове, които не са избрали никого. Разбивка национално и по МИР.",
    breadcrumbName: "Изгубени гласове",
    ogImage: "/og/wasted-vote.png",
    bodyHtml: `
<h1>Изгубени гласове за партии под 4%</h1>
<p>В българската избирателна система партии под прага от 4% не получават мандати. Гласовете, подадени за тях, остават без представителство — често ги наричаме „изгубени гласове“.</p>
<h2>Какво се показва</h2>
<ul>
<li><strong>Изгубени национално</strong> — общ дял на гласовете за партии под прага.</li>
<li><strong>Близо до прага (2–4%)</strong> — партии, които са били почти на ръба.</li>
<li><strong>Под 2%</strong> — фрагментирани „маргинални“ гласове.</li>
<li><strong>По МИР</strong> — карта и сортируема таблица по многомандатни райони. Виж <a href="${SITE_URL}/wasted-vote/regions">пълния списък по области</a>.</li>
</ul>
<p>Изчисление: сума на гласовете за партии под 4% национален праг, разделена на общия брой действителни гласове.</p>`.trim(),
    english: {
      title:
        "Wasted Votes — Sub-4% Parties in Bulgarian Parliamentary Elections | electionsbg.com",
      description:
        "Share of valid votes cast for parties below the 4% national threshold — votes that elected nobody. National and per-region breakdown.",
      breadcrumbName: "Wasted votes",
      bodyHtml: `
<h1>Wasted votes — parties below 4%</h1>
<p>Bulgaria's electoral system gives no seats to parties under the 4% threshold. Votes cast for those parties end up with no representation — what we usually call "wasted votes".</p>
<h2>What you'll find</h2>
<ul>
<li><strong>Wasted nationally</strong> — total share of votes cast for sub-threshold parties.</li>
<li><strong>Almost made it (2–4%)</strong> — parties that came close to passing.</li>
<li><strong>Fringe (&lt;2%)</strong> — fragmented "margin" votes.</li>
<li><strong>By region</strong> — choropleth map plus sortable table by multi-mandate region. See the <a href="${SITE_URL}/en/wasted-vote/regions">full regional ranking</a>.</li>
</ul>
<p>Calculation: sum of votes for parties below the 4% national threshold, divided by total valid votes.</p>`.trim(),
    },
  }),
  staticPage({
    path: "wasted-vote/regions",
    title:
      "Изгубени гласове по области — парламентарни избори | electionsbg.com",
    description:
      "Сортируема таблица с дела на изгубените гласове за всеки от 28-те многомандатни района — гласове за партии под 4% национален праг.",
    breadcrumbName: "Изгубени гласове по МИР",
    ogImage: "/og/wasted-vote.png",
    bodyHtml: `
<h1>Изгубени гласове по области</h1>
<p>Пълна сортируема таблица по 28-те многомандатни избирателни района (МИР). За всяка област — общ брой действителни гласове, гласове за партии под 4% и дял изгубени гласове.</p>
<p>Виж и <a href="${SITE_URL}/wasted-vote">обобщеното представяне</a> на национално ниво с карта и топ партии под прага.</p>`.trim(),
    english: {
      title:
        "Wasted Votes by Region — Bulgarian Parliamentary Elections | electionsbg.com",
      description:
        "Sortable table of wasted-vote share across all 28 Bulgarian multi-mandate districts (MIR) — votes cast for parties below the 4% national threshold.",
      breadcrumbName: "Wasted votes by region",
      bodyHtml: `
<h1>Wasted votes by region</h1>
<p>Sortable table across Bulgaria's 28 multi-mandate districts (MIR). For each region — total valid votes, votes for sub-4% parties, and the wasted-vote share.</p>
<p>See also the <a href="${SITE_URL}/en/wasted-vote">national overview</a> with the choropleth map and top sub-threshold parties.</p>`.trim(),
    },
  }),
  staticPage({
    path: "where-did-votes-go/methodology",
    title: "Къде отидоха гласовете — методология | electionsbg.com",
    description:
      "Методология на анализа на потока на гласовете между две парламентарни сесии — NNLS Goodman регресия по секции, RAS мащабиране и ограниченията на агрегираната оценка.",
    breadcrumbName: "Методология на потока на гласовете",
    ogImage: "/og/vote-flow-methodology.png",
    bodyHtml: `
<h1>Къде отидоха гласовете — методология</h1>
<p>Анализът „Къде отидоха гласовете“ оценява потока от една партия към друга между два последователни вота на ниво многомандатен район. Тази страница описва статистическия метод зад оценките.</p>
<h2>Какво обхваща страницата</h2>
<ul>
<li>Goodman регресия с неотрицателни най-малки квадрати (NNLS) на ниво секция.</li>
<li>RAS мащабиране, което гарантира, че редовете и колоните на матрицата на прехода съответстват на наблюдаваните общи стойности.</li>
<li>Защо включваме „малки партии“ и негласувалите като отделни категории.</li>
<li>Кога методът подвежда — секции с малък брой гласоподаватели, демографски промени, новорегистрирани избиратели.</li>
</ul>
<p>Виж също <a href="${SITE_URL}/persistence">Лоялност на гласоподавателите</a>, която използва същия метод за измерване на партийната устойчивост.</p>`.trim(),
    english: {
      title: "Where Did Votes Go — Methodology | electionsbg.com",
      description:
        "Methodology behind the vote-flow analysis between two parliamentary cycles — per-section NNLS Goodman regression, RAS scaling, and the limits of an aggregate estimate.",
      breadcrumbName: "Vote-flow methodology",
      bodyHtml: `
<h1>Where did votes go — methodology</h1>
<p>The "where did votes go" analysis estimates flows from one party to another between two consecutive cycles at the multi-mandate region level. This page documents the statistical method behind the estimates.</p>
<h2>What this page covers</h2>
<ul>
<li>Non-negative least squares (NNLS) Goodman regression at the section level.</li>
<li>RAS scaling, which forces the row and column sums of the transition matrix to match observed totals.</li>
<li>Why "small parties" and abstainers are included as their own categories.</li>
<li>When the method misleads — sections with few voters, demographic change, newly registered voters.</li>
</ul>
<p>See also <a href="${SITE_URL}/en/persistence">Voter persistence</a>, which uses the same method to measure party loyalty.</p>`.trim(),
    },
  }),
  staticPage({
    path: "connections",
    title: "Бизнес-връзки между народните представители | electionsbg.com",
    description:
      "Графика на бизнес-връзките между действащите народни представители — общи фирми, имуществени декларации и пътища между депутати от различни партии.",
    breadcrumbName: "Бизнес-връзки",
    ogImage: "/og/connections.png",
    bodyHtml: `
<h1>Бизнес-връзки между народните представители</h1>
<p>Графиката на бизнес-връзките показва кои действащи народни представители са свързани чрез обща фирма, съвместно акционерство или роли в управлението. Източник са декларациите, подадени пред Сметната палата, и публичните данни от Търговския регистър.</p>
<h2>Какво ще намерите тук</h2>
<ul>
<li>Графика на връзките с разцветяване по партийна група.</li>
<li>Откриване на пътища между двама конкретни депутати.</li>
<li><a href="${SITE_URL}/mp/companies">Списък на всички фирми</a> с поне един депутат-собственик или ръководител.</li>
<li><a href="${SITE_URL}/mp-assets">Класиране на депутатите</a> по декларирани активи.</li>
<li><a href="${SITE_URL}/mp-cars">Декларирани коли</a> на народните представители.</li>
</ul>
<p>Източник: <a href="https://register.cacbg.bg" rel="nofollow noopener">register.cacbg.bg</a> (Сметна палата) и <a href="https://www.registryagency.bg" rel="nofollow noopener">Търговски регистър</a>.</p>`.trim(),
    english: {
      title: "MP Business Connections — Bulgarian Parliament | electionsbg.com",
      description:
        "Network graph of business connections among sitting Bulgarian MPs — shared companies, asset declarations, and paths between MPs from different parties.",
      breadcrumbName: "MP business connections",
      bodyHtml: `
<h1>MP business connections</h1>
<p>The business-connections graph shows which sitting Bulgarian MPs are connected through a shared company, joint shareholding, or roles on the same board. Sources: declarations filed with the Bulgarian Court of Audit, and public Commerce Registry filings.</p>
<h2>What you'll find</h2>
<ul>
<li>Network graph coloured by parliamentary group.</li>
<li>Path-finding between any two named MPs.</li>
<li><a href="${SITE_URL}/en/mp/companies">List of all companies</a> with at least one MP owner or director.</li>
<li><a href="${SITE_URL}/en/mp-assets">MPs ranked</a> by declared assets.</li>
<li><a href="${SITE_URL}/en/mp-cars">Cars declared</a> by MPs.</li>
</ul>
<p>Sources: <a href="https://register.cacbg.bg" rel="nofollow noopener">register.cacbg.bg</a> (Court of Audit) and the <a href="https://www.registryagency.bg" rel="nofollow noopener">Bulgarian Commerce Registry</a>.</p>`.trim(),
    },
  }),
  staticPage({
    path: "mp/companies",
    title: "Фирми с участие на народни представители | electionsbg.com",
    description:
      "Списък на всички фирми, в които действащите народни представители са собственици, акционери или членове на управлението — данни от Търговския регистър и декларациите на Сметната палата.",
    breadcrumbName: "Фирми на депутати",
    ogImage: "/og/mp-companies.png",
    bodyHtml: `
<h1>Фирми с участие на народни представители</h1>
<p>Списък на всички фирми, в които поне един действащ народен представител фигурира като собственик, акционер или роля в управлението. Данните се обединяват от декларациите, подадени пред Сметната палата, и от публичните филинги в Търговския регистър.</p>
<p>За мрежовия изглед виж <a href="${SITE_URL}/connections">Бизнес-връзки между депутатите</a>.</p>`.trim(),
    english: {
      title:
        "Companies Owned or Run by MPs — Bulgarian Parliament | electionsbg.com",
      description:
        "Every company in which a sitting Bulgarian MP is an owner, shareholder, or board member — sourced from the Commerce Registry and Court of Audit declarations.",
      breadcrumbName: "MP companies",
      bodyHtml: `
<h1>Companies owned or run by MPs</h1>
<p>Every company in which at least one sitting Bulgarian MP figures as an owner, shareholder, or role on the board. Data is combined from declarations filed with the Court of Audit and public filings in the Commerce Registry.</p>
<p>For the network view see <a href="${SITE_URL}/en/connections">MP business connections</a>.</p>`.trim(),
    },
  }),
  staticPage({
    path: "mp-assets",
    title: "Народни представители по декларирани активи | electionsbg.com",
    description:
      "Класиране на действащите народни представители по декларирано имущество — недвижими имоти, превозни средства, парични средства, инвестиции и дялове във фирми (декларант + съпруг).",
    breadcrumbName: "Активи на депутати",
    ogImage: "/og/mp-assets.png",
    bodyHtml: `
<h1>Народни представители по декларирани активи</h1>
<p>Класиране на действащите народни представители по нетното имущество, декларирано в последната подадена декларация пред Сметната палата. Нетното имущество се изчислява като сума на декларираните недвижими имоти, превозни средства, парични средства и банкови депозити, вземания, инвестиции, ценни книжа и дялове във фирми (декларант + съпруг), намалена с декларираните задължения.</p>
<p>Източник: <a href="https://register.cacbg.bg" rel="nofollow noopener">register.cacbg.bg</a> (Сметна палата).</p>`.trim(),
    english: {
      title: "MPs by Declared Assets — Bulgarian Parliament | electionsbg.com",
      description:
        "Sitting Bulgarian MPs ranked by net worth from their most recent property/interest declaration filed with the Court of Audit (declarant + spouse, minus declared debts).",
      breadcrumbName: "MPs by assets",
      bodyHtml: `
<h1>MPs by declared assets</h1>
<p>Sitting Bulgarian MPs ranked by net worth from their most recent property/interest declaration filed with the Court of Audit. Net worth is the sum of declared real estate, vehicles, cash, bank deposits, receivables, investments, securities and company shares (declarant + spouse) minus declared debts.</p>
<p>Source: <a href="https://register.cacbg.bg" rel="nofollow noopener">register.cacbg.bg</a> (Bulgarian Court of Audit).</p>`.trim(),
    },
  }),
  staticPage({
    path: "mp-cars",
    title: "Коли, декларирани от народните представители | electionsbg.com",
    description:
      "Всеки лек автомобил или джип, деклариран от действащ депутат (или съпруг), от последната подадена декларация — подреден по декларирана стойност в лева.",
    breadcrumbName: "Коли на депутати",
    ogImage: "/og/mp-cars.png",
    bodyHtml: `
<h1>Коли, декларирани от народните представители</h1>
<p>Всеки лек автомобил или джип, деклариран от действащ народен представител (или съпруг) в последната подадена пред Сметната палата декларация — подреден по декларирана стойност в лева. Колите на съпругата/съпруга се показват с притежател „съпруг“.</p>
<p>Източник: <a href="https://register.cacbg.bg" rel="nofollow noopener">register.cacbg.bg</a> (Сметна палата).</p>`.trim(),
    english: {
      title: "Cars Declared by MPs — Bulgarian Parliament | electionsbg.com",
      description:
        "Every passenger car or jeep declared by a sitting Bulgarian MP (or spouse) in their most recent declaration, sorted by declared BGN value.",
      breadcrumbName: "MP cars",
      bodyHtml: `
<h1>Cars declared by MPs</h1>
<p>Every passenger car or jeep declared by a sitting MP (or spouse) in their most recent declaration filed with the Court of Audit — sorted by declared BGN value. Spouse-held cars are listed with holder = spouse.</p>
<p>Source: <a href="https://register.cacbg.bg" rel="nofollow noopener">register.cacbg.bg</a> (Bulgarian Court of Audit).</p>`.trim(),
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
  staticPage({
    path: "parliament",
    title:
      "Парламент — анализ на гласуванията в Народното събрание | electionsbg.com",
    description:
      "Анализ на поименните гласувания в българското Народно събрание — архив на заседанията, партийна дисциплина, гласови близнаци и UMAP визуализация на гласовото пространство.",
    breadcrumbName: "Парламент",
    ogImage: "/og/parliament.png",
    bodyHtml: `
<h1>Парламент — анализ на гласуванията</h1>
<p>Аналитични страници върху поименните гласувания в българското Народно събрание. Данните се извличат от стенограмите на parliament.bg.</p>
<ul>
<li><a href="${SITE_URL}/votes">Архив на поименните гласувания</a> по заседания, с разбивка по точка и парламентарна група.</li>
<li><a href="${SITE_URL}/parliament/cohesion">Партийна дисциплина</a> — колко обединени гласуват членовете на всяка група, с динамика по време.</li>
<li>Гласови близнаци — кои депутати гласуват най-сходно с други, с акцент на близнаци от различни групи. Достъпни от страницата на всеки депутат.</li>
<li><a href="${SITE_URL}/parliament/embedding">Гласово пространство</a> — UMAP визуализация на цялото гласово поведение.</li>
</ul>`.trim(),
    english: {
      title:
        "Parliament — Bulgarian National Assembly Voting Analytics | electionsbg.com",
      description:
        "Roll-call voting analytics for the Bulgarian National Assembly — session archive, group cohesion, voting twins, and a UMAP map of MP voting behaviour.",
      breadcrumbName: "Parliament",
      bodyHtml: `
<h1>Parliament — voting analytics</h1>
<p>Analytical views over roll-call voting in the Bulgarian National Assembly. Data is sourced from parliament.bg stenograms.</p>
<ul>
<li><a href="${SITE_URL}/en/votes">Roll-call vote archive</a>, broken down per item and per parliamentary group.</li>
<li><a href="${SITE_URL}/en/parliament/cohesion">Group cohesion</a> — how unified each parliamentary group votes, with a per-session trend.</li>
<li>Voting twins — which MPs vote most similarly, surfacing twins from different groups. Available from each MP's candidate page.</li>
<li><a href="${SITE_URL}/en/parliament/embedding">Voting space</a> — UMAP projection of every MP's voting behaviour.</li>
</ul>`.trim(),
    },
  }),
  staticPage({
    path: "parliament/embedding",
    title:
      "Гласовото пространство на Народното събрание — UMAP визуализация | electionsbg.com",
    description:
      "2D проекция (UMAP) на гласуванията на всеки действащ народен представител. Депутати, които гласуват сходно, се появяват близо един до друг — клъстерите разкриват неформални блокове.",
    breadcrumbName: "Гласово пространство",
    ogImage: "/og/parliament-embedding.png",
    bodyHtml: `
<h1>Гласовото пространство на Народното събрание</h1>
<p>Всяка точка е един депутат. Разстоянието приближено отразява колко различно гласуват двама депутати — съседите гласуват по същия начин в по-голяма част от случаите.</p>
<p>Подредбата е UMAP проекция на векторите от поименните гласувания (за / против / въздържал се) на всеки депутат. Цветът показва парламентарната група. Клъстерите разкриват неформалните блокове.</p>
<p>Виж и <a href="${SITE_URL}/parliament/cohesion">партийната дисциплина</a> и <a href="${SITE_URL}/votes">архива на поименните гласувания</a>.</p>`.trim(),
    english: {
      title: "MP Voting Space — UMAP Embedding | electionsbg.com",
      description:
        "2D UMAP projection of every sitting Bulgarian MP's roll-call vote vector. MPs who vote similarly appear close together; clusters reveal informal blocs.",
      breadcrumbName: "Voting space",
      bodyHtml: `
<h1>MP voting space</h1>
<p>Each dot is one MP. Distance approximates how differently two MPs vote — neighbours vote the same way most of the time.</p>
<p>Layout is a UMAP projection of the full vote-vector space, coloured by parliamentary group. Clusters reveal informal blocs.</p>
<p>See also <a href="${SITE_URL}/en/parliament/cohesion">parliamentary group cohesion</a> and the <a href="${SITE_URL}/en/votes">roll-call archive</a>.</p>`.trim(),
    },
  }),
  staticPage({
    path: "parliament/cohesion",
    title:
      "Партийна дисциплина в Народното събрание — обединеност при гласуване | electionsbg.com",
    description:
      "Колко обединени гласуват парламентарните групи в българското Народно събрание — средна и медианна обединеност по точки, размер на групата и брой обхванати гласувания.",
    breadcrumbName: "Партийна дисциплина",
    ogImage: "/og/parliament-cohesion.png",
    bodyHtml: `
<h1>Партийна дисциплина в Народното събрание</h1>
<p>За всяка точка, по която Народното събрание гласува, измерваме каква част от членовете на дадена парламентарна група са гласували еднакво. След това усредняваме по всички точки в текущия мандат.</p>
<p>1,00 означава, че всеки път цялата група е гласувала по един и същ начин; 0,50 означава равноделно разцепление. Отсъствията не се отчитат.</p>
<p>Виж и <a href="${SITE_URL}/votes">архива на поименните гласувания</a> и <a href="${SITE_URL}/connections">бизнес-връзките между депутатите</a>.</p>`.trim(),
    english: {
      title:
        "Parliamentary Group Cohesion — Bulgarian National Assembly | electionsbg.com",
      description:
        "How unified the parliamentary groups vote in Bulgaria's National Assembly — mean and median cohesion per item, group size, and items covered.",
      breadcrumbName: "Group cohesion",
      bodyHtml: `
<h1>Parliamentary group cohesion</h1>
<p>For each item on which the National Assembly votes, we measure the share of a group's members who voted the same way. We then average across every item in the current parliament.</p>
<p>1.00 means the entire group voted identically every time; 0.50 is an even split. Absences are excluded.</p>
<p>See also the <a href="${SITE_URL}/en/votes">archive of roll-call votes</a> and the <a href="${SITE_URL}/en/connections">business-connections graph</a>.</p>`.trim(),
    },
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
