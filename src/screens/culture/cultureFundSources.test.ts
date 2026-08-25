// The /culture/funds source registry — the data behind the four detail pages.
//
// ⚠️ THE INVARIANT: a reader can land on ONE of these pages without ever seeing
// the parent's „these do not sum" warning, so every arm must carry its own basis,
// its own identity and — the one most likely to be dropped for space — what it
// CANNOT answer. These assert each field exists and is genuinely distinct per
// arm; a copy-pasted basis is worse than none, because it reads as a checked fact.
//
// Hermetic — no DB, no network. The figures themselves come from
// `hub_stats.json` and are gated in scripts/db/tests/culture_fund_sources.data.test.ts.

import { describe, expect, it } from "vitest";
import {
  CULTURE_FUND_SOURCES,
  cultureFundSource,
  eikNameMissed,
} from "./cultureFundSources";
import { readFileSync } from "node:fs";
import type { CultureHubStats } from "@/data/culture/hubStats";

const STATS = {
  generatedAt: "2026-08-25",
  procurement: {
    contracts: 972,
    eur: 166_898_550,
    buyers: 59,
    suppliers: 449,
    singleBid: 281,
    bidKnown: 695,
    nationalSingleBid: 108_766,
    nationalBidKnown: 265_746,
    firstDate: "2011-01-19",
  },
  risk: { grades: {} },
  funds: {
    eikExactEur: 105_920_570,
    eikExactProjects: 47,
    byNameEur: 147_024_687,
    byNameProjects: 1560,
    byNameNames: 1475,
    byNameTopProgram: {
      code: "2021BG-RRP",
      name: "Национален план за възстановяване и устойчивост",
      projects: 1292,
      eur: 117_274_067,
    },
    chitalishtaEur: 22_080_751,
    eikExactAlsoByName: 46,
  },
  agri: { chitalishtaEur: 18_341_814, chitalishtaRows: 264 },
  interreg: {
    thematicEur: 48_807_847,
    partnerRows: 202,
    partners: 168,
    rowsWithEik: 37,
  },
  people: { culturalInstituteRoles: 224 },
} satisfies CultureHubStats;

describe("CULTURE_FUND_SOURCES", () => {
  it("covers the four arms /culture/funds publishes, and nothing else", () => {
    expect(CULTURE_FUND_SOURCES.map((s) => s.id)).toEqual([
      "isun-eik",
      "isun-name",
      "interreg",
      "dfz",
    ]);
  });

  it("gives every arm a distinct id, path, resource and accent", () => {
    for (const field of ["id", "to", "resource", "accent"] as const) {
      const values = CULTURE_FUND_SOURCES.map((s) => s[field]);
      expect(
        new Set(values).size,
        `two arms share a ${field} — they render together in the cross-arm ` +
          `strip, so a repeat reads as "these two are the same kind of thing"`,
      ).toBe(values.length);
    }
  });

  it("every path is static, and routed in routes.tsx", () => {
    // cultureRegistry.ts's rule: no seeded `:param` destinations — a tile or a
    // strip card pointing at an unregistered route is a dead link no type system
    // catches. (The SITEMAP half — a <loc> and a prerendered body per path — is
    // a separate obligation and has its own gate; this asserts only that the
    // route exists.)
    const routes = readFileSync("src/routes.tsx", "utf8");
    for (const s of CULTURE_FUND_SOURCES) {
      expect(s.to, `${s.id} has a param in its path`).not.toMatch(/:/);
      expect(s.to.startsWith("/culture/funds/")).toBe(true);
      expect(
        routes,
        `${s.to} has no <Route> in src/routes.tsx — the strip card and the ` +
          `parent page both link to it`,
      ).toContain(`path="${s.to.slice(1)}"`);
    }
  });

  it("every arm states a basis, an identity and a limit — in both languages", () => {
    for (const s of CULTURE_FUND_SOURCES) {
      const limit = s.limit(STATS, "bg");
      // `short` is a strip label („Interreg") and is meant to be short; the
      // rest are sentences.
      for (const [name, text, floor] of [
        ["title", s.title, 10],
        ["short", s.short, 3],
        ["deck", s.deck, 40],
        ["basis", s.basis, 40],
        ["identity", s.identity, 40],
        ["limit", limit, 40],
      ] as const) {
        expect(
          text.bg.trim().length,
          `${s.id}.${name}.bg is too short to say anything`,
        ).toBeGreaterThan(floor);
        expect(
          text.en.trim().length,
          `${s.id}.${name}.en is too short to say anything`,
        ).toBeGreaterThan(floor);
      }
    }
  });

  it("no two arms share a basis, an identity or a limit", () => {
    // A copy-pasted basis is worse than a missing one: it reads as a checked
    // fact about THIS arm. The four are a contract value, the same contract
    // value over a wider population, a published budget and a farm subsidy —
    // four sentences, not one.
    for (const field of ["basis", "identity", "deck"] as const) {
      const values = CULTURE_FUND_SOURCES.map((s) => s[field].bg);
      expect(new Set(values).size, `two arms share their ${field}`).toBe(
        values.length,
      );
    }
    const limits = CULTURE_FUND_SOURCES.map((s) => s.limit(STATS, "bg").bg);
    expect(new Set(limits).size).toBe(limits.length);
  });

  it("every limit is a real restriction, not a hedge", () => {
    // The field exists to say what the arm cannot answer. A sentence with no
    // negation in it is a description, and the page would then look answered.
    for (const s of CULTURE_FUND_SOURCES) {
      const bg = s.limit(STATS, "bg").bg;
      expect(
        /само|не |нямат|няма|липсва|нито/i.test(bg),
        `${s.id}'s limit states no restriction: "${bg}"`,
      ).toBe(true);
    }
  });

  it("each metric reads the arm's OWN figure from the blob", () => {
    // Never a literal — the prose says what an arm is, the blob says how big.
    const byId = Object.fromEntries(
      CULTURE_FUND_SOURCES.map((s) => [s.id, s.metric(STATS)]),
    );
    expect(byId["isun-eik"].eur).toBe(STATS.funds.eikExactEur);
    expect(byId["isun-eik"].rows).toBe(STATS.funds.eikExactProjects);
    expect(byId["isun-name"].eur).toBe(STATS.funds.byNameEur);
    expect(byId["isun-name"].rows).toBe(STATS.funds.byNameProjects);
    expect(byId.interreg.eur).toBe(STATS.interreg.thematicEur);
    expect(byId.interreg.rows).toBe(STATS.interreg.partnerRows);
    expect(byId.dfz.eur).toBe(STATS.agri.chitalishtaEur);
    expect(byId.dfz.rows).toBe(STATS.agri.chitalishtaRows);
  });

  it("no two arms report the same euro figure", () => {
    // Not a style check. If two arms ever quote one number, a reader has no way
    // to tell they are different quantities, and the page family's whole thesis
    // becomes unreadable.
    const eur = CULTURE_FUND_SOURCES.map((s) => s.metric(STATS).eur);
    expect(new Set(eur).size).toBe(eur.length);
  });

  it("each arm names what a ROW is, so a count is never bare", () => {
    // „264" alone is meaningless: payments, projects and participations are
    // three different things, and one of them is not even a grant.
    const nouns = CULTURE_FUND_SOURCES.map((s) => s.metric(STATS).rowsLabel.bg);
    expect(nouns).toEqual(["проекта", "проекта", "участия", "плащания"]);
  });

  it("carries the бройна форма and the plain plural separately", () => {
    // ⚠️ Bulgarian distinguishes the noun AFTER A NUMERAL („47 проекта") from
    // the one after an article („най-големите проекти"); English does not. One
    // field therefore reads correctly in one language and wrong in the other —
    // the head's evidence heading shipped „Най-големите проекта", which is the
    // same class of error as „1 проекта". Only the ИСУН arms differ, which is
    // exactly why one field looked sufficient.
    const isun = cultureFundSource("isun-eik")!.metric(STATS);
    expect(isun.rowsLabel.bg).toBe("проекта");
    expect(isun.rowsPlural.bg).toBe("проекти");
    // Every arm declares both, and English is the same word in both roles.
    for (const src of CULTURE_FUND_SOURCES) {
      const m = src.metric(STATS);
      expect(
        m.rowsPlural.bg.length,
        `${src.id} has no plural form`,
      ).toBeGreaterThan(2);
      expect(m.rowsPlural.en).toBe(m.rowsLabel.en);
    }
  });

  it("resolves an arm by id and refuses an unknown one", () => {
    expect(cultureFundSource("dfz")?.resource).toBe("culture_agri_chitalishta");
    expect(cultureFundSource("chitalishta")).toBeUndefined();
  });

  // ── TEST-002: the documented degrade, actually exercised ──────────────────
  it("says nothing about the overlap when the blob predates the field", () => {
    // `eikExactAlsoByName` is OPTIONAL on the wire — the blob ships via
    // bucket:sync, a different command from the bundle. The fixture always
    // carries it, so without this the documented degrade is never run and the
    // guard could be removed with everything still green.
    const stale = {
      ...STATS,
      funds: { ...STATS.funds, eikExactAlsoByName: undefined },
    } as CultureHubStats;
    expect(eikNameMissed(stale)).toBeNull();
    const limit = cultureFundSource("isun-eik")!.limit(stale, "bg");
    expect(limit.bg).not.toMatch(/съдържа/);
    expect(limit.bg).not.toMatch(/NaN|undefined|\b0\b/);
    expect(limit.en).not.toMatch(/contained/);
    // The rest of the sentence — the real restriction — still stands.
    expect(limit.bg).toContain("Само институциите с ЕИК в регистъра");
  });

  it("derives the overlap once, and the three branches are distinct", () => {
    const at = (alsoByName: number | undefined) =>
      cultureFundSource("isun-eik")!.limit(
        {
          ...STATS,
          funds: { ...STATS.funds, eikExactAlsoByName: alsoByName },
        } as CultureHubStats,
        "bg",
      ).bg;
    const nested = at(STATS.funds.eikExactProjects);
    const one = at(STATS.funds.eikExactProjects - 1);
    const many = at(STATS.funds.eikExactProjects - 3);
    expect(new Set([nested, one, many, at(undefined)]).size).toBe(4);
    // Number agreement: „един проект … няма" at one, the бройна форма above it.
    expect(one).toContain("един проект");
    expect(one).toContain("няма културна дума");
    expect(many).toContain("3 проекта");
    expect(many).toContain("нямат културна дума");
    expect(nested).toContain("се съдържа изцяло");
  });

  // ── TEST-003: the route passes the matching sourceId ──────────────────────
  it("each route hands the screen the id whose path it serves", () => {
    // A path/prop mismatch is the failure a path-existence check cannot see:
    // /culture/funds/dfz rendering the Interreg arm is a 200 with the wrong
    // basis card, which is worse than a 404.
    const routes = readFileSync("src/routes.tsx", "utf8");
    for (const s of CULTURE_FUND_SOURCES) {
      const path = s.to.slice(1);
      const i = routes.indexOf(`path="${path}"`);
      expect(i, `no route for ${path}`).toBeGreaterThan(-1);
      // The element block that follows this path, up to the next <Route.
      const block = routes.slice(i, routes.indexOf("<Route", i + 1));
      expect(
        block,
        `${path} renders a CultureFundsSourceScreen with the wrong sourceId`,
      ).toContain(`sourceId="${s.id}"`);
    }
  });

  // ── TEST-004: the parent's row keys resolve ──────────────────────────────
  it("every row key on /culture/funds resolves to an arm", () => {
    // The parent builds its links with `cultureFundSource(r.key)`, which returns
    // undefined for an unknown key and silently renders an unlinked row — the
    // exact state this whole tier removes. `chitalishta` was that key until the
    // registry named the arm `dfz` for its register instead of for the group
    // (which appears on TWO of the four arms).
    const screen = readFileSync(
      "src/screens/culture/CultureFundsScreen.tsx",
      "utf8",
    );
    const keys = [...screen.matchAll(/^\s*key: "([a-z-]+)",/gm)].map(
      (m) => m[1],
    );
    expect(keys.length, "the parent's row keys are no longer findable").toBe(4);
    for (const k of keys)
      expect(
        cultureFundSource(k),
        `/culture/funds has a row keyed "${k}" that resolves to no arm, so it ` +
          `renders without a link to the records behind its number`,
      ).toBeDefined();
    expect(new Set(keys)).toEqual(
      new Set(CULTURE_FUND_SOURCES.map((s) => s.id)),
    );
  });

  // ── the KPI band, this tier's central artifact ────────────────────────────

  it("every arm builds a band, and every figure declares its basis", () => {
    // ⚠️ `HubKpi.basis` is typed as REQUIRED, which enforces PRESENCE and not
    // content — `basis: ""` compiles and renders an empty span, i.e. exactly the
    // state the field exists to prevent. HubHead guards it only with a DEV
    // console.error, which no test reads. This is the check with teeth.
    for (const src of CULTURE_FUND_SOURCES)
      for (const lang of ["bg", "en"]) {
        const band = src.kpis(STATS, lang);
        expect(
          band.length,
          `${src.id} builds no band in ${lang}`,
        ).toBeGreaterThanOrEqual(3);
        for (const k of band) {
          expect(k.value.trim(), `${src.id}/${lang}: empty KPI value`).not.toBe(
            "",
          );
          expect(k.label.trim(), `${src.id}/${lang}: empty KPI label`).not.toBe(
            "",
          );
          expect(
            k.basis.trim(),
            `${src.id}/${lang}: a figure with no declared basis — the band is the ` +
              `largest type on the page and these four arms measure four different ` +
              `things, so the basis is what stops a reader carrying one arm's ` +
              `figure onto another`,
          ).not.toBe("");
          expect(k.value).not.toMatch(/NaN|undefined/);
        }
        const labels = band.map((k) => k.label);
        expect(
          new Set(labels).size,
          `${src.id}/${lang} repeats a KPI label`,
        ).toBe(labels.length);
      }
  });

  it("the band's headline figure is the arm's own", () => {
    for (const lang of ["bg", "en"]) {
      const values = CULTURE_FUND_SOURCES.map(
        (s) => s.kpis(STATS, lang)[0].value,
      );
      expect(
        new Set(values).size,
        `two arms lead with the same figure in ${lang}`,
      ).toBe(values.length);
    }
  });

  it("drops the cells the blob cannot support, rather than showing a zero", () => {
    // `byNameNames`, `byNameTopProgram` and `eikExactAlsoByName` are all optional
    // on the wire — the blob ships via bucket:sync, a different command from the
    // bundle. A 0 in any of those cells would be a claim.
    const bare = {
      ...STATS,
      funds: {
        ...STATS.funds,
        byNameNames: undefined,
        byNameTopProgram: undefined,
        eikExactAlsoByName: undefined,
      },
    } as CultureHubStats;

    const eik = cultureFundSource("isun-eik")!;
    expect(eik.kpis(bare, "bg").length).toBe(2);
    expect(eik.kpis(STATS, "bg").length).toBe(3);

    const name = cultureFundSource("isun-name")!;
    expect(name.kpis(bare, "bg").length).toBe(3);
    expect(name.kpis(STATS, "bg").length).toBe(4);
    expect(name.finding!(bare, "bg")).toBeNull();
    expect(name.finding!(STATS, "bg")).not.toBeNull();
  });

  it("the overlap KPI shows the blob's own figure", () => {
    // Not `eikExactProjects - missed`, which reaches the same number by
    // subtracting the difference back out and is one refactor away from being
    // silently wrong.
    const band = cultureFundSource("isun-eik")!.kpis(STATS, "bg");
    const cell = band.find((k) => k.label.includes("и по име"));
    expect(cell?.value).toBe(String(STATS.funds.eikExactAlsoByName));
  });

  // ── the ranking sentence and the ORDER BY are one entry ──────────────────

  it("every arm names what its evidence list is ranked by, and the column", () => {
    // The list is only a top-N while the table is in its DEFAULT sort, and
    // `rankColumn` is the camelCased money column that sort produces. Paired so
    // the sentence and the ORDER BY cannot drift.
    const cols = new Set<string>();
    for (const src of CULTURE_FUND_SOURCES) {
      expect(src.evidenceBasis.bg.trim().length).toBeGreaterThan(5);
      expect(src.evidenceBasis.en.trim().length).toBeGreaterThan(5);
      expect(src.rankColumn).toMatch(/^[a-z][A-Za-z]*Eur$/);
      cols.add(src.rankColumn);
    }
    // The two ИСУН arms rank by the same column deliberately — same quantity,
    // two populations. The other two must not.
    expect(cols).toEqual(new Set(["grantEur", "budgetEur", "subsidyEur"]));
  });

  it("each search placeholder names what that arm's search actually reaches", () => {
    // A placeholder that under-states the reach makes a reader stop typing the
    // term that would have worked. ДФЗ genuinely searches the name ONLY
    // (scheme_desc has no trigram index), so it is the one that may be narrow.
    for (const src of CULTURE_FUND_SOURCES) {
      expect(src.searchPlaceholder.bg).toMatch(/…$/);
      expect(src.searchPlaceholder.en).toMatch(/…$/);
    }
    expect(cultureFundSource("dfz")!.searchPlaceholder.bg).toContain(
      "читалище",
    );
    expect(cultureFundSource("interreg")!.searchPlaceholder.bg).toContain(
      "операция",
    );
    expect(cultureFundSource("isun-name")!.searchPlaceholder.bg).toContain(
      "програма",
    );
  });
});
