// Scroll-driven article for the home flyover — `docs/plans/home-flyover-v1.md` §9.
//
// The prose comes from the same committed markdown that prerendering gives crawlers. React
// only supplies the progressive enhancement: each `##` becomes one observed chapter and the
// sticky canvas shares the tour's data states, with article-specific framing and colors
// matched by the poster renderer.

import { FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link as RouterLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArticleLayout } from "@/components/article/ArticleLayout";
import { proseClasses } from "@/components/article/proseClasses";
import { useArticleBody, useArticles } from "@/data/articles/useArticles";
import { isBg } from "@/i18n";
import { TOP_FLOWS, TOP_FLOWS_NARROW } from "@/lib/flyover/layers";
import { ARTICLE_CHAPTERS } from "@/lib/flyover/programmes/tour";
import { render } from "@/lib/flyover/render";
import type { FlyoverState } from "@/lib/flyover/state";
import type { Viewport } from "@/lib/flyover/types";
import { useFlyoverArtifact } from "@/screens/home/flyover/useFlyoverArtifact";
import {
  ARTICLE_BACKGROUND,
  ARTICLE_PALETTE,
} from "@/lib/flyover/articlePresentation";
import { ShareButton } from "@/ux/ShareButton";
import { usePreserveParams } from "@/ux/usePreserveParams";
import {
  MONEY_MAP_SLUG,
  moneyMapElectionTransitionAt,
  moneyMapStateAt,
  moneyMapTitleFromBody,
  splitMoneyMapChapters,
} from "./moneyMapArticle";

const useChapterScroll = (count: number) => {
  const refs = useRef<Array<HTMLElement | null>>([]);
  const activeRef = useRef(0);
  const [position, setPosition] = useState({ chapter: 0, progress: 0 });

  useEffect(() => {
    const measure = () => {
      const el = refs.current[activeRef.current];
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const anchor = window.innerHeight * 0.28;
      const span = Math.max(1, rect.height - window.innerHeight * 0.35);
      const progress = Math.max(0, Math.min(1, (anchor - rect.top) / span));
      setPosition({ chapter: activeRef.current, progress });
    };

    const observers: IntersectionObserver[] = [];
    if (typeof IntersectionObserver !== "undefined") {
      for (let index = 0; index < count; index++) {
        const el = refs.current[index];
        if (!el) continue;
        const observer = new IntersectionObserver(
          (entries) => {
            if (!entries.some((entry) => entry.isIntersecting)) return;
            activeRef.current = index;
            measure();
          },
          { rootMargin: "-18% 0px -56% 0px", threshold: [0, 0.25, 0.5, 1] },
        );
        observer.observe(el);
        observers.push(observer);
      }
    }

    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      for (const observer of observers) observer.disconnect();
    };
  }, [count]);

  return { refs, ...position };
};

const MoneyMapCanvas: FC<{
  state: FlyoverState;
  chapter: number;
  progress: number;
  poster: string;
  label: string;
  lang: "bg" | "en";
}> = ({ state, chapter, progress, poster, label, lang }) => {
  const { world } = useFlyoverArtifact(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [painted, setPainted] = useState(false);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !world) return;
    const rect = canvas.getBoundingClientRect();
    const viewport: Viewport = {
      w: Math.max(1, Math.round(rect.width)),
      h: Math.max(1, Math.round(rect.height)),
    };
    if (viewport.w <= 1 || viewport.h <= 1) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (
      canvas.width !== viewport.w * dpr ||
      canvas.height !== viewport.h * dpr
    ) {
      canvas.width = viewport.w * dpr;
      canvas.height = viewport.h * dpr;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render(ctx, world, state, {
      viewport,
      palette: ARTICLE_PALETTE,
      clock: 0,
      lang,
      electionTransition: moneyMapElectionTransitionAt(chapter, progress),
      maxFlows: viewport.w < 640 ? TOP_FLOWS_NARROW : TOP_FLOWS,
    });
    setPainted(true);
  }, [chapter, lang, progress, state, world]);

  useEffect(() => {
    draw();
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [draw]);

  return (
    <div
      className="sticky top-16 z-10 mb-6 overflow-hidden rounded-lg border border-border shadow-sm lg:top-24 lg:mb-0"
      style={{ aspectRatio: "1000 / 625", background: ARTICLE_BACKGROUND }}
      role="img"
      aria-label={label}
      data-money-map-canvas
    >
      <img
        src={poster}
        alt=""
        width={1000}
        height={625}
        className={`absolute inset-0 h-full w-full object-cover ${painted ? "opacity-0" : ""}`}
      />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        aria-hidden="true"
      />
    </div>
  );
};

export const MoneyMapArticleScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const lang: "bg" | "en" = isBg(i18n.language) ? "bg" : "en";
  const { data: index } = useArticles();
  const {
    data: body,
    isLoading,
    isError,
  } = useArticleBody(MONEY_MAP_SLUG, lang);
  const preserveParams = usePreserveParams();
  const meta = index?.find((article) => article.slug === MONEY_MAP_SLUG);
  const chapters = useMemo(
    () => (body ? splitMoneyMapChapters(body) : []),
    [body],
  );
  const { refs, chapter, progress } = useChapterScroll(chapters.length);
  const active = Math.min(chapter, ARTICLE_CHAPTERS.length - 1);
  const activeDefinition = ARTICLE_CHAPTERS[active] ?? ARTICLE_CHAPTERS[0];
  const activeBody = chapters[active];
  const poster = `/articles/money-map/${activeDefinition.id}.webp`;
  const state = useMemo(
    () => moneyMapStateAt(active, progress),
    [active, progress],
  );

  const internalHref = (href: string): string => {
    const [pathname, search = ""] = href.split("?");
    const incoming = new URLSearchParams(search);
    const merged = preserveParams(Object.fromEntries(incoming.entries()));
    return merged.size ? `${pathname}?${merged.toString()}` : pathname;
  };

  return (
    <ArticleLayout
      title={meta?.title[lang] ?? moneyMapTitleFromBody(body) ?? MONEY_MAP_SLUG}
      description={meta?.summary[lang] ?? ""}
      date={meta?.publishedAt}
      author={meta?.author}
      breadcrumb={{ to: "/articles", label: t("articles_title") }}
    >
      {isLoading ? (
        <div className="text-sm text-muted-foreground">{t("loading")}</div>
      ) : isError || chapters.length !== ARTICLE_CHAPTERS.length ? (
        <div className="text-sm text-muted-foreground">
          {t("articles_not_found")}
        </div>
      ) : (
        <div className="lg:grid lg:grid-cols-[minmax(0,0.88fr)_minmax(420px,1.12fr)] lg:gap-8">
          <div className="lg:col-start-2 lg:row-start-1">
            <MoneyMapCanvas
              state={state}
              chapter={active}
              progress={progress}
              poster={poster}
              label={activeBody?.title ?? ""}
              lang={lang}
            />
          </div>
          <div className="min-w-0 lg:col-start-1 lg:row-start-1">
            {chapters.map((item, chapterIndex) => {
              const definition = ARTICLE_CHAPTERS[chapterIndex];
              return (
                <section
                  key={definition.id}
                  ref={(el) => {
                    refs.current[chapterIndex] = el;
                  }}
                  data-chapter={definition.id}
                  className="scroll-mt-28 pb-12 lg:min-h-[72vh]"
                >
                  <h2 className={proseClasses.h2}>{item.title}</h2>
                  <Markdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      a: ({ href, children }) =>
                        href?.startsWith("/") && !href.startsWith("//") ? (
                          <RouterLink
                            to={internalHref(href)}
                            className={proseClasses.a}
                          >
                            {children}
                          </RouterLink>
                        ) : (
                          <a
                            href={href}
                            target="_blank"
                            rel="noreferrer"
                            className={proseClasses.a}
                          >
                            {children}
                          </a>
                        ),
                      h3: ({ children }) => (
                        <h3 className={proseClasses.h3}>{children}</h3>
                      ),
                      p: ({ children }) => (
                        <p className={proseClasses.p}>{children}</p>
                      ),
                      ul: ({ children }) => (
                        <ul className={proseClasses.ul}>{children}</ul>
                      ),
                      li: ({ children }) => (
                        <li className={proseClasses.li}>{children}</li>
                      ),
                      strong: ({ children }) => (
                        <strong className={proseClasses.strong}>
                          {children}
                        </strong>
                      ),
                      table: ({ children }) => (
                        <div className={proseClasses.tableWrap}>
                          <table className={proseClasses.table}>
                            {children}
                          </table>
                        </div>
                      ),
                      thead: ({ children }) => (
                        <thead className={proseClasses.thead}>{children}</thead>
                      ),
                      th: ({ children }) => (
                        <th className={proseClasses.th}>{children}</th>
                      ),
                      td: ({ children }) => (
                        <td className={proseClasses.td}>{children}</td>
                      ),
                      tr: ({ children }) => (
                        <tr className={proseClasses.tr}>{children}</tr>
                      ),
                      img: ({ src, alt }) => (
                        <img
                          src={src}
                          alt={alt ?? ""}
                          width={1000}
                          height={625}
                          loading="lazy"
                          decoding="async"
                          className={`${proseClasses.img} lg:hidden`}
                        />
                      ),
                    }}
                  >
                    {item.markdown}
                  </Markdown>
                </section>
              );
            })}
            <div className="border-t border-border pt-6">
              <ShareButton />
            </div>
          </div>
        </div>
      )}
    </ArticleLayout>
  );
};
