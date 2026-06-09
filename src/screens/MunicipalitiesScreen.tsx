import { useParams, Navigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { SEO } from "@/ux/SEO";
import { placeResultsTitle } from "@/ux/seoTitle";
import { isSofiaMir } from "@/data/dataTypes";
import { useRegions } from "@/data/regions/useRegions";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { RegionDashboardCards } from "./dashboard/RegionDashboardCards";
import { PlaceHeader } from "@/screens/components/PlaceHeader";

export const MunicipalitiesScreen = () => {
  const { id: region } = useParams();
  const { search } = useLocation();
  const { findRegion } = useRegions();
  const { municipalities } = useMunicipalities();
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  if (!region) {
    return null;
  }

  // A handful of "градски" МИР map 1:1 to a single municipality — Plovdiv-grad
  // (oblast PDV-00) contains only Plovdiv city (PDV22). The region dashboard
  // and that município's /settlement page then show the identical voter set,
  // but only the município page carries the unified header (My-Area /
  // Parliamentary / Local) + map thumbnail. Bypass the degenerate region page
  // so every entry point (map, search, direct link) lands on the richer one.
  // The check is data-driven, so it self-applies to any future single-muni
  // МИР without a hard-coded list.
  const inOblast = municipalities?.filter((m) => m.oblast === region);
  if (inOblast && inOblast.length === 1) {
    return (
      <Navigate
        replace
        to={{ pathname: `/settlement/${inOblast[0].obshtina}`, search }}
      />
    );
  }

  const info = findRegion(region);
  const title =
    (lang === "bg"
      ? info?.long_name || info?.name
      : info?.long_name_en || info?.name_en) || "";
  // The /municipality/:id route is actually a REGION (oblast) dashboard — the
  // historical "off-by-one" route naming (see placeViews.ts). Title it
  // "Област {name}" so the browser tab is self-describing. Two kinds of region
  // are NOT области and already carry a self-describing name, so we leave them
  // verbatim: Sofia's three МИР (S23/24/25 → "София N МИР") and the abroad МИР
  // (32 → "Извън страната" / "Abroad"). SFO already reads "София област".
  const alreadyTyped =
    lang === "bg"
      ? /област|МИР|страна/i.test(title)
      : /\b(region|MMR|abroad)\b/i.test(title);
  const seoTitle =
    isSofiaMir(region) || alreadyTyped
      ? title
      : lang === "bg"
        ? `${t("region")} ${title}`
        : `${title} (${t("region")})`;
  // Rich document <title> matching the prerendered crawler HTML — same place
  // label, lower-cased tier word in the language's natural position.
  const placeLabel =
    isSofiaMir(region) || alreadyTyped
      ? title
      : lang === "bg"
        ? `${t("region").toLowerCase()} ${title}`
        : `${title} ${t("region").toLowerCase()}`;
  // RegionDashboardCards is diaspora-aware: for МИР 32 (abroad) it swaps the
  // municipality map for the per-country tile and appends a voting-abroad FAQ,
  // while the municipality/census/local-government sections self-hide.
  return (
    <>
      <SEO
        title={seoTitle}
        fullTitle={placeResultsTitle(placeLabel, lang)}
        description={
          lang === "bg"
            ? `${seoTitle} — резултати от изборите в България`
            : `${seoTitle} — election results in Bulgaria`
        }
      />
      <PlaceHeader
        active="parliamentary"
        level="region"
        oblast={region}
        fallbackName={title}
        className="my-4"
      />
      <RegionDashboardCards regionCode={region} />
    </>
  );
};
