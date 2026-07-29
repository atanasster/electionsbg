// Procedure-mix overview for the contracts table: a 100%-stacked horizontal bar of the
// ProcedureBuckets present for the scoped entity, doubling AS the procedure filter. Fed by
// the filter-scoped `procurement_method` facet (which excludes its OWN dimension, so every
// bucket stays visible while another filter is active). See CompanyContractsDbScreen.
//
// The bar, legend, dimming and a11y now live in the generic MixBar (src/ux/MixBar.tsx),
// which /persons also renders. What stays HERE is the part that is actually about
// procurement: the bucket palette (which hue means "no open advert") and the localized
// bucket labels. Behaviour is unchanged — same markup, same interactions.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  procedureLabel,
  type MethodBucketFacet,
  type ProcedureBucket,
} from "@/lib/cpvSectors";
import { useIsDark } from "@/screens/components/procurement/chartColors";
import { MixBar } from "@/ux/MixBar";

// One distinct hue per bucket, brightened at the -400 step for dark mode so each
// segment clears non-text contrast against the navy background.
const BUCKET_LIGHT: Record<ProcedureBucket, string> = {
  open: "#0d9488", // teal-600 — competitive/open
  competition: "#2563eb", // blue-600
  collection: "#7c3aed", // violet-600
  direct: "#dc2626", // red-600 — no open advert
  framework: "#d97706", // amber-600
  other: "#64748b", // slate-500
  unknown: "#94a3b8", // slate-400
};
const BUCKET_DARK: Record<ProcedureBucket, string> = {
  open: "#2dd4bf",
  competition: "#60a5fa",
  collection: "#a78bfa",
  direct: "#f87171",
  framework: "#fbbf24",
  other: "#94a3b8",
  unknown: "#cbd5e1",
};

export const ProcedureMixBar: FC<{
  buckets: MethodBucketFacet[];
  /** Currently-selected bucket key, or null when unfiltered. */
  selected: ProcedureBucket | null;
  /** Toggle a bucket by key, or null to clear. The raw methods behind the bucket
   *  are re-derived by the consumer from the same facet (single source of truth),
   *  so only the key is passed. */
  onSelect: (bucket: ProcedureBucket | null) => void;
  title?: string;
  /** Small caption under the bar — e.g. that the mix covers only contracts with a
   *  recorded procedure (rows with no procurement_method are excluded). */
  note?: string;
}> = ({ buckets, selected, onSelect, title, note }) => {
  const { i18n } = useTranslation();
  const dark = useIsDark();
  const colors = dark ? BUCKET_DARK : BUCKET_LIGHT;

  const segments = useMemo(
    () =>
      buckets.map((b) => ({
        key: b.bucket,
        label: procedureLabel(b.bucket, i18n.language),
        count: b.count,
        color: colors[b.bucket],
      })),
    [buckets, colors, i18n.language],
  );

  return (
    <MixBar<ProcedureBucket>
      segments={segments}
      selected={selected}
      onSelect={onSelect}
      title={title}
      note={note}
      locale={i18n.language?.startsWith("bg") ? "bg-BG" : "en-GB"}
    />
  );
};
