// The /companies landing — `RegistryLanding` with this page's cards and its TWO browse actions.
//
// ⚠️ THE SECOND BROWSE ACTION IS THE `has_signal` FLOOR, and that is the whole point of this
// page. The floor used to be an unconditional client-side `extraFilters` push which
// `DbDataTable` ANDs with the global term — so it applied to SEARCHES exactly as it applied to
// browsing, and 923,855 companies (90.34%) could not be found by name or by EIK. Measured:
// `uic = '205074978'` (ЕЛСЛАК ЕООД, €1.59bn declared capital) returned ZERO rows, as did
// „елслак" and „бета фонд", while the page's own copy promised „търсенето обхваща целия
// регистър". Here the floor becomes a deliberate act with its size on the label.
//
// ⚠️ AND BOTH ACTIONS SET TWO PARAMS IN ONE WRITE. `setScope("signal")` followed by
// `setBrowseAll(true)` does NOT compose — react-router hands `setSearchParams(fn)` the params
// as of the current RENDER, so the second call drops the first's param and the button labelled
// „Разгледай 98 737 фирми с публична следа" would open all 1,022,592 rows. `browseScope()` on
// the URL hook is the composed writer; the screen must pass it, and
// `useUrlCompanyFilters.test.ts` pins both halves.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import {
  RegistryLanding,
  type LandingCard,
} from "@/screens/components/RegistryLanding";
import type { CompanyScope } from "@/data/companies/useUrlCompanyFilters";
import {
  COMPANIES_LANDING_LABELS,
  COMPANIES_REGISTRY_ID_PREFIX,
} from "./companiesBrowseConstants";

export type { LandingCard };

export const CompaniesLanding: FC<{
  cards: LandingCard[];
  /** How many companies each scope holds, for the two browse labels. `undefined` while the
   *  facets are in flight — the label then omits the figure rather than promising a zero. */
  counts: { all?: number; signal?: number };
  /** Open the table at a scope. MUST be the URL hook's `browseScope`, which writes `?scope`
   *  and `?browse` in ONE setParams — see the header.
   *
   *  ⚠️ ONE CALLBACK TAKING THE SCOPE, not two callbacks. With a pair, only the primary's
   *  requirement was documented and the secondary quietly needed the same thing: reached from
   *  an inbound `?scope=signal`, a `setBrowseAll(true)` that did not also clear the scope would
   *  leave the button labelled „…или целия регистър (1 022 592)" opening 98,737 rows. One
   *  parameterised callback makes the two arms the same code path, so they cannot diverge. */
  onBrowse: (scope: CompanyScope) => void;
  fmtInt: (n: number) => string;
}> = ({ cards, counts, onBrowse, fmtInt }) => {
  const { t } = useTranslation();
  // ⚠️ THE COUNT IS PART OF THE PROMISE, so a label without one must not invent it. „Разгледай
  // 0 фирми с публична следа" is a sentence and it is false; the countless form is not. Same
  // rule and the same reason as the KPI band's scope basis, whose producer is the same facet
  // request that fills these.
  //
  // ⚠️ ONE OBJECT ARGUMENT, not five positional strings. The first draft took
  // `(withCount, without, n, fallbackWith, fallbackWithout)`, where swapping either pair is a
  // type-correct call that renders the wrong sentence — and the countless form only appears
  // while a request is in flight, so a swap there is invisible in every screenshot and most
  // tests.
  const label = ({
    n,
    counted,
    countless,
  }: {
    n: number | undefined;
    counted: { key: string; fallback: string };
    countless: { key: string; fallback: string };
  }) =>
    n == null
      ? t(countless.key, { defaultValue: countless.fallback })
      : t(counted.key, { defaultValue: counted.fallback, n: fmtInt(n) });

  return (
    <RegistryLanding
      cards={cards}
      // No `above`: /persons passes its mix bar there, and this page's corpus breakdown is the
      // head's evidence aside („Видове", the seven entity_class rows). Offering the same
      // partition twice on one screen is the „Бизнес" segment problem /persons had to write a
      // paragraph about.
      browse={[
        {
          key: "signal",
          label: label({
            n: counts.signal,
            counted: {
              key: "companies_browse_signal",
              fallback: "Разгледай {{n}} фирми с публична следа",
            },
            countless: {
              key: "companies_browse_signal_short",
              fallback: "Разгледай фирмите с публична следа",
            },
          }),
          hint: t("companies_browse_signal_hint", {
            defaultValue:
              "Фирмите, за които този сайт има какво да каже — публични средства, връзка с публично лице, спечелена поръчка или НПО статут.",
          }),
          onClick: () => onBrowse("signal"),
        },
        {
          key: "all",
          label: label({
            n: counts.all,
            counted: {
              key: "companies_browse_all",
              fallback: "…или целия регистър ({{n}})",
            },
            countless: {
              key: "companies_browse_all_short",
              fallback: "…или целия регистър",
            },
          }),
          hint: t("companies_browse_all_hint", {
            defaultValue:
              "Всяко вписване в Търговския регистър. За повечето от тях страницата показва само име, ЕИК и седалище.",
          }),
          onClick: () => onBrowse("all"),
          // ⚠️ THE WHOLE REGISTRY IS THE SECONDARY ACTION, and the default `?scope` is still
          // `all`. Those are not in conflict: the DEFAULT has to be `all` or the search box
          // goes on lying, while the RECOMMENDED browse is the floored one, because the other
          // 90.34% is a phone book — measured, four of the table's five columns render „—" for
          // a hidden row, and 881,169 of them are ordinary active trading companies rather
          // than dormant shells.
          emphasis: "secondary",
        },
      ]}
      labels={COMPANIES_LANDING_LABELS}
      idPrefix={COMPANIES_REGISTRY_ID_PREFIX}
      fmtInt={fmtInt}
    />
  );
};
