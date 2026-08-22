// The gates the /funds hub needs that the registry file cannot express, because they are about
// the module as a WHOLE rather than about the registry's contents.
//
// Three of the four are in docs/plans/funds-hub-v1.md §6 and each has a specific defect behind
// it in this module's history. The fourth — the approval-rate ban — is inherited from
// funds-module-v2, where it already has a gate on one page and none on the hub that fronts it.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FUNDS_TILES } from "./fundsRegistry";
import { bgCorpus as bg, enCorpus as en } from "@/locales/allKeys";

const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const read = (p: string) => readFileSync(path.join(REPO, p), "utf8");
const routes = read("src/routes.tsx");

describe("no /funds sub-page is an orphan", () => {
  it("every routed /funds/* page is either a hub destination or explicitly exempt", () => {
    // A sub-page nothing links to is a page nothing indexes. The exemptions are the three
    // shapes that legitimately have no tile:
    //   - parameterised detail pages, reached from their index (which DOES have a tile)
    //   - the hub itself
    //   - /funds/calls, which is band 1's live module rather than a tile
    // „funds" itself is not in this set: the regex below requires a `funds/` prefix, so the
    // hub can never appear as a candidate and exempting it was unreachable code that the
    // anti-rot check below then dutifully verified.
    const EXEMPT = new Set(["funds/calls"]);
    // `[\s\S]*?` across the attribute, because `<Route\n  path="…"` is the shape prettier
    // produces and a same-line-only regex silently sees fewer routes than exist — a gate that
    // scans nothing passes.
    const routed = [...routes.matchAll(/path="(funds\/[^"]*)"/g)]
      .map((m) => m[1])
      .filter((p) => !p.includes(":")) // detail pages are reached from their index
      .filter((p) => !EXEMPT.has(p));

    // A gate that scanned zero routes would pass. This is the floor that stops it.
    expect(
      routed.length,
      "the route scan found almost nothing — has the <Route> shape changed?",
    ).toBeGreaterThanOrEqual(8);

    const destinations = new Set(
      FUNDS_TILES.map((t) => t.to.replace(/^\//, "")),
    );
    const orphans = routed.filter((p) => !destinations.has(p));
    expect(
      orphans,
      `routed but unreachable from the hub: ${orphans.join(", ")}`,
    ).toEqual([]);
  });

  it("the exemptions are real routes, so the list cannot rot silently", () => {
    // An exemption for a page that no longer exists would quietly widen the gate.
    for (const p of ["funds/calls"])
      expect(routes, `${p} is exempted but not routed`).toContain(
        `path="${p}"`,
      );
  });
});

describe("the hub's stat call stays small", () => {
  it("the SQL grows no aggregate and no runaway key count", () => {
    // THE PAYLOAD RULE, as a budget. The hub fetches this on every view, and the reason it
    // exists is that the page used to pull 390 KB across 8 requests to draw previews. Without a
    // ceiling it regrows into the full artifact the first time someone adds a field carrying
    // detail — which is exactly how the parliament hub's seven mini-tiles came to pull 1.65 MB.
    //
    // Measured against the SQL rather than a database, so it runs on a checkout with no
    // Postgres: every key the function emits, counted. A new key is cheap; a new ARRAY is not,
    // and that is the shape this catches.
    const sql = read("scripts/db/schema/pg/145_funds_hub_stats.sql");
    const arrays = sql.match(/jsonb_agg|json_agg|array_agg/g) ?? [];
    expect(
      arrays,
      "145 has grown an aggregate — the hub blob must stay a flat set of scalars, or it is on its way back to being the full artifact",
    ).toEqual([]);
    // `[a-zA-Z_0-9]+`, not `[a-zA-Z]+`: the first draft's class excluded `_` and digits, so
    // forty added snake_case keys left the count unmoved and the ceiling was decorative.
    const keys = sql.match(/^\s+'[a-zA-Z_0-9]+',\s/gm) ?? [];
    expect(keys.length, `145 emits ${keys.length} keys`).toBeLessThan(45);
    expect(
      keys.length,
      "the key scan matched nothing — has the shape changed?",
    ).toBeGreaterThan(15);
    // An array can also arrive by selecting a jsonb ARRAY straight out of a payload, with no
    // `*_agg` anywhere. `focus_dossiers` takes the LENGTH of one, which is why the guard is on
    // the projection rather than on the whole file.
    const projection = sql.slice(sql.indexOf("jsonb_build_object"));
    expect(
      projection.match(/->\s*'themes'(?!\))/g) ?? [],
      "a raw jsonb array is being embedded in the hub payload",
    ).toEqual([]);
  });
});

describe("every money figure declares its basis", () => {
  it("every caption over a PERCENTAGE names its denominator", () => {
    // The first draft tested `/^(средства|пари|money|funds)$/` — a caption exactly equal to one
    // of four words. „европейски средства", „средства." and „евро" all sailed through, and the
    // live defect it was written for did too: the RRF tile's secondary read „30% изплатени"
    // while the tile two cases above it says „изплатено от ПОМОЩТА", because the other answer
    // is 21.1%. A gate that cannot see the bug it was written for is not a gate.
    //
    // So this is a TABLE. Every caption that sits over a percentage must name what the
    // percentage is of; adding a new one means adding a row here on purpose.
    const OVER_A_PERCENTAGE = [
      "funds_m_paid_of_grant",
      "funds_m_paid",
      "funds_m_of_corpus",
    ];
    const DENOMINATOR = /помощ|корпус|договорено|grant|corpus|contracted/i;
    for (const k of OVER_A_PERCENTAGE) {
      for (const [lang, bundle] of [
        ["bg", bg],
        ["en", en],
      ] as const) {
        const v = (bundle as Record<string, string>)[k];
        expect(v, `${lang} is missing ${k}`).toBeTruthy();
        expect(
          DENOMINATOR.test(v),
          `${lang}.${k} = „${v}" sits over a percentage and names no denominator — this corpus has two answers for every rate`,
        ).toBe(true);
      }
    }
  });

  it("the Interreg tile's caption names Bulgaria, since its figure is BG-filtered", () => {
    // 1,115 of 1,954. A caption reading „проекти" over the filtered count would be a claim
    // about the whole register.
    const cap = (bg as Record<string, string>)["funds_m_bg_projects"];
    expect(cap).toMatch(/български/);
    expect((en as Record<string, string>)["funds_m_bg_projects"]).toMatch(
      /Bulgarian/,
    );
  });

  it("the places caption names that it is a SUBSET", () => {
    // The map carries 50% of the money. „разпределени по места" plus the „X% от целия корпус"
    // secondary is what keeps €22bn from reading as the corpus total.
    expect((bg as Record<string, string>)["funds_m_of_corpus"]).toMatch(
      /корпус/,
    );
  });
});

describe("nothing on the hub is worded as an approval rate", () => {
  it("no funds string calls a disbursement figure „одобрен“ / „approved“", () => {
    // ИСУН publishes no rejected applications, so an approval rate has no denominator and is
    // not computable from this corpus. `ProcedureBaseRates.test.tsx` gates one page; this gates
    // the module's shared strings, which is where a hub tile would take its wording from.
    // EVERY prefix this module renders, not just `funds_`: 168 of the 426 `t()` calls under
    // src/screens/funds use one of the others, `rates_*` (the base-rate card) among them —
    // which is precisely where an approval rate would be invented.
    const PREFIXES = [
      "funds_",
      "rates_",
      "oc_",
      "fit_",
      "integrity_",
      "focus_",
      "news_",
    ];
    // THE BAN IS NARROW, and the first draft's detector was not. It flagged any use of the
    // word, which caught three compliant strings on its first run:
    //   - „Не е процент одобрение — регистърът съдържа само сключени договори" (the required
    //     ruling-out itself)
    //   - „такса … независимо дали проектът бъде одобрен" (a consultancy fee, not a rate)
    // A gate that fires on its own remedy gets deleted by the next person.
    //
    // So: flag only where the word sits beside a RATE. „N% одобрени" is the defect; „payable
    // whether or not the project is approved" is not.
    const RATE = /%|процент|дял|\brate\b|\bshare\b/i;
    const RULES_IT_OUT =
      /не\s+е\s+процент|няма.{0,24}одобрен|не\s+се\s+публикуват|not an approval|no approval|never an approval/i;
    const offenders: string[] = [];
    for (const [lang, bundle] of [
      ["bg", bg],
      ["en", en],
    ] as const) {
      for (const [k, v] of Object.entries(bundle as Record<string, string>)) {
        if (!PREFIXES.some((p) => k.startsWith(p))) continue;
        if (RULES_IT_OUT.test(v)) continue;
        const usesWord =
          lang === "bg" ? /одобрен/i.test(v) : /\bapprov/i.test(v);
        if (usesWord && RATE.test(v)) offenders.push(`${lang}.${k}: ${v}`);
      }
    }
    expect(
      offenders,
      `a disbursement figure worded as approval — ИСУН publishes no rejected applications, so that denominator does not exist:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("the detector is not vacuous — it catches the shape it bans", () => {
    // After narrowing it to „the word beside a rate", the risk flips: a detector that now
    // matches nothing would pass silently for ever.
    const RATE = /%|процент|дял|\brate\b|\bshare\b/i;
    const RULES_IT_OUT =
      /не\s+е\s+процент|няма.{0,24}одобрен|не\s+се\s+публикуват|not an approval|no approval|never an approval/i;
    const bad = (v: string, bgLang = true) =>
      !RULES_IT_OUT.test(v) &&
      (bgLang ? /одобрен/i.test(v) : /\bapprov/i.test(v)) &&
      RATE.test(v);
    expect(bad("74% одобрени проекта"), "the banned shape must be caught").toBe(
      true,
    );
    expect(bad("Approval rate: 74%", false)).toBe(true);
    // …and the compliant ones must not be.
    expect(
      bad("Не е процент одобрение — публикуват се само сключени договори"),
    ).toBe(false);
    expect(bad("плаща се независимо дали проектът бъде одобрен")).toBe(false);
  });
});

describe("the funds screens directory has no dead components", () => {
  it("every Tile/Card/Screen file is imported somewhere", () => {
    // The rewire orphaned three teaser tiles whose destinations now render their own content.
    // Dead code in a directory this size is the trace of a move that was half-finished.
    //
    // LIMIT, stated: this finds only DIRECTLY unreferenced files. A dead component that another
    // dead component still imports stays invisible, so a chain has to be removed from the leaf
    // up. Catching that needs a real import graph and is out of scope here.
    const dir = "src/screens/funds";
    const files = readdirSync(path.join(REPO, dir)).filter(
      (f) => /\.tsx$/.test(f) && !/\.test\.tsx$/.test(f),
    );
    // THE SCAN ROOT MATTERS: three funds components are referenced from `src/data/**`, so a
    // three-file root would flag them as dead. Walk the whole of `src/`.
    const walk = (d: string): string[] =>
      readdirSync(path.join(REPO, d), { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? walk(path.join(d, e.name))
          : /\.(tsx?|ts)$/.test(e.name)
            ? [path.join(d, e.name)]
            : [],
      );
    const all = walk("src").map(read).join("\n");
    const orphans = files
      .map((f) => f.replace(/\.tsx$/, ""))
      .filter((name) => {
        // Count references OUTSIDE the file's own source.
        const own = read(path.join(dir, `${name}.tsx`));
        const outside = all.split(own).join("");
        return !new RegExp(`\\b${name}\\b`).test(outside);
      });
    expect(orphans, `unimported: ${orphans.join(", ")}`).toEqual([]);
  });
});
