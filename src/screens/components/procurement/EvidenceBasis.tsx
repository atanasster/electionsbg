// The one line that says WHICH evidence a connections block rests on.
//
// It exists because the three blocks in the „Връзки" section read three different
// things, and once they sit in one section a reader will otherwise take them for three
// views of one dataset:
//
//   Кръг от партньори  → tr_officers self-join (co-officership in the registry)
//   Проверка на връзка → THE SAME tr_officers self-join, for one named person
//   Политически връзки → the curated company_politicians table, which ALSO includes
//                        DECLARED stakes and counts only companies with procurement
//
// The consequence is not academic: a politician listed in Политически връзки via a
// declared stake, typed into the check below it, comes back „няма общи фирми" — the page
// denying in one card what it asserted in the one above. Conversely the check reaches
// companies with no procurement at all, which Политически връзки excludes by
// construction. Stating each basis is what keeps that difference legible instead of
// looking like a contradiction.
//
// This repo's convention is that a claim of this kind travels WITH its basis or not at
// all — the same rule 161_council_serving.sql applies with `attendanceBasis` /
// `dissentBasis`, and for the same reason: the caveat cannot live in a tooltip, because
// the reader who most needs it is the one skimming.

import { FC, ReactNode } from "react";

export const EvidenceBasis: FC<{ children: ReactNode }> = ({ children }) => (
  <p className="mb-3 border-l-2 border-border bg-muted/40 px-2.5 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
    {children}
  </p>
);
