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

describe("news light/dark accessibility tokens", () => {
  const css = fs.readFileSync("newsapp/news.css", "utf8");
  const light = {
    bg: [42, 38, 96],
    fg: [28, 16, 12],
    muted: [28, 9, 36],
    kicker: [13, 63, 34],
    border: [31, 13, 52],
    primary: [28, 16, 12],
    secondary: [39, 25, 91],
    card: [42, 44, 98],
    ring: [329, 86, 50],
  } as const;
  const dark = {
    bg: [220, 25, 9],
    fg: [39, 29, 92],
    muted: [37, 12, 68],
    kicker: [32, 72, 68],
    border: [216, 12, 52],
    primary: [39, 29, 92],
    secondary: [218, 18, 17],
    card: [220, 22, 12],
    ring: [329, 86, 50],
  } as const;
  const cssName = (name: string) =>
    name === "bg"
      ? "background"
      : name === "fg"
        ? "foreground"
        : name === "muted"
          ? "muted-foreground"
          : name === "kicker"
            ? "editorial-kicker"
            : name;
  const cssValue = ([h, s, l]: readonly number[]) => `${h} ${s}% ${l}%`;
  const block = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    expect(start).toBeGreaterThanOrEqual(0);
    return css.slice(start, css.indexOf("}", start) + 1);
  };

  it("keeps audited semantic tokens in the production stylesheet", () => {
    for (const [selector, tokens] of [
      [".news-shell", light],
      [".dark .news-shell", dark],
    ] as const)
      for (const [name, value] of Object.entries(tokens))
        expect(block(selector)).toContain(
          `--${cssName(name)}: ${cssValue(value)}`,
        );
  });

  it.each([
    [light, "light"],
    [dark, "dark"],
  ] as const)("meets AA contrast in %s mode", (tokens) => {
    expect(ratio(tokens.fg as Hsl, tokens.bg as Hsl)).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(ratio(tokens.muted as Hsl, tokens.bg as Hsl)).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(
      ratio(tokens.kicker as Hsl, tokens.bg as Hsl),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      ratio(tokens.border as Hsl, tokens.bg as Hsl),
    ).toBeGreaterThanOrEqual(3);
    expect(ratio(tokens.ring as Hsl, tokens.bg as Hsl)).toBeGreaterThanOrEqual(
      3,
    );
    expect(ratio(tokens.ring as Hsl, tokens.fg as Hsl)).toBeGreaterThanOrEqual(
      3,
    );
    for (const surface of [tokens.primary, tokens.secondary, tokens.card])
      expect(ratio(tokens.ring as Hsl, surface as Hsl)).toBeGreaterThanOrEqual(
        3,
      );
  });
});
