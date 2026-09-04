// WHERE a surface points, and WHICH authority stands behind it (§5 "ElectionDestinations",
// §5 "The source authority is not single-valued", §4.1).
//
// ⚠ EVERY ROUTE COMES FROM `placeViewUrl` / `localUrl`, NEVER FROM A STRING BUILT HERE. This
// is the module's whole reason to exist. A generator that concatenates `/local/${cycle}/${code}`
// keeps emitting the old shape after the routing rule moves — and both sides stay green,
// because the generator's tests assert the string it builds and the router's tests assert the
// route it serves. Nothing compares them. The helpers already encode the cases a hand-built
// path gets wrong: Sofia's city aggregate is `SOF` and never `SOF00`, a Sofia район is a
// município in the local tree and a settlement in the parliamentary one, and Пловдив/Варна
// райони have their own local pages.
//
// ⚠ `available: false` IS A RENDERED STATE, NOT AN OMISSION (§5). "Тук не са провеждани местни
// избори през 2023" is an answer; a silently missing pill is not. So a view that does not
// resolve carries a `reason` enum key both locales carry, and the caller renders it.
//
// ⚠ ABSENT `reconciliation` MEANS NOT RECONCILED, NEVER "THEY AGREE" — the same rule as
// `turnoutBasis: "unavailable"`. Only the local tier has a second authority at all, so the
// field is absent on every parliamentary surface by construction, and a UI that renders
// "confirmed" from its absence is the defect the shape exists to prevent.

import fs from "node:fs";
import path from "node:path";
import { computeOverall } from "../parsers_local/reconcile_officials";
// ⚠ THE PUBLISHED TYPES, not the parser's private ones. `Parameters<typeof computeOverall>`
// bound this reader to whatever shape the parser happened to have; the file on disk is
// published under these, and the two are separate declarations that can drift.
import type {
  MayorDiffStatus,
  MunicipalityOfficialsDiff,
} from "../../src/data/local/types";
import { type PlaceLevel } from "../../src/data/local/placeViews";
import type { ElectionPlaceLevel } from "../../src/data/elections/surfaceTypes";

export const DATA_ROOT = path.join(process.cwd(), "data");

// ⚠ RE-EXPORTED, NOT RE-DECLARED. The destination builder moved to
// `src/data/elections/destinations.ts` so the BROWSER can read it: this file opens with
// `node:fs`, and a `canonical` level (§5.0) is served by a client-side adapter that needs the
// same cross-link rules. Only the file-reading half — the `/sverka` sidecar below — stays here.
export {
  VIEW_NAMES,
  buildDestinations,
  toPlaceRef,
} from "../../src/data/elections/destinations";
export type { DestinationInput } from "../../src/data/elections/destinations";

// ─── the second authority (§5) ──────────────────────────────────────────────────────────────

/** The `/sverka` sidecar for one município in one local cycle, if the cycle ships one.
 *
 *  `root` defaults to the real data tree and exists so a test can exercise a sidecar shape the
 *  corpus does not currently contain — `missing_official` reached zero municipalities once the
 *  obshtina join, the published role and the bench filter were fixed, which left the arm that
 *  carries that state through covered by nothing. Same injection as `emitShards`'s `shardDir`. */
export const sverkaSidecarPath = (
  cycle: string,
  obshtina: string,
  root: string = DATA_ROOT,
): string => path.join(root, cycle, "officials_diff", `${obshtina}.json`);

export type Reconciliation = {
  against: "officials_roster";
  /** ⚠ FOUR STATES, NEVER A BOOLEAN. See `surfaceTypes.ts` — `missing` is one side having no
   *  record, and collapsing it into "does not agree" publishes a contradiction those sidecars
   *  do not assert. (The count is per-cycle and moves with the roster vintage; it is
   *  deliberately not written down here.) */
  outcome: MunicipalityOfficialsDiff["overallStatus"];
  to: string;
};

/** ⚠ `agrees` IS RE-DERIVED FROM THE SIDECAR'S PARTS, never copied from its stored
 *  `overallStatus`. §5's gate says so: "`agrees` re-derives from the sidecar rather than from a
 *  stored copy" — a surface that trusts the scalar inherits whatever the comparison meant when
 *  it was last written.
 *
 *  ⚠ THE OUTCOME IS CARRIED WHOLE, NEVER REDUCED TO A BOOLEAN. `computeOverall(...) === "match"`
 *  was the first shape and it fabricated a contradiction for every municipality whose roster
 *  has no mayor record at all.
 *
 *  ⚠ RE-DERIVE THROUGH `computeOverall`, NEVER THROUGH A RULE RESTATED HERE. That is the whole
 *  difference between re-deriving and inventing a second, harsher test. The first draft of this
 *  function required a 100% council match; the real rule is 80% (`reconcile_officials.ts`), and
 *  the strict version marked 195 of 288 municipalities as contradicted — every one of them with
 *  a mayor whose name matches EXACTLY on both sides — which is a fabricated accusation against
 *  named councils, published from a file whose own summary says "match".
 *
 *  Returns `undefined` — meaning NOT RECONCILED — when no sidecar exists. Never `agrees: true`. */
export const readReconciliation = (
  cycle: string,
  obshtina: string,
  root: string = DATA_ROOT,
): Reconciliation | undefined => {
  const p = sverkaSidecarPath(cycle, obshtina, root);
  if (!fs.existsSync(p)) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    // A malformed sidecar is NOT agreement, and it is not silence either — but the surface has
    // one boolean to say it with, so the honest answer is "not reconciled".
    return undefined;
  }
  const d = raw as {
    mayor?: { status?: MayorDiffStatus };
    council?: MunicipalityOfficialsDiff["council"];
  };
  // A sidecar missing either part cannot be re-derived, and "cannot check" is not agreement.
  if (!d.mayor?.status || !d.council) return undefined;
  return {
    against: "officials_roster",
    outcome: computeOverall(d.mayor.status, d.council),
    // `/sverka` is a routed page; the route is a constant of the app, not a built path.
    to: "/sverka",
  };
};

/** Does this cycle ship the comparison at all? §5's gate: `reconciliation` is present iff a
 *  sidecar exists for that município in that cycle. */
export const hasSverkaSidecar = (cycle: string, obshtina: string): boolean =>
  fs.existsSync(sverkaSidecarPath(cycle, obshtina));

/** The `PlaceLevel` a router helper understands, for a caller that has an election level. */
export const routerLevel = (level: ElectionPlaceLevel): PlaceLevel | null =>
  level === "abroad" ? null : level;
