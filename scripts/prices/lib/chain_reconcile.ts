// WHY a day got smaller — the one definition, shared by the ingest guard
// (scripts/prices/load_day.ts) and anything else that has to explain a drop.
//
// It lives here for the same reason lib/coverage.ts does: the rule must have a
// single home, or two callers will disagree about whether the same day is
// acceptable.
//
// The problem it solves: `SANITY_DROP` compares TOTAL rows against yesterday
// and therefore cannot tell these apart —
//
//   (a) two named chains stopped filing, everyone else is unchanged;
//   (b) the parser regressed and EVERY chain lost a slice;
//   (c) ONE chain's file format changed and it parsed to nothing.
//
// All three read as "−27% rows". (a) is the feed doing what feeds do and the
// day is real; (b) and (c) would replace `price_current` with a corrupted
// fraction. The only available response used to be `--no-floor`, which
// suppresses the check for EVERY cause at once — so the operator either loses
// the day or loses the guard.
//
// The discriminator is per-chain attribution: subtract the loss that identified
// collapsed chains account for, and judge what is LEFT.
//
//   (b) is caught by the residue. No chain is individually collapsed, nothing
//       is attributable, and the whole drop lands unexplained.
//
//   (c) is NOT caught by the residue, and this is the subtle one. A single
//       chain parsing to zero is arithmetically indistinguishable from that
//       chain having stopped filing — same rows, same total, same everything.
//       Measured against the real parser: switching a chain's CSV to tab
//       delimiters, or appending a currency suffix to its price cell, each
//       yields 0 rows and 0 parse errors. It is separated only by
//       `archiveEiks`: КЗП OMITS the file when a chain stops filing, so a
//       PUBLISHED file that yields exactly zero rows is our failure, not
//       theirs. Such chains are collected as `unreadable` and forbid
//       attribution outright.
//
// The 2026-08 Билла break is why (c) needs the zero test rather than an
// absence test: Билла filed a SMALL file (1,768 rows against 171,275), not an
// empty one. A real collapse leaves a trace; a parse failure leaves nothing.

/** A chain reporting below this share of its previous volume counts as
 *  COLLAPSED, and its loss becomes explainable. 0.2 mirrors SANITY_DROP: the
 *  same "this is not a wobble" bar, applied per chain instead of to the total.
 *
 *  Deliberately not 0 (absent-only): the 2026-08 Билла break filed 1,768 rows
 *  against 171,275 the day before — its file was present and parsed cleanly, so
 *  an absence test sees a chain that reported and explains nothing. */
export const CHAIN_COLLAPSE_SHARE = 0.2;

/** How much of the previous day's volume may go unexplained and the day still
 *  load. This is the tolerance for ordinary day-to-day churn among the chains
 *  that are still filing normally — stores closing, a chain trimming its range.
 *
 *  5% is wide enough for that and far too narrow for a parse regression: a
 *  uniform slice off every chain leaves NOTHING explained, so the residue is
 *  the entire drop. */
export const RESIDUE_TOLERANCE = 0.05;

export interface ChainDelta {
  eik: string;
  /** Rows this chain contributed on the previous loaded day. */
  prev: number;
  /** Rows it contributed today (0 when it filed nothing at all). */
  today: number;
  /** prev − today. Positive is a loss. */
  lost: number;
  /** True when the chain's CSV was not in today's archive at all, as opposed to
   *  present and nearly empty. For a COLLAPSED chain this is reporting only —
   *  both are the source publishing less. For a chain at exactly zero it is
   *  decisive: see `unreadable`. */
  absentFromArchive: boolean;
}

export interface Reconciliation {
  prevRows: number;
  todayRows: number;
  /** prevRows − todayRows. Negative when the day GREW. */
  observedLoss: number;
  /** The part of the loss attributable to collapsed chains. */
  explainedLoss: number;
  /** Loss among chains that are still filing normally — accumulated per chain
   *  over the survivors, NOT netted globally, so a chain that grew cannot
   *  cancel a real loss elsewhere. */
  unexplainedLoss: number;
  /** `unexplainedLoss` as a share of prevRows. */
  residueShare: number;
  /** The collapsed chains, largest loss first. */
  collapsed: ChainDelta[];
  /** Chains whose file the source PUBLISHED and which yielded exactly zero
   *  rows. Never attributable — a published file we got nothing out of is a
   *  parse failure wearing a collapse's numbers. */
  unreadable: ChainDelta[];
  /** True when the drop is attributable and the day may load. */
  explained: boolean;
  /** Set when the tokeniser failed on at least one file, which forbids
   *  attribution outright. */
  parseErrors: number;
}

/** Explain a day's row loss against the previous loaded day.
 *
 *  @param prev         eik → rows on the previous LOADED day (`price_chain_days`).
 *  @param today        eik → rows parsed from today's archive, post-filter — the
 *                      same basis `price_chain_days` is written from, so the two
 *                      are comparable.
 *  @param parseErrors  Files whose tokenise threw. Any non-zero value forces
 *                      `explained: false`: attribution assumes every file we
 *                      were handed was read correctly, and one failure breaks
 *                      the premise. It is also the cheapest way to lose a
 *                      chain's whole volume, which would otherwise present as a
 *                      perfectly explainable collapse.
 *  @param archiveEiks  Every eik whose CSV was PRESENT in today's archive,
 *                      whatever came of parsing it. Omit only when the caller
 *                      genuinely cannot know; the `now === 0` fallback then used
 *                      cannot separate case (c) above.
 *
 *  Pure: no I/O, no clock.
 */
export const reconcileRowLoss = (
  prev: Map<string, number>,
  today: Map<string, number>,
  parseErrors = 0,
  archiveEiks?: ReadonlySet<string>,
): Reconciliation => {
  let prevRows = 0;
  for (const n of prev.values()) prevRows += n;
  let todayRows = 0;
  for (const n of today.values()) todayRows += n;

  const collapsed: ChainDelta[] = [];
  const unreadable: ChainDelta[] = [];
  let explainedLoss = 0;
  let unexplainedLoss = 0;

  for (const [eik, before] of prev) {
    const now = today.get(eik) ?? 0;
    if (before <= 0) continue;
    const lost = before - now;

    if (now >= before * CHAIN_COLLAPSE_SHARE) {
      // Still filing normally. Any loss here is survivor churn and counts
      // toward the residue — accumulated per chain so growth elsewhere cannot
      // net it away.
      if (lost > 0) unexplainedLoss += lost;
      continue;
    }

    const absentFromArchive = archiveEiks ? !archiveEiks.has(eik) : now === 0;
    const delta: ChainDelta = {
      eik,
      prev: before,
      today: now,
      lost,
      absentFromArchive,
    };

    // Published a file, yielded nothing: case (c). Not a collapse — a file we
    // failed to read. Counted, never explained.
    if (archiveEiks && !absentFromArchive && now === 0) {
      unreadable.push(delta);
      unexplainedLoss += lost;
      continue;
    }

    explainedLoss += lost;
    collapsed.push(delta);
  }
  collapsed.sort((a, b) => b.lost - a.lost);
  unreadable.sort((a, b) => b.lost - a.lost);

  const residueShare = prevRows > 0 ? unexplainedLoss / prevRows : 0;

  return {
    prevRows,
    todayRows,
    observedLoss: prevRows - todayRows,
    explainedLoss,
    unexplainedLoss,
    residueShare,
    collapsed,
    unreadable,
    explained:
      parseErrors === 0 &&
      unreadable.length === 0 &&
      residueShare <= RESIDUE_TOLERANCE,
    parseErrors,
  };
};

/** Did the chains that went missing turn out to be the ones we identified?
 *
 *  The cliff has two arms — rows and chain COUNT — and either alone triggers a
 *  reconciliation that reasons about rows. Usually the same event, but not the
 *  same statement: a chain-count collapse cleared by a row verdict is an answer
 *  to a question nobody asked. This closes that on its own terms. */
export const chainsAccountedFor = (
  r: Reconciliation,
  chainsToday: number,
  prevChains: number,
  drop: number,
): boolean =>
  prevChains === 0 ||
  chainsToday + r.collapsed.length >= prevChains * (1 - drop);

/** What the ingest should DO once the cliff has fired. Extracted from the
 *  guard so the decision is testable without a database: the throw is the
 *  branch that matters most and the one hardest to reach from an integration
 *  test.
 *
 *  - `load`        the drop is attributable and the parse was clean.
 *  - `warn-bypass` not attributable, but --backfill/--force/--no-floor was
 *                  passed. Loads, loudly. Never silent.
 *  - `throw`       not attributable and no bypass. Refuse the day.
 */
export const cliffVerdict = (
  rec: Reconciliation,
  chainsOk: boolean,
  skipFloor: boolean,
): "load" | "warn-bypass" | "throw" =>
  rec.explained && chainsOk ? "load" : skipFloor ? "warn-bypass" : "throw";

/** One line an operator can act on. Names the chains rather than the count,
 *  because "2 chains" is not something anyone can check and "Билла, Кауфланд"
 *  is — so pass a resolver that can name a chain which filed NOTHING today. */
export const describeReconciliation = (
  r: Reconciliation,
  chainName: (eik: string) => string = (e) => e,
): string => {
  const n = (x: number) => x.toLocaleString("en-US");
  const signed = (x: number) =>
    x === 0 ? "0" : x > 0 ? `−${n(x)}` : `+${n(-x)}`;
  const name = (c: ChainDelta) =>
    `${chainName(c.eik)}${c.absentFromArchive ? "" : ` (${n(c.today)} left)`}`;

  const parts: string[] = [`${signed(r.observedLoss)} rows`];

  if (r.collapsed.length === 0) {
    parts.push(
      `no chain individually collapsed, so none of it is attributable ` +
        `(residue ${(r.residueShare * 100).toFixed(1)}%)`,
    );
  } else {
    const who = r.collapsed.slice(0, 4).map(name).join(", ");
    const more =
      r.collapsed.length > 4 ? ` +${r.collapsed.length - 4} more` : "";
    parts.push(
      `${n(r.explainedLoss)} explained by ${r.collapsed.length} collapsed ` +
        `chain(s) — ${who}${more}`,
      `residue ${signed(r.unexplainedLoss)} (${(r.residueShare * 100).toFixed(1)}%)`,
    );
  }

  if (r.unreadable.length > 0)
    parts.push(
      `⚠ ${r.unreadable.length} chain(s) published a file that parsed to ` +
        `NOTHING — ${r.unreadable
          .slice(0, 4)
          .map((c) => chainName(c.eik))
          .join(", ")}` +
        ` — which is a parse failure, not a collapse, and forbids attribution`,
    );

  return parts.join("; ");
};
