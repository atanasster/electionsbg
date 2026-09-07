export type DisplayNumber = {
  raw: string;
  value: number;
  unit: "percent" | "million" | "billion" | null;
};

const NUMBER = /\d(?:[\d ]*\d)?(?:[,.]\d+)?/g;

const numberValue = (token: string): number =>
  Number(token.replace(/\s/g, "").replace(",", "."));

/** Numeric display tokens, retaining the scale written immediately after them. */
export const displayNumbers = (text: string): DisplayNumber[] =>
  [...text.matchAll(NUMBER)].map((match) => {
    const raw = match[0].trim();
    const suffix = text.slice((match.index ?? 0) + match[0].length);
    const unitMatch = /^\s*(%|млрд\.?|млн\.?)/iu
      .exec(suffix)?.[1]
      ?.toLowerCase();
    const unit = unitMatch?.startsWith("млрд")
      ? "billion"
      : unitMatch?.startsWith("млн")
        ? "million"
        : unitMatch === "%"
          ? "percent"
          : null;
    return { raw, value: numberValue(raw), unit };
  });

export const numericTokens = (text: string): string[] =>
  displayNumbers(text).map((token) => token.raw);

/** Half a unit in the displayed number's last decimal place. */
export const displayTolerance = (token: DisplayNumber): number => {
  const decimal = token.raw.replace(/\s/g, "").split(/[,.]/)[1];
  if (decimal) return 0.5 * 10 ** -decimal.length + 1e-9;
  return token.unit ? 0.5 + 1e-9 : 0.005;
};

const scaledValues = (value: number, unit: DisplayNumber["unit"]): number[] => {
  if (unit === "percent")
    return Math.abs(value) <= 1 ? [value, value * 100] : [value];
  if (unit === "million")
    return Math.abs(value) >= 1_000_000 ? [value, value / 1_000_000] : [value];
  if (unit === "billion")
    return Math.abs(value) >= 1_000_000_000
      ? [value, value / 1_000_000_000]
      : [value];
  return [value];
};

/**
 * Check one displayed number against a scalar or nested canonical JSON value.
 * Scaling is unit-directed, so a fraction cannot satisfy a plain number and a
 * euro amount cannot satisfy a percentage.
 */
export const carriesDisplayNumber = (
  value: unknown,
  token: DisplayNumber,
): boolean => {
  if (value == null) return false;
  const tolerance = displayTolerance(token);
  if (typeof value === "number")
    return scaledValues(value, token.unit).some(
      (candidate) => Math.abs(candidate - token.value) <= tolerance,
    );
  if (typeof value === "string")
    return displayNumbers(value).some(
      (source) => Math.abs(source.value - token.value) <= tolerance,
    );
  if (Array.isArray(value))
    return value.some((item) => carriesDisplayNumber(item, token));
  if (typeof value === "object")
    return Object.values(value as Record<string, unknown>).some((item) =>
      carriesDisplayNumber(item, token),
    );
  return false;
};
