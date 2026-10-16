// The /sector/transport hub and its sub-pages — the canonical paths, and
// NOTHING else. This file must stay import-free.
//
// It sits apart from the transport register (@/lib/transportReferenceData) for
// the roadsAwarder.ts reason: anything that needs a transport PATH — the hub
// registry, the subsidies registry, the governance sector list — would otherwise
// reach the EIK tables, and a registry edge from routes.tsx or the shell drags
// the sector-pack cluster into the entry chunk every page downloads.
// src/entryGraph.test.ts gates it.

/** The МТС awarder key. Restated here (not imported) so this file stays
 *  import-free; transportReferenceData.test.ts holds the two equal. */
export const TRANSPORT_MINISTRY_EIK = "000695388";

/** The hub and its four sub-pages (docs/plans/transport-hub-v1.md §3). */
export const TRANSPORT_PATHS = {
  hub: "/sector/transport",
  network: "/sector/transport/network",
  procurement: "/sector/transport/procurement",
  bodies: "/sector/transport/bodies",
  money: "/sector/transport/money",
} as const;

export const TRANSPORT_SECTOR_PATH = TRANSPORT_PATHS.hub;

/** The МТС awarder page — the ministry as ONE buyer, not the sector. */
export const TRANSPORT_AWARDER_PATH = `/awarder/${TRANSPORT_MINISTRY_EIK}`;
