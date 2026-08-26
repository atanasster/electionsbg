// The two PURE rules behind `RegistryFilterSelect`, in a module of its own.
//
// They live outside the component file for the mechanical reason `personsBrowseConstants.ts`
// does — exporting a non-component from a component file breaks Fast Refresh
// (`react-refresh/only-export-components`) — and for a better one: Radix only mounts
// `SelectContent` while the dropdown is OPEN, and opening one in jsdom needs
// `hasPointerCapture` / `scrollIntoView` polyfills no test in this repo has. As inline
// expressions these two were therefore UNTESTABLE, and both carry a rule that is wrong in a way
// a reader would not notice.

import type { RegistryFilterOption } from "./RegistryFilterSelect";

/** Whether a select with this vocabulary and value would render anything at all.
 *
 *  ⚠️ EXPORTED BECAUSE THE BAR NEEDS THE SAME ANSWER. `RegistryFilterSelect` returns `null` for
 *  an empty vocabulary with nothing selected — a picker offering only „всички" is a control
 *  that cannot do anything — and `RegistryFilterBar` was rendering the LABEL and the
 *  `aria-labelledby` target anyway. That leaves „ВИД" floating over nothing on a cold mount
 *  (reachable today: a screen pushes its selects before the facets resolve) and an
 *  `aria-labelledby` pointing at a label whose control does not exist. Restating the condition
 *  in the bar would be two copies of one rule; asking the component is one. */
export const registrySelectWillRender = (
  options: readonly RegistryFilterOption[],
  value: string,
  allValue: string,
): boolean => options.length > 0 || value !== allValue;

/** One option's rendered text: its label, and its count where the option carries one.
 *
 *  ⚠️ EXTRACTED SO IT CAN BE TESTED AT ALL. Radix only mounts `SelectContent` while the
 *  dropdown is OPEN, and opening one in jsdom needs `hasPointerCapture`/`scrollIntoView`
 *  polyfills that no test in this repo has — so as an inline expression the count rendering,
 *  the thousands separator and the `locale` prop were untestable and untested. The separator is
 *  not cosmetic: „21 815" (BG, a non-breaking space) and „21,815" are different strings, and
 *  this picker sits beside a KPI band formatting the same figures.
 *
 *  A `count` of ZERO renders — „(0)" is a true statement about a facet bucket that exists and
 *  is empty — so the guard is `!= null`, never falsiness. `undefined` means the facet column
 *  and the filter column differ, where a count that under-promises what clicking returns is
 *  worse than no count at all. */
export const registryOptionLabel = (
  option: RegistryFilterOption,
  locale: string,
): string =>
  option.count != null
    ? `${option.label} (${option.count.toLocaleString(locale)})`
    : option.label;
