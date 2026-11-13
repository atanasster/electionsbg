// The handler registry: every watcher source → what runs when it moves.
// Plan: docs/plans/watch-pipeline-scripts-v1.md §2.1.

import { BUDGET_MACRO } from "./handlers/budget_macro";
import { PARLIAMENT_PEOPLE } from "./handlers/parliament_people";
import { PROCUREMENT_FUNDS } from "./handlers/procurement_funds";
import { SECTORS_LOCAL } from "./handlers/sectors_local";
import { markerOf, type Handler } from "./types";

export * from "./types";
export { CLOUD_ORDER, cloudSlot, orderCloud } from "./cloud_order";

export const HANDLERS: readonly Handler[] = [
  ...PARLIAMENT_PEOPLE,
  ...PROCUREMENT_FUNDS,
  ...BUDGET_MACRO,
  ...SECTORS_LOCAL,
];

/** Watcher sources deliberately routed nowhere, each with the reason.
 *
 *  An entry is a DECISION, not a todo: the coverage test fails on an id that
 *  is no longer registered, and on one that a handler has since picked up. */
export const UNROUTED: Readonly<Record<string, string>> = {};

export const handlerById = (id: string): Handler | undefined =>
  HANDLERS.find((h) => h.id === id);

/** Handlers that share a marker file. Legal only when they also share a skill:
 *  two unrelated handlers stamping one marker would mask each other's debt. */
export const markerOwners = (): Map<string, Handler[]> => {
  const out = new Map<string, Handler[]>();
  for (const h of HANDLERS) {
    const m = markerOf(h);
    out.set(m, [...(out.get(m) ?? []), h]);
  }
  return out;
};
