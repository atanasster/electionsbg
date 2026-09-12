import { rollcallScope, type RollcallQuery } from "./rollcallQuery";
export const rollcallColumn = (key: string, lang: "bg" | "en"): string =>
  ({
    date: ["Дата", "Date"],
    title: ["Заглавие на записа", "Record title"],
    name: ["Име в източника", "Source name"],
    choice: ["Публикуван глас", "Published cast"],
    faction: ["Група при гласуването", "Faction at vote time"],
    records: ["Записи", "Records"],
    key: ["Група / запис", "Group / record"],
    percentage: ["Дял (%)", "Share (%)"],
    item_count: ["Индексирани гласувания", "Indexed motions"],
    yes: ["За (общо)", "For (aggregate)"],
    no: ["Против (общо)", "Against (aggregate)"],
    abstain: ["Въздържали се (общо)", "Abstain (aggregate)"],
    first: ["Първи индексиран запис", "First indexed record"],
    latest: ["Последен индексиран запис", "Latest indexed record"],
    named: ["Решения с поименен вот", "Resolutions with named rolls"],
    precision: ["Точност на датите", "Date precision"],
    revote: ["Свързано прегласуване", "Linked re-vote"],
    outcome: ["Публикуван резултат", "Published outcome"],
  })[key]?.[lang === "bg" ? 0 : 1] || key;
export const rollcallChoice = (value: string, lang: "bg" | "en") =>
  ({
    for: ["За", "For"],
    against: ["Против", "Against"],
    abstain: ["Въздържал се", "Abstain"],
    recordedAbsent: ["Записано отсъствие", "Recorded absent"],
    adopted: ["Прието", "Adopted"],
    rejected: ["Отхвърлено", "Rejected"],
    returned: ["Върнато", "Returned"],
    unknown: ["Неизвестно", "Unknown"],
  })[value]?.[lang === "bg" ? 0 : 1] || value;
export function rollcallDisplayRow(
  row: Record<string, unknown>,
  lang: "bg" | "en",
): Record<string, string | number | null> {
  const r = Object.fromEntries(
    Object.entries(row).filter(
      ([, v]) => v === null || typeof v === "string" || typeof v === "number",
    ),
  ) as Record<string, string | number | null>;
  if ("title" in r && !r.title)
    r.title = lang === "bg" ? "Без заглавие в източника" : "No title in source";
  if (row.year_only && typeof r.date === "string") r.date = r.date.slice(0, 4);
  if (r.revote)
    r.revote =
      r.revote === "linked"
        ? lang === "bg"
          ? "Има свързан запис"
          : "Linked attempt recorded"
        : lang === "bg"
          ? "Няма свързан запис"
          : "No linked attempt indexed";
  for (const field of ["choice", "outcome"])
    if (typeof r[field] === "string")
      r[field] = rollcallChoice(r[field] as string, lang);
  return r;
}
export function rollcallDisplayScope(
  q: RollcallQuery,
  lang: "bg" | "en",
  rows: Record<string, unknown>[] = [],
) {
  let scope = rollcallScope(q, lang);
  const names = [
    ...new Set(
      rows.flatMap((r) => (typeof r.name === "string" ? [r.name] : [])),
    ),
  ];
  if (names.length && q.seatIds)
    scope = scope.replace(q.seatIds.join(", "), names.join(", "));
  if (names.length && q.councilCastKeys)
    scope = scope.replace(q.councilCastKeys.join(", "), names.join(", "));
  return scope;
}
export const rollcallDateLabel = (date: unknown, yearOnly: unknown) =>
  typeof date === "string"
    ? Number(yearOnly) > 0
      ? date.slice(0, 4)
      : date
    : "—";
export const rollcallStatus = (status: string, lang: "bg" | "en") =>
  ({
    success: ["Налични данни", "Available"],
    partial: ["Непълно покритие", "Partial coverage"],
    empty: ["Няма съвпадения", "No matches"],
    unavailable: ["Няма налични данни", "Unavailable"],
    unsupported: ["Неподдържан обхват", "Unsupported scope"],
    stale: ["Обновени данни", "Data changed"],
  })[status]?.[lang === "bg" ? 0 : 1] ||
  (lang === "bg" ? "Неизвестно" : "Unknown");
