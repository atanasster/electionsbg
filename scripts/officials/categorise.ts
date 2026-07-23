// Which executive bucket a declarant belongs to.
//
// Kept out of ./index.ts on purpose, for the same reason as ./merge.ts: that
// module calls `run(...)` at import time, so importing it from a test would
// execute the whole network ingest.

import type { OfficialCategoryKind } from "../../src/data/dataTypes";

// Substring match against the verbatim `Category Name` in list.xml — every
// declaration's category is one of ~53 long names from ЗПК. We bucket on
// stable substrings and ignore the rest (mayors, judiciary, MPs, etc.).
// Order matters: the first matching bucket wins, so put more specific
// strings before generic ones.
//
// MUST stay in sync with CATEGORY_SUBSTRINGS in
// scripts/watch/sources/cacbg_officials.ts — the watcher has to fingerprint
// exactly the set this ingest would process.
export const CATEGORY_MAP: Array<{
  kind: OfficialCategoryKind;
  substrings: string[];
}> = [
  {
    kind: "cabinet",
    substrings: ["Министър-председател", "министри и заместник-министри"],
  },
  {
    kind: "regional_governor",
    substrings: ["Областни управители"],
  },
  {
    kind: "agency_head",
    substrings: [
      "държавни агенции",
      "изпълнителните агенции",
      "изпълнителни агенции",
    ],
  },
];

export const categoriseRaw = (raw: string): OfficialCategoryKind | null => {
  for (const bucket of CATEGORY_MAP) {
    for (const sub of bucket.substrings) {
      if (raw.includes(sub)) return bucket.kind;
    }
  }
  return null;
};

// A deputy minister and their minister share one register category
// ("Министър-председател, заместник министър-председатели, министри и
// заместник-министри"), so the category alone cannot tell them apart. The
// per-person position title can, and now that the ingest reads the right
// element it is available: the register writes "Заместник-министър" for a
// deputy minister and "Министър" / "Министър-председател" / "Заместник
// министър-председател" / "Служебен министър-председател" for the rest.
//
// Note the trap: "Заместник министър-председател" (deputy PRIME minister, a
// cabinet member) starts with the same word as "Заместник-министър" (deputy
// minister). They differ by the hyphen and by "-председател", so match the
// deputy-minister form specifically rather than on a "Заместник" prefix.
const DEPUTY_MINISTER_RE = /^заместник[\s-]*министър(?![\s-]*председател)/i;

// "Служебен" marks a CARETAKER government post — the register writes "Служебен
// министър", "Служебен заместник-министър", "Служебен министър-председател".
// It is a modifier on the office, not a different office, so it is stripped
// before the office test and reported separately.
//
// This is the distinction that made a caretaker minister indistinguishable from
// any other cabinet member on a profile page: three consecutive caretaker
// cabinets served between 2021 and 2024, and "Член на кабинета" said nothing
// about which.
const CARETAKER_RE = /^служебен\s+/i;

export const isCaretakerTitle = (title: string | null): boolean =>
  title != null && CARETAKER_RE.test(title.trim());

/** The office, with any caretaker modifier removed. */
export const officeTitle = (title: string | null): string | null =>
  title == null ? null : title.trim().replace(CARETAKER_RE, "") || null;

export const isDeputyMinisterTitle = (title: string | null): boolean => {
  const office = officeTitle(title);
  return office != null && DEPUTY_MINISTER_RE.test(office);
};

// Final category for one declarant: the category bucket, refined by the
// position title where the register lumps two distinct offices together.
export const categorise = (
  categoryRaw: string,
  positionTitle: string | null,
): OfficialCategoryKind | null => {
  const kind = categoriseRaw(categoryRaw);
  if (kind === "cabinet" && isDeputyMinisterTitle(positionTitle)) {
    return "deputy_minister";
  }
  return kind;
};
