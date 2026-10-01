// The /privacy notice — ONE source for both the React screen and the prerendered HTML
// (scripts/prerender/routes.ts), so the two cannot publish different promises.
//
// Plan: docs/plans/gdpr-consent-v1.md. The "people in our data" section is an INTERIM text
// pending legal review (Phase 2); everything else describes what the code does today and must be
// kept true as the code changes. Two gates hold it:
//   • privacyContent.test.ts — every file that writes browser storage is listed in STORAGE_ROWS
//     (so "no consent needed" stays true), and every section renders in both languages.
//   • The analytics seam (src/lib/analytics.ts) refuses query strings and free-text props, which
//     is what the #analytics section promises.
//
// Deliberately NOT i18n keys: this is ~15 KB of text per language, and the core translation
// bundle is downloaded by every page. It lives in the lazily-loaded screen's own chunk instead.
//
// Inline links use a tiny `[label](href)` syntax, parsed by `parseInline` for both renderers.

import { escHtml, inlineHtml } from "@/lib/inlineMarkup";

export type Lang = "bg" | "en";
type Text = Record<Lang, string>;

/** The data controller — the site owner, as a natural person (plan §2). */
export const CONTROLLER_NAME: Text = {
  bg: "Атанас Стоянов",
  en: "Atanas Stoyanov",
};
export const CONTACT_EMAIL = "support@electionsbg.com";
export const PRIVACY_UPDATED = "2026-10-01";

export type Block =
  | { kind: "p"; text: Text }
  | { kind: "ul"; items: Text[] }
  | { kind: "table"; head: Text[]; rows: Text[][] };

export type Section = { id: string; heading: Text; blocks: Block[] };

/** One row per browser-storage key the site writes. `files` is what the gate checks. */
export type StorageRow = {
  key: string;
  kind: "localStorage" | "sessionStorage";
  purpose: Text;
  files: string[];
};

export const STORAGE_ROWS: StorageRow[] = [
  {
    key: "language",
    kind: "localStorage",
    purpose: { bg: "избраният език", en: "the language you chose" },
    files: ["src/i18n.ts"],
  },
  {
    key: "theme",
    kind: "localStorage",
    purpose: { bg: "светла или тъмна тема", en: "light or dark theme" },
    files: ["src/theme/ThemeContext.tsx"],
  },
  {
    key: "map_with_names, map_with_shift_arrows",
    kind: "localStorage",
    purpose: { bg: "настройки на картите", en: "map display settings" },
    files: ["src/layout/dataview/OptionsContext.tsx"],
  },
  {
    key: "consolidated_history",
    kind: "localStorage",
    purpose: {
      bg: "изглед на историята на партиите",
      en: "party-history view setting",
    },
    files: ["src/data/ConsolidatedContext.tsx"],
  },
  {
    key: "reports_include_abroad",
    kind: "localStorage",
    purpose: {
      bg: "дали докладите включват секциите в чужбина",
      en: "whether reports include polling stations abroad",
    },
    files: ["src/screens/reports/common/ReportTemplate.tsx"],
  },
  {
    key: "naiasno_cta_dismissed_until",
    kind: "localStorage",
    purpose: {
      bg: "скрита покана за общността",
      en: "a dismissed community invitation",
    },
    files: ["src/screens/components/CommunityCtaStrip.tsx"],
  },
  {
    key: "naiasno.watchlist.v1",
    kind: "localStorage",
    purpose: { bg: "хората, които следите", en: "people you follow" },
    files: ["src/lib/watchlist.ts"],
  },
  {
    key: "naiasno.procurement.watchlist.*",
    kind: "localStorage",
    purpose: {
      bg: "поръчките и фирмите, които следите, и кои промени сте видели",
      en: "procurement items you follow and which changes you have seen",
    },
    files: ["src/data/procurement/useWatchlist.ts"],
  },
  {
    key: "naiasno.consumption.basket.v1",
    kind: "localStorage",
    purpose: { bg: "вашата потребителска кошница", en: "your shopping basket" },
    files: ["src/data/prices/useBasket.ts"],
  },
  {
    key: "policy_sim_submitted_*",
    kind: "localStorage",
    purpose: {
      bg: "че вече сте изпратили даден бюджетен сценарий (без съдържанието му)",
      en: "that you already submitted a budget scenario (not its contents)",
    },
    files: ["src/data/budget/usePublicScenarios.ts"],
  },
  {
    key: "sqlbrowser.history.v1, sqlbrowser.saved.v1",
    kind: "localStorage",
    purpose: {
      bg: "история и запазени заявки в SQL браузъра",
      en: "query history and saved queries in the SQL browser",
    },
    files: ["src/screens/dev/SqlBrowserScreen.tsx"],
  },
  {
    key: "naiasno.chat.v1, naiasno.chat.history.v1",
    kind: "localStorage",
    purpose: {
      bg: "разговорът и историята на въпросите в AI чата — само в този браузър",
      en: "the AI chat conversation and question history — in this browser only",
    },
    files: ["ai/app/Chat.tsx"],
  },
  {
    key: "naiasno.model.v1",
    kind: "localStorage",
    purpose: { bg: "избраният режим на чата", en: "the chat mode you chose" },
    files: ["ai/llm/useModelEngine.ts"],
  },
  {
    key: "naiasno.tools.recent.v1",
    kind: "localStorage",
    purpose: {
      bg: "последно отваряните инструменти на чата",
      en: "recently opened chat tools",
    },
    files: ["ai/app/Explorer.tsx"],
  },
  {
    key: "stale-chunk-reloaded",
    kind: "sessionStorage",
    purpose: {
      bg: "техническо: предпазва от безкрайно презареждане след обновяване на сайта",
      en: "technical: prevents an endless reload loop after a site update",
    },
    files: ["src/main.tsx"],
  },
];

/** Files that write browser storage but never run on the public site, with the reason. */
export const STORAGE_WRITER_EXCEPTIONS: Record<string, string> = {
  "ai/llm/fcEval.browser.ts":
    "offline evaluation harness; not imported by any page",
};

const P = (bg: string, en: string): Block => ({ kind: "p", text: { bg, en } });
const L = (...items: [string, string][]): Block => ({
  kind: "ul",
  items: items.map(([bg, en]) => ({ bg, en })),
});
const T = (bg: string, en: string): Text => ({ bg, en });

const controllerLine = (lang: Lang) => {
  const name = CONTROLLER_NAME[lang];
  const who =
    lang === "bg"
      ? name
        ? `${name}, физическо лице, което поддържа naiasno.bg`
        : "Физическото лице, което поддържа naiasno.bg"
      : name
        ? `${name}, the natural person who runs naiasno.bg`
        : "The natural person who runs naiasno.bg";
  return lang === "bg"
    ? `${who}. За всякакви въпроси за личните данни: [${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL}). Сайтът по-рано работеше като electionsbg.com — това е същият оператор.`
    : `${who}. For any question about personal data: [${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL}). The site was previously electionsbg.com — it is the same operator.`;
};

export const privacySections = (): Section[] => [
  {
    id: "summary",
    heading: T("Накратко", "In short"),
    blocks: [
      L(
        [
          "Не използваме бисквитки, реклама, профилиране или проследяване между сайтове.",
          "We use no cookies, no advertising, no profiling and no cross-site tracking.",
        ],
        [
          "Затова няма банер за съгласие — законът изисква съгласие само за несъществено записване на данни в устройството ви, а ние не правим такова (виж „Какво пазим във вашия браузър“).",
          "That is why there is no consent banner — the law requires consent only for non-essential storage on your device, and we do none (see “What we keep in your browser”).",
        ],
        [
          "Статистиката за посещенията е наша, без бисквитки и без да пазим IP адреса ви.",
          "Visit statistics are self-hosted, cookieless, and do not store your IP address.",
        ],
        [
          "Ако ползвате AI чата, въпросът ви се изпраща на Google Gemini — не въвеждайте лични данни в него.",
          "If you use the AI chat, your question is sent to Google Gemini — do not enter personal data into it.",
        ],
      ),
    ],
  },
  {
    id: "controller",
    heading: T("Кой отговаря за данните", "Who is responsible"),
    blocks: [
      {
        kind: "p",
        text: { bg: controllerLine("bg"), en: controllerLine("en") },
      },
    ],
  },
  {
    id: "visit",
    heading: T("Когато отворите сайта", "When you visit"),
    blocks: [
      P(
        "Сайтът се обслужва от Google Cloud (Firebase Hosting, Cloud Run, Cloud Storage, Cloud SQL). Както всеки уеб сървър, при всяка заявка те получават IP адреса ви, браузъра и адреса на страницата. Google пази тези технически журнали до 30 дни. Използваме IP адреса и в паметта на сървъра за ограничаване на прекомерни заявки, без да го записваме. Основание: легитимен интерес (сигурна и работеща услуга), чл. 6(1)(е) ОРЗД.",
        "The site is served by Google Cloud (Firebase Hosting, Cloud Run, Cloud Storage, Cloud SQL). Like any web server, they receive your IP address, browser and the page address with every request. Google keeps these technical logs for up to 30 days. We also use the IP address in server memory to rate-limit excessive requests, without storing it. Legal basis: legitimate interest (a secure, working service), Art. 6(1)(f) GDPR.",
      ),
      P(
        "Базата данни и повечето услуги са в Германия (Франкфурт). Функциите на AI чата и бюджетния симулатор работят в САЩ; предаването към Google LLC става въз основа на Рамката за защита на данните ЕС–САЩ.",
        "The database and most services are in Germany (Frankfurt). The AI chat and budget-simulator functions run in the US; the transfer to Google LLC relies on the EU–US Data Privacy Framework.",
      ),
    ],
  },
  {
    id: "analytics",
    heading: T("Статистика за посещенията", "Visit statistics"),
    blocks: [
      P(
        "Броим посещенията с [Umami](https://umami.is), инсталиран на наш сървър във Франкфурт — данните не отиват при трета страна. Umami не поставя бисквитки и не записва нищо в браузъра ви. Записваме: коя страница (без параметрите след „?“ и без заглавието ѝ), от кой сайт идвате, държава и област (никога град), вид браузър, операционна система, тип устройство, размер на екрана и език. IP адресът се използва само за определяне на държавата и областта и за анонимен идентификатор, който се сменя всеки ден (затова не можем да разпознаем повторно посещение), и не се съхранява. Ако браузърът ви изпраща сигнал „Do Not Track“, не броим посещението.",
        "We count visits with [Umami](https://umami.is), installed on our own server in Frankfurt — the data does not go to a third party. Umami sets no cookies and writes nothing to your browser. We record: which page (without the parameters after “?” and without its title), which site you came from, country and region (never the city), browser type, operating system, device type, screen size and language. The IP address is used only to derive the country and region and an anonymous identifier that changes every day (so we cannot recognise a return visit), and is not stored. If your browser sends a “Do Not Track” signal, the visit is not counted.",
      ),
      P(
        "Броим и някои действия (например че е направено търсене и колко резултата е имало) — но никога текста на търсенето или името на резултата, защото той често е име на човек. Данните се пазят до 25 месеца. Основание: легитимен интерес (да знаем кои части от сайта се ползват), чл. 6(1)(е) ОРЗД.",
        "We also count some actions (for example that a search was made and how many results it had) — but never the search text or the name of the result, because that is often a person’s name. The data is kept for up to 25 months. Legal basis: legitimate interest (knowing which parts of the site are used), Art. 6(1)(f) GDPR.",
      ),
    ],
  },
  {
    id: "ai",
    heading: T("AI чат", "AI chat"),
    blocks: [
      L(
        [
          "Въпросът и контекстът на разговора се изпращат през нашия сървър към Google Gemini (Google LLC), който генерира отговора. Използваме платения план на Gemini API, при който според условията на Google въпросите не се използват за подобряване на продуктите му; Google ги пази ограничено време за предотвратяване на злоупотреби.",
          "Your question and the conversation context are sent through our server to Google Gemini (Google LLC), which generates the answer. We use the paid tier of the Gemini API, under whose terms Google does not use the questions to improve its products; Google keeps them for a limited time for abuse prevention.",
        ],
        [
          "Cloudflare Turnstile проверява, че не сте робот, преди да започне AI сесия.",
          "Cloudflare Turnstile checks that you are not a bot before an AI session starts.",
        ],
        [
          "За дневните лимити сървърът пази хеширан идентификатор на IP адреса, който се изтрива автоматично след 2 дни.",
          "For the daily limits the server keeps a hashed identifier of your IP address, deleted automatically after 2 days.",
        ],
        [
          "Разговорът се пази само във вашия браузър. Ние не съхраняваме текста на въпросите.",
          "The conversation is kept only in your browser. We do not store the text of your questions.",
        ],
        [
          "Гласовото въвеждане използва разпознаването на реч на браузъра ви; в Chrome звукът се обработва от Google като доставчик на браузъра, не от нас.",
          "Voice input uses your browser’s speech recognition; in Chrome the audio is processed by Google as the browser vendor, not by us.",
        ],
      ),
      P(
        "Моля, не въвеждайте лични или поверителни данни във въпросите.",
        "Please do not enter personal or confidential information in your questions.",
      ),
    ],
  },
  {
    id: "scenarios",
    heading: T("Бюджетен симулатор", "Budget simulator"),
    blocks: [
      P(
        "Ако изпратите сценарий, пазим избраните стойности и изчислените резултати — без данни за вас — за обобщението „Какво избра публиката“. За да не се брои един сценарий многократно, за един ден пазим хеш на IP адреса ви; той се изтрива автоматично след 2 дни. Основание: легитимен интерес (честна статистика), чл. 6(1)(е) ОРЗД.",
        "If you submit a scenario, we keep the chosen values and computed results — with nothing about you — for the “What the public chose” summary. To avoid counting one scenario repeatedly, we keep a hash of your IP address for one day; it is deleted automatically after 2 days. Legal basis: legitimate interest (honest statistics), Art. 6(1)(f) GDPR.",
      ),
    ],
  },
  {
    id: "maps",
    heading: T("Карти и местоположение", "Maps and location"),
    blocks: [
      P(
        "Когато страница показва подробна карта, фоновите плочки се зареждат от [OpenStreetMap](https://osmfoundation.org/wiki/Privacy_Policy) (Фондация OpenStreetMap, Обединеното кралство — страна с решение за адекватност). Тя получава IP адреса ви и адреса на нашия сайт. На страници без такава карта не се свързваме с OpenStreetMap.",
        "When a page shows a detailed map, the background tiles load from [OpenStreetMap](https://osmfoundation.org/wiki/Privacy_Policy) (the OpenStreetMap Foundation, UK — a country with an adequacy decision). It receives your IP address and our site’s address. Pages without such a map do not contact OpenStreetMap.",
      ),
      P(
        "Бутонът „Моят район“ може да поиска местоположението ви. Браузърът ви пита първо; координатите се сравняват със списъка на населените места във вашия браузър и не се изпращат никъде.",
        "The “My area” button can ask for your location. Your browser asks first; the coordinates are matched against the list of settlements inside your browser and are not sent anywhere.",
      ),
    ],
  },
  {
    id: "storage",
    heading: T("Какво пазим във вашия браузър", "What we keep in your browser"),
    blocks: [
      P(
        "Сайтът не поставя бисквитки. Пази в браузъра ви само настройки, които сте избрали, и неща, които сте поискали да бъдат запазени. Те не се изпращат до нас и не служат за проследяване, затова според чл. 4а от Закона за електронните съобщения за тях не е нужно съгласие. Можете да ги изтриете по всяко време от настройките на браузъра.",
        "The site sets no cookies. It keeps in your browser only settings you chose and things you asked it to save. They are not sent to us and are not used for tracking, so under Art. 4a of the Bulgarian Electronic Communications Act they need no consent. You can delete them at any time in your browser settings.",
      ),
      {
        kind: "table",
        // Two columns, not three: a separate "type" column squeezed the key column on a phone
        // until `language` broke mid-word, and only one row is not localStorage.
        head: [T("Ключ", "Key"), T("За какво", "Purpose")],
        rows: STORAGE_ROWS.map((r) => [
          { bg: r.key, en: r.key },
          r.kind === "sessionStorage"
            ? {
                bg: `${r.purpose.bg} (изтрива се при затваряне на раздела)`,
                en: `${r.purpose.en} (cleared when the tab closes)`,
              }
            : r.purpose,
        ]),
      },
    ],
  },
  {
    id: "people",
    heading: T("Хората в нашите данни", "People in our data"),
    blocks: [
      P(
        "Сайтът публикува данни за лица с публична роля — народни представители, министри, кметове, общински съветници, магистрати, кандидати — както и за дарители на партии и за частни собственици и управители на фирми, получили публични средства, и за физически лица — изпълнители на обществени поръчки. Данните идват от публични регистри: ЦИК, Народното събрание, Сметната палата, Инспектората към ВСС, Търговския регистър, АОП, ИСУН, ДФ „Земеделие“ и общинските съвети. Обработваме ги в обществен интерес — прозрачност на властта и на публичните средства — въз основа на легитимен интерес (чл. 6(1)(е) ОРЗД) и свободата на изразяване и информация (чл. 85 ОРЗД, чл. 25з ЗЗЛД).",
        "The site publishes data about people with a public role — MPs, ministers, mayors, municipal councillors, magistrates, candidates — and about party donors and private owners and managers of companies that received public money, and natural persons who are public-procurement contractors. The data comes from public registers: the Central Election Commission, the National Assembly, the National Audit Office, the Inspectorate to the Supreme Judicial Council, the Commercial Register, the Public Procurement Agency, the EU-funds system ИСУН, State Fund Agriculture and the municipal councils. We process it in the public interest — transparency of power and of public money — on the basis of legitimate interest (Art. 6(1)(f) GDPR) and freedom of expression and information (Art. 85 GDPR, Art. 25h of the Bulgarian Personal Data Protection Act).",
      ),
      P(
        "Не съхраняваме ЕГН. Някои регистри посочват хората само с име. Тогава свързваме човек с фирма по името единствено при строги условия: пълно трииметно име, не повече от 5 фирми и връзка с публични средства. Профилите на частни лица, свързани така, не се показват в търсачките. Ако смятате, че данни за вас са неточни или не бива да се публикуват, пишете ни на [" +
          CONTACT_EMAIL +
          "](mailto:" +
          CONTACT_EMAIL +
          ") — ще отговорим в срок до един месец. Подробно уведомление за тази обработка предстои.",
        "We do not store personal identification numbers (ЕГН). Some registers identify people by name only. In that case we link a person to a company by name only under strict conditions: a full three-part name, no more than 5 companies, and a link to public money. Profiles of private individuals linked this way are not shown in search engines. If you believe data about you is inaccurate or should not be published, write to [" +
          CONTACT_EMAIL +
          "](mailto:" +
          CONTACT_EMAIL +
          ") — we will reply within one month. A detailed notice for this processing is in preparation.",
      ),
    ],
  },
  {
    id: "rights",
    heading: T("Вашите права", "Your rights"),
    blocks: [
      P(
        "Имате право на достъп, коригиране, изтриване, ограничаване на обработването, преносимост и възражение срещу обработване на основание легитимен интерес. Пишете ни на [" +
          CONTACT_EMAIL +
          "](mailto:" +
          CONTACT_EMAIL +
          "); отговаряме до един месец. Имате право и на жалба до [Комисията за защита на личните данни](https://www.cpdp.bg) (София 1592, бул. „Проф. Цветан Лазаров“ № 2).",
        "You have the right of access, rectification, erasure, restriction, portability, and to object to processing based on legitimate interest. Write to [" +
          CONTACT_EMAIL +
          "](mailto:" +
          CONTACT_EMAIL +
          "); we reply within one month. You also have the right to lodge a complaint with the Bulgarian [Commission for Personal Data Protection](https://www.cpdp.bg) (2 Prof. Tsvetan Lazarov Blvd., Sofia 1592).",
      ),
      P(
        "Статистиката за посещенията не съдържа данни, по които да ви разпознаем, затова не можем да намерим или изтрием „вашите“ записи в нея.",
        "Visit statistics contain nothing we could recognise you by, so we cannot find or delete “your” records in them.",
      ),
    ],
  },
];

export const PRIVACY_TITLE: Text = {
  bg: "Поверителност",
  en: "Privacy",
};

/** The prerendered body — the same sections the React screen renders. */
export const privacyBodyHtml = (lang: Lang): string => {
  const parts = [`<h1>${escHtml(PRIVACY_TITLE[lang])}</h1>`];
  parts.push(
    `<p>${lang === "bg" ? "Последна промяна" : "Last updated"}: ${PRIVACY_UPDATED}</p>`,
  );
  for (const s of privacySections()) {
    parts.push(`<h2 id="${s.id}">${escHtml(s.heading[lang])}</h2>`);
    for (const b of s.blocks) {
      if (b.kind === "p") parts.push(`<p>${inlineHtml(b.text[lang])}</p>`);
      else if (b.kind === "ul")
        parts.push(
          `<ul>${b.items.map((i) => `<li>${inlineHtml(i[lang])}</li>`).join("")}</ul>`,
        );
      else
        parts.push(
          `<table><thead><tr>${b.head.map((h) => `<th>${escHtml(h[lang])}</th>`).join("")}</tr></thead><tbody>${b.rows
            .map(
              (r) =>
                `<tr>${r.map((c) => `<td>${inlineHtml(c[lang])}</td>`).join("")}</tr>`,
            )
            .join("")}</tbody></table>`,
        );
    }
  }
  return parts.join("\n");
};
