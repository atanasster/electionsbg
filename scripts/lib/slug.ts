// Stable, human-readable slug ids from Bulgarian text — shared by the
// classification-registry builders (admin units, economic lines, vote items, …).

const TRANSLIT: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "sht",
  ъ: "a",
  ь: "y",
  ю: "yu",
  я: "ya",
};

// `slugify("Данъчни приходи", "eco")` → "eco-danachni-prihodi". Deterministic,
// so the same source label always maps to the same node id.
export const slugify = (name: string, prefix: string): string => {
  const latin = [...name.toLowerCase()]
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join("");
  const slug = latin
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug ? `${prefix}-${slug}` : prefix;
};
