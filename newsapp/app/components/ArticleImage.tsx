// The article photo, its credit, and the fallback ladder — one component,
// because the three are not separable.
//
// ⚠️ EVERY RENDERED IMAGE CARRIES A VISIBLE CREDIT THAT LINKS TO THE SOURCE
// ARTICLE. This is a presentation invariant, not proof of permission:
// delivery (`hotlink_ok`), attribution, and display rights are three separate
// facts. The rights state lives on the article record and will become the
// fail-closed eligibility gate; this component continues to own delivery and
// fallback behavior.
//
// ⚠️ A reviewed photo credit links to its recorded credit URL, never to our
// own page. Logo/monogram fallbacks identify the outlet and link to its
// article, but make no copyright claim.
//
// Why a fallback ladder rather than a plain <img>: measured 2026-08-26 with
// our own bot UA and a news.electionsbg.com referer, 10 of 13 outlets serve
// their images to us and three do not (mediapool.bg and novavarna.net answer
// 403; e-vestnik.bg's sampled photos 404). Unhandled, that is a broken image
// in the grid — silently, because the failure is per-request and per-referer
// and nothing at build time can see it.
//
// Two shapes the URL cannot warn you about, both live in this corpus:
// dariknews.bg's og:image is a branding REDIRECTOR, and e-vestnik.bg's is the
// author's PORTRAIT rather than the article photo. So the component is built
// to survive a WRONG image, not only a missing one — which is why the credit
// and the layout never depend on the image loading.

import { useEffect, useState } from "react";
import type { ImageRights, Outlet } from "../data";
import { initialStage, monogramOf, type ImageStage } from "./imageFallback";
import { compactImageCredit } from "./imageCredit";
import { useNewsLocale } from "../i18n";

export const ArticleImage = ({
  image,
  imageAlt,
  outlet,
  articleUrl,
  rights,
  className = "",
  aspect = "aspect-[16/10]",
  priority = false,
  creditVariant = "full",
}: {
  image: string | null | undefined;
  imageAlt?: string | null;
  /** The outlet, for the credit, the logo rung and the monogram. */
  outlet: Pick<Outlet, "domain" | "outlet" | "logo"> & {
    hotlink_ok?: boolean | null;
  };
  /** Where an outlet fallback points. Falls back to the outlet page if absent. */
  articleUrl: string | null;
  /** Reviewed attribution/rights record. Delivery still uses outlet.hotlink_ok. */
  rights?: ImageRights | null;
  className?: string;
  aspect?: string;
  /** Only the single above-the-fold lead may opt out of lazy loading. */
  priority?: boolean;
  /** Dense cards show a structured short credit; detail pages keep the full record. */
  creditVariant?: "compact" | "full";
}) => {
  const { tr } = useNewsLocale();
  const name = outlet.outlet || outlet.domain;
  const [stage, setStage] = useState<ImageStage>(() =>
    initialStage(image, outlet.hotlink_ok, outlet.logo),
  );

  // A card can be recycled onto a different article as a list re-renders, and
  // a stage left on "monogram" from the previous one would suppress a photo
  // that is perfectly fine.
  useEffect(() => {
    setStage(initialStage(image, outlet.hotlink_ok, outlet.logo));
  }, [image, outlet.hotlink_ok, outlet.logo]);

  const src = stage === "photo" ? image : stage === "logo" ? outlet.logo : null;
  const hasReviewedCredit = stage === "photo" && rights;
  const creditText = hasReviewedCredit
    ? creditVariant === "compact"
      ? compactImageCredit(rights)
      : rights.credit_text
    : name;
  const creditHref = hasReviewedCredit
    ? rights.credit_url
    : (articleUrl ?? `https://${outlet.domain}/`);
  // A real description is useful. Repeating the adjacent card/article title
  // is not: when the source supplied no alt, the image is decorative beside
  // the same heading and credit. Logo/monogram rungs are decorative too.
  const alt = stage === "photo" ? imageAlt?.trim() || "" : "";
  const fallbackDestination = articleUrl
    ? tr("към материала", "to the article")
    : tr("към сайта на медията", "to the outlet website");

  return (
    <figure className={`overflow-hidden rounded-md bg-muted ${className}`}>
      <div className={`relative ${aspect}`}>
        {src ? (
          <img
            src={src}
            // Use the outlet's own description when present. Otherwise the
            // empty alt avoids repeating the adjacent linked story title.
            alt={alt}
            loading={priority ? "eager" : "lazy"}
            fetchPriority={priority ? "high" : "auto"}
            decoding="async"
            // ⚠️ NOT "no-referrer". Stripping the referer would hide from the
            // outlet that the traffic is ours, which is the opposite of what an
            // attribution-carrying link is for — and it would "fix" a 403 by
            // concealing who is asking.
            referrerPolicy="no-referrer-when-downgrade"
            className={
              stage === "photo"
                ? "size-full object-cover"
                : "size-full object-contain p-4"
            }
            onError={() =>
              setStage((s) =>
                s === "photo" && outlet.logo ? "logo" : "monogram",
              )
            }
          />
        ) : (
          <div
            className="flex size-full items-center justify-center font-title text-2xl font-semibold text-muted-foreground"
            aria-hidden
          >
            {monogramOf(name)}
          </div>
        )}
      </div>
      {/* Rendered on EVERY rung, including the monogram: the card still shows
          an outlet's work and still names them. */}
      <figcaption
        className={`flex flex-wrap items-center gap-x-1 border-t bg-card px-2 leading-snug ${
          creditVariant === "compact"
            ? "news-image-credit--compact py-1 text-[11px] font-normal text-muted-foreground"
            : "py-1.5 text-xs text-card-foreground"
        }`}
      >
        <a
          href={creditHref}
          target="_blank"
          rel="noopener noreferrer"
          className="min-w-0 max-w-full break-words rounded-sm underline-offset-2 [overflow-wrap:anywhere] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-card"
          aria-label={
            hasReviewedCredit
              ? `${tr("Кредит за изображението", "Image credit")}: ${rights.credit_text} ${tr("(отваря се в нов прозорец)", "(opens in a new window)")}`
              : `${name} — ${fallbackDestination} ${tr("(отваря се в нов прозорец)", "(opens in a new window)")}`
          }
        >
          {creditText}
        </a>
        {hasReviewedCredit && rights.licence_name && rights.licence_url ? (
          <>
            <span aria-hidden>·</span>
            <a
              href={rights.licence_url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-sm underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-card"
              aria-label={`${tr("Условия на лиценза", "Licence terms")}: ${rights.licence_name} ${tr("(отварят се в нов прозорец)", "(open in a new window)")}`}
            >
              {rights.licence_name}
            </a>
          </>
        ) : null}
      </figcaption>
    </figure>
  );
};
