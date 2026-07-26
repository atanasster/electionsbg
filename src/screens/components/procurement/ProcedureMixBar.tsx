// Procedure-mix overview for the contracts table: a 100%-stacked horizontal bar
// of the ProcedureBuckets present for the scoped entity, doubling AS the procedure
// filter — clicking a segment (or its legend chip) selects that bucket; clicking
// the active one clears it. Fed by the filter-scoped `procurement_method` facet
// (excludes its OWN dimension, so every bucket stays visible while another filter
// is active). Pure CSS bars — no chart lib — per the project's infographic-bar
// convention. See CompanyContractsDbScreen.
import { FC } from "react";
import { useTranslation } from "react-i18next";
import {
  procedureLabel,
  type MethodBucketFacet,
  type ProcedureBucket,
} from "@/lib/cpvSectors";
import { useIsDark } from "@/screens/components/procurement/chartColors";

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

const nfmt = new Intl.NumberFormat("bg-BG");

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
  const total = buckets.reduce((s, b) => s + b.count, 0);
  if (!buckets.length || total === 0) return null;

  const pct = (n: number) => (n / total) * 100;
  const toggle = (b: MethodBucketFacet) =>
    selected === b.bucket ? onSelect(null) : onSelect(b.bucket);

  return (
    <div className="rounded-xl border bg-card p-3 md:p-4">
      {title ? (
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </div>
      ) : null}
      {/* The stacked bar. Each segment is a button so the bar itself filters. */}
      <div className="flex h-3 w-full overflow-hidden rounded-full">
        {buckets.map((b) => {
          const active = selected === b.bucket;
          const label = procedureLabel(b.bucket, i18n.language);
          const desc = `${label} · ${nfmt.format(b.count)} (${pct(b.count).toFixed(0)}%)`;
          return (
            <button
              key={b.bucket}
              type="button"
              onClick={() => toggle(b)}
              aria-pressed={active}
              aria-label={desc}
              title={desc}
              className="h-full transition-opacity hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              style={{
                width: `${pct(b.count)}%`,
                backgroundColor: colors[b.bucket],
                opacity: selected && !active ? 0.35 : 1,
              }}
            />
          );
        })}
      </div>
      {/* Clickable legend — the accessible hit target for narrow segments. */}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {buckets.map((b) => {
          const active = selected === b.bucket;
          const label = procedureLabel(b.bucket, i18n.language);
          return (
            <button
              key={b.bucket}
              type="button"
              onClick={() => toggle(b)}
              aria-pressed={active}
              className={`flex items-center gap-1.5 text-xs transition-opacity ${
                selected && !active ? "opacity-50" : "opacity-100"
              } hover:opacity-100`}
            >
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: colors[b.bucket] }}
              />
              <span
                className={
                  active
                    ? "font-semibold text-foreground"
                    : "text-muted-foreground"
                }
              >
                {label}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {pct(b.count).toFixed(0)}%
              </span>
            </button>
          );
        })}
      </div>
      {note ? (
        <p className="mt-2 text-[11px] text-muted-foreground">{note}</p>
      ) : null}
    </div>
  );
};
