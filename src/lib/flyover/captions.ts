// The caption table — `docs/plans/home-flyover-v1.md` §4 and §2.7.
//
// ⚠️ THE CANVAS NEVER DRAWS BULGARIAN PROSE. The engine emits `{ key, params }` and the React
// host renders it as DOM text through `t()`. That is what makes captions translatable,
// selectable, readable by a screen reader and available to the prerendered body — none of
// which a string painted into a bitmap is. City labels (proper nouns) are the only text the
// canvas draws, and they come from the artifact in both languages.
//
// ⚠️ EVERY KEY IS A LITERAL, NEVER A TEMPLATE. `scripts/i18n/key_usage.test.ts` and
// `bundle_reachability.test.ts` treat a built template — `` `flyover_${id}` `` — as naming
// EVERY key it could match, so one interpolated key would make the whole family unprunable
// and unsplittable, and `npm run i18n:prune` would stop being able to tell a live key from a
// dead one. The home registry's `descKey` comment records the same trap.
//
// ⚠️ AND EVERY CAPTION NAMES ITS BASIS. A number without one is a defect (plan §2.7): the
// three money layers are three taps over overlapping corpora, and the arcs cover 46.6% of the
// contract money. `params` therefore carries the coverage figures beside the headline ones, so
// a translation cannot quietly drop the qualifier and leave the number.

import type { FlyoverWorld } from "./types";

export type CaptionParams = Record<string, number | string>;

export interface Caption {
  /** A LITERAL i18n key. See the header. */
  key: string;
  params: CaptionParams;
}

/**
 * How much of the corpus the arcs actually draw, as a percentage to one decimal.
 *
 * ⚠️ The `|| 1` matters: an empty corpus is reachable (a fresh clone, a database mid-reload)
 * and the alternative is `NaN`, which `t()` interpolates as the literal string „NaN" beside a
 * euro figure in two captions.
 */
const placedPct = (w: FlyoverWorld): number =>
  Math.round(
    (w.flows.coverage.bothPlacedEur / (w.flows.coverage.totalEur || 1)) * 1000,
  ) / 10;

const pct = (share: number): number => Math.round(share * 1000) / 10;

const bn = (eur: number): number => Math.round(eur / 1e8) / 10;

/**
 * Every caption the engine can emit, keyed by the id a `FlyoverState` carries.
 *
 * A caption is a FUNCTION of the world rather than a frozen string, so the numbers move with
 * the corpus and cannot go stale in the copy — the failure the home hub's frozen tile strings
 * were. What it may NOT do is compute a new statistic: every figure here is read from
 * `figures` or `flows.coverage`, which the data gate recounts against Postgres.
 */
export const CAPTIONS = {
  // ── columns ───────────────────────────────────────────────────────────────────────────
  columns_proc: (w) => ({
    key: "flyover_caption_columns_proc",
    params: {
      eurBn: bn(w.figures.procTotalEur),
      contracts: w.figures.procContracts,
      sofiaPct: pct(w.figures.sofiaBuyerShare),
    },
  }),
  columns_funds: (w) => ({
    key: "flyover_caption_columns_funds",
    params: {
      // BOTH, always: 4.6% of the rows carry no oblast and they hold 52% of the money, so a
      // placed figure without its denominator is a caption that halves the corpus.
      placedBn: bn(w.figures.fundsPlacedEur),
      totalBn: bn(w.figures.fundsTotalEur),
      placedPct:
        Math.round(
          (w.figures.fundsPlacedEur / (w.figures.fundsTotalEur || 1)) * 1000,
        ) / 10,
    },
  }),
  columns_agri: (w) => ({
    key: "flyover_caption_columns_agri",
    params: { eurBn: bn(w.figures.agriTotalEur) },
  }),

  // ── arcs ──────────────────────────────────────────────────────────────────────────────
  arcs_same: (w) => ({
    key: "flyover_caption_arcs_same",
    params: { pct: pct(w.figures.sameOblastArcShare) },
  }),
  arcs_into_sofia: (w) => ({
    key: "flyover_caption_arcs_into_sofia",
    params: { pct: pct(w.figures.intoSofiaArcShare) },
  }),
  arcs_out_of_sofia: (w) => ({
    key: "flyover_caption_arcs_out_of_sofia",
    params: { pct: pct(w.figures.outOfSofiaArcShare) },
  }),
  arcs_top_flow: (w) => ({
    key: "flyover_caption_arcs_top_flow",
    params: {
      from: w.figures.topFlow[0],
      to: w.figures.topFlow[1],
      eurM: w.figures.topFlow[2],
    },
  }),
  /**
   * ⚠️ CONTENT, NOT A DISCLAIMER (plan §14). „€44bn of €94bn has both ends placed" is the
   * first thing a reader of the arcs must see; hiding it in a tooltip turns a partial view
   * into a false one.
   *
   * ⚠️ AND `placedPct` IS A MONEY SHARE, which the copy used to call „% от договорите" / "% of
   * contracts". Measured: the euro share is 46.62% and the ROW share is 49.11%, so the sentence
   * stated one and named the other — the undeclared-basis defect this module's header polices
   * everywhere else. It says „% от парите по договори" / "% of the contracted money" now.
   *
   * ⚠️ AND IT NO LONGER SAYS „SEAT", which it did until T3.3. €9.8bn of the placed money is
   * consortium money attributed to the largest member (`flows.carrierLead`) — those carriers
   * have no seat and never will — so the old wording „и възложителят, и изпълнителят имат
   * установено седалище" became a false claim about a tenth of what the arcs draw the moment
   * the attribution shipped. The copy says „на картата" / „on the map" instead, and
   * `arcs_consortia` states the attribution in its own keyframe rather than crowding this one.
   */
  arcs_coverage: (w) => ({
    key: "flyover_caption_arcs_coverage",
    params: {
      placedBn: bn(w.flows.coverage.bothPlacedEur),
      totalBn: bn(w.flows.coverage.totalEur),
      placedPct: placedPct(w),
      noSeatBn: bn(w.flows.coverage.unplaced.trNoSeat),
      notInTrBn: bn(w.flows.coverage.unplaced.notInTr),
    },
  }),
  /**
   * The consortium attribution, said out loud — plan §7 step 3.
   *
   * ⚠️ IT NAMES THE CHOICE AND THE COST IN ONE SENTENCE. A ДЗЗД has no seat of its own, so
   * „where is it" has no answer in the corpus; placing it at its largest member is the best
   * available answer and NOT a fact, and `multiOblast` is how many groups have members in
   * more than one oblast — i.e. how often a true answer was discarded to draw one arc.
   * Publishing the figure beside the attribution is what keeps this from being a silent
   * precision claim.
   *
   * ⚠️ THE COPY NAMES ITS OWN DENOMINATOR rather than saying „of that". This caption is second
   * in the ARCS loop, so an anaphor resolves against `arcs_coverage` there — and nowhere else:
   * an article chapter, a poster, or a screen reader entering mid-loop would get a number with
   * no whole to measure it against, which is the one thing every caption here must not do.
   */
  arcs_consortia: (w) =>
    w.flows.carrierLead && w.flows.carrierLead.consortia > 0
      ? {
          key: "flyover_caption_arcs_consortia",
          params: {
            leadBn: bn(w.flows.carrierLead.eur),
            groups: w.flows.carrierLead.consortia,
            multi: w.flows.carrierLead.multiOblast,
          },
        }
      : null,

  // ── the guided tour ───────────────────────────────────────────────────────────────────
  tour_buys: (w) => ({
    key: "flyover_caption_tour_buys",
    params: {
      eurBn: bn(w.figures.procTotalEur),
      sofiaPct: pct(w.figures.sofiaBuyerShare),
    },
  }),
  tour_goes: (w) => ({
    key: "flyover_caption_tour_goes",
    params: {
      intoPct: pct(w.figures.intoSofiaArcShare),
      outPct: pct(w.figures.outOfSofiaArcShare),
      placedPct: placedPct(w),
    },
  }),
  tour_funds: (w) => ({
    key: "flyover_caption_tour_funds",
    params: {
      placedBn: bn(w.figures.fundsPlacedEur),
      totalBn: bn(w.figures.fundsTotalEur),
      procBn: bn(w.figures.procTotalEur),
    },
  }),
  tour_agri: (w) => ({
    key: "flyover_caption_tour_agri",
    params: { eurBn: bn(w.figures.agriTotalEur) },
  }),
  /**
   * ⚠️ NO FALLBACK, AND THAT IS THE WHOLE POINT. The index is „100 = 2 January 2026", so a
   * default of 100 is not a placeholder — it is the measurement „the national basket is exactly
   * at the euro-changeover baseline", published where a reader looks for a number, about a
   * corpus that is not there. A world with no price overlay says NOTHING; `captionFor` already
   * returns null and every host already handles it.
   */
  tour_prices: (w: FlyoverWorld): Caption | null =>
    w.prices
      ? {
          key: "flyover_caption_tour_prices",
          params: {
            national: w.prices.national,
            asOf: w.prices.asOf,
            places: Object.keys(w.prices.byMir).length,
          },
        }
      : null,
} satisfies Record<string, (w: FlyoverWorld) => Caption | null>;

/**
 * The fourteen ids, as a real union.
 *
 * ⚠️ `satisfies` above rather than a `Record<string, …>` ANNOTATION, because the annotation
 * makes `keyof typeof CAPTIONS` resolve to plain `string` — a type that reads like a union of
 * the ids, would appear to catch `"tour_price"` (a typo for `tour_prices`), and does not.
 */
export type CaptionId = keyof typeof CAPTIONS;

/**
 * Every literal key the table can emit — what the i18n corpora must carry.
 *
 * ⚠️ RESTATED DELIBERATELY, not derived. `scripts/i18n/key_usage.test.ts` scans SOURCE for
 * literals, so a list built by calling the builders would be invisible to it and every key
 * here would read as dead to `npm run i18n:prune`. `captions.test.ts` holds the two in step,
 * which is what makes the duplication a maintenance cost rather than a risk.
 */
export const CAPTION_KEYS: readonly string[] = [
  "flyover_caption_columns_proc",
  "flyover_caption_columns_funds",
  "flyover_caption_columns_agri",
  "flyover_caption_arcs_same",
  "flyover_caption_arcs_into_sofia",
  "flyover_caption_arcs_out_of_sofia",
  "flyover_caption_arcs_top_flow",
  "flyover_caption_arcs_coverage",
  "flyover_caption_arcs_consortia",
  "flyover_caption_tour_buys",
  "flyover_caption_tour_goes",
  "flyover_caption_tour_funds",
  "flyover_caption_tour_agri",
  "flyover_caption_tour_prices",
];

/** Resolve a caption id against a world, or `null` when the state is saying nothing. */
export const captionFor = (
  id: string | null,
  world: FlyoverWorld,
): Caption | null => {
  if (!id) return null;
  // A bare `string` on purpose: a host may pass a value out of a URL or a saved session, so
  // the lookup is defensive and the narrowing happens here rather than at every call site.
  const table = CAPTIONS as Record<
    string,
    ((w: FlyoverWorld) => Caption | null) | undefined
  >;
  const build = table[id];
  return build ? build(world) : null;
};
