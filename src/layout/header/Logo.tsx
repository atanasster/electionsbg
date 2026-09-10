import { FC } from "react";
import { useTranslation } from "react-i18next";
import { brandMonogram, brandName } from "@/lib/brand";

/**
 * The Наясно app mark — the same lockup as `public/favicon.svg`, the PWA icons
 * and the social avatars: a rounded navy tile, the monogram, a coral swipe
 * beneath it.
 *
 * It follows the interface language: "на" in Bulgarian, "Na" on `/en`. The
 * favicon cannot (one static file, both locales) — see `brand.ts` for why that
 * asymmetry is accepted.
 *
 * The monogram is the wordmark's first half rather than a single letter, for
 * the reason `drawMonogram` gives: lowercase Cyrillic "н" is H-shaped, so a
 * one-letter Bulgarian mark reads as a Latin "H" and names nothing.
 *
 * ⚠️ `<text>`, deliberately, and it is the SAME construction favicon.svg uses —
 * so the two cannot drift, and neither carries hand-drawn letterforms that
 * approximate Inter rather than being it. `text-anchor="middle"` centres the
 * glyphs whatever their advance width, so a fallback font during the first
 * paint shifts the weight of the mark and never its position.
 */
export const Logo: FC<{ className?: string }> = ({ className }) => {
  const { i18n } = useTranslation();
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      role="img"
      aria-label={brandName(i18n?.language)}
    >
      <defs>
        <linearGradient id="naiasnoLogoBg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="hsl(var(--logo-card-2))" />
          <stop offset="1" stopColor="hsl(var(--logo-card))" />
        </linearGradient>
      </defs>
      <rect
        x="4"
        y="4"
        width="56"
        height="56"
        rx="14"
        fill="url(#naiasnoLogoBg)"
      />
      <text
        x="32"
        y="38"
        textAnchor="middle"
        fill="hsl(var(--logo-ink))"
        fontFamily="Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
        fontSize="27"
        fontWeight="800"
        letterSpacing="-0.5"
      >
        {brandMonogram(i18n?.language)}
      </text>
      <rect
        x="17"
        y="42"
        width="30"
        height="5"
        rx="2.5"
        fill="hsl(var(--logo-swipe))"
      />
    </svg>
  );
};
