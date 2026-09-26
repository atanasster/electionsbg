// The outlet × person grid's display rules (news-person-sentiment-v1 §7.1),
// apart from its markup.

import type { MatrixCell, PersonMatrix, ToneBucket } from "./data";
import { BUCKET_FILL } from "./personPage";

export type MatrixMode = "position" | "deviation";

export interface CellView {
  /** blank: too few units for a mean · hatched: a mean with a wide interval. */
  state: "blank" | "hatched" | "filled";
  fill: string;
  bucket: ToneBucket | null;
  deviation: -1 | 0 | 1 | null;
}

export const cellView = (
  cell: MatrixCell | undefined,
  mode: MatrixMode,
  rules: PersonMatrix["rules"],
): CellView => {
  const n = cell?.n ?? 0;
  if (!cell || n < rules.cell_min_n || typeof cell.mean !== "number")
    return { state: "blank", fill: "", bucket: null, deviation: null };
  const state = n < rules.hatch_below_n ? "hatched" : "filled";
  if (mode === "position") {
    const bucket = cell.mean_bucket ?? null;
    return {
      state,
      fill: bucket ? BUCKET_FILL[bucket] : "bg-muted",
      bucket,
      deviation: null,
    };
  }
  // ⚠️ A colour ONLY when the gap's interval excludes zero. Everything else
  // is grey — „в рамките на обичайното", not „no difference measured".
  const sign = cell.dev_sign ?? 0;
  return {
    state,
    fill:
      sign < 0
        ? "bg-negative"
        : sign > 0
          ? "bg-positive"
          : "bg-muted-foreground/25",
    bucket: cell.mean_bucket ?? null,
    deviation: sign,
  };
};

/** The periods worth offering, in the order the picker shows them. */
export const offeredPeriods = (m: PersonMatrix) =>
  (["90", "all", "30"] as const).filter((p) => m.periods[p]?.offered);
