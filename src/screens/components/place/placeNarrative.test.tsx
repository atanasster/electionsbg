// Guards the PlaceHeader → PlaceHeaderView + renderPlaceNarrative extraction: the
// breadcrumb wording matrix must stay byte-identical to what PlaceHeader shipped
// inline. Tests the PURE narrative function directly (no data hooks, no network)
// across every branch, then a minimal PlaceHeaderView render for the title/hero.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// PlaceHeaderView calls useTranslation; the pure narrative function does not.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "bg" } }),
}));

import { renderPlaceNarrative, PlaceNarrativeContext } from "./placeNarrative";
import { PlaceHeaderView } from "./PlaceHeaderView";

// A neutral base — every flag false, no names. Each case overrides the slice it
// exercises, mirroring how PlaceHeader builds the context per level.
const base = (over: Partial<PlaceNarrativeContext>): PlaceNarrativeContext => ({
  lang: "bg",
  isCountry: false,
  isRegion: false,
  isSection: false,
  isSettlement: false,
  isSofiaRayon: false,
  isCityRayon: false,
  isAbroad: false,
  parentIsSofiaRayon: false,
  name: "",
  muniName: null,
  regionName: null,
  regionNameRaw: null,
  muniHref: null,
  regionHref: null,
  settlementHref: null,
  sofiaCityHref: "/governance/SOF00",
  countryHref: "/",
  cityRayonParentHref: null,
  ...over,
});

const text = (ctx: PlaceNarrativeContext): string => {
  const { container } = render(
    <MemoryRouter>{renderPlaceNarrative(ctx)}</MemoryRouter>,
  );
  return container.textContent ?? "";
};

describe("renderPlaceNarrative", () => {
  it("country returns null (no breadcrumb)", () => {
    expect(renderPlaceNarrative(base({ isCountry: true }))).toBeNull();
  });

  it("settlement (BG): typed name в община …, област …", () => {
    const out = text(
      base({
        isSettlement: true,
        name: "Варна",
        settlementType: "гр.",
        muniName: "Варна",
        muniHref: "/settlement/VAR06",
        regionName: "Варна",
        regionHref: "/municipality/VAR",
      }),
    );
    expect(out).toContain("гр. Варна");
    expect(out).toContain("в община");
    expect(out).toContain("област");
    expect(out).toContain("Варна");
  });

  it("settlement (EN): name in … municipality, … oblast", () => {
    const out = text(
      base({
        lang: "en",
        isSettlement: true,
        name: "Varna",
        muniName: "Varna",
        muniHref: "/settlement/VAR06",
        regionName: "Varna",
        regionHref: "/municipality/VAR",
      }),
    );
    expect(out).toContain("Varna");
    expect(out).toContain("municipality");
    expect(out).toContain("oblast");
  });

  it("município (BG): Община {name}, област {region}", () => {
    const out = text(
      base({
        name: "Варна",
        regionName: "Варна",
        regionHref: "/municipality/VAR",
      }),
    );
    expect(out).toContain("Община Варна");
    expect(out).toContain("област");
  });

  it("region (BG): Област в България", () => {
    const out = text(
      base({ isRegion: true, name: "Варна", oblastCode: "VAR" }),
    );
    expect(out).toContain("Област в");
    expect(out).toContain("България");
  });

  it("region — Sofia МИР roots under Столична община, not oblast", () => {
    const out = text(
      base({ isRegion: true, name: "София 23", oblastCode: "S23" }),
    );
    expect(out).toContain("Столична община");
    expect(out).not.toContain("Област в");
  });

  it("region — abroad МИР 32 has no breadcrumb", () => {
    expect(
      renderPlaceNarrative(base({ isRegion: true, oblastCode: "32" })),
    ).toBeNull();
  });

  it("section (BG): settlement link в община …, област …", () => {
    const out = text(
      base({
        isSection: true,
        settlementName: "Варна",
        displaySettlementType: "гр.",
        settlementHref: "/sections/10135",
        muniName: "Варна",
        muniHref: "/settlement/VAR06",
        regionName: "Варна",
        regionHref: "/municipality/VAR",
      }),
    );
    expect(out).toContain("гр. Варна");
    expect(out).toContain("в община");
    expect(out).toContain("област");
  });

  it("Sofia район (BG): Район на Столична община, {МИР}", () => {
    const out = text(
      base({
        isSofiaRayon: true,
        name: "Лозенец",
        regionNameRaw: "София 24",
        regionHref: "/municipality/S24",
      }),
    );
    expect(out).toContain("Район на");
    expect(out).toContain("Столична община");
    expect(out).toContain("София 24");
  });

  it("Пловдив/Варна city район (BG): Район на Община {city}, {n} МИР", () => {
    const out = text(
      base({
        isCityRayon: true,
        name: "Централен",
        cityRayon: {
          cityBg: "Пловдив",
          cityEn: "Plovdiv",
          obshtina: "PDV00",
          mir: "16",
        },
        cityRayonParentHref: "/governance/PDV00",
      }),
    );
    expect(out).toContain("Район на Община Пловдив");
    expect(out).toContain("16 МИР");
  });

  it("abroad settlement: country в continent, no община/област qualifiers", () => {
    const out = text(
      base({
        isSettlement: true,
        isAbroad: true,
        name: "САЩ",
        muniName: "Северна Америка",
        muniHref: "/settlement/NA",
        regionName: "Извън страната",
        regionHref: "/municipality/32",
      }),
    );
    expect(out).toContain("САЩ");
    expect(out).toContain("Северна Америка");
    expect(out).not.toContain("община");
    expect(out).not.toContain("област");
  });

  it("Sofia city aggregate (SOF00): bare name, no Община qualifier", () => {
    expect(text(base({ name: "София Град", obshtina: "SOF00" }))).toBe(
      "София Град",
    );
  });

  it("abroad município (BG): Континент {name}, {district}", () => {
    const out = text(
      base({
        isAbroad: true,
        name: "Северна Америка",
        regionName: "Извън страната",
        regionHref: "/municipality/32",
      }),
    );
    expect(out).toContain("Континент Северна Америка");
    expect(out).not.toContain("Община");
  });

  it("settlement inside a Sofia район (BG): typed name в район …, Столична община", () => {
    const out = text(
      base({
        isSettlement: true,
        parentIsSofiaRayon: true,
        name: "Долни Богров",
        displaySettlementType: "с.",
        settlementType: "с.",
        muniName: "Кремиковци",
        muniHref: "/settlement/S2422",
      }),
    );
    expect(out).toContain("с. Долни Богров");
    expect(out).toContain("в район");
    expect(out).toContain("Кремиковци");
    expect(out).toContain("Столична община");
  });

  it("section inside a Sofia район (BG): settlement link в район …, Столична община", () => {
    const out = text(
      base({
        isSection: true,
        parentIsSofiaRayon: true,
        settlementName: "Долни Богров",
        displaySettlementType: "с.",
        settlementHref: "/sections/00001",
        muniName: "Кремиковци",
        muniHref: "/settlement/S2422",
      }),
    );
    expect(out).toContain("Долни Богров");
    expect(out).toContain("в район");
    expect(out).toContain("Столична община");
  });

  it("section (EN): name in … municipality, … oblast", () => {
    const out = text(
      base({
        lang: "en",
        isSection: true,
        settlementName: "Varna",
        settlementHref: "/sections/10135",
        muniName: "Varna",
        muniHref: "/settlement/VAR06",
        regionName: "Varna",
        regionHref: "/municipality/VAR",
      }),
    );
    expect(out).toContain("municipality");
    expect(out).toContain("oblast");
  });

  it("Sofia район (EN): District of Sofia (Stolichna) municipality, {МИР}", () => {
    const out = text(
      base({
        lang: "en",
        isSofiaRayon: true,
        name: "Lozenets",
        regionNameRaw: "Sofia 24",
        regionHref: "/municipality/S24",
      }),
    );
    expect(out).toContain("District of");
    expect(out).toContain("Sofia (Stolichna) municipality");
    expect(out).toContain("Sofia 24");
  });

  it("city район (EN): District of {city} municipality, MIR {n}", () => {
    const out = text(
      base({
        lang: "en",
        isCityRayon: true,
        name: "Central",
        cityRayon: {
          cityBg: "Пловдив",
          cityEn: "Plovdiv",
          obshtina: "PDV00",
          mir: "16",
        },
        cityRayonParentHref: "/governance/PDV00",
      }),
    );
    expect(out).toContain("District of Plovdiv municipality");
    expect(out).toContain("MIR 16");
  });
});

describe("PlaceHeaderView", () => {
  it("renders the title h1 and the composed narrative (abroad → no switcher/thumbnail)", () => {
    const { container } = render(
      <MemoryRouter>
        <PlaceHeaderView
          active="parliamentary"
          level="settlement"
          titleText="гр. Варна"
          narrative={<span>в община Варна</span>}
          loc={{ lat: 43.2, lon: 27.9 }}
          isAbroad
          thumbName="Варна"
        />
      </MemoryRouter>,
    );
    const h1 = container.querySelector("h1");
    expect(h1).toHaveTextContent("гр. Варна");
    expect(container.textContent).toContain("в община Варна");
    // isAbroad suppresses both the thumbnail and the view switcher.
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("nav")).toBeNull();
  });

  it("non-abroad: thumbnail (anchor via thumbAnchorHref), GRAO row, eyebrow link, navSlot override", () => {
    const { container, getByText } = render(
      <MemoryRouter>
        <PlaceHeaderView
          active="governance"
          level="settlement"
          titleText="гр. Варна"
          narrative={<span>в община Варна</span>}
          loc={{ lat: 43.2, lon: 27.9 }}
          isAbroad={false}
          thumbName="Варна"
          thumbAnchorHref="#myarea-projects-map"
          grao={{ current: 300000, permanent: 340000, asOf: "2025" }}
          eyebrowTo="/governance"
          navSlot={<div data-testid="nav-override">nav override</div>}
        />
      </MemoryRouter>,
    );
    // Thumbnail present and wrapped in the jump-to-map anchor (explicit prop, not `active`).
    expect(
      container.querySelector('a[href="#myarea-projects-map"]'),
    ).not.toBeNull();
    expect(container.querySelector("img")).not.toBeNull();
    // GRAO row renders both address-count labels.
    expect(container.textContent).toContain("grao_current_address");
    expect(container.textContent).toContain("grao_permanent_address");
    // Eyebrow is a link to the parent feed.
    expect(container.querySelector('a[href="/governance"]')).not.toBeNull();
    // navSlot override renders in place of the default PlaceViewNav (<nav>).
    expect(getByText("nav override")).toBeInTheDocument();
    expect(container.querySelector("nav")).toBeNull();
  });

  it("without thumbAnchorHref the thumbnail is static — no link-to-nowhere (procurement case)", () => {
    // Regression guard: a page framed under governance (active="governance") that has no
    // #myarea-projects-map anchor must NOT get a clickable thumbnail. The anchor is driven by
    // the explicit thumbAnchorHref prop, not by `active`.
    const { container } = render(
      <MemoryRouter>
        <PlaceHeaderView
          active="governance"
          level="settlement"
          titleText="гр. Варна"
          narrative={<span>n</span>}
          loc={{ lat: 43.2, lon: 27.9 }}
          isAbroad={false}
          thumbName="Варна"
          navSlot={<div>nav</div>}
        />
      </MemoryRouter>,
    );
    expect(container.querySelector("img")).not.toBeNull();
    expect(
      container.querySelector('a[href="#myarea-projects-map"]'),
    ).toBeNull();
  });
});
