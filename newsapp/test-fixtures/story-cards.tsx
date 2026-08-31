import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "@/index.css";
import "@/App.css";
import "../news.css";
import type { ArticleRecord, HomeStory, Outlet } from "../app/data";
import type { HomeLeadStoryItem } from "../app/homeHierarchy";
import { LeadStory } from "../app/components/LeadStory";
import { StoryCard } from "../app/components/StoryCard";

if (new URLSearchParams(window.location.search).has("dark")) {
  document.documentElement.classList.add("dark");
}

const outlets = [
  { domain: "top.bg", outlet: "Българска телеграфна агенция", rank: 1 },
  { domain: "second.bg", outlet: "Дневен обзор", rank: 2 },
  { domain: "third.bg", outlet: "Регионален глас", rank: 3 },
  { domain: "fourth.bg", outlet: "Свободна Европа", rank: 4 },
] as Outlet[];

const story = (
  id: string,
  title: string,
  summary: string,
  byDomain: Record<string, number>,
): HomeStory => ({
  id,
  title_bg: title,
  title_en: null,
  summary_bg: summary,
  summary_en: null,
  last_published: "2026-08-31T06:45:00Z",
  topics: [
    { category: "foreign-policy", subcategory: "bilateral", primary: true },
  ],
  aggregates: {
    outlet_count: Object.keys(byDomain).length,
    article_count: Object.values(byDomain).reduce(
      (sum, count) => sum + count,
      0,
    ),
    by_leaning: { neutral: 2, progressive: 1 },
    by_russia_stance: { neutral: 2, anti_russia: 1 },
    by_party_tone: {},
    by_domain: byDomain,
  },
});

const imageArticle = {
  id: "visual-image",
  domain: "top.bg",
  title: "Източников материал",
  url: "https://example.com/article",
  image:
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1200 750'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop stop-color='%232c5364'/%3E%3Cstop offset='1' stop-color='%23c06c54'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='1200' height='750' fill='url(%23g)'/%3E%3Ccircle cx='860' cy='270' r='160' fill='%23f0c987' opacity='.55'/%3E%3Cpath d='M0 650 380 280 620 520 820 350 1200 720V750H0Z' fill='%23151d28' opacity='.62'/%3E%3C/svg%3E",
  image_alt: "Абстрактна редакционна илюстрация",
  story_id: "lead",
  image_rights: {
    status: "cc",
    creator:
      "Много дълго име на автор без компромис с атрибуцията и редакционния контекст",
    credit_text:
      "Илюстрация · visual-reference.svg · https://example.com/a/very/long/source/path · Много дълго име на автор без компромис с атрибуцията и редакционния контекст · CC BY 4.0",
    credit_url: "https://commons.wikimedia.org/wiki/File:Visual_reference.svg",
    licence_name: "CC BY 4.0",
    licence_url: "https://creativecommons.org/licenses/by/4.0/",
    source_url: "https://commons.wikimedia.org/wiki/File:Visual_reference.svg",
    checked_at: "2026-08-31",
    display_home: true,
  },
  analysis: { summary_bg: "Резюме" },
} as ArticleRecord;

const leadStory = story(
  "lead",
  "Европейските лидери обсъдиха нов общ подход към сигурността и енергетиката",
  "Разговорите събраха различни позиции за общата отбрана, цените на енергията и следващите стъпки пред държавите членки.",
  { "top.bg": 3, "second.bg": 2, "third.bg": 1, "fourth.bg": 1 },
);
const singleStory = story(
  "single",
  "Кратка история от един проверен източник",
  "Ясно резюме с най-важното, без повтаряща се покана за действие.",
  { "top.bg": 1 },
);
const textStory = story(
  "text",
  "Текстова карта без снимка изглежда като съзнателен редакционен избор",
  "Съдържанието започва веднага, а деликатният акцент отличава варианта без да създава празно поле.",
  { "second.bg": 2, "third.bg": 1, "fourth.bg": 1 },
);
const overflowStory = story(
  "overflow",
  "Изключително дълго българско заглавие проверява устойчивостта на картата при тесни екрани и по-голям мащаб на текста",
  "Дългите имена и липсващият ред в регистъра трябва да се пренасят безопасно, без хоризонтално превъртане.",
  {
    "an-extremely-long-unregistered-publication-domain-without-breaks.example": 2,
    "top.bg": 1,
  },
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <div className="news-shell min-h-screen bg-background text-foreground">
        <main className="news-main mx-auto space-y-5 px-3 py-6 sm:px-5">
          <div data-testid="image-led-multi-source">
            <LeadStory
              item={
                {
                  story: leadStory,
                  imageArticle,
                  kind: "comparison",
                } as HomeLeadStoryItem
              }
              outlets={outlets}
              taxonomy={null}
            />
          </div>
          <div className="news-supporting-grid grid gap-3">
            <div data-testid="image-led-single-source">
              <StoryCard
                story={singleStory}
                taxonomy={null}
                imageArticle={imageArticle}
                outlets={outlets}
                kind="analyzed_article"
              />
            </div>
            <div data-testid="text-first-multi-source">
              <StoryCard
                story={textStory}
                taxonomy={null}
                imageArticle={null}
                outlets={outlets}
                kind="comparison"
              />
            </div>
            <div data-testid="long-content-fallback-source">
              <StoryCard
                story={overflowStory}
                taxonomy={null}
                imageArticle={null}
                outlets={outlets}
                kind="comparison"
              />
            </div>
          </div>
        </main>
      </div>
    </BrowserRouter>
  </React.StrictMode>,
);
