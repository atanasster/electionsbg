import { FC, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Search, X } from "lucide-react";
import { useConnectionsSearch } from "@/data/parliament/useConnectionsSearch";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import type { ConnectionsSearchEntry } from "@/data/dataTypes";
import { candidateUrlForMp } from "@/data/candidates/candidateSlug";
import type { ConnectionsFilters } from "./useConnectionsFilters";
import { cn } from "@/lib/utils";

type Props = {
  filters: ConnectionsFilters;
  setNs: (ns: string | null) => void;
  setCrossParty: (v: boolean) => void;
  setCurrentOnly: (v: boolean) => void;
  setHighConfidenceOnly: (v: boolean) => void;
  setPartyPair: (pair: [string, string] | null) => void;
  resetAll: () => void;
  /** Set of NS folders to offer in the scope dropdown — populated by the
   * caller from rankings.byNs so we only list parliaments we actually have
   * data for. */
  availableNsFolders: string[];
};

/** Linear/Notion-style filter rail. Sits above the tabs on the Connections
 * page and applies to every tab below it (Strongest ties + Find a connection;
 * the Explore graph tab keeps its own canvas-specific toggles). */
export const FilterRail: FC<Props> = ({
  filters,
  setNs,
  setCrossParty,
  setCurrentOnly,
  setHighConfidenceOnly,
  setPartyPair,
  resetAll,
  availableNsFolders,
}) => {
  const { t } = useTranslation();
  const { partyGroupShortLabel } = useCanonicalParties();

  const anyActive =
    filters.ns === null ||
    filters.crossParty ||
    filters.currentOnly ||
    filters.highConfidenceOnly ||
    filters.partyPair !== null;

  return (
    <div className="flex flex-wrap gap-2 items-center text-xs mb-3">
      <SmartEntitySearch />

      <ScopeChip
        ns={filters.ns}
        availableNsFolders={availableNsFolders}
        onChange={setNs}
      />

      <ToggleChip
        label={t("connections_filter_cross_party") || "Cross-party only"}
        active={filters.crossParty}
        onToggle={() => setCrossParty(!filters.crossParty)}
      />
      <ToggleChip
        label={t("connections_filter_current_path") || "All current"}
        active={filters.currentOnly}
        onToggle={() => setCurrentOnly(!filters.currentOnly)}
      />
      <ToggleChip
        label={t("connections_filter_high_conf_path") || "High confidence"}
        active={filters.highConfidenceOnly}
        onToggle={() => setHighConfidenceOnly(!filters.highConfidenceOnly)}
      />

      {filters.partyPair && (
        <button
          type="button"
          onClick={() => setPartyPair(null)}
          className="inline-flex items-center gap-1 rounded-full border border-primary bg-primary/10 px-2 py-1 text-primary"
        >
          {partyGroupShortLabel(filters.partyPair[0]) ?? filters.partyPair[0]} ×{" "}
          {partyGroupShortLabel(filters.partyPair[1]) ?? filters.partyPair[1]}
          <X className="h-3 w-3" />
        </button>
      )}

      {anyActive && (
        <button
          type="button"
          onClick={resetAll}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 ml-1"
        >
          <X className="h-3 w-3" />
          {t("connections_filter_reset_all") || "Reset"}
        </button>
      )}
    </div>
  );
};

const ToggleChip: FC<{
  label: string;
  active: boolean;
  onToggle: () => void;
}> = ({ label, active, onToggle }) => (
  <button
    type="button"
    onClick={onToggle}
    className={cn(
      "inline-flex items-center gap-1 rounded-full border px-2 py-1 transition-colors",
      active
        ? "border-primary bg-primary/10 text-primary"
        : "border-border/60 bg-background text-muted-foreground hover:bg-muted",
    )}
  >
    {label}
    {active && <X className="h-3 w-3" />}
  </button>
);

const ScopeChip: FC<{
  ns: string | null;
  availableNsFolders: string[];
  onChange: (ns: string | null) => void;
}> = ({ ns, availableNsFolders, onChange }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const label =
    ns === null
      ? t("connections_scope_all") || "All parliaments"
      : t("connections_scope_ns", { nsLabel: ns }) || `Parliament ${ns}`;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        className="inline-flex items-center gap-1 rounded-full border border-primary bg-primary/10 px-2 py-1 text-primary"
      >
        {label}
      </button>
      {open && (
        <div className="absolute z-20 mt-1 left-0 max-h-72 overflow-auto rounded border border-border/60 bg-background shadow-md min-w-[160px]">
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              onChange(null);
              setOpen(false);
            }}
            className="block w-full text-left px-2 py-1 hover:bg-muted text-xs"
          >
            {t("connections_scope_all") || "All parliaments"}
          </button>
          {availableNsFolders
            .slice()
            .sort((a, b) => Number(b) - Number(a))
            .map((nsFolder) => (
              <button
                key={nsFolder}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(nsFolder);
                  setOpen(false);
                }}
                className="block w-full text-left px-2 py-1 hover:bg-muted text-xs"
              >
                {t("connections_scope_ns", { nsLabel: nsFolder }) ||
                  `Parliament ${nsFolder}`}
              </button>
            ))}
        </div>
      )}
    </div>
  );
};

/** Smart entity autocomplete — substring match on MP/company labels.
 * Selecting an entry navigates to the corresponding profile page (MP
 * candidate page or company page). Companies without a slug fall back to
 * label-only display since they're not linkable. */
const SmartEntitySearch: FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { searchIndex } = useConnectionsSearch();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const suggestions = useMemo<ConnectionsSearchEntry[]>(() => {
    if (!searchIndex) return [];
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const hits: ConnectionsSearchEntry[] = [];
    for (const entry of searchIndex.entries) {
      if (entry.label.toLowerCase().includes(q)) hits.push(entry);
      if (hits.length >= 10) break;
    }
    return hits;
  }, [searchIndex, query]);

  const onPick = (entry: ConnectionsSearchEntry) => {
    if (entry.type === "mp") {
      navigate(candidateUrlForMp(entry.mpId));
    } else if (entry.slug) {
      navigate(`/mp/company/${encodeURIComponent(entry.slug)}`);
    }
    setQuery("");
    setOpen(false);
  };

  return (
    <div className="relative">
      <div className="relative inline-flex items-center">
        <Search className="absolute left-2 h-3 w-3 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={
            t("connections_search_placeholder") || "Search MP or company…"
          }
          className="pl-7 pr-2 py-1 text-xs rounded border border-border/60 bg-background w-56"
        />
      </div>
      {open && suggestions.length > 0 && (
        <div className="absolute z-20 mt-1 left-0 right-0 max-h-72 overflow-auto rounded border border-border/60 bg-background shadow-md min-w-[260px]">
          {suggestions.map((entry, i) => (
            <button
              key={
                entry.type === "mp"
                  ? `mp-${entry.mpId}`
                  : `co-${entry.slug ?? entry.uic ?? i}`
              }
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(entry);
              }}
              className="block w-full text-left px-2 py-1 hover:bg-muted text-xs"
              disabled={entry.type === "company" && !entry.slug}
            >
              <span
                className={cn(
                  "inline-block h-1.5 w-1.5 rounded-full mr-1.5",
                  entry.type === "mp" ? "bg-blue-500" : "bg-amber-500",
                )}
              />
              <span className="truncate">{entry.label}</span>
              {entry.type === "mp" && entry.partyGroupShort && (
                <span className="ml-2 text-[10px] text-muted-foreground">
                  {entry.partyGroupShort}
                </span>
              )}
              {entry.type === "company" && entry.seat && (
                <span className="ml-2 text-[10px] text-muted-foreground">
                  {entry.seat}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
