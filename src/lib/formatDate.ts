// Date-only localized format shared across procurement surfaces (tender detail,
// the recent-appeals tile, the appeals browser). Renders a raw ISO date
// ("2024-03-14") as "14 март 2024" (bg) / "14 Mar 2024" (en). Falls back to the
// raw string on an unparseable input rather than printing "Invalid Date".
export const formatDate = (iso: string, lang: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(lang === "bg" ? "bg-BG" : "en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
};
