// The flu-vaccine season rules shared by the page, the AI tool and the
// prerender. Import-free on purpose: the
// prerender and the AI bundle both read it.

/** A season runs 1 August – 31 July and is named by its start year. */
export const seasonLabel = (s: number): string =>
  `${s}/${String((s + 1) % 100).padStart(2, "0")}`;

/** The latest announced season total that no later row superseded. */
export const currentTotal = <
  T extends {
    channel: string;
    sourceDate: string;
    supersededBy: string | null;
  },
>(
  rows: readonly T[],
): T | null =>
  rows
    .filter((r) => r.channel === "total" && !r.supersededBy)
    .sort((a, b) => b.sourceDate.localeCompare(a.sourceDate))[0] ?? null;
