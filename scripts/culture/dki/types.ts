// The shape of data/culture/dki_register.json, declared ONCE.
//
// It was briefly declared twice — `DkiRegister` in ingest.ts (the writer) and
// `DkiRegisterFile` in reconcile.ts (the reader) — and the two had already
// drifted by the time anyone looked: the reader's `institutes[]` was missing
// `pageId`, `cityBasis`, `corpusName`, `address`, `email` and `website`, so the
// gate cast its way around its own type with an `as unknown as`. A cast in a
// gate means the compiler has stopped checking the thing the gate is for.

import type { DkiEntry } from "./parse";
import type { DKI_COVERAGE } from "./sources";

export type DkiEikBasis = "exact" | "tokens" | "ambiguous" | "unmatched";

export type DkiInstitute = DkiEntry & {
  /** Resolved from the corpus by NAME — see resolve.ts. `null` means the
   *  register lists this body and no EIK could be established, which is a
   *  reportable fact, never a reason to guess. */
  eik: string | null;
  eikBasis: DkiEikBasis;
  /** The corpus spelling the match was made on, so a reader can check it.
   *  Chosen deterministically (longest, then lexicographic) rather than taken
   *  from whatever row Postgres returned first — this goes into a committed
   *  file, and an incidental order made 26 of 49 records churn on a re-run. */
  corpusName: string | null;
  /** Only on `ambiguous` — the EIKs that collided. A refusal is meant to be
   *  adjudicated by hand, and without this the adjudicator has to re-run the
   *  resolver under a debugger to see what it collided with. */
  ambiguousCandidates?: readonly { eik: string; name: string }[];
};

export type DkiRegister = {
  source: {
    pages: { id: string; label: string; url: string }[];
    fetchedAt: string;
  };
  coverage: typeof DKI_COVERAGE & {
    listed: number;
    resolved: number;
    ambiguous: number;
    unmatched: number;
  };
  institutes: DkiInstitute[];
};
