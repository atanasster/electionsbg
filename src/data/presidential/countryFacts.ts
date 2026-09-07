// The presidential COUNTRY strip — the four KPI cards `/presidential/:cycle` opens with, from
// the `national_summary.json` the page already holds.
//
// ⚠ IT EXISTS BECAUSE THE COUNTRY LEVEL IS `canonical`. Every level below it gets its facts
// from `presidentialFacts` in `scripts/elections/build_presidential_surface.ts`, baked into an
// artifact; the country's own file is inside its budget, so §5.0 says read it directly — and
// there is no generator on this path to build the strip. This is that producer, in the browser.
//
// ⚠ A TWIN OF THE GENERATOR'S RULE, DELIBERATELY, AND ONLY THE PARTS THE COUNTRY DECLARES.
// The producer module opens with node-adjacent imports no browser chunk may pull in — the same
// reason `summary.ts` re-declares the published shape rather than importing the parser's — so
// the shared half is the DESCRIPTOR: which codes this level may show, in what order and how
// many, is read from `descriptorFor("presidential", "country")` exactly as the generator reads
// it, rather than restated as a literal list here.
//
// ⚠ AND IT PRODUCES TWO CODES THE GENERATOR NEVER EMITS. `majority_threshold` and
// `runoff_pending` are declared at the country level and NOWHERE below it — art. 93 (3) is a
// national test — so the levels the generator serves legitimately have nothing to say about
// them, and this is the only producer that can.

import { descriptorFor } from "@/screens/elections/electionSurfaceDescriptors";
import type {
  ElectionFactCode,
  ElectionSurfaceFact,
} from "@/data/elections/surfaceTypes";
import type { PresidentialSummaryRound } from "./summary";

/** The votes art. 93 (3) requires: MORE than half the valid votes, i.e. the smallest integer
 *  strictly above half.
 *
 *  ⚠ „MORE THAN HALF", NEVER „AT LEAST HALF" — with an even valid-vote total the two differ by
 *  one vote, and the one they differ on is the tie, where the constitution says no one is
 *  elected. `Math.floor(v / 2) + 1` is right for both parities. */
export const majorityVotes = (validVotes: number): number =>
  Math.floor(validVotes / 2) + 1;

/**
 * The facts the presidential country strip publishes for ONE round.
 *
 * @param round - The round being shown. ⚠ THE STRIP DESCRIBES THE ROUND ON SCREEN, never the
 *   cycle: round 1 and the runoff are different electorates — nationally 5.7 points apart in
 *   2021 — so a band that mixed them would put one round's turnout beside another's leader.
 * @returns At most the level's `maxFacts`, in its declared order.
 */
export const presidentialCountryFacts = (
  round: PresidentialSummaryRound,
): ElectionSurfaceFact[] => {
  const d = descriptorFor("presidential", "country");
  if (!d.available) return [];
  const leader = round.ranking[0];
  // ⚠ KEYED BY THE FACT CODE, not by `string`: a mistyped key would otherwise be a silently
  // unreachable entry, and a level's declared fact would simply never render.
  const available: Partial<Record<ElectionFactCode, ElectionSurfaceFact>> = {
    // ⚠ ROUND 1 ONLY, AND THAT IS THE CONSTITUTION RATHER THAN A LAYOUT CHOICE. Art. 93 (3)
    // tests the first round; art. 93 (4) elects whichever pair takes MORE votes in the runoff,
    // with no majority requirement at all — so a „Мнозинство" card on the runoff would state a
    // threshold that does not apply to the result beneath it.
    majority_threshold:
      round.round === 1
        ? {
            code: "majority_threshold",
            value: majorityVotes(round.votes.valid),
            unit: "votes",
            basis: "valid_votes",
          }
        : undefined,
    // ⚠ A SHARE, NOT A NAME. The card is „Първи · 49.42%", and who that is stands directly
    // beneath it in the ranked table and in the header's decided-by line. The party-bearing
    // variant of this label (`labelParams.partyId`) is deliberately unused: a ticket has no
    // `partyId` — its nominator may be a party, a coalition or an инициативен комитет — so
    // supplying one would label two of the three wrongly.
    winner: leader
      ? {
          code: "winner",
          // The schema's `pct` unit is a PERCENTAGE; `shareOfValid` is a fraction of 1.
          value: leader.shareOfValid * 100,
          unit: "pct",
          basis: "valid_votes",
        }
      : undefined,
    // ⚠ `null` IS „THE CORPUS CANNOT SUPPORT A RATE", never 0% — 2006's 144 abroad sections
    // report neither a roll nor a signature count while casting 46,113 valid votes. An absent
    // fact drops the card; a zero would publish „nobody voted".
    turnout:
      round.turnout.pct === null
        ? undefined
        : {
            code: "turnout",
            value: round.turnout.pct * 100,
            unit: "pct",
            basis: "registered_voters",
          },
    valid_votes: {
      code: "valid_votes",
      value: round.votes.valid,
      unit: "votes",
      basis: "valid_votes",
    },
    // ⚠ QUALITATIVE — no value, and the card renders label-only. It says WHY the leader's share
    // is not the outcome, which is the one thing a reader takes from a round-1 page. At
    // `maxFacts: 4` it only reaches the strip when an earlier fact is absent, and that is the
    // right precedence: the rule box below states both conditions in words either way.
    runoff_pending:
      round.round === 1 && !round.outcome.winsOutright
        ? { code: "runoff_pending", unit: "none" }
        : undefined,
    // ⚠ NOT PRODUCED HERE, AND THAT IS A DECISION. `paper_machine` is declared at this level
    // and `national_summary.json` carries no machine/paper split — the per-section channel
    // counts live in the round roll-ups. Emitting a 0 would present 2001/2006/2011's ABSENT
    // technology as a measured share, which is exactly what the descriptor's own header
    // forbids, so the card is absent until a producer can answer it.
  };
  return d.factPriority
    .map((code) => available[code])
    .filter((f): f is ElectionSurfaceFact => f !== undefined)
    .slice(0, d.maxFacts);
};
