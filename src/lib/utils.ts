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
