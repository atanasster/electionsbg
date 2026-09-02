import fs from "node:fs";
import { describe, expect, it } from "vitest";

type Hsl = [number, number, number];
const luminance = ([h, s, l]: Hsl): number => {
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  const linear = [r + m, g + m, b + m].map((v) =>
    v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
};
const ratio = (a: Hsl, b: Hsl) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** sRGB channels of an HSL colour, 0-1 — the space CSS composites alpha in. */
const srgb = ([h, s, l]: Hsl): [number, number, number] => {
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return [r + m, g + m, b + m];
};

const relativeLuminance = ([r, g, b]: [number, number, number]) => {
  const linear = [r, g, b].map((v) =>
    v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
};

/**
 * Contrast of a colour rendered at partial alpha over a background.
 *
 * ⚠️ NOT the same as the colour's own ratio, which is what the token checks
 * above measure. `hsl(var(--muted-foreground) / 0.86)` is a DIFFERENT colour
 * from `--muted-foreground`, and it is the one the image credit and the source
 * preview actually render in — so a token passing at full opacity says nothing
 * about the text a reader sees.
 */
const alphaRatio = (foreground: Hsl, background: Hsl, alpha: number) => {
  const fg = srgb(foreground);
  const bg = srgb(background);
  const composited = fg.map(
    (channel, index) => alpha * channel + (1 - alpha) * bg[index],
  ) as [number, number, number];
  const [hi, lo] = [relativeLuminance(composited), relativeLuminance(bg)].sort(
    (x, y) => y - x,
  );
  return (hi + 0.05) / (lo + 0.05);
};

describe("news light/dark accessibility tokens", () => {
  const mainCss = fs.readFileSync("src/App.css", "utf8");
  const newsCss = fs.readFileSync("newsapp/news.css", "utf8");
  const block = (css: string, selector: string) => {
    const start = css.indexOf(`${selector} {`);
    expect(start).toBeGreaterThanOrEqual(0);
    return css.slice(start, css.indexOf("}", start) + 1);
  };
  const hslToken = (cssBlock: string, name: string): Hsl => {
    const match = cssBlock.match(
      new RegExp(`--${name}:\\s*(\\d+)\\s+(\\d+)%\\s+(\\d+)%`),
    );
    expect(match, name).not.toBeNull();
    return match!.slice(1).map(Number) as Hsl;
  };

  it("inherits every brand token from the shared application theme", () => {
    const newsBlock = block(newsCss, ".news-shell");
    for (const name of [
      "background",
      "foreground",
      "card",
      "popover",
      "primary",
      "secondary",
      "muted",
      "accent",
      "border",
      "input",
      "ring",
      "radius",
    ]) {
      expect(newsBlock).not.toMatch(new RegExp(`--${name}:`));
    }
    expect(newsBlock).toContain("--news-kicker: var(--popover-foreground)");
    expect(newsCss).not.toContain(".dark .news-shell");
  });

  it.each([":root", ".dark"])(
    "keeps shared reading and focus colors accessible in %s",
    (selector) => {
      const tokens = block(mainCss, selector);
      const background = hslToken(tokens, "background");
      expect(
        ratio(hslToken(tokens, "foreground"), background),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        ratio(hslToken(tokens, "muted-foreground"), background),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        ratio(hslToken(tokens, "popover-foreground"), background),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        ratio(hslToken(tokens, "ring"), background),
      ).toBeGreaterThanOrEqual(3);
      expect(
        ratio(hslToken(tokens, "ring"), hslToken(tokens, "card")),
      ).toBeGreaterThanOrEqual(3);
      expect(
        ratio(
          hslToken(tokens, "accent-foreground"),
          hslToken(tokens, "accent"),
        ),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        ratio(
          hslToken(tokens, "destructive-foreground"),
          hslToken(tokens, "destructive"),
        ),
      ).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("uses a separated two-pixel focus treatment on shared controls", () => {
    for (const file of [
      "src/components/ui/button.tsx",
      "src/components/ui/input.tsx",
      "src/components/ui/checkbox.tsx",
    ]) {
      const source = fs.readFileSync(file, "utf8");
      expect(source).toContain("focus-visible:ring-2");
      expect(source).toContain("focus-visible:ring-offset-2");
      expect(source).toContain("focus-visible:ring-offset-background");
    }
  });

  it("leaves the shared mobile menu state to the Radix trigger", () => {
    const source = fs.readFileSync("src/layout/header/Header.tsx", "utf8");
    expect(source).not.toContain('aria-expanded="false"');
    expect(source).not.toContain('aria-controls="navbar-default"');
    expect(source).not.toContain('data-collapse-toggle="navbar-default"');
  });

  it.each([":root", ".dark"])(
    "keeps partially transparent attribution readable in %s",
    (selector) => {
      // §5 (Phase 5): "muted attribution remains at least 4.5:1 for its text
      // size". The image credit and the source preview render at 86% alpha, so
      // the token check above — which measures the colour at FULL opacity —
      // does not cover the text a reader actually sees.
      const tokens = block(mainCss, selector);
      const rule = newsCss.match(
        /\.news-story-sources,\s*\.news-image-credit--compact\s*\{([^}]*)\}/,
      );
      expect(rule, "the muted attribution rule must exist").not.toBeNull();
      // Whatever alpha the rule carries — including none — is what gets
      // measured. Written as "must state an alpha" this would have passed
      // vacuously the moment the alpha was removed to fix the failure.
      const declared = rule![1].match(
        /color:\s*hsl\(var\(--muted-foreground\)(?:\s*\/\s*([\d.]+))?\s*\)/,
      );
      expect(
        declared,
        "and must colour itself from --muted-foreground",
      ).not.toBeNull();
      const alpha = declared![1] === undefined ? 1 : Number(declared![1]);
      for (const surface of ["background", "card"] as const)
        expect(
          alphaRatio(
            hslToken(tokens, "muted-foreground"),
            hslToken(tokens, surface),
            alpha,
          ),
          `${selector}: attribution at alpha ${alpha} over ${surface}`,
        ).toBeGreaterThanOrEqual(4.5);
    },
  );
});
