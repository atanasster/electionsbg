// The standing half of the dead-key prune (scripts/i18n/prune_translations.ts).
//
// Every page loads the whole flat corpus before it can paint, so an unused key
// is wire bytes on every route of the site — it comes out of the per-language
// brotli budgets in tests/perf.spec.ts, and those budgets have almost no
// headroom left: the corpus grows ~2.5 KB br per language per day and the EN
// ceiling was 64 B away at the last prune. A key added and never wired is
// therefore not tidy-up-later, it is a budget failure a few commits out, in a
// test that takes a ~10-minute build to run. This one takes seconds.
//
// Failing means one of three things, in descending likelihood:
//   1. a key was added before its call site — wire it, or drop it until then;
//   2. a key is genuinely dead — `npx tsx scripts/i18n/prune_translations.ts`;
//   3. the call site builds the key in a shape analyzeKeyUsage cannot see, in
//      which case fix the ANALYSIS (see KEY_TEMPLATES) rather than adding an
//      allowlist here. There is deliberately no allowlist: every "unreachable
//      but live" shape found so far was a rule this reader should have had, and
//      two of them (a `const k =` template, a family prefix passed as a string)
//      would have been hidden by one.
import { describe, expect, it } from "vitest";
import { analyzeKeyUsage, builtKeyPatterns, loadCorpus } from "./key_usage";

const bg = loadCorpus("bg");
const en = loadCorpus("en");
const usage = analyzeKeyUsage(Object.keys(bg));

describe("translation corpus", () => {
  it("is key-for-key parallel across languages", () => {
    // The prune and this gate both analyse ONE key list, so drift here would
    // exempt the other language's extra keys from both.
    expect(Object.keys(bg).filter((k) => !(k in en))).toEqual([]);
    expect(Object.keys(en).filter((k) => !(k in bg))).toEqual([]);
  });

  it("carries no key the app cannot ask for", () => {
    expect(
      usage.unused,
      `${usage.unused.length} unreachable keys — see this file's header:\n  ` +
        usage.unused.join("\n  "),
    ).toEqual([]);
  });
});

// Every assertion above is "the dead list is empty", which an analysis that has
// stopped working satisfies perfectly. These four are what make it mean
// something.
describe("the reachability analysis still discriminates", () => {
  it("sees the corpus and the call sites", () => {
    expect(Object.keys(bg).length).toBeGreaterThan(5_000);
    expect(usage.literal.size).toBeGreaterThan(4_000);
  });

  it("reports a key no call site names", () => {
    const fake = "zz_key_no_screen_will_ever_render";
    expect(analyzeKeyUsage([fake]).unused).toEqual([fake]);
  });

  it("keeps a key only a template can produce, and only for a real family", () => {
    // official_role_* is built as `official_role_${role}` in five screens.
    const built = analyzeKeyUsage(["official_role_mayor", "zzz_role_mayor"]);
    expect(built.unused).toEqual(["zzz_role_mayor"]);
    expect(built.built.has("official_role_mayor")).toBe(true);
  });

  it("keeps a plural form whose base is used, and not a bare suffix match", () => {
    // t("mp_assets_show_more", { count }) resolves to _one/_other, and neither
    // suffixed key is written down anywhere.
    const plural = analyzeKeyUsage([
      "mp_assets_show_more_one",
      "zz_nothing_here_one",
    ]);
    expect(plural.unused).toEqual(["zz_nothing_here_one"]);
    expect(plural.plural.has("mp_assets_show_more_one")).toBe(true);
  });

  it("does not turn a text-free template into a match-everything pattern", () => {
    // RollcallHeatmap writes t(`${party}#${it.item}`) — a lookup, not a corpus
    // key. Widened to /^.*$/ it would keep the entire corpus and this gate would
    // never fail again.
    const pats = builtKeyPatterns("const a = t(`${party}#${item}`);");
    expect(pats.filter((p) => p.test("zz_anything_at_all"))).toEqual([]);
  });
});
