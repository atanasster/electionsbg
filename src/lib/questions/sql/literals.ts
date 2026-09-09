export class SqlParameterError extends Error {
  constructor(
    public readonly parameterId: string,
    message: string,
  ) {
    super(message);
    this.name = "SqlParameterError";
  }
}

export const sqlText = (value: unknown, parameterId = "value"): string => {
  if (typeof value !== "string")
    throw new SqlParameterError(parameterId, "Expected text");
  if (value.includes("\0"))
    throw new SqlParameterError(parameterId, "NUL is not allowed");
  return `E'${value.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
};

export const sqlCode = (value: unknown, parameterId = "code"): string => {
  if (typeof value !== "string" || !/^[\p{L}\p{N} ._:/-]+$/u.test(value))
    throw new SqlParameterError(
      parameterId,
      "Expected a code or identifier value",
    );
  return sqlText(value, parameterId);
};

export const sqlInteger = (
  value: unknown,
  parameterId: string,
  min: number,
  max: number,
): string => {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^-?\d+$/.test(value.trim())
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max)
    throw new SqlParameterError(
      parameterId,
      `Expected an integer from ${min} to ${max}`,
    );
  return String(parsed);
};

export const sqlDate = (value: unknown, parameterId = "date"): string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new SqlParameterError(parameterId, "Expected YYYY-MM-DD");
  const parsed = new Date(`${value}T00:00:00Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  )
    throw new SqlParameterError(parameterId, "Expected a valid date");
  return `${sqlText(value, parameterId)}::date`;
};
