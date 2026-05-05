import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const initials = (name?: string | null): string => {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return (
    (
      (parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "")
    ).toUpperCase() || "?"
  );
};

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
