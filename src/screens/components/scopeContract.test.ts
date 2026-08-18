// The `?pscope` contract, checked over the SOURCE of every <ScopeControl> call
// site rather than over one page's behaviour.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE RULE. `pscope` is in usePreserveParams' allowlist, so it rides along on
// ordinary in-app links: a scope minted where it IS valid (y:2019 on
// /procurement) arrives on a page whose corpus has no such year. A page in that
// position has exactly TWO honest answers, and CLAUDE.md's URL contract names
// both:
//
//   RESOLVE  — clamp with useScope({ years, allowAll }) and hand the control the
//              SAME value via `value`/`onChange`. The pill and the numbers are
//              then one value and cannot disagree.
//   NAME IT  — keep the raw scope and say "no data for 2019" in the page body.
//              The reader keeps seeing the year they asked for and is told why
//              it is empty.
//
// What no page may do is the third thing: offer a NARROWED picker (`years=` or
// `allowAll={false}`) while reading the scope unresolved and rendering neither
// state. Radix renders a controlled Select whose value matches no item as EMPTY
// — not the placeholder — so the widget reads as the page default while the page
// underneath answers for some other window. That is "shows one window and counts
// another", which the contract forbids.
//
// This gate can check the RESOLVE arm mechanically. The NAME-IT arm is a claim
// about rendered copy, so it is a declared exception carrying its reason — and
// the declaration is verified, not taken on trust: an excepted file must read
// the scope unresolved (`useScope()` with no support argument), which is the
// mechanism that makes "keep the raw scope" true. A file that starts resolving
// fails as a STALE exception, so the list cannot rot in either direction.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { join } from "node:path";

/** Call sites that keep the RAW scope and name the gap in the page body.
 *
 *  `rawScopeIn` is the file whose `useScope()` must carry NO support argument —
 *  the mechanism that makes "the reader keeps seeing the year they asked for"
 *  true. It is usually the call site itself, but a component that renders the
 *  picker while its sibling hook reads the scope points at the hook, because
 *  that is where a future `useScope({...})` would silently break the claim. */
const NAMES_THE_GAP: Record<string, { reason: string; rawScopeIn: string }> = {
  "src/screens/SubsidiesDashboardScreen.tsx": {
    reason:
      "The CAP corpus skips 2014 and 2018-2020, so an off-list year is COMMON rather " +
      "than exotic. The hub renders a named `noData` card — „Няма данни за субсидии за " +
      "2019“ plus the list of years ДФЗ does publish — which tells the reader more than " +
      "silently snapping them back to the latest year would.",
    rawScopeIn: "src/screens/SubsidiesDashboardScreen.tsx",
  },
  "src/screens/dev/SubsidiesBrowserDbScreen.tsx": {
    reason:
      "Filters the table to the requested year and lets the table's own empty state " +
      "report it, under a pill showing that same year. Clamping would answer a question " +
      "nobody asked.",
    rawScopeIn: "src/screens/dev/SubsidiesBrowserDbScreen.tsx",
  },
  "src/screens/subsidies/AgriScopeGate.tsx": {
    reason:
      "The shared picker + fallback for the seven /subsidies sub-pages that offer a " +
      "scope. Its own `AgriScopeFallback` renders the four-state gate, `noData` " +
      "included, so every one of them inherits the named gap — the year, the list of " +
      "years ДФЗ does publish, and a button back to one that works — from one place. " +
      "Two of the seven hand-rolled a weaker card until step 6c; if that recurs this " +
      "reason is false, so AGRI_FALLBACK_USERS below checks it rather than trusting it.",
    // The picker is a presentational component; the scope is read next door, and
    // that is the read a future support argument would clamp.
    rawScopeIn: "src/data/agri/useAgriScope.ts",
  },
};

const REPO = join(__dirname, "..", "..", "..");
const files = globSync("src/**/*.tsx", { cwd: REPO })
  .filter((f) => !f.includes(".test."))
  .sort();

interface Site {
  file: string;
  tag: string;
  narrowed: boolean;
  controlled: boolean;
}

/** Strip // and /* *\/ comments so a <ScopeControl> named in PROSE is not counted
 *  as a call site — PersonContractsScreen mentions it twice in its header. */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

/** Read one JSX element's opening tag from `<ScopeControl` to its matching `>`,
 *  tracking brace depth so an inline arrow prop — `onChange={(v) => set(v)}`,
 *  the idiomatic form of the very prop this gate reasons about — does not end
 *  the tag at the `>` inside it. A `[^>]*?` regex silently DROPS such a site,
 *  which is the worst failure available to a gate: it reports green by seeing
 *  less. */
const openingTags = (src: string): string[] => {
  const out: string[] = [];
  for (
    let i = src.indexOf("<ScopeControl");
    i !== -1;
    i = src.indexOf("<ScopeControl", i + 1)
  ) {
    let depth = 0;
    let quote: string | null = null;
    for (let j = i; j < src.length; j++) {
      const c = src[j];
      if (quote) {
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) {
        out.push(src.slice(i, j + 1).replace(/\s+/g, " "));
        break;
      }
    }
  }
  return out;
};

const sites: Site[] = [];
const tokenCounts = new Map<string, { tokens: number; parsed: number }>();
for (const rel of files) {
  const src = stripComments(readFileSync(join(REPO, rel), "utf8"));
  if (!src.includes("<ScopeControl")) continue;
  const tags = openingTags(src);
  tokenCounts.set(rel, {
    tokens: src.split("<ScopeControl").length - 1,
    parsed: tags.length,
  });
  for (const tag of tags) {
    sites.push({
      file: rel,
      tag,
      narrowed: /\byears=/.test(tag) || /allowAll=\{false\}/.test(tag),
      // `value` alone is not enough — an uncontrolled `onChange` cannot hold a
      // resolved scope, and a `value` with no `onChange` cannot be changed.
      controlled: /\bvalue=/.test(tag) && /\bonChange=/.test(tag),
    });
  }
}

describe("the ?pscope contract", () => {
  it("finds the call sites at all (the gate is not vacuous)", () => {
    // A refactor that renames the component or changes the tag shape would
    // otherwise turn every assertion below into a green no-op.
    expect(sites.length).toBeGreaterThan(15);
    expect(sites.filter((s) => s.narrowed).length).toBeGreaterThan(3);
    expect(sites.filter((s) => s.controlled).length).toBeGreaterThan(3);
  });

  it("parses every call site it can see (no silent under-counting)", () => {
    // The gate's own blind spot, made loud. An element form the parser cannot
    // read is indistinguishable from one that is compliant, so a mismatch here
    // is a defect in this file, not in the screen.
    const missed = [...tokenCounts.entries()]
      .filter(([, c]) => c.tokens !== c.parsed)
      .map(([f, c]) => `${f}: ${c.tokens} occurrences, ${c.parsed} parsed`);
    expect(
      missed,
      "openingTags() failed to read a <ScopeControl> element. Fix the parser — " +
        "an unparsed site is silently exempt from every rule below.",
    ).toEqual([]);
  });

  it("never offers a narrowed picker while reading the scope unresolved", () => {
    const offenders = sites
      .filter((s) => s.narrowed && !s.controlled)
      .filter((s) => !(s.file in NAMES_THE_GAP))
      .map((s) => `${s.file}: ${s.tag}`);
    expect(
      offenders,
      "A <ScopeControl> with a narrowed `years=` / `allowAll={false}` must either " +
        "be controlled by a resolved scope (useScope({years, allowAll}) → value/onChange) " +
        "or its page must name the gap — add it to NAMES_THE_GAP with the reason.",
    ).toEqual([]);
  });

  it("every declared exception is real, and none has gone stale", () => {
    for (const [file, { reason, rawScopeIn }] of Object.entries(
      NAMES_THE_GAP,
    )) {
      const mine = sites.filter((s) => s.file === file);
      expect(
        mine.length,
        `${file} declares an exception but renders no <ScopeControl>`,
      ).toBeGreaterThan(0);
      expect(
        mine.some((s) => s.narrowed && !s.controlled),
        `${file} is listed in NAMES_THE_GAP but no longer offers a narrowed, ` +
          `uncontrolled picker — remove the exception.`,
      ).toBe(true);

      // The claim is "it keeps the RAW scope", so the declared reader must call
      // useScope WITHOUT a support argument. `useScope({...})` clamps, and a
      // clamping page cannot also be showing the reader the year they asked for.
      // stripComments, like every other reader here. Without it a file that merely NAMES
      // `useScope({...})` in a comment reads as clamping — which is exactly what happened
      // when the /subsidies hub grew a comment explaining how /culture resolves its scope.
      // A gate that trips on prose teaches people to delete the prose.
      const src = stripComments(readFileSync(join(REPO, rawScopeIn), "utf8"));
      expect(
        /useScope\(\s*\)/.test(src),
        `${file} claims to keep the raw scope, but ${rawScopeIn} does not call ` +
          `useScope() bare — either it now clamps (drop the exception) or the ` +
          `rawScopeIn pointer is wrong.`,
      ).toBe(true);
      expect(
        /useScope\(\s*\{/.test(src),
        `${rawScopeIn} both clamps and reads raw — two scopes on one screen.`,
      ).toBe(false);

      expect(
        reason.length,
        `${file}'s exception needs a real reason`,
      ).toBeGreaterThan(60);
    }
  });

  it("every sub-page behind the shared picker uses the shared fallback", () => {
    // AgriScopeGate's exception is granted on the claim that its sub-pages all
    // inherit ONE named-gap card. That claim is the exception's entire basis,
    // the rule above cannot see it, and it was FALSE when written: two of the
    // seven hand-rolled „Няма данни за субсидии за избрания период" — no year,
    // no published-years list, no way back, and a FAILED fetch rendered as an
    // unpublished year (the four-state defect, one directory from /farm/:eik).
    // Checked here rather than trusted, because prose in an exception list is
    // exactly the thing that rots without failing.
    const consumers = globSync("src/screens/subsidies/*.tsx", { cwd: REPO })
      .filter((f) => !f.includes(".test."))
      .filter((f) => !f.endsWith("AgriScopeGate.tsx"))
      .filter((f) =>
        stripComments(readFileSync(join(REPO, f), "utf8")).includes(
          "<AgriScopePicker",
        ),
      );
    expect(
      consumers.length,
      "no sub-page renders the shared picker — has this module moved?",
    ).toBeGreaterThan(4);
    // The ELEMENT, with a boundary — a plain substring also matches an import
    // that is never rendered, and any identifier that merely starts with the
    // name. (Both were true of the first cut of this check.)
    const handRolled = consumers.filter(
      (f) =>
        !/<AgriScopeFallback[\s>]/.test(
          stripComments(readFileSync(join(REPO, f), "utf8")),
        ),
    );
    expect(
      handRolled,
      "These pages render the shared scope picker but not the shared fallback, so " +
        "their empty state is weaker than the one AgriScopeGate's exception promises. " +
        "Use <AgriScopeFallback gate={gate}>.",
    ).toEqual([]);
  });

  it("a page that clamps never leaves its picker reading ?pscope", () => {
    // The CONVERSE of the rule above, and the one a tag-keyed gate would miss:
    // the page narrows in the hook (useScope({years})) but renders a bare
    // <ScopeControl />, which falls back to reading ?pscope itself. The picker
    // then offers 2011-2026 and drives the URL while the page counts a clamped
    // window — the same "one window shown, another counted" failure, arrived at
    // from the other side. Zero instances today; this keeps it that way.
    const offenders: string[] = [];
    for (const s of sites.filter((x) => !x.controlled)) {
      const src = stripComments(readFileSync(join(REPO, s.file), "utf8"));
      if (/useScope\(\s*\{/.test(src)) offenders.push(`${s.file}: ${s.tag}`);
    }
    expect(
      offenders,
      "This page clamps the scope with useScope({...}) but its <ScopeControl> is " +
        "uncontrolled, so the picker reads ?pscope raw. Pass the resolved scope " +
        "as value/onChange.",
    ).toEqual([]);
  });

  it("a page that DOES resolve hands the control the same value", () => {
    // The converse failure: resolving in the hook and then letting the control
    // read `?pscope` itself puts two different scopes on one screen.
    for (const s of sites.filter((x) => x.controlled)) {
      const src = readFileSync(join(REPO, s.file), "utf8");
      const resolvesHere = /useScope\(\s*\{/.test(src);
      const takesScopeAsProp = /scopeValue|onScopeChange/.test(s.tag);
      expect(
        resolvesHere || takesScopeAsProp || /useState/.test(src),
        `${s.file} passes value/onChange to <ScopeControl> but neither resolves a ` +
          `scope nor receives one as a prop — where does that value come from?`,
      ).toBe(true);
    }
  });
});
