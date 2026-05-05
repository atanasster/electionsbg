import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText } from "lucide-react";
import { SEO } from "@/ux/SEO";
import { Link } from "@/ux/Link";
import {
  ArticleMeta,
  DashboardSectionId,
  useArticles,
} from "@/data/articles/useArticles";

const TOPIC_LABEL_KEY: Record<DashboardSectionId, string> = {
  votes: "dashboard_section_votes",
  geography: "dashboard_section_geography",
  anomalies: "dashboard_section_anomalies",
  neighborhoods: "dashboard_section_neighborhoods",
  declarations: "dashboard_section_declarations",
  financing: "dashboard_section_financing",
  history: "dashboard_section_history",
  polling: "dashboard_section_polling",
};

// Deterministic gradient seeded by slug — keeps cards without an ogImage
// visually distinct without bringing in randomness.
const fallbackGradient = (slug: string) => {
  let hash = 0;
  for (let i = 0; i < slug.length; i++) {
    hash = (hash * 31 + slug.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  return `linear-gradient(135deg, hsl(${hue} 55% 38%) 0%, hsl(${(hue + 40) % 360} 60% 22%) 100%)`;
};

export const ArticlesScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const { data: articles, isLoading } = useArticles();
  const [activeTopic, setActiveTopic] = useState<DashboardSectionId | null>(
    null,
  );

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(lang === "bg" ? "bg-BG" : "en-GB", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

  const sortedArticles = useMemo(
    () =>
      (articles ?? [])
        .slice()
        .sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1)),
    [articles],
  );

  const availableTopics = useMemo(() => {
    const set = new Set<DashboardSectionId>();
    sortedArticles.forEach((a) => a.topics?.forEach((tt) => set.add(tt)));
    return Array.from(set);
  }, [sortedArticles]);

  const visible = activeTopic
    ? sortedArticles.filter((a) => a.topics?.includes(activeTopic))
    : sortedArticles;

  const renderCard = (a: ArticleMeta) => (
    <Link
      key={a.slug}
      to={`/articles/${a.slug}`}
      underline={false}
      className="group flex flex-col overflow-hidden rounded-xl border border-border/60 bg-card transition-shadow hover:shadow-md"
    >
      <div
        className="aspect-[16/9] w-full overflow-hidden bg-muted"
        style={a.ogImage ? undefined : { background: fallbackGradient(a.slug) }}
      >
        {a.ogImage ? (
          <img
            src={a.ogImage}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-white/80">
            <FileText className="h-10 w-10" />
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4 md:p-5">
        <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {formatDate(a.publishedAt)}
        </div>
        <h2 className="text-lg md:text-xl font-bold leading-snug text-foreground group-hover:text-primary">
          {a.title[lang]}
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground line-clamp-3">
          {a.summary[lang]}
        </p>
        {a.topics && a.topics.length > 0 && (
          <div className="mt-auto flex flex-wrap gap-1.5 pt-2">
            {a.topics.map((topic) => (
              <span
                key={topic}
                className="rounded-full border border-border/70 bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
              >
                {t(TOPIC_LABEL_KEY[topic])}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );

  return (
    <>
      <SEO
        title={t("analysis_title")}
        description={t("analysis_meta_description")}
      />
      <div className="mx-auto w-full max-w-6xl px-4 md:px-8 py-6 md:py-10">
        <header className="mb-8 border-b border-border/60 pb-6">
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            <FileText className="h-3.5 w-3.5" />
            {t("analysis_title")}
          </div>
          <h1 className="mt-2 text-2xl md:text-3xl font-extrabold leading-tight tracking-tight text-foreground">
            {t("analysis_title")}
          </h1>
          <p className="mt-3 text-base leading-relaxed text-muted-foreground">
            {t("analysis_meta_description")}
          </p>

          {availableTopics.length > 1 && (
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setActiveTopic(null)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  activeTopic === null
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border/70 bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {t("analysis_all_topics")}
              </button>
              {availableTopics.map((topic) => (
                <button
                  key={topic}
                  type="button"
                  onClick={() => setActiveTopic(topic)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    activeTopic === topic
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border/70 bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t(TOPIC_LABEL_KEY[topic])}
                </button>
              ))}
            </div>
          )}
        </header>

        {isLoading ? (
          <div className="text-sm text-muted-foreground">{t("loading")}</div>
        ) : visible.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            {t("articles_empty")}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map(renderCard)}
          </div>
        )}
      </div>
    </>
  );
};
