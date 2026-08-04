// The group shape <SectorEntitySearch> renders, kept out of the component file
// so that file only exports components (react-refresh/only-export-components).

import type { FC } from "react";
import type { EntityIndex } from "@/lib/entitySearchIndex";

export interface EntitySearchGroup {
  /** Stable key — also the row-id prefix, so it must be unique per box. */
  id: string;
  label: { bg: string; en: string };
  /** Null while the caller has not built it yet (see the component's `onArm`).
   *  A null index is NOT searched, and is excluded from the empty-state list —
   *  naming it there would claim a search that never ran. */
  index: EntityIndex | null;
  /** Rows shown for this group (default 8). */
  limit?: number;
  /** The caller is still fetching this group's source payload. */
  loading?: boolean;
  /** Row icon (lucide). Defaults to a magnifier. */
  icon?: FC<{ className?: string }>;
}

/** Convenience for the common "one group, built from an already-loaded payload"
 *  case, so a caller does not repeat the label/limit plumbing. */
export const entityGroup = (
  id: string,
  bgLabel: string,
  enLabel: string,
  index: EntityIndex | null,
  opts?: {
    limit?: number;
    loading?: boolean;
    icon?: FC<{ className?: string }>;
  },
): EntitySearchGroup => ({
  id,
  label: { bg: bgLabel, en: enLabel },
  index,
  limit: opts?.limit,
  loading: opts?.loading,
  icon: opts?.icon,
});
