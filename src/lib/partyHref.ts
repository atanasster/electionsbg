// The `/party/<nickName>` URL, on its own — a leaf module with NO imports.
//
// ⚠ IT LIVES HERE RATHER THAN IN `lib/utils.ts` BECAUSE OF WHAT `utils` COSTS ITS IMPORTERS.
// That module opens with `clsx` and `tailwind-merge` for `cn`, so taking one 3-line URL builder
// from it drags ~6.6 KB brotli into the importer's static closure — measured on
// `ElectionResultsShell`, whose own budget is 10.4 KB and which went to 16,968 B the moment it
// imported `partyHref` from there. `lib/utils.ts` re-exports this name, so every existing call
// site is unchanged and there is still exactly one definition of the rule.

// Build a URL path to a party page, encoding the nickName so coalition names
// containing a slash (e.g. "ВОЛЯ/НФСБ", ballot 24 in April 2021) don't get
// chopped by React Router's path-segment matching.
export const partyHref = (
  nickName: string | number | null | undefined,
  suffix = "",
): string => `/party/${encodeURIComponent(String(nickName ?? ""))}${suffix}`;
