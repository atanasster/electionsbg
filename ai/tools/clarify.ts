// Ask-the-user disambiguation primitives.
//
// Some name lookups are genuinely ambiguous: several settlements/municipalities
// share a name ("с. Баня" — five villages + a town), and distinct people can
// share a candidate name. Rather than silently picking the "best" match (and
// returning hard numbers for the wrong place), the resolvers raise
// `AmbiguousPlaceError` on an EXACT-name collision; `runTool` catches it and
// returns a `clarify` Envelope (a prompt + a list of options). The renderer pops
// a chooser; picking an option re-runs the same tool with a stable disambiguator
// threaded back through the SAME place arg as a "pin" ("ekatte:68134" /
// "obshtina:RSE08"), which the resolvers decode to resolve to exactly one entity.
//
// This lives at the tool layer on purpose: both the offline keyword router and
// the LLM path call `runTool`, so disambiguation works identically for both with
// no router/model changes — the model never needs to know a name was ambiguous.

import type { ClarifyOption, Domain, Envelope } from "./types";

export type PlaceKind = "settlement" | "municipality";

// Raised by resolveSettlement/resolveMunicipality when a name matches more than
// one distinct entity exactly. Carries the original query (so runTool can find
// which arg held it) and the full candidate set (so it can build the options).
export class AmbiguousPlaceError<T = unknown> extends Error {
  constructor(
    readonly kind: PlaceKind,
    readonly query: string,
    readonly candidates: T[],
  ) {
    super(`ambiguous ${kind}: "${query}" (${candidates.length} matches)`);
    this.name = "AmbiguousPlaceError";
  }
}

// A disambiguation "pin" rides inside the place query once the user has picked
// one of several same-name candidates. Each resolver decodes its OWN kind and
// returns undefined for the other's pin, so a pin is never fuzzy-matched to the
// wrong entity. The trailing free text (the display name) is ignored on decode.
const PIN_RE = /^(ekatte|obshtina):([A-Za-z0-9]+)/;

export type PlacePin = { kind: "ekatte" | "obshtina"; value: string };

export const parsePlacePin = (query: string): PlacePin | null => {
  const m = query.match(PIN_RE);
  return m ? { kind: m[1] as PlacePin["kind"], value: m[2] } : null;
};

export const settlementPin = (ekatte: string): string => `ekatte:${ekatte}`;
export const municipalityPin = (obshtina: string): string =>
  `obshtina:${obshtina}`;

// Build the disambiguation envelope. `kind:"scalar"` / `viz:"none"` keep the
// renderer's normal payload empty — the chooser is driven by `clarify` alone.
// The title doubles as the template narration (narrate() falls back to it).
export const clarifyEnvelope = (
  prompt: string,
  options: ClarifyOption[],
  provenance: string[],
  domain?: Domain,
): Envelope => ({
  tool: "clarify",
  domain,
  kind: "scalar",
  title: prompt,
  viz: "none",
  clarify: { prompt, options },
  facts: {},
  provenance,
});
