// Shared matcher for the НЗОК per-hospital БМП (болнична медицинска помощ)
// PAYMENTS files on nhif.bg's bmp/{year} listing pages — used by the writer, the
// PG loader and the watcher so a naming change on nhif.bg is a one-file edit.
//
// The listing carries three БМП files per month: the payments one we want, plus
// the "МИ" (медицински изделия) and "лекарствени продукти" siblings we exclude.
// The exclusion uses `(?<!\p{L})МИ(?!\p{L})` (Unicode-aware, both boundaries) —
// JS `\b` is ASCII-only, so `/МИ\b/` never fired after a Cyrillic letter; and
// without the LEFT boundary the `i`-flag would also match word-final "ми"
// (суми, програми), wrongly excluding a payments file that ever contained one.

/** True for a decoded "…здравноосигурителни плащания за БМП…" payments href,
 *  excluding the МИ / лекарствени-продукти siblings. */
export const isBmpPaymentsHref = (decoded: string): boolean =>
  /здравноосигурителни\s+плащания\s+за\s+БМП/i.test(decoded) &&
  !/(?<!\p{L})МИ(?!\p{L})|лек[_\s]?прод|изделия/iu.test(decoded);

/** All БМП-payments PDF hrefs on a bmp/{year} page, in document order (the page
 *  lists newest-first, so `[0]` is the latest month). */
export const bmpPaymentLinks = (html: string): string[] =>
  [...html.matchAll(/href="(\/upload\/[^"]+\.pdf)"/gi)]
    .map((m) => m[1])
    .filter((h) => isBmpPaymentsHref(decodeURIComponent(h)));

// The two siblings the payments matcher deliberately excludes. Together with
// `bmp` they are the three money streams НЗОК pays a hospital, and a facility's
// total НЗОК income is their sum — see PaymentStream in parse_hospital_payments.
//
//   drugs    "Заплатени средства за ЛП в условията на БМП по ЛЗ към …"
//   devices  "Заплатени средства за МИ прилагани в БМП по ЛЗ към …"
//
// Both boundaries stay Unicode-aware for the same reason as above. `ЛП` needs the
// left boundary too, or it matches inside "ЛЗ"-adjacent words under `i`.

/** True for a decoded "…средства за ЛП…" (лекарствени продукти) href. */
export const isDrugsHref = (decoded: string): boolean =>
  /средства\s+за\s+(?<!\p{L})ЛП(?!\p{L})|лек[_\s]?прод/iu.test(decoded);

/** True for a decoded "…средства за МИ…" (медицински изделия) href. */
export const isDevicesHref = (decoded: string): boolean =>
  /средства\s+за\s+(?<!\p{L})МИ(?!\p{L})|изделия/iu.test(decoded);

/** All ЛП (drugs-in-hospital) PDF hrefs on a bmp/{year} page, newest first. */
export const drugsPaymentLinks = (html: string): string[] =>
  [...html.matchAll(/href="(\/upload\/[^"]+\.pdf)"/gi)]
    .map((m) => m[1])
    .filter((h) => isDrugsHref(decodeURIComponent(h)));

/** All МИ (medical devices) PDF hrefs on a bmp/{year} page, newest first. */
export const devicesPaymentLinks = (html: string): string[] =>
  [...html.matchAll(/href="(\/upload\/[^"]+\.pdf)"/gi)]
    .map((m) => m[1])
    .filter((h) => isDevicesHref(decodeURIComponent(h)));
