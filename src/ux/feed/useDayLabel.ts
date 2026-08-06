// One formatter for plain calendar days ("2026-07-31") across the feed kit.
//
// `timeZone: "UTC"` is load-bearing, not boilerplate, and this hook exists so it cannot be
// forgotten card by card. These strings are calendar DAYS, not instants: parsed as UTC
// midnight and formatted in the viewer's zone, 2026-07-31 renders as "30 юли" for everyone
// west of UTC — so a card's date and the /votes/<date> it links to disagree by a day. Caught
// on a UTC−4 machine, where every column of the session strip was off by one.

import { useMemo } from "react";
import { useTranslation } from "react-i18next";

export type DayLabelStyle = "short" | "long";

export const useDayLabel = (
  style: DayLabelStyle = "short",
): ((iso: string) => string) => {
  const { i18n } = useTranslation();
  const fmt = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language === "bg" ? "bg-BG" : "en-GB", {
        day: "numeric",
        month: style === "long" ? "long" : "short",
        ...(style === "long" ? { year: "numeric" as const } : {}),
        timeZone: "UTC",
      }),
    [i18n.language, style],
  );
  return useMemo(
    () => (iso: string) => fmt.format(new Date(`${iso}T00:00:00Z`)),
    [fmt],
  );
};
