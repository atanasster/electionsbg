// The `/elections` scope row's cross-kind links: which OTHER catalogues a reader standing on
// one cycle is offered, where each goes, and what each is called.
//
// ⚠ IT LIVES HERE, NOT IN THE SCREEN, so the exhaustiveness can be gated. The rule this
// module exists to hold is that every `ElectionsHubKind` is answered — a kind with no
// destination is a link that never renders, and a kind with no copy key renders its own raw
// identifier at a 200. Neither is visible in review, and neither was expressible while the
// row was a ternary inside the component.
//
// ⚠ THE ROW WAS A BINARY TOGGLE UNTIL 2026-09-07 — `local ? "/parliamentary" : "/local/…"`,
// written when there were two catalogues. It did not merely omit the third: it READS as „the
// other kind" while meaning „the other of the two I know about", so the presidency was
// unreachable from this page for every reader on a parliamentary cycle, which is the ordinary
// case.

import { CYCLE_SURFACE, type ElectionsHubKind } from "./electionsHubCycle";

/**
 * The copy key per kind.
 *
 * ⚠ LITERALS, NEVER `` `elections_hub_other_${kind}` ``. Two reasons, and the first is the
 * one that bites: a `Record` over the union makes a missing key a COMPILE error, while a
 * template silently produces `elections_hub_other_<newkind>` and renders it verbatim. The
 * second is `src/locales/bundles.ts`' rule — a key matching a built template can never be
 * deferred into a bundle, so a template would pin this family to the core corpus for good.
 */
export const OTHER_KIND_LABEL: Record<ElectionsHubKind, string> = {
  parliamentary: "elections_hub_other_parliamentary",
  local: "elections_hub_other_local",
  presidential: "elections_hub_other_presidential",
};

/** A tuple that covers every kind, or `never` — which makes the assignment below fail. */
type CoversEveryKind<T extends readonly ElectionsHubKind[]> =
  Exclude<ElectionsHubKind, T[number]> extends never ? T : never;

const ORDER = ["parliamentary", "presidential", "local"] as const;

/**
 * Display order, declared rather than inherited from key-insertion order.
 *
 * ⚠ THE `CoversEveryKind` ANNOTATION IS LOAD-BEARING. A tuple assigned to a plain
 * `readonly ElectionsHubKind[]` is NOT exhaustive — the narrow array is assignable to the
 * wider one and a fourth kind is dropped with no error (measured on a fixture, exit 0).
 */
export const OTHER_KIND_ORDER: CoversEveryKind<typeof ORDER> = ORDER;

export interface OtherKindLink {
  kind: ElectionsHubKind;
  to: string;
  labelKey: string;
}

/**
 * The links to render beside the scope pill: one per kind the reader is NOT on.
 *
 * ⚠ EVERY DESTINATION COMES FROM `CYCLE_SURFACE`, never a template. `presidentialRoutes.ts`
 * carries this family's rule — a hand-built path keeps working until the routing rule moves
 * and then nothing compares the two — and `electionsHubCycle.test.ts` gates each `href`
 * against its own declared `prefix`.
 *
 * ⚠ PARLIAMENTARY IS THE CATALOGUE'S LANDING PAGE AND CARRIES NO CYCLE, unlike the other two.
 * That is deliberate: `/parliamentary` is the destination every other surface in the app uses
 * for this kind (the breadcrumb, the header menu, the place header), and there is no
 * `parliamentaryAsOf` to anchor it with. The cost is real and small — `usePreserveParams`
 * forwards `?elections=<a presidential id>`, which `ElectionContext` cannot resolve, so that
 * reader lands on the latest parliamentary result rather than the contemporaneous one.
 *
 * @param args.current - The kind the hub is showing; it is the one link never rendered.
 * @param args.localCycle - The local cycle resolved for the reader's date.
 * @param args.presidentialCycle - The presidential cycle resolved for the reader's date.
 * @returns One link per other kind, in `OTHER_KIND_ORDER`.
 */
export const otherKindLinks = (args: {
  current: ElectionsHubKind;
  localCycle: string;
  presidentialCycle: string;
}): OtherKindLink[] => {
  const to: Record<ElectionsHubKind, string> = {
    parliamentary: "/parliamentary",
    local: CYCLE_SURFACE.local.href(args.localCycle),
    presidential: CYCLE_SURFACE.presidential.href(args.presidentialCycle),
  };
  return OTHER_KIND_ORDER.filter((k) => k !== args.current).map((kind) => ({
    kind,
    to: to[kind],
    labelKey: OTHER_KIND_LABEL[kind],
  }));
};
