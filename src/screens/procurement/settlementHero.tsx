// Builds the shared PlaceHeaderView identity (title + composed breadcrumb + centroid) for a
// procurement settlement page from its PG payload — the SAME hero the parliamentary settlement
// page renders, with NO settlements.json. Lives in its own module (not the screen) so the
// screen file only exports its component (react-refresh) and this stays unit-testable.
//
// The procurement detail is always a plain 5-digit settlement (the hook guards /^\d{5}$/), so
// only the settlement branch of renderPlaceNarrative is exercised; drill-up links target the
// governance view (procurement lives under Управление). Falls back to the Bulgarian
// awarder_seats strings the payload has always carried when the dimension lacks a field.
//
// KNOWN MINOR DIVERGENCE: plain EKATTE 68134 (Sofia the city, the largest single seat) passes
// the /^\d{5}$/ guard and renders the generic settlement narrative ("гр. София в община
// Столична община, област София (столица)") rather than the capital-specific narrative the
// parliamentary PlaceHeader gives its município view. Accepted: this is buyer-HQ-proxy data,
// the wording is correct if slightly redundant, and the composite Sofia-район codes (which DO
// need the special branch) never reach here.

import { renderPlaceNarrative } from "@/screens/components/place/placeNarrative";
import { placeViewUrl } from "@/data/local/placeViews";
import { parseLoc } from "@/lib/geo";
import type { ProcurementBySettlementFile } from "@/data/dataTypes";

const eurFmt = new Intl.NumberFormat("bg-BG", { maximumFractionDigits: 0 });
const countFmt = new Intl.NumberFormat("bg-BG");

export const settlementHero = (
  data: ProcurementBySettlementFile,
  lang: "bg" | "en",
) => {
  const displayName = lang === "bg" ? data.name : data.nameEn || data.name;
  const muniName =
    (lang === "bg"
      ? data.obshtinaName
      : data.obshtinaNameEn || data.obshtinaName) ?? null;
  const oblastRaw =
    (lang === "bg" ? data.oblastName : data.oblastNameEn || data.oblastName) ??
    null;
  // Strip the tautological "област"/"region" suffix the narrative re-adds (e.g. SFO).
  const oblastName = oblastRaw
    ? lang === "bg"
      ? oblastRaw.replace(/\s+област$/u, "").trim()
      : oblastRaw.replace(/\s+region$/iu, "").trim()
    : null;
  const muniHref = data.obshtinaCode
    ? placeViewUrl("governance", {
        level: "municipality",
        obshtina: data.obshtinaCode,
        oblast: data.oblastCode ?? undefined,
      })
    : null;
  const regionHref = data.oblastCode
    ? placeViewUrl("governance", { level: "region", oblast: data.oblastCode })
    : null;
  const narrative = renderPlaceNarrative({
    lang,
    isCountry: false,
    isRegion: false,
    isSection: false,
    isSettlement: true,
    isSofiaRayon: false,
    isCityRayon: false,
    isAbroad: false,
    parentIsSofiaRayon: false,
    name: displayName,
    muniName,
    regionName: oblastName,
    regionNameRaw: oblastRaw,
    settlementType: data.settlementType ?? null,
    displaySettlementType: data.settlementType ?? null,
    oblastCode: data.oblastCode ?? undefined,
    obshtina: data.obshtinaCode ?? undefined,
    muniHref,
    regionHref,
    settlementHref: null,
    sofiaCityHref: "",
    countryHref: "",
    cityRayonParentHref: null,
  });
  const titleText =
    data.settlementType && lang === "bg"
      ? `${data.settlementType} ${displayName}`
      : displayName;
  return { titleText, narrative, loc: parseLoc(data.loc), displayName };
};

// The document <title>/meta for the page — deliberately KEEPS the procurement framing for
// search ("Обществени поръчки във Варна"), even though the visible hero h1 is now the bare
// place identity ("гр. Варна"). BG euphony: "в" → "във" before в/ф (във Варна, във Видин).
export const settlementSeo = (
  data: ProcurementBySettlementFile,
  displayName: string,
  lang: "bg" | "en",
): { title: string; description: string } => {
  const bgPrep = /^[вфВФ]/.test(data.name) ? "във" : "в";
  const eur = `€${eurFmt.format(Math.round(data.totalEur))}`;
  const count = countFmt.format(data.contractCount);
  return lang === "bg"
    ? {
        title: `Обществени поръчки ${bgPrep} ${data.name}`,
        description: `Обществени поръчки, възложители и най-големи договори ${bgPrep} ${data.name} — ${eur} в ${count} договора.`,
      }
    : {
        title: `Public procurement in ${displayName}`,
        description: `Public procurement, buyers and biggest contracts in ${displayName} — ${eur} across ${count} contracts.`,
      };
};
