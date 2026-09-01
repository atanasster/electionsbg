import { beforeAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { enCorpus as en } from "@/locales/allKeys";
import { DataMapDirectory } from "./DataMapDirectory";
import type { DataMapManifest } from "@/data/dataMap/useDataMap";

// The SHIPPED en bundle, not a stub: without it `t()` returns the KEY, so
// every interpolated figure below would be asserting on "data_map_keys_scale"
// rather than on "up to 40,265". It also means a renamed {{n}} placeholder
// fails here instead of leaving "{{n}}" on the page.
beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: en } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
});

const lang = { bg: "", en: "" };
const ds = (id: string, en: string) => ({
  id,
  kind: "dataset" as const,
  label: { bg: en, en },
  detail: { bg: "d", en: "d" },
  desc: { bg: "x", en: "x" },
  tags: [],
  x: 0,
  y: 0,
  w: 1,
  h: 1,
});

const manifest = {
  version: 2,
  generatedAt: "",
  nodes: [ds("ds:one", "One"), ds("ds:two", "Two")],
  edges: [{ id: "e0", from: "src:a", to: "ds:one" }],
  views: [],
  tiers: [],
  tours: [],
  links: [
    {
      id: "l1",
      a: "ds:one",
      b: "ds:two",
      kind: "join" as const,
      key: "eik" as const,
      label: lang,
      overlap: 40265,
    },
    {
      id: "l2",
      a: "ds:one",
      b: "ds:two",
      kind: "join" as const,
      key: "eik" as const,
      label: lang,
      overlap: 18713,
    },
    // a boundary link contributes NO key chip: it has no shared key.
    {
      id: "l3",
      a: "ds:one",
      b: "ds:two",
      kind: "boundary" as const,
      label: lang,
    },
  ],
} as unknown as DataMapManifest;

const draw = () =>
  render(
    <MemoryRouter>
      <DataMapDirectory manifest={manifest} lang="en" />
    </MemoryRouter>,
  );

describe("DataMapDirectory", () => {
  it("counts sources and links per dataset", () => {
    // The stats memo had no coverage; corrupting it passed silently.
    draw();
    const body = document.body.textContent ?? "";
    // ds:one has 1 source edge and 3 links; ds:two has 0 sources and 3 links.
    expect(body).toContain("1 source");
    expect(body).toContain("3 links");
    expect(body).toContain("0 sources");
  });

  it("renders every dataset as a real crawlable link", () => {
    // The point of the section: the page shipped a canvas and no crawlable
    // text, so these must be <Link>s in the HTML, not canvas-derived.
    draw();
    expect(screen.getByRole("link", { name: "One" })).toHaveAttribute(
      "href",
      "/data?node=ds%3Aone",
    );
    expect(screen.getByRole("link", { name: "Two" })).toBeInTheDocument();
  });

  it("shows the LARGEST overlap for a key, never the sum", () => {
    // Summing overlaps across pairs counts the same company once per pair —
    // the exact double-count this map exists to make visible. 40,265 and
    // 18,713 must not become 58,978.
    draw();
    const body = document.body.textContent ?? "";
    expect(body).toContain("40,265");
    expect(body).not.toContain("58,978");
  });

  it("carries the sparse-key caveat onto the chip", () => {
    // The ekatte link declares "of the companies with a resolved seat"; a bare
    // number on the chip claims coverage the key does not have, and the panel
    // prints that same caveat on the same page.
    const withOf = {
      ...manifest,
      links: [
        {
          id: "l4",
          a: "ds:one",
          b: "ds:two",
          kind: "join" as const,
          key: "ekatte" as const,
          label: lang,
          overlap: 4018,
          of: { bg: "от разпознатите", en: "of the resolved seats" },
        },
      ],
    } as unknown as DataMapManifest;
    render(
      <MemoryRouter>
        <DataMapDirectory manifest={withOf} lang="en" />
      </MemoryRouter>,
    );
    expect(document.body.textContent).toContain("of the resolved seats");
  });

  it("gives a boundary link no key chip", () => {
    // A boundary link means "these must not be merged". A key chip would say
    // the opposite.
    draw();
    const chips = screen.getAllByRole("link", { name: /pairs/ });
    expect(chips).toHaveLength(1); // eik only — the boundary contributes none
  });
});
