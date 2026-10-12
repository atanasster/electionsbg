// Shared bilingual labels for the road work-group + component taxonomies.
// The canonical maps live in the dependency-free engine (@/lib/roadAttributes)
// so the AI narration layer can share them without importing src/screens; this
// module just re-exports them under the local path the tiles already use.

export { GROUP_META, COMPONENT_LABEL } from "@/lib/roadAttributes";

import type { PerKmClass } from "@/lib/roadAttributes";

/** Short label for the work class a corridor €/km median is taken over. */
export const PER_KM_CLASS_LABEL: Record<
  PerKmClass,
  { bg: string; en: string }
> = {
  build: { bg: "строителство", en: "build" },
  rehab: { bg: "ремонт", en: "repair" },
};
