// The sentence on the /awarder/:eik → /sector/:id banner.
//
// Extracted from the render because the BRANCH is the risky part of that banner
// and a nested ternary inside JSX is not assertable: swapping its two arms passes
// every test in the repo while telling 161 member pages something false.
//
// The two sentences are NOT interchangeable, and the asymmetry is the whole point:
//
//   · The LEAD's says its content MOVED. True only for it — `getSectorPack` keys on
//     `leadEik`, so the dashboard renders that lead's pack as its body and the
//     awarder page keeps just the institution's own ЗОП financials.
//   · A MEMBER's says only that it belongs there. Reusing the lead's sentence would
//     claim the member's money is on the dashboard, which for МЗ's €2.84bn is
//     plainly false: /sector/health shows НЗОК's budget bridge, not МЗ's spending.
//
// The member line is deliberately subject-less („Част от сектор …", not „Тази
// институция …"). Roughly nineteen members are ЕАД/ЕООД commercial companies — АЕЦ
// Козлодуй, НЕК, ЕСО, „Летище София", „БДЖ — Пътнически превози" — so calling every
// one of them an институция is wrong, and no single noun covers a ministry, a
// regional directorate and a joint-stock company. Dropping it is accurate for all
// of them and reads as the label it is.

import type { SectorDashboardConfig } from "./sectorDashboards";

export const sectorCrossLinkCopy = (
  config: SectorDashboardConfig,
  eik: string,
  bg: boolean,
  /** Resolved sector title — `t(config.titleKey)`, passed in so this stays pure. */
  title: string,
): string =>
  config.leadEik === eik
    ? bg
      ? "Разпределените средства и детайлите са в таблото на сектора"
      : "The disbursed funds and sector detail are on the sector dashboard"
    : bg
      ? `Част от сектор „${title}“`
      : `Part of the ${title} sector`;
