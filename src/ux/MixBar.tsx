// A 100%-stacked horizontal bar that doubles AS a filter: clicking a segment (or its
// legend chip) selects that key, clicking the active one clears it. Pure CSS bars — no
// chart library — per the project's infographic-bar convention.
//
// Extracted from ProcedureMixBar (the procurement browsers' "Вид процедура" strip), which
// now renders through it, so a second consumer (/persons' "Основна принадлежност") does not
// mean a second implementation of the stacking, the dimming, the legend or the a11y.
//
// THE INPUT MUST BE A PARTITION. Segment widths are shares of the summed total, so a set of
// OVERLAPPING categories — the kind produced by membership flags, where one person can be
// in three groups — renders widths that add to more than the whole and read as proportions
// of something that does not exist. Feed it a single-valued dimension (a bucketed procedure,
// a representative facet), never a set of independent booleans.

export interface MixSegment<K extends string = string> {
  /** Stable identity — the filter value this segment selects. */
  key: K;
  label: string;
  count: number;
  /** Resolved hue. The caller owns the palette because "which colour means direct award"
   *  is a domain decision, not a layout one. */
  color: string;
}

export const MixBar = <K extends string = string>({
  segments,
  selected,
  onSelect,
  title,
  note,
  locale = "bg-BG",
}: {
  segments: MixSegment<K>[];
  /** Currently-selected key, or null when unfiltered. */
  selected: K | null;
  /** Toggle by key, or null to clear. */
  onSelect: (key: K | null) => void;
  title?: string;
  /** Small caption under the bar — e.g. that the mix covers only rows with a recorded
   *  value, or that the categories are a person's PRIMARY one rather than all of them. */
  note?: string;
  /** Number formatting for the segment tooltips. */
  locale?: string;
}) => {
  const total = segments.reduce((s, b) => s + b.count, 0);
  if (!segments.length || total === 0) return null;

  const nfmt = new Intl.NumberFormat(locale);
  // Dim the others only when the selection is one of these segments. A value the bar cannot
  // represent — a stale or hand-typed URL param — would otherwise dim EVERY segment, which
  // reads as "the data is empty" rather than "your filter matched nothing here".
  const representable = segments.some((s) => s.key === selected);
  const dim = selected != null && representable;
  const pct = (n: number) => (n / total) * 100;
  const toggle = (s: MixSegment<K>) =>
    selected === s.key ? onSelect(null) : onSelect(s.key);

  return (
    <div className="rounded-xl border bg-card p-3 md:p-4">
      {title ? (
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </div>
      ) : null}
      {/* The stacked bar. Each segment is a button so the bar itself filters. */}
      <div className="flex h-3 w-full overflow-hidden rounded-full">
        {segments.map((s) => {
          const active = selected === s.key;
          const desc = `${s.label} · ${nfmt.format(s.count)} (${pct(s.count).toFixed(0)}%)`;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => toggle(s)}
              aria-pressed={active}
              aria-label={desc}
              title={desc}
              className="h-full transition-opacity hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              style={{
                width: `${pct(s.count)}%`,
                backgroundColor: s.color,
                opacity: dim && !active ? 0.35 : 1,
              }}
            />
          );
        })}
      </div>
      {/* Clickable legend — the accessible hit target for narrow segments. */}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {segments.map((s) => {
          const active = selected === s.key;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => toggle(s)}
              aria-pressed={active}
              className={`flex items-center gap-1.5 text-xs transition-opacity ${
                dim && !active ? "opacity-50" : "opacity-100"
              } hover:opacity-100`}
            >
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: s.color }}
              />
              <span
                className={
                  active
                    ? "font-semibold text-foreground"
                    : "text-muted-foreground"
                }
              >
                {s.label}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {pct(s.count).toFixed(0)}%
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
