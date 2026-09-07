import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Re-exported, not defined here: the rule lives in a leaf module so a consumer with a byte
// budget can take it without `clsx` + `tailwind-merge` coming along. See `lib/partyHref.ts`.
export { partyHref } from "./partyHref";

export const initials = (name?: string | null): string => {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return (
    (
      (parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "")
    ).toUpperCase() || "?"
  );
};

// Canonical form for name-based lookups across data sources. parliament.bg's
// profile API returns hyphenated names without surrounding spaces
// ("ГУГЛЕВА-ИВАНОВА"), but the roll-call CSVs render the same name with
// spaces around the hyphen ("ГУГЛЕВА - ИВАНОВА") — and CIK data is
// inconsistent too. Without this collapsing step, the rollcall→index
// fallback in `useMps.findMpByName` and the legacy /candidate/{name} URL
// resolver both miss for any MP with a hyphenated family name. Apply at
// every comparison site (and at scrape time when writing the index's
// `normalizedName`) so both ends agree.
export const normalizeMpName = (s: string): string =>
  s
    .toUpperCase()
    .replace(/\s+/g, " ")
    .replace(/\s*-\s*/g, "-")
    .trim();

// Drop the patronymic from a Bulgarian three-part name (e.g.
// "Бойко Методиев Борисов" → "Бойко Борисов") so tight tile layouts can
// show a recognizable name without truncation. Falls back to the original
// string for one- or two-part names.
export const firstLastName = (name?: string | null): string => {
  if (!name) return "";
  const parts = name.trim().split(/\s+/);
  if (parts.length < 3) return name.trim();
  return `${parts[0]} ${parts[parts.length - 1]}`;
};

// Title-case a name, preserving hyphenated parts ("ИВАН ПЕТРОВ-СТАНЕВ"
// → "Иван Петров-Станев"). Source data from parliament.bg roll-call CSVs
// is uppercase; this gives a more readable form for dense chip layouts.
export const titleCaseName = (name?: string | null): string => {
  if (!name) return "";
  return name
    .trim()
    .split(/\s+/)
    .map((part) =>
      part
        .split("-")
        .map((seg) =>
          seg.length === 0
            ? seg
            : seg.charAt(0).toLocaleUpperCase() +
              seg.slice(1).toLocaleLowerCase(),
        )
        .join("-"),
    )
    .join(" ");
};
