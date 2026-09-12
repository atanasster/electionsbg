// Strict calendar/instant validation shared by analytical query contracts.
export const isQueryDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
};
/** Parse only supported complete ISO instants, without Date's overflow normalization. */
export function queryInstant(value: string): string | null {
  const match =
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (
    !match ||
    !isQueryDate(match[1]) ||
    Number(match[2]) > 23 ||
    Number(match[3]) > 59 ||
    Number(match[4] ?? 0) > 59
  )
    return null;
  const zone = match[6];
  if (
    zone !== "Z" &&
    (Number(zone.slice(1, 3)) > 14 ||
      Number(zone.slice(4)) > 59 ||
      (Number(zone.slice(1, 3)) === 14 && Number(zone.slice(4)) !== 0))
  )
    return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
