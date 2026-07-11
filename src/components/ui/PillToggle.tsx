// Tiny controlled pill-toggle — the `role="group"` + `aria-pressed` segmented
// control the NZOK tiles hand-roll (fiscal-year picker, hospitals↔РЗОК view,
// per-capita↔total). Single-sourced so new sector tiles (НОИ €↔брой) reuse the
// exact same look: selected = border-primary bg-primary/10 text-primary,
// unselected = muted with a hover lift. Generic over the option value type.

interface PillToggleProps<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
}

export function PillToggle<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: PillToggleProps<T>) {
  return (
    <div className="flex gap-1" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={o.value === value}
          className={`rounded-full border px-2 py-0.5 text-xs font-medium transition-colors ${
            o.value === value
              ? "border-primary bg-primary/10 text-primary"
              : "border-border bg-background text-muted-foreground hover:text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
