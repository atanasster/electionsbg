// The pure logic of the ЦАИС tenderId walk: what an id turns out to BE, and which
// ids to visit.
//
// Split out of enumerate_eop_ids.ts (which runs its CLI at import time) so the two
// pieces of judgement in the walk are unit-testable. Both have already been wrong
// once: the range default hid a recency gap, and an unvalidated sample size walked
// zero ids while reporting success.

/** Nothing is published below this: ids 1000…56504 all answer with an empty body
 *  (probed 2026-08-03), so the ЦАИС era genuinely starts here. */
export const ID_FLOOR = 56505;

/**
 * How far PAST the highest id we already hold the default walk reaches.
 *
 * ⚠️ Without this the audit cannot see the failure it exists to catch. Stopping at
 * our own maximum means a gap at the TOP of the id space — the newest procedures,
 * i.e. exactly the 69-day-hole shape from §11 — is structurally invisible, because
 * every id we are missing sits above the ceiling we chose from what we have.
 *
 * Walking past the register's real maximum is FREE of false positives: an unminted
 * id answers with an empty body, so it classifies as `empty` and can never enter the
 * missing set. The only cost is spent calls, which is the right thing to trade.
 */
export const ID_HEADROOM = 20_000;

export type TenderIdClass = "empty" | "lot" | "procedure";

export interface DetailsShape {
  SpecialNumber?: string | null;
  TenderPublicationDetails?: unknown[];
}

/**
 * Classify one `GetPublishedTenderDetails` body.
 *
 * ⚠️ A LOT ANSWERS 200 WITH A REAL BODY — name, status, the lot's own id — so
 * "did I get a 200?" is not a completeness test. Lots are 53% of the id space
 * (plan §9.3); counting them as procedures would inflate the corpus ~2.4x.
 *
 * A procedure needs BOTH a non-empty `SpecialNumber` and at least one publication:
 *
 * - `SpecialNumber` alone is not enough — a lot can carry one in some payloads.
 * - Publications alone are not enough either, and this is the subtle half: 248 rows
 *   in the corpus have a synthetic `T<tenderId>` УНП, for which the register returns
 *   `SpecialNumber: ""`. Keying on publications alone would classify those as
 *   procedures on a different basis than the rest, so they are deliberately treated
 *   the same as any other empty-УНП body here and reconciled by tenderId instead.
 */
export const classifyDetails = (body: DetailsShape | null): TenderIdClass => {
  if (!body) return "empty";
  const hasUnp = !!body.SpecialNumber && body.SpecialNumber.length > 0;
  const hasPubs = (body.TenderPublicationDetails ?? []).length > 0;
  return hasUnp && hasPubs ? "procedure" : "lot";
};

export interface IdRangeSpec {
  /** Highest tenderId the corpus already holds; the default ceiling builds on it. */
  maxHave: number;
  from?: string;
  to?: string;
  sample?: string;
  full?: boolean;
  probe?: boolean;
}

/**
 * Which ids the walk visits.
 *
 * Throws on any unusable input rather than returning a short list. That is the point:
 * the first version parsed `--sample` with a bare `parseInt`, so `abc`, `0` and `-5`
 * each walked ZERO ids and printed a clean "✓ complete" summary at exit 0 — the same
 * silently-empty-work-set failure the store guards against one layer down.
 *
 * Sampling is a deterministic even spread (no `Math.random`) so two runs are
 * comparable and any id a run flags can be re-probed exactly.
 */
export const selectIds = (spec: IdRangeSpec): number[] => {
  const num = (raw: string | undefined, label: string): number | undefined => {
    if (raw === undefined) return undefined;
    // Bare parseInt accepts "1e3" as 1 and "abc" as NaN; require the whole token.
    if (!/^\d+$/.test(raw.trim()))
      throw new Error(
        `${label} must be a whole number, got ${JSON.stringify(raw)}`,
      );
    return Number(raw.trim());
  };

  const from = num(spec.from, "--from") ?? ID_FLOOR;
  const to = num(spec.to, "--to") ?? spec.maxHave + ID_HEADROOM;
  if (to < from) throw new Error(`empty range: --from ${from} > --to ${to}`);

  const span = to - from + 1;
  if (spec.full) return Array.from({ length: span }, (_, i) => from + i);

  const sample = num(spec.sample, "--sample") ?? (spec.probe ? 400 : 2000);
  if (sample < 1) throw new Error(`--sample must be at least 1, got ${sample}`);
  if (sample >= span) return Array.from({ length: span }, (_, i) => from + i);
  if (sample === 1) return [to];

  // Spread INCLUSIVE of both endpoints. A `from + floor(k * span / sample)` spread
  // stops ~one step short of the ceiling, so the newest ids — the likeliest place
  // for a gap, and the whole reason the range reaches past `maxHave` — would be the
  // ones never probed. Anchoring the last sample on `to` costs nothing and closes
  // that blind spot.
  const step = (span - 1) / (sample - 1);
  return Array.from({ length: sample }, (_, k) => Math.round(from + k * step));
};
