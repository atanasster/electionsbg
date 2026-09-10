import { FC, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { SITE_ORIGIN } from "@/lib/siteOrigin";
import { withBrandSuffix } from "@/lib/brand";

export const SEO: FC<{
  title: string;
  description: string;
  type?: string;
  canonical?: string;
  // When set, used verbatim as the document <title> (bypassing the "Избори | "
  // wrapper) so the tab + the title Googlebot indexes match the richer,
  // prerendered crawler HTML. og:/twitter: keep the short `title` so social
  // cards stay clean. See placeResultsTitle.
  fullTitle?: string;
}> = ({ title, description, type = "website", canonical, fullTitle }) => {
  const location = useLocation();
  const { i18n } = useTranslation();
  // ⚠️ PER-LOCALE, and it was not until 2026-09-10: this wrapper appended the
  // Cyrillic suffix on every page in both languages, so an /en page hydrated to
  // "About | Наясно" while the PRERENDERED head of that same URL said
  // "| Naiasno". The prerender has always split the two (see brand.ts, and
  // personRoutesEn.test.ts for why an /en title must not carry Cyrillic); the
  // runtime is what disagreed with it, on every page, after hydration.
  // `i18n?.` — SEO is rendered by nearly every screen, and a component test
  // that stubs `react-i18next` typically returns `{ t }` and no `i18n` at all.
  // Reading through it unguarded turned five BudgetExplorerScreen tests red.
  // `withBrandSuffix`, not a bare append: it skips the suffix when the title
  // already names the brand. /chat hydrated to „Попитай Наясно | Наясно" on the
  // live site — the prerendered head said it once and the runtime added it
  // again, so the tab changed under the reader a second after the page painted.
  const applyBrand = (t: string) => withBrandSuffix(t, i18n?.language);

  // Dynamically inject canonical URL
  useEffect(() => {
    const baseUrl = SITE_ORIGIN;
    const canonicalUrl = canonical || `${baseUrl}${location.pathname}`;

    // Remove existing canonical link if present
    const existingCanonical = document.querySelector('link[rel="canonical"]');
    if (existingCanonical) {
      existingCanonical.remove();
    }

    // Add new canonical link
    const link = document.createElement("link");
    link.rel = "canonical";
    link.href = canonicalUrl;
    document.head.appendChild(link);

    // Cleanup on unmount
    return () => {
      const canonical = document.querySelector('link[rel="canonical"]');
      if (canonical) {
        canonical.remove();
      }
    };
  }, [location.pathname, canonical]);
  return (
    <>
      <title>
        {/* Mirrors the PRERENDERED form — "<page> | Наясно", "<page> | Naiasno"
            on /en — so the tab a visitor sees after hydration matches the title
            Googlebot indexed.
            It used to prefix every page with "Избори", which named one section
            of a site that long ago outgrew it. */}
        {fullTitle ?? applyBrand(title)}
      </title>
      <meta name="description" content={description} />
      {/* Facebook tags */}
      <meta property="og:type" content={type} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      {/* Twitter tags */}
      <meta name="twitter:card" content={type} />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
    </>
  );
};
