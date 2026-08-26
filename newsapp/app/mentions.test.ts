// Whether a mention may be rendered as a link.
//
// ⚠️ ONE rule, one definition. A story page that links a name the article page
// refuses to — about the same person — is the failure this guards, and it is
// invisible in review because both pages look correct on their own.
//
// The rule behind the rule: Bulgarian newsrooms write two-part names while the
// identity layer stores three. Of 17 corpus names tested, ZERO matched exactly
// and every one matched ambiguously when folded — Борисов 7 candidates, Радев
// 15, Цветан Василев 21. So a link is a claim, and only an exact roster hit or
// an in-document coreference has earned one.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isLinkableMention, type Mention, type MentionBasis } from "./data";

const m = (over: Partial<Mention> = {}): Mention => ({
  kind: "person",
  surface: "Делян Пеевски",
  basis: "gazetteer_exact",
  id: "delyan-peevski-ab12cd",
  role: "subject",
  ...over,
});

const ALL_BASES: MentionBasis[] = [
  "gazetteer_exact",
  "coref_resolved",
  "ambiguous_refused",
  "not_in_gazetteer",
];

describe("isLinkableMention", () => {
  it("links a roster hit and an in-document coreference", () => {
    expect(isLinkableMention(m())).toBe(true);
    expect(isLinkableMention(m({ basis: "coref_resolved" }))).toBe(true);
  });

  it("refuses both refusal bases even if an id somehow arrived", () => {
    // ⚠️ The server rejects this shape, so it should be unreachable — which
    // is exactly why the client must not assume it. Trusting `id` alone would
    // make a single bad record a wrong link about a named individual.
    for (const basis of ["ambiguous_refused", "not_in_gazetteer"] as const) {
      expect(isLinkableMention(m({ basis, id: "someone-else-99" }))).toBe(
        false,
      );
    }
  });

  it("refuses a resolution with nothing to link to", () => {
    expect(isLinkableMention(m({ id: null }))).toBe(false);
    expect(isLinkableMention(m({ id: "" }))).toBe(false);
    // ⚠️ Boolean("  ") is TRUE, so an untrimmed check renders a link to
    // /person/%20%20. The server rejects that shape, which is exactly why the
    // client must not rely on it: one bad record should cost a missing link,
    // never a wrong one.
    expect(isLinkableMention(m({ id: "   " }))).toBe(false);
  });

  it("covers every basis in the vocabulary", () => {
    // A basis added to the type but not to the rule would default to
    // unlinkable — safe — but silently, so this makes the omission visible.
    const linkable = ALL_BASES.filter((basis) =>
      isLinkableMention(m({ basis })),
    );
    expect(linkable).toEqual(["gazetteer_exact", "coref_resolved"]);
  });

  it("has no basis meaning 'we picked the best candidate'", () => {
    // ⚠️ The guard against the fix somebody will reach for the first time a
    // name they can see is right gets refused.
    for (const banned of [
      "best_match",
      "highest_ranked",
      "top_candidate",
      "fuzzy",
      "inferred",
      "probable",
    ]) {
      expect(ALL_BASES).not.toContain(banned);
    }
  });
});

describe("every renderer goes through the rule", () => {
  // ⚠️ A STATIC SOURCE GATE, the same shape imageCredit.test.ts uses for the
  // image attribution — because the failure it prevents is a file that does
  // not exist yet. Nothing renders `mentions` today; the first component that
  // does can trivially write `m.id ? <Link/> : …` and ship a link built from
  // a refused match, with every unit test in this file still green.
  //
  // The rule: a module that reads `.id` off a mention must also name
  // `isLinkableMention`. Grep-level, deliberately — a type cannot express it,
  // and the alternative (nothing) is what let the first draft through.
  const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)));

  const sources = (): { file: string; text: string }[] => {
    const out: { file: string; text: string }[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name))
          out.push({
            file: path.relative(appDir, full),
            text: fs.readFileSync(full, "utf-8"),
          });
      }
    };
    walk(appDir);
    return out;
  };

  it("has no module that reads a mention id without the rule", () => {
    const offenders = sources()
      .filter(
        (s) =>
          // Mentions are in play in this module …
          /\bMention\b|\bmentions\b/.test(s.text) &&
          // … it dereferences an id …
          /\bmention[s]?\b[^\n]{0,80}\.id\b|\bm\.id\b/.test(s.text) &&
          // … and it is not data.ts, which DEFINES the rule.
          s.file !== "data.ts" &&
          !s.text.includes("isLinkableMention"),
      )
      .map((s) => s.file);
    expect(offenders).toEqual([]);
  });

  it("still finds the definition, so the sweep is not vacuous", () => {
    // ⚠️ Without this the gate passes forever if `sources()` silently returns
    // nothing — a renamed directory, a changed extension filter.
    const all = sources();
    expect(all.length).toBeGreaterThan(5);
    expect(all.some((s) => s.text.includes("isLinkableMention"))).toBe(true);
  });
});

describe("absent vs empty", () => {
  // ⚠️ This ran against two object literals declared in the test body and
  // asserted JavaScript's own semantics — it could not fail. It now reads the
  // REAL bundle the builder wrote, which is the only place the distinction
  // can actually be lost.
  const bundleDir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "news",
    "app-data",
    "articles",
  );
  const built = fs.existsSync(bundleDir);
  if (!built) {
    console.warn(
      "mentions.test: news/app-data/articles is absent — SKIPPING the " +
        "bundle arm. This is not a pass. Run news/scripts/build_app_data.py.",
    );
  }

  (built ? it : it.skip)(
    "never turns an absent mentions key into an empty list",
    () => {
      // Every analysis on disk today predates mention extraction, so the key
      // must be absent throughout. An `?? []` anywhere in the builder would
      // publish „mentions nobody" about all 365 of them.
      let analysed = 0;
      let withKey = 0;
      for (const f of fs.readdirSync(bundleDir)) {
        if (!f.endsWith(".json")) continue;
        const bundle = JSON.parse(
          fs.readFileSync(path.join(bundleDir, f), "utf-8"),
        ) as { articles?: { analysis?: { mentions?: Mention[] } }[] };
        for (const a of bundle.articles ?? []) {
          if (!a.analysis) continue;
          analysed += 1;
          if ("mentions" in a.analysis) withKey += 1;
        }
      }
      // Non-vacuous: if the corpus were empty this would assert nothing.
      expect(analysed).toBeGreaterThan(0);
      expect(withKey).toBe(0);
    },
  );

  it("distinguishes the two states at the type level", () => {
    // The narrow half: `undefined` must not be assignable where a caller has
    // already decided extraction ran.
    const older: { mentions?: Mention[] } = {};
    const extracted: { mentions?: Mention[] } = { mentions: [] };
    expect(older.mentions ?? null).toBeNull();
    expect(extracted.mentions ?? null).not.toBeNull();
  });
});
