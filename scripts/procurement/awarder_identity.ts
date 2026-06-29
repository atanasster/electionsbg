// Canonical identity overrides for awarders whose per-row name / address is
// unreliable. A single legal entity (one EIK) can file procurement under many
// buyer sub-unit names — the textbook case is АПИ (Агенция "Пътна
// инфраструктура", EIK 000695089), whose contracts are filed under both the
// central agency name *and* the 28 Областни пътни управления (regional road
// offices), all under the one EIK. buildRollups picks the LAST-observed
// awarderName / address per EIK (newest-row-wins), so for АПИ the rollup
// identity landed on whichever ОПУ filed the most recent contract (Благоевград)
// instead of the central national agency — a pure labelling artifact on top of
// otherwise-correct €7.5bn aggregates.
//
// These overrides force the correct national identity (name + HQ seat). The
// per-contract awarderName on each row is intentionally left untouched, so the
// central-vs-ОПУ sub-unit distinction stays recoverable for later analysis.
//
// Keep this list tiny and curated — only multi-name national entities whose
// newest-row-wins identity is demonstrably wrong belong here.

export interface AwarderIdentity {
  /** Canonical display name. */
  name: string;
  /** Forces geo.ekatte to the HQ settlement (high-confidence). Optional. */
  ekatte?: string;
  /** NUTS region of the HQ. Optional. */
  region?: string;
  /** HQ address parts. Optional. */
  locality?: string;
  postal?: string;
  street?: string;
}

export const AWARDER_IDENTITY: Record<string, AwarderIdentity> = {
  // АПИ — central national road agency. HQ: бул. Македония № 3, София.
  "000695089": {
    name: 'Агенция "Пътна инфраструктура"',
    ekatte: "68134",
    region: "BG411",
    locality: "гр. София",
    postal: "1606",
    street: "бул. Македония № 3",
  },
};

/** Canonical awarder name for an EIK, falling back to the observed name. */
export const canonicalAwarderName = (eik: string, fallback: string): string =>
  AWARDER_IDENTITY[eik]?.name ?? fallback;
