// The renderer's half of §5.3: an id becomes a label HERE, and only here.
//
// ⚠ TWO DIRECTIONS, and the second is the one a normal test misses. It is easy to assert that
// „gerb" renders „ГЕРБ"; what this file also has to hold is that the three OTHER answers stay
// distinguishable — a local-only list carries its own Bulgarian name in both languages, an
// independent stands for nobody, and an id nothing can resolve must not quietly become a blank
// cell beside a real vote count.

import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { stripComments } from "@/../scripts/lib/strip_comments";
import { bgCorpus, enCorpus } from "@/locales/allKeys";
import { useSurfaceLabels } from "./useSurfaceLabels";

// The repo's convention for a test that asserts on rendered copy: a corpus-backed `t`, so a key
// missing from a corpus shows up as its own identifier here exactly as it would on the page.
// ⚠ `lang` is MUTABLE because this file has to run the same resolvers in BOTH languages — the
// whole §5.3 rule is about what changes between them and what deliberately does not.
let lang: "bg" | "en" = "bg";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    get i18n() {
      return { language: lang };
    },
    t: (k: string) =>
      ((lang === "bg" ? bgCorpus : enCorpus) as Record<string, string>)[k] ?? k,
  }),
}));

const inEnglish = <T,>(fn: () => T): T => {
  lang = "en";
  try {
    return fn();
  } finally {
    lang = "bg";
  }
};

const parties = {
  parties: [
    {
      id: "gerb",
      displayName: "ГЕРБ",
      displayNameEn: "GERB",
      color: "rgb(1,2,3)",
      history: [],
    },
    {
      id: "p_20",
      displayName: "ПрБ",
      displayNameEn: "PrB",
      color: "rgb(4,5,6)",
      history: [],
    },
  ],
  byNickName: { ГЕРБ: "gerb" },
  consolidationByNickName: {},
};

const settlements = [
  {
    ekatte: "56784",
    name: "Пловдив",
    name_en: "Plovdiv",
    oblast: "PDV",
    obshtina: "PDV22",
    t_v_m: "гр.",
    kmetstvo: "",
  },
];

const wrapper = ({ children }: { children: ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Seeded, never fetched: an unstubbed fetch throws in this project's jsdom setup, which is
  // also what proves this hook issues none of its own.
  qc.setQueryData(["canonical_parties"], parties);
  qc.setQueryData(["settlements"], settlements);
  qc.setQueryData(
    ["municipalities"],
    [
      {
        obshtina: "PDV22",
        ekatte: "56784",
        name: "Пловдив",
        name_en: "Plovdiv",
        oblast: "PDV",
      },
    ],
  );
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

const hook = () => renderHook(() => useSurfaceLabels(), { wrapper }).result;

describe("a ranked row's four answers stay four", () => {
  it("names a canonical party, with its colour", () => {
    const r = hook().current.rankedLabel({ partyId: "gerb" });
    expect(r).toEqual({ kind: "party", label: "ГЕРБ", color: "rgb(1,2,3)" });
  });

  it("names a local-only list from the row, not from a dictionary", () => {
    // ⚠ §5.3's SECOND EXCEPTION. No English form of a purely local list exists anywhere in the
    // corpus, so the name travels on the row and renders in both languages. Before this the id
    // WAS the name — `local:движение заедно за промяна` — and resolved to nothing at all.
    const r = hook().current.rankedLabel({
      partyId: null,
      localPartyName: "Движение заедно за промяна",
    });
    expect(r).toEqual({
      kind: "local_list",
      label: "Движение заедно за промяна",
    });
  });

  it("keeps an independent distinct from an unnamed list", () => {
    expect(hook().current.rankedLabel({ partyId: null })).toEqual({
      kind: "independent",
    });
  });

  it("REPORTS an id it cannot resolve instead of rendering a blank", () => {
    // ⚠ THE ONE THAT MATTERS. A row that resolves to nothing still carries a real vote count, so
    // an empty label is a percentage attributed to no one. `unresolved` carries the id so a
    // consumer can render it, and a gate can find it.
    expect(hook().current.rankedLabel({ partyId: "p_999" })).toEqual({
      kind: "unresolved",
      id: "p_999",
    });
  });
});

describe("place labels come from the dictionaries that own both languages", () => {
  it("resolves every level to something a reader can read", () => {
    const p = hook().current.placeLabel;
    expect(p("country", "BG")).toBe("България");
    expect(p("region", "PDV")).toBeTruthy();
    expect(p("municipality", "PDV22")).toBe("Пловдив");
    expect(p("settlement", "56784")).toBe("гр. Пловдив");
    // A polling station has no name in the corpus — the number IS the label.
    expect(p("section", "162200001")).toBe("162200001");
  });

  it("reads ABROAD out of the region dictionary, not out of a copy key", () => {
    // ⚠ THE 32nd MIR IS ALREADY IN `regions.json`, in both languages, under the same code the
    // surface stores. A new `election_place_abroad` string looked like the answer and would have
    // been a second producer for a name the corpus owns — and, since neither corpus carried it,
    // one that renders as its own identifier on the page.
    expect(hook().current.placeLabel("abroad", "32")).toBe("Извън страната");
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/data/elections/useSurfaceLabels.ts"),
      "utf8",
    );
    expect(stripComments(src)).not.toContain("election_place_abroad");
  });

  it("falls back to the CODE, never to an empty string", () => {
    // A blank place name on a result page is a heading about nowhere. „ZZZ" is ugly and honest.
    const p = hook().current.placeLabel;
    for (const level of ["region", "municipality", "settlement"] as const)
      expect(p(level, "ZZZ"), level).toBe("ZZZ");
  });
});

describe("it adds no producer (§5.3)", () => {
  it("issues no fetch of its own — it composes the app's existing resolvers", () => {
    // ⚠ THE PLAN'S OWN RULE: the EN place name already has a build-time producer with a silent
    // degrade, and „do not add a third producer" is written into §5.3. A fetch from here would
    // be that third producer, and it would disagree with the other two only in the 455 places
    // whose curated `name_en` differs from a transliteration — i.e. invisibly.
    const src = stripComments(
      fs.readFileSync(
        path.join(process.cwd(), "src/data/elections/useSurfaceLabels.ts"),
        "utf8",
      ),
    );
    expect(src).not.toMatch(/\bfetch\s*\(/);
    expect(src).not.toContain("dataUrl");
    for (const corpus of [
      "canonical_parties.json",
      "municipalities.json",
      "settlements.json",
      "regions.json",
    ])
      expect(src, corpus).not.toContain(corpus);
  });
});

describe("the English page", () => {
  it("renders party and place names in English, and the two exceptions in Bulgarian", () => {
    // §5.3: "EN pages render party and place names from the English corpus, and person names in
    // Bulgarian by design" — and a local-only list is the second such name.
    inEnglish(() => {
      const h = hook().current;
      expect(h.rankedLabel({ partyId: "gerb" })).toMatchObject({
        label: "GERB",
      });
      expect(h.placeLabel("country", "BG")).toBe("Bulgaria");
      expect(h.placeLabel("settlement", "56784")).toBe("Plovdiv");
      expect(h.placeLabel("abroad", "32")).toBe("Abroad");
      expect(h.placeLabel("municipality", "PDV22")).toBe("Plovdiv");
      // ⚠ …and the exception, unchanged and UN-TRANSLITERATED. A Latin spelling here would
      // pass any „no Cyrillic on the EN page" check while naming a list that appears in no
      // source document under that spelling.
      expect(
        h.rankedLabel({
          partyId: null,
          localPartyName: "Заедно за силна община",
        }),
      ).toMatchObject({ label: "Заедно за силна община" });
    });
  });
});
