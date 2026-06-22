// Desktop-only community CTA strip rendered under the header on every page.
// Left third invites the user into the Наясно Facebook group (the primary
// funnel — see src/lib/community.ts), the right two-thirds surface the two
// latest articles. Scrolls away with the page (normal flow, not sticky) and
// is dismissible for ~2 weeks via localStorage. Hidden below `lg` because the
// three-column layout needs the width.

import { FC, useState } from "react";
import { useTranslation } from "react-i18next";
import { Facebook, Users, ArrowRight, X } from "lucide-react";
import { Link } from "@/ux/Link";
import { Anchor } from "@/ux/Anchor";
import { GROUP_URL, PAGE_URL } from "@/lib/community";
import { useListedArticles } from "@/data/articles/useArticles";

const DISMISS_KEY = "naiasno_cta_dismissed_until";
const DISMISS_DAYS = 14;

const isDismissed = (): boolean => {
  if (typeof window === "undefined") return false;
  const until = Number(window.localStorage.getItem(DISMISS_KEY) ?? 0);
  return until > Date.now();
};

export const CommunityCtaStrip: FC = () => {
  const { t, i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const { data: articles } = useListedArticles();
  const [dismissed, setDismissed] = useState(isDismissed);

  if (dismissed) return null;

  const latest = (articles ?? [])
    .slice()
    .sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1))
    .slice(0, 2);

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(lang === "bg" ? "bg-BG" : "en-GB", {
      month: "long",
      day: "numeric",
    });

  const dismiss = () => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(
        DISMISS_KEY,
        String(Date.now() + DISMISS_DAYS * 24 * 60 * 60 * 1000),
      );
    }
    setDismissed(true);
  };

  return (
    <div className="relative mb-3 hidden lg:flex gap-3 rounded-xl border border-border/60 bg-card p-3">
      <button
        type="button"
        onClick={dismiss}
        aria-label={t("cta_dismiss")}
        className="absolute right-2 top-2 z-10 flex size-6 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <X className="size-4" />
      </button>

      <div className="flex flex-1 flex-col gap-2 rounded-lg border border-accent/40 bg-accent/10 p-3">
        <div className="flex items-center gap-2">
          <Facebook className="size-5 text-accent" />
          <h2 className="text-sm font-semibold text-foreground">
            {t("cta_group_title")}
          </h2>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("cta_group_desc")}
        </p>
        <div className="mt-auto flex flex-wrap items-center gap-3 pt-1">
          <Anchor
            href={GROUP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-1.5 text-sm font-medium text-accent-foreground no-underline hover:opacity-90"
          >
            <Users className="size-4" />
            {t("community_join")}
          </Anchor>
          <Anchor
            href={PAGE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {t("cta_page_follow")}
          </Anchor>
        </div>
      </div>

      {latest.length > 0 && (
        <div className="grid flex-[2] grid-cols-2 gap-3">
          {latest.map((a) => (
            <Link
              key={a.slug}
              to={`/articles/${a.slug}`}
              underline={false}
              className="group flex flex-col gap-1.5 rounded-lg bg-muted/60 p-3 transition-colors hover:bg-muted"
            >
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {formatDate(a.publishedAt)}
              </span>
              <span className="line-clamp-2 text-sm font-semibold leading-snug text-foreground group-hover:text-primary">
                {a.title[lang]}
              </span>
              <span className="mt-auto inline-flex items-center gap-1 pt-1 text-xs text-muted-foreground">
                {t("cta_read")}
                <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
};
