import type { MacroIndicatorKey } from "@/data/macro/useMacro";

// Grouped form is used when a single chart hosts >5 indicators or distinct
// conceptual buckets (e.g. headline + activity + sentiment).
export type IndicatorGroup = {
  labelKey: string;
  keys: MacroIndicatorKey[];
};
export type IndicatorSpec = MacroIndicatorKey[] | IndicatorGroup[];

// Public alias for the per-indicator on/off map. Exported so screens that
// lift toggle state (e.g., IndicatorsScreen filtering the snapshot table by
// what the chart shows) can type their state.
export type IndicatorToggle = Partial<Record<MacroIndicatorKey, boolean>>;

// Helper for callers that lift `enabled` state out: produces the same
// initial Toggle the chart would build internally given the same args. Use
// in a `useState` initializer to seed lifted state with the chart's defaults.
export const initialIndicatorToggle = (
  spec: IndicatorSpec,
  defaultEnabled?: MacroIndicatorKey[],
): IndicatorToggle => {
  const keys =
    Array.isArray(spec) && typeof spec[0] === "string"
      ? (spec as MacroIndicatorKey[])
      : (spec as IndicatorGroup[]).flatMap((g) => g.keys);
  const on = new Set<MacroIndicatorKey>(defaultEnabled ?? keys);
  const out: IndicatorToggle = {};
  for (const k of keys) out[k] = on.has(k);
  return out;
};
