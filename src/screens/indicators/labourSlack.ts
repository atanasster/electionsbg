import type { MacroPayload } from "@/data/macro/useMacro";

export type LabourSlackCallout = {
  year: number;
  /** Latest slack value, locale-formatted (e.g. "5,5"). */
  value: string;
  /** Same-year annual mean of the SA quarterly unemployment rate,
   *  locale-formatted; null when no quarters exist for the slack's year. */
  unemp: string | null;
  /** slack ÷ unemployment mean, locale-formatted; null when unemp is null. */
  ratio: string | null;
};

// Pure computation behind the labour-market slack callout on /indicators/economy.
//
// Slack (lfsi_sla_a) is the broad "true unemployment" measure — unemployed +
// underemployed part-timers + available-but-not-searching — expressed as % of
// the EXTENDED labour force. We pair the latest annual reading with its
// multiple over the headline unemployment rate for the same year (annual mean
// of the SA quarters). The two are different denominators (extended labour
// force vs active population), so the ratio is a rough multiple, not an exact
// one — the caption discloses this. Kept pure (no React, no i18n) so the ratio
// and its guards are unit-testable; the caller supplies `fmt` for locale
// number formatting.
export const computeLabourSlackCallout = (
  macro: MacroPayload | undefined,
  fmt: (v: number) => string,
): LabourSlackCallout | null => {
  const slackSeries = macro?.series.labourSlack;
  if (!slackSeries?.length) return null;
  const slack = slackSeries[slackSeries.length - 1];
  const sameYear = (macro?.series.unemployment ?? []).filter(
    (p) => p.year === slack.year,
  );
  const unempAvg = sameYear.length
    ? sameYear.reduce((s, p) => s + p.value, 0) / sameYear.length
    : null;
  const ratio = unempAvg && unempAvg > 0 ? slack.value / unempAvg : null;
  return {
    year: slack.year,
    value: fmt(slack.value),
    unemp: unempAvg != null ? fmt(unempAvg) : null,
    ratio: ratio != null ? fmt(ratio) : null,
  };
};
