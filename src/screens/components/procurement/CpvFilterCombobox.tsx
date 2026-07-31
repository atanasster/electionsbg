// Searchable CPV filter for the contracts browser. The facet only yields 2-digit
// divisions, so this combobox merges those (with in-scope counts) with the named
// CPV-code catalogue (tenders' cpv_desc, ~3.6k codes) — searchable by name OR by
// code — and lets a user type any CPV code/prefix to filter on it directly.
// Selecting sends a prefix filter (cpv LIKE '<code>%'), same as the old select.
//
// The catalogue is fetched HERE rather than by the four screens that mount this,
// because only this component knows when it is needed: the closed control renders
// entirely from `divisions`, which arrive free with the facet. See `armed` below.

import { FC, useMemo, useState } from "react";
import { Command as CommandPrimitive } from "cmdk";
import { ChevronDown, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  CommandEmpty,
  CommandInput,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { cpvDivisionName } from "@/lib/cpvSectors";
import { skeletonMatches } from "@/lib/translitSearch";
import { useCpvCatalog } from "@/data/procurement/useCpvCatalog";

export const CPV_ALL = "__all__";

type DivisionOption = { value: string; count: number };
type Item = {
  value: string; // the CPV code/prefix to filter on (or CPV_ALL)
  label: string; // primary text
  hint?: string; // muted secondary text (code or count)
};

const norm = (s: string) => s.toLocaleLowerCase().trim();

export const CpvFilterCombobox: FC<{
  value: string;
  onChange: (v: string) => void;
  divisions: DivisionOption[];
}> = ({ value, onChange, divisions }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  // A LATCH, not `open` — once armed the catalogue stays enabled for the life of
  // the control. Flipping `enabled` back to false on close would abandon a fetch
  // still in flight (the request has no abort signal, so the bytes arrive and are
  // thrown away), and re-open would start over.
  //
  // Armed by the trigger's pointer/focus as well as by opening, so for a mouse
  // user the ~200 ms fetch overlaps the reach-and-click and the list is already
  // there. Touch and keyboard fall back to arming on open, where the list fills
  // in behind the "loading" note below.
  const [armed, setArmed] = useState(false);
  // The one case the closed control cannot render without the catalogue: a
  // deep-linked FULL code (`?cpv=45231300`), whose name lives only there.
  //
  // EXACTLY 8 digits, because that is exactly the set of values the catalogue can
  // name — all 3,606 of its keys are 8-digit codes (measured). `?cpv` also carries
  // comma-sets (`45,50`) and shorter prefixes (`451`, and anything a reader picks
  // via the "Филтрирай по CPV код <q>" row below), and `catalogByCode.get()` misses
  // on every one of them: the trigger falls through to a bare `CPV <value>` whether
  // or not the catalogue arrived. Any looser test here pays the eager fetch this
  // gate exists to avoid and gets nothing back. Divisions are 2 digits and CPV_ALL
  // is `__all__`, so both fail this test without needing their own guard.
  //
  // If a future corpus ever yields a key shorter than 8, its trigger reads the bare
  // `CPV <code>` until the picker is opened — visible, and not a wrong label.
  const needsCodeName = /^\d{8}$/.test(value);

  const { data, isError: catalogError } = useCpvCatalog(armed || needsCodeName);
  const catalog = useMemo(() => data ?? [], [data]);
  // "Not fetched yet" is not "empty": the note below must not claim a degraded
  // search while the request is simply still on the wire.
  const catalogPending = (armed || needsCodeName) && !data && !catalogError;

  const catalogByCode = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of catalog) if (!m.has(c.cpv)) m.set(c.cpv, c.desc);
    return m;
  }, [catalog]);

  // Label for the trigger button given the current filter value.
  const triggerLabel = useMemo(() => {
    if (value === CPV_ALL || !value)
      return bg ? "Всички категории (CPV)" : "All categories (CPV)";
    const div = divisions.find((d) => d.value === value);
    if (div) return `${cpvDivisionName(value, lang)} (${div.count})`;
    const desc = catalogByCode.get(value);
    return desc ? `${desc} · CPV ${value}` : `CPV ${value}`;
  }, [value, divisions, catalogByCode, lang, bg]);

  const items = useMemo<Item[]>(() => {
    const q = norm(query);
    const out: Item[] = [];
    out.push({
      value: CPV_ALL,
      label: bg ? "Всички категории (CPV)" : "All categories (CPV)",
    });
    const digits = /^\d{2,8}$/.test(q);
    // A typed code/prefix is always applicable, even if it's not a catalogue key.
    if (digits && !catalogByCode.has(q))
      out.push({
        value: q,
        label: bg ? `Филтрирай по CPV код ${q}` : `Filter by CPV code ${q}`,
        hint: cpvDivisionName(q, lang),
      });
    // Divisions (default view + name/code match). skeletonMatches folds Latin
    // and Cyrillic so "arh"/"arch"/"арх" all match "Архитектурни".
    for (const d of divisions) {
      const name = cpvDivisionName(d.value, lang);
      if (!q || skeletonMatches(name, q) || d.value.startsWith(q))
        out.push({ value: d.value, label: name, hint: `${d.count}` });
    }
    // Finer named codes — only when searching (the catalogue is ~3.6k long).
    if (q) {
      let n = 0;
      for (const c of catalog) {
        if (skeletonMatches(c.desc, q) || c.cpv.startsWith(q)) {
          out.push({ value: c.cpv, label: c.desc, hint: `CPV ${c.cpv}` });
          if (++n >= 80) break;
        }
      }
    }
    return out;
  }, [query, divisions, catalog, catalogByCode, lang, bg]);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setArmed(true);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          onPointerEnter={() => setArmed(true)}
          onFocus={() => setArmed(true)}
          className="h-9 w-auto max-w-[240px] justify-between font-normal"
        >
          <span className="truncate">{triggerLabel}</span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[460px] max-w-[92vw] p-0" align="start">
        <CommandPrimitive shouldFilter={false}>
          <CommandInput
            placeholder={
              bg
                ? "Търси категория или CPV код…"
                : "Search category or CPV code…"
            }
            value={query}
            onValueChange={setQuery}
          />
          {/* Say so when only the divisions are searchable. Silently offering a
              shortened list is how a timing-out catalogue route went unnoticed —
              and now that the fetch starts on open rather than on mount, the same
              shortened list is also the normal first ~200 ms. The two states get
              different words so "still arriving" never reads as "broken". */}
          {/* A polite live region, so the transition out of "loading" — into a
              full list or into the error — is SPOKEN. Both notes are otherwise
              visual-only, and to a screen-reader user the two failure shapes are
              identical to a healthy one: the list is simply short. The wrapper is
              always mounted (an aria-live element inserted already-populated is
              not reliably announced; it has to be there when the text changes). */}
          <div aria-live="polite">
            {catalogError ? (
              <div className="border-b px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400">
                {bg
                  ? "Списъкът с CPV кодове не се зареди — търсенето е само по раздели."
                  : "The CPV code list failed to load — search is limited to divisions."}
              </div>
            ) : catalogPending ? (
              <div className="border-b px-3 py-2 text-[11px] text-muted-foreground">
                {bg
                  ? "Зарежда се списъкът с CPV кодове…"
                  : "Loading the CPV code list…"}
              </div>
            ) : null}
          </div>
          <CommandList>
            <CommandEmpty>{t("no_results") || "Няма резултати"}</CommandEmpty>
            {items.map((it) => (
              <CommandPrimitive.Item
                key={`${it.value}:${it.label}`}
                value={`${it.value}:${it.label}`}
                onSelect={() => {
                  onChange(it.value);
                  setOpen(false);
                  setQuery("");
                }}
                className="flex cursor-pointer items-start gap-2 px-2 py-2 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
              >
                <Check
                  className={cn(
                    "mt-0.5 h-4 w-4 shrink-0",
                    value === it.value ? "opacity-100" : "opacity-0",
                  )}
                />
                <span className="min-w-0 flex-1 leading-snug">{it.label}</span>
                {it.hint ? (
                  <span className="mt-0.5 shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                    {it.hint}
                  </span>
                ) : null}
              </CommandPrimitive.Item>
            ))}
          </CommandList>
        </CommandPrimitive>
      </PopoverContent>
    </Popover>
  );
};
