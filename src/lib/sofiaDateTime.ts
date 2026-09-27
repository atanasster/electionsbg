// A date and time stated in Europe/Sofia, whatever the reader's zone — for
// copy that names an instant („замразени към 6 ноември 2026 г., 23:59"), where
// a relative phrase would be wrong for a reader elsewhere and wrong again
// tomorrow. Used by the main site and the news app alike.

export const sofiaDateTime = (
  iso: string,
  locale: "bg-BG" | "en-GB",
  withYear = true,
): string =>
  new Intl.DateTimeFormat(locale, {
    timeZone: "Europe/Sofia",
    day: "numeric",
    month: "long",
    ...(withYear ? { year: "numeric" } : {}),
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
