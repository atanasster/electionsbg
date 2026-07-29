// Split out of StatutoryValue.tsx so that file exports only components —
// mixing a helper in breaks React Fast Refresh for the whole module.
import type { StatutoryStep } from "@/lib/bgTax";
import type { StatutoryValueProps } from "./StatutoryValue";

export const fmtDate = (iso: string, locale: string): string =>
  new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00Z`));

/** Render a `StatutoryStep[]` as a value + the window it replaced. */
export const statutoryStepProps = (
  steps: StatutoryStep[] | undefined,
  format: (v: number) => string,
): Pick<StatutoryValueProps, "value" | "from" | "previous"> | null => {
  if (!steps || steps.length === 0) return null;
  const last = steps[steps.length - 1];
  const prev = steps.length > 1 ? steps[steps.length - 2] : undefined;
  return {
    value: format(last.value),
    from: steps.length > 1 ? last.from : undefined,
    ...(prev
      ? { previous: { value: format(prev.value), from: prev.from } }
      : {}),
  };
};
