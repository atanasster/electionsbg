// The registry is only worth having if it cannot drift from the builder that feeds it, so
// this reads `scripts/myarea/build_alerts.ts` rather than a copy of its kind list.
//
// The defect it exists to catch already shipped: the builder emitted `open_call` and the UI
// type did not list it, so the tile fell through to a generic icon and grey. Nothing errored,
// nothing was red, and TypeScript positively asserted the kind could not occur.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ALERT_KINDS,
  ALERT_KIND_META,
  isAlertKind,
  type AlertKind,
} from "./alertKinds";
import { HOME_DATE_BASES, HOME_EVENT_CATEGORIES } from "@/data/home/homeTypes";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const BUILDER = path.join(REPO_ROOT, "scripts/myarea/build_alerts.ts");

/** Every `kind: "…"` literal the builder emits.
 *
 *  ⚠️ A quoted literal after `kind:` is an emission OR a SINGLE-LINE union member, and the
 *  file has one of the latter: `ChmiHistoryEvent` (build_alerts.ts:134) writes its four
 *  members on one line, so the scan really does pick `obshtina_mayor` out of a type
 *  declaration. That is what the CHMI allowlist below absorbs. `AlertEvent`'s own union is
 *  now a single `AlertKind` reference, so it contributes nothing here at all.
 *
 *  Two limits worth stating rather than discovering: `[a-z_]+` would miss a kind containing a
 *  digit, and a kind emitted through a variable or a template literal is invisible to the
 *  scan entirely — in which case the silent-drop warning in `useMyAreaAlerts` is the only
 *  signal left. */
const builderKinds = (): Set<string> => {
  const src = readFileSync(BUILDER, "utf-8");
  const out = new Set<string>();
  for (const m of src.matchAll(/\bkind:\s*"([a-z_]+)"/g)) out.add(m[1]);
  return out;
};

describe("alert kinds — builder ↔ registry", () => {
  it("the builder scan is not vacuous", () => {
    // A regex that stopped matching would make every assertion below pass on an empty set.
    const found = builderKinds();
    expect(found.size).toBeGreaterThanOrEqual(ALERT_KINDS.length);
    expect(found.has("procurement")).toBe(true);
  });

  it("every kind the builder emits is in the registry", () => {
    // The ChmiHistoryEvent kinds are a DIFFERENT feed with its own renderer, living in the
    // same file and never reaching MyAreaAlertEvent. Only `obshtina_mayor` is actually
    // matched by the scan today (it is the first member of that single-line union, and the
    // only one preceded by `kind:`); the other three are forward-proofing in case that type
    // is ever reformatted one-member-per-line.
    const CHMI = new Set([
      "obshtina_mayor",
      "kmetstvo_mayor",
      "rayon_mayor",
      "council",
    ]);
    const missing = [...builderKinds()].filter(
      (k) => !CHMI.has(k) && !isAlertKind(k),
    );
    expect(
      missing,
      `emitted by build_alerts.ts and absent from ALERT_KIND_META — these render with a ` +
        `fallback icon and #888:\n${missing.join("\n")}`,
    ).toEqual([]);
  });

  it("every registered kind is actually emitted", () => {
    // The converse: a kind kept in the registry after its builder was deleted is a promise of
    // a row that can never arrive, and it keeps a translation key alive that the i18n prune
    // would otherwise reclaim.
    const emitted = builderKinds();
    const stale = ALERT_KINDS.filter((k) => !emitted.has(k));
    expect(
      stale,
      `in ALERT_KIND_META and never emitted:\n${stale.join("\n")}`,
    ).toEqual([]);
  });

  it("open_call specifically is covered", () => {
    // Named rather than left to the sweep above: it is the row that shipped broken, and a
    // sweep that silently stopped scanning would pass without it.
    expect(isAlertKind("open_call")).toBe(true);
    expect(ALERT_KIND_META.open_call.dateBasis).toBe("first_seen");
  });
});

describe("alert-kind metadata", () => {
  it("every field uses a declared enum value", () => {
    for (const kind of ALERT_KINDS) {
      const meta = ALERT_KIND_META[kind];
      expect(HOME_EVENT_CATEGORIES, kind).toContain(meta.category);
      expect(HOME_DATE_BASES, kind).toContain(meta.dateBasis);
      expect(meta.color, kind).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(meta.labelKey, kind).toBe(`alert_kind_${kind}`);
    }
  });

  it("colors are distinct, so two kinds never read as one", () => {
    const colors = ALERT_KINDS.map((k) => ALERT_KIND_META[k].color);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it("icons are distinct", () => {
    const icons = ALERT_KINDS.map((k) => ALERT_KIND_META[k].icon);
    expect(new Set(icons).size).toBe(icons.length);
  });

  // WCAG 1.4.11 for the icon chip. Pure arithmetic, no DOM — and it exists because the
  // sibling "colors are distinct" test was the right instinct on the wrong axis: all eight
  // hues ARE distinct and, drawn at their own hex on a 13% tint of themselves, all eight
  // measured 1.55–2.88:1 in light mode. The tile now draws the glyph in the theme foreground
  // token over the tint instead, which is what this asserts.
  const hslToRgb = (
    h: number,
    s: number,
    l: number,
  ): [number, number, number] => {
    s /= 100;
    l /= 100;
    const k = (n: number) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) =>
      l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [f(0), f(8), f(4)].map((v) => Math.round(v * 255)) as [
      number,
      number,
      number,
    ];
  };
  const hexToRgb = (hex: string): [number, number, number] =>
    [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [
      number,
      number,
      number,
    ];
  const luminance = ([r, g, b]: [number, number, number]): number => {
    const ch = (c: number) => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
  };
  const contrast = (
    a: [number, number, number],
    b: [number, number, number],
  ): number => {
    const [x, y] = [luminance(a), luminance(b)];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  const over = (
    fg: [number, number, number],
    bg: [number, number, number],
    alpha: number,
  ): [number, number, number] =>
    fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha))) as [
      number,
      number,
      number,
    ];

  // src/App.css:11 (light) and :57 (dark) — the real tokens, so a theme change moves this.
  const CARD = { light: hslToRgb(36, 30, 86), dark: hslToRgb(223, 38, 13) };
  const CARD_FG = { light: hslToRgb(30, 10, 12), dark: hslToRgb(210, 25, 96) };
  const TINT_ALPHA = 0x22 / 255;

  it.each(["light", "dark"] as const)(
    "every icon clears WCAG 1.4.11 (3:1) in %s mode",
    (theme) => {
      const failing = ALERT_KINDS.map((k) => {
        const hue = hexToRgb(ALERT_KIND_META[k].color);
        const chip = over(hue, CARD[theme], TINT_ALPHA);
        // `text-foreground/80` composites onto the chip it sits on.
        const glyph = over(CARD_FG[theme], chip, 0.8);
        return [k, contrast(glyph, chip)] as const;
      }).filter(([, ratio]) => ratio < 3);
      expect(
        failing.map(([k, r]) => `${k} ${r.toFixed(2)}:1`),
        "the tile must draw the glyph in the theme foreground token, not at the kind hue",
      ).toEqual([]);
    },
  );

  it("drawing the glyph AT the kind hue would fail — so the rule above is not vacuous", () => {
    // The mutation check. Without it the assertion above passes on any implementation,
    // including the one this change replaced.
    const failing = ALERT_KINDS.filter((k) => {
      const hue = hexToRgb(ALERT_KIND_META[k].color);
      const chip = over(hue, CARD.light, TINT_ALPHA);
      return contrast(hue, chip) < 3;
    });
    expect(failing).toEqual([...ALERT_KINDS]);
  });

  it("a synthetic date is never labelled as something that occurred", () => {
    // The two synthetic kinds carry a CONSTRUCTED date — a programme-period midpoint and a
    // Jan-1 stand-in for a budget year. Labelling either `occurred` would assert that a thing
    // happened on a day nobody recorded.
    const wrong = ALERT_KINDS.filter(
      (k) =>
        ALERT_KIND_META[k].syntheticDate &&
        ALERT_KIND_META[k].dateBasis === "occurred",
    );
    expect(
      wrong,
      `synthetic date declared as occurred:\n${wrong.join("\n")}`,
    ).toEqual([]);
  });

  it("the kinds whose builders construct a date are marked synthetic", () => {
    // Read off the builder rather than restated: `${year}-01-01` and the programme-period
    // midpoint are the two constructions, and both are load-bearing enough that losing the
    // flag would let a consumer print "adopted on 1 January".
    const synthetic = ALERT_KINDS.filter(
      (k) => ALERT_KIND_META[k].syntheticDate,
    ).sort();
    expect(synthetic).toEqual(["capital_program", "eu_funds"]);
    const src = readFileSync(BUILDER, "utf-8");
    expect(src).toContain("`${year}-01-01`");
    expect(src).toContain("inferFundsPeriod");
  });

  it("isAlertKind rejects what it should", () => {
    expect(isAlertKind("not_a_kind")).toBe(false);
    expect(isAlertKind(undefined)).toBe(false);
    expect(isAlertKind(42)).toBe(false);
    // Prototype keys are not kinds — `hasOwnProperty` rather than `in` is what makes this so.
    expect(isAlertKind("toString")).toBe(false);
    expect(isAlertKind("constructor")).toBe(false);
  });

  it("narrows for the caller", () => {
    const value: unknown = "council_resolution";
    if (!isAlertKind(value)) throw new Error("guard failed");
    const kind: AlertKind = value;
    expect(ALERT_KIND_META[kind].category).toBe("local");
  });
});
