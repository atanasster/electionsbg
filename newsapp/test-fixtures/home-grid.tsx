// Full-home COMPOSITION fixture — the harness `tests/news/home-grid.spec.ts`
// measures row geometry, section fill and reading order against.
//
// ⚠️ This is a MATRIX, not a snapshot of today's corpus, and that is the whole
// point. The plan's outcome ("the page should look designed even when only five
// of sixteen stories have a rights-cleared image") is a RATIO-ROBUSTNESS
// property: it has to hold at every image ratio between 0 and 1, and at every
// section size. Measured 2026-09-01, the live corpus renders zero perspectives,
// no mixed-kind rows and exactly one image ratio — so a fixture generated from
// it tests one point on that curve and cannot exercise the rules the plan
// actually writes. Pick a scenario with `?scenario=`.
//
// ⚠️ NOTHING THE APP OWNS IS RESTATED HERE. The grid class comes from
// `HomeScreen`, the shell from `App`, the scenario names from
// `home-grid.scenarios`. The earlier card fixture hard-coded
// `news-supporting-grid` and its own shell padding, so it measured a layout the
// app no longer used — green against nothing. Import and the two cannot drift.
//
// ⚠️ An unknown `?scenario=` REFUSES rather than falling back. A silent
// fallback to `today` makes every later measurement a measurement of `today`
// under another name, and `test.fail()` cannot tell that apart from the
// documented defect.

import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "@/index.css";
import "@/App.css";
import "../news.css";
import type { ArticleRecord, HomeStory, Outlet } from "../app/data";
import type { HomeLeadStoryItem, HomeStoryKind } from "../app/homeHierarchy";
import { LeadStory } from "../app/components/LeadStory";
import { StoryCard } from "../app/components/StoryCard";
import { STORY_GRID } from "../app/screens/HomeScreen";
import { SHELL_MAIN } from "../app/shell";
import { NewsLocaleProvider, type NewsLanguage } from "../app/i18n";
import { SCENARIO_NAMES, type ScenarioName } from "./home-grid.scenarios";

const params = new URLSearchParams(window.location.search);
if (params.has("dark")) document.documentElement.classList.add("dark");
const language: NewsLanguage = params.get("lang") === "en" ? "en" : "bg";

const outlets = [
  { domain: "top.bg", outlet: "Българска телеграфна агенция", rank: 1 },
  { domain: "second.bg", outlet: "Дневен обзор", rank: 2 },
  { domain: "third.bg", outlet: "Регионален глас", rank: 3 },
  { domain: "fourth.bg", outlet: "Свободна Европа", rank: 4 },
] as Outlet[];

const svg = (w: number, h: number, accent: string) =>
  `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${w} ${h}'%3E%3Crect width='${w}' height='${h}' fill='%232c5364'/%3E%3Ccircle cx='${Math.round(w * 0.7)}' cy='${Math.round(h * 0.35)}' r='${Math.round(Math.min(w, h) * 0.2)}' fill='%23${accent}' opacity='.6'/%3E%3C/svg%3E`;

const LANDSCAPE = svg(1200, 750, "f0c987");
/**
 * A portrait source, staged for §5.3's crop/contain decision. It changes
 * NOTHING measurable today: `ArticleImage` crops into a fixed `aspect-[16/10]`
 * box with `object-cover`, so portrait and landscape produce identical card
 * geometry. It becomes load-bearing when the media anatomy changes.
 */
const PORTRAIT = svg(750, 1200, "c06c54");

/**
 * Titles and summaries of deliberately different lengths. Uniform copy hides
 * exactly the height variance this fixture exists to measure — which is also
 * why EN gets its OWN corpus rather than a copy of the Bulgarian: English is
 * materially shorter for the same content, so it wraps at different line
 * counts and therefore different row heights.
 */
const TITLES = {
  bg: [
    "Европейските лидери обсъдиха нов общ подход към сигурността и енергетиката",
    "КЕВР увеличи цената на природния газ",
    "Изключително дълго българско заглавие проверява устойчивостта на картата при тесни екрани и по-голям мащаб на текста",
    "Бюджетните организации намаляват разходите за персонал с 10%",
    "Украйна премества част от горивните си резерви под земята",
    "Кратка история",
  ],
  en: [
    "European leaders agreed a joint approach to security and energy",
    "The regulator raised the price of natural gas",
    "An extremely long English headline that tests card resilience on narrow screens and at a larger text scale",
    "Public bodies cut staffing costs by 10%",
    "Ukraine moves part of its fuel reserves underground",
    "Brief",
  ],
} as const;

const SUMMARIES = {
  bg: [
    "Разговорите събраха различни позиции за общата отбрана, цените на енергията и следващите стъпки пред държавите членки.",
    "Ясно резюме с най-важното.",
    "Дългите имена и липсващият ред в регистъра трябва да се пренасят безопасно, без хоризонтално превъртане, а редакционният акцент да остане четим.",
    "Второ резюме със средна дължина, което заема два реда на широк екран.",
  ],
  en: [
    "The talks drew together competing positions on joint defence, energy prices and the next steps for member states.",
    "A short summary with the essentials.",
    "Long names and an unregistered domain must wrap safely, without horizontal scrolling, while the editorial accent stays readable.",
    "A second summary of middling length, filling two lines on a wide screen.",
  ],
} as const;

const BY_DOMAIN: Record<string, number>[] = [
  { "top.bg": 3, "second.bg": 2, "third.bg": 1, "fourth.bg": 1 },
  { "top.bg": 1 },
  { "second.bg": 2, "third.bg": 1 },
  {
    "an-extremely-long-unregistered-publication-domain-without-breaks.example": 2,
    "top.bg": 1,
  },
];

const imageRecord = (seq: number): ArticleRecord =>
  ({
    id: `image-${seq}`,
    domain: "top.bg",
    title: "Източников материал",
    url: "https://example.com/article",
    image: seq % 2 === 0 ? LANDSCAPE : PORTRAIT,
    image_alt: "Абстрактна редакционна илюстрация",
    story_id: `story-${seq}`,
    image_rights: {
      status: "cc",
      creator:
        seq % 3 === 0
          ? "Много дълго име на автор без компромис с атрибуцията и редакционния контекст"
          : "Автор на илюстрацията",
      credit_text:
        "Илюстрация · visual-reference.svg · https://example.com/a/very/long/source/path · CC BY 4.0",
      credit_url:
        "https://commons.wikimedia.org/wiki/File:Visual_reference.svg",
      licence_name: "CC BY 4.0",
      licence_url: "https://creativecommons.org/licenses/by/4.0/",
      source_url:
        "https://commons.wikimedia.org/wiki/File:Visual_reference.svg",
      checked_at: "2026-08-31",
      display_home: true,
    },
    analysis: { summary_bg: "Резюме" },
  }) as ArticleRecord;

interface FixtureItem {
  story: HomeStory;
  imageArticle: ArticleRecord | null;
  kind: HomeStoryKind;
}

/**
 * Build `count` items. `imageAt` names the 0-based positions that carry a
 * cleared image — positions, not a count, because WHERE the images land decides
 * how many rows they can make tall.
 */
const items = (
  prefix: string,
  count: number,
  imageAt: readonly number[],
  kindAt: (index: number) => HomeStoryKind = () => "analyzed_article",
): FixtureItem[] =>
  Array.from({ length: count }, (_, index) => {
    const byDomain = BY_DOMAIN[index % BY_DOMAIN.length];
    const kind = kindAt(index);
    const title = index % TITLES.bg.length;
    const summary = index % SUMMARIES.bg.length;
    return {
      story: {
        id: `${prefix}-${index}`,
        title_bg: TITLES.bg[title],
        title_en: TITLES.en[title],
        summary_bg: SUMMARIES.bg[summary],
        summary_en: SUMMARIES.en[summary],
        // Descending so DOM order is chronological, newest first.
        last_published: new Date(
          Date.UTC(2026, 7, 31, 12) - index * 3_600_000,
        ).toISOString(),
        topics: [
          {
            category: "foreign-policy",
            subcategory: "bilateral",
            primary: true,
          },
        ],
        aggregates: {
          outlet_count:
            kind === "comparison"
              ? Math.max(2, Object.keys(byDomain).length)
              : 1,
          article_count: Object.values(byDomain).reduce((a, b) => a + b, 0),
          by_leaning: { neutral: 2, progressive: 1 },
          by_russia_stance: { neutral: 2, anti_russia: 1 },
          by_party_tone: {},
          by_domain: byDomain,
        },
      } as HomeStory,
      imageArticle: imageAt.includes(index) ? imageRecord(index) : null,
      kind,
    };
  });

const every = (count: number) => Array.from({ length: count }, (_, i) => i);
const alternating = (index: number): HomeStoryKind =>
  index % 2 === 0 ? "comparison" : "analyzed_article";

interface FixtureSection {
  id: string;
  heading: string;
  items: FixtureItem[];
}

interface Scenario {
  lead: boolean;
  density: "compact" | "detailed";
  sections: FixtureSection[];
}

/**
 * The measured 2026-09-01 live composition: a 2-card update band and a 13-card
 * standard section. The image positions are the ONLY axis that varies across
 * the three ratio scenarios, so those three points stay comparable by
 * construction rather than by three literals happening to agree.
 */
const liveShape = (
  standardImagesAt: readonly number[],
  updateImagesAt: readonly number[] = [],
): FixtureSection[] => [
  {
    id: "update",
    heading: "Обнови ме",
    items: items("update", 2, updateImagesAt),
  },
  {
    id: "standard",
    heading: "Още анализирани истории",
    items: items("standard", 13, standardImagesAt),
  },
];

const SCENARIOS: Record<ScenarioName, Scenario> = {
  // Today's corpus shape — the composition the screenshots show.
  today: {
    lead: true,
    density: "detailed",
    sections: liveShape([1, 6, 8, 10]),
  },
  // Ratio floor: nothing may depend on an image existing. No lead, because
  // there is no cleared image for one.
  "no-images": { lead: false, density: "detailed", sections: liveShape([]) },
  // Ratio ceiling: every card image-led. Rows must stay even here too.
  "all-images": {
    lead: true,
    density: "detailed",
    sections: liveShape(every(13), every(2)),
  },
  // Section fill: 1, 2 and 3 cards. The first two must stop reserving tracks
  // they have no card for; the third already fills its row at 3 columns and is
  // here so the check cannot pass by only ever seeing short sections.
  "short-sections": {
    lead: false,
    density: "detailed",
    sections: [
      {
        id: "one",
        heading: "Различни гледни точки",
        items: items("one", 1, [0]),
      },
      { id: "two", heading: "Обнови ме", items: items("two", 2, []) },
      {
        id: "three",
        heading: "Водещи истории извън интересите ви",
        items: items("three", 3, [1]),
      },
    ],
  },
  // The only rows where a comparison cue and a plain card can share a row.
  "mixed-kinds": {
    lead: false,
    density: "detailed",
    sections: [
      {
        id: "mixed",
        heading: "Водещи истории извън интересите ви",
        items: items("mixed", 6, [0, 3], alternating),
      },
    ],
  },
  // ⚠️ `lead: false` mirrors the app: `HomeScreen` renders `LeadStory` only
  // when density is "detailed", so a compact fixture WITH a lead would measure
  // a page the app never serves. Note `StoryCard` also gates the image block on
  // `!compact`, so this scenario renders zero images whatever `imageAt` says.
  compact: {
    lead: false,
    density: "compact",
    sections: liveShape([1, 6, 8, 10]),
  },
};

const requested = params.get("scenario") ?? "today";
const scenario = SCENARIOS[requested as ScenarioName] as Scenario | undefined;
if (!scenario) {
  const message = `unknown scenario "${requested}" — expected one of ${SCENARIO_NAMES.join(", ")}`;
  document.body.textContent = message;
  throw new Error(message);
}

const leadItem: HomeLeadStoryItem = {
  ...items("lead", 1, [0])[0],
  imageArticle: imageRecord(0),
} as HomeLeadStoryItem;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <NewsLocaleProvider language={language}>
        <div className="news-shell min-h-screen bg-background text-foreground">
          <main
            className={`${SHELL_MAIN} space-y-7`}
            data-fixture-scenario={requested}
          >
            {scenario.lead ? (
              <section aria-labelledby="fixture-lead-heading">
                <h3
                  id="fixture-lead-heading"
                  className="app-section-title mb-3"
                >
                  Водеща история
                </h3>
                <LeadStory item={leadItem} outlets={outlets} taxonomy={null} />
              </section>
            ) : null}
            {scenario.sections.map((section) => (
              <section
                key={section.id}
                aria-labelledby={`fixture-${section.id}-heading`}
              >
                <h3
                  id={`fixture-${section.id}-heading`}
                  className="app-section-title mb-3"
                >
                  {section.heading}
                </h3>
                <div className={STORY_GRID} data-fixture-section={section.id}>
                  {section.items.map((item) => (
                    <StoryCard
                      key={item.story.id}
                      story={item.story}
                      taxonomy={null}
                      imageArticle={item.imageArticle}
                      outlets={outlets}
                      kind={item.kind}
                      density={scenario.density}
                    />
                  ))}
                </div>
              </section>
            ))}
          </main>
        </div>
      </NewsLocaleProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
