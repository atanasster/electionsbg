// The shared procurement-query filter — the recall-thread editor (BuildForm /
// ThreadRow / ThreadAdder, moved here from ProjectFileScreen so they are reusable)
// plus the membership-narrowing controls (CPV / date / €-window / eu-funded). One
// definition used by the dossier hub build form and the dossier inline editor; the
// contracts page reuses the SAME underlying narrowing controls for consistency.
//
// Controlled via GRANULAR callbacks (not a single onChange) so the host keeps its
// own persistence: the dossier screen re-reads the ?q= URL inside each mutateSpec
// so an edit is never applied to a stale value. The pure transforms that back these
// edits (withThreadTerms / withCpvIn / …) live in projectFile.ts.

import { FC, useEffect, useState } from "react";
import {
  AwarderSearch,
  type AwarderChoice,
} from "@/screens/components/procurement/AwarderSearch";
import type {
  ProcurementQuery,
  MembershipNarrowing,
} from "@/data/procurement/projectFile";

export const BuildForm = ({
  onSubmit,
  bg,
  cta,
  initial = "",
  initialAwarder = null,
}: {
  onSubmit: (terms: string, awarder: AwarderChoice | null) => void;
  bg: boolean;
  cta: string;
  /** Pre-populate the input — e.g. a "Прецизирай думите" refine deep-link. */
  initial?: string;
  /** Pre-select the buyer — the refine link carries the dossier's scope. */
  initialAwarder?: AwarderChoice | null;
}) => {
  const [terms, setTerms] = useState(initial);
  const [awarder, setAwarder] = useState<AwarderChoice | null>(initialAwarder);
  return (
    <form
      className="no-print my-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(terms, awarder);
      }}
    >
      {/* terms + buyer + submit fill one row on desktop (subject ~2× the buyer,
          both flexible), stacking on mobile */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          className="rounded-md border px-3 py-1.5 text-sm bg-background sm:min-w-0 sm:flex-[2]"
          value={terms}
          onChange={(e) => setTerms(e.target.value)}
          placeholder={
            bg
              ? "напр. западна дъга, ремонт улици Пловдив…"
              : "e.g. western arc, street repair Plovdiv…"
          }
        />
        <AwarderSearch
          value={awarder}
          onChange={setAwarder}
          bg={bg}
          className="sm:min-w-0 sm:flex-1"
        />
        <button
          className="shrink-0 rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
          type="submit"
        >
          {cta}
        </button>
      </div>
    </form>
  );
};

// One editable search thread (§0f.2). Commits on Enter or blur; the × removes it
// (hidden for the last remaining thread — a file needs at least one search).
const ThreadRow = ({
  initial,
  index,
  removable,
  buyer,
  contractor,
  onCommit,
  onBuyer,
  onContractor,
  onRemove,
  bg,
}: {
  initial: string;
  index: number;
  removable: boolean;
  buyer: AwarderChoice | null;
  contractor: AwarderChoice | null;
  onCommit: (i: number, terms: string) => void;
  onBuyer: (i: number, buyer: AwarderChoice | null) => void;
  onContractor: (i: number, contractor: AwarderChoice | null) => void;
  onRemove: (i: number) => void;
  bg: boolean;
}) => {
  const [terms, setTerms] = useState(initial);
  // Re-sync when the committed value changes externally (e.g. a sibling row was
  // removed and indices shifted). Keying by index keeps focus on Enter-commit.
  useEffect(() => setTerms(initial), [initial]);
  // Blank is not a valid commit (setThreadTerms ignores it) — revert the box to
  // the committed term instead of leaving it misleadingly empty.
  const commit = () => {
    if (!terms.trim()) setTerms(initial);
    else onCommit(index, terms);
  };
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <input
        className="rounded-md border px-3 py-1.5 text-sm bg-background sm:flex-1"
        aria-label={
          bg ? `Дума за търсене ${index + 1}` : `Search term ${index + 1}`
        }
        value={terms}
        onChange={(e) => setTerms(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
      />
      {/* per-thread buyer scope — same typeahead as the build form */}
      <AwarderSearch
        value={buyer}
        onChange={(a) => onBuyer(index, a)}
        bg={bg}
        className="sm:w-64"
      />
      {/* per-thread contractor (supplier) scope — the award's-other-side mirror.
          A contractor + no terms anchors the dossier on that supplier's slice. */}
      <AwarderSearch
        value={contractor}
        onChange={(a) => onContractor(index, a)}
        bg={bg}
        group="companies"
        className="sm:w-64"
      />
      {removable && (
        <button
          type="button"
          onClick={() => onRemove(index)}
          aria-label={bg ? "Махни реда" : "Remove row"}
          className="shrink-0 self-start rounded-md border px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted sm:self-auto"
        >
          ×
        </button>
      )}
    </div>
  );
};

// The "add another search thread" row — clears itself after each add.
const ThreadAdder = ({
  onAdd,
  bg,
}: {
  onAdd: (terms: string) => void;
  bg: boolean;
}) => {
  const [terms, setTerms] = useState("");
  const submit = () => {
    onAdd(terms);
    setTerms("");
  };
  return (
    <div className="flex items-center gap-2">
      <input
        className="flex-1 rounded-md border border-dashed px-3 py-1.5 text-sm bg-background"
        aria-label={bg ? "Добави дума за търсене" : "Add a search term"}
        value={terms}
        onChange={(e) => setTerms(e.target.value)}
        placeholder={
          bg ? "+ добави дума за търсене…" : "+ add another search term…"
        }
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
      />
      <button
        type="button"
        onClick={submit}
        disabled={!terms.trim()}
        className="shrink-0 rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-40"
      >
        {bg ? "Добави" : "Add"}
      </button>
    </div>
  );
};

const numOrUndef = (v: string): number | undefined => {
  const t = v.trim();
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

// The funding tri-state ↔ select-option mapping, one definition for read + write so
// the "all → undefined" (not false) rule can't drift between the two sides.
type EuOption = "all" | "eu" | "nat";
const euFundedToOption = (v: boolean | undefined): EuOption =>
  v === true ? "eu" : v === false ? "nat" : "all";
const optionToEuFunded = (o: string): boolean | undefined =>
  o === "eu" ? true : o === "nat" ? false : undefined;

/** The membership-narrowing controls — cpv division(s), date window, €-window and
 *  eu-funded. Controlled from `value`; each edit calls the matching granular
 *  callback (the host applies the pure with* transform). Deliberately plain inputs
 *  (a comma-separated CPV box, native date/number fields) so the editor carries no
 *  facet-fetch dependency; the contracts page pairs the same model with its richer
 *  CpvFilterCombobox. */
export const NarrowingControls: FC<{
  value: MembershipNarrowing;
  bg: boolean;
  onCpvIn: (cpvIn: string[]) => void;
  onDateRange: (from: string | undefined, to: string | undefined) => void;
  onAmountRange: (min: number | undefined, max: number | undefined) => void;
  onEuFunded: (v: boolean | undefined) => void;
}> = ({ value, bg, onCpvIn, onDateRange, onAmountRange, onEuFunded }) => {
  // Local CPV text state so a partial edit ("45,") isn't fought by the parsed value.
  // Depend on the JOINED string, not the array: the host recreates `value.cpvIn` by
  // reference on every mutateSpec (JSON.parse), so keying the re-sync on the array
  // would clobber an in-progress edit whenever another narrowing field changes.
  const cpvJoined = (value.cpvIn ?? []).join(", ");
  const [cpvText, setCpvText] = useState(cpvJoined);
  useEffect(() => setCpvText(cpvJoined), [cpvJoined]);
  const commitCpv = () => {
    const parsed = cpvText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    // Skip the redundant URL write when the value is unchanged (a no-op blur).
    if (parsed.join(", ") !== cpvJoined) onCpvIn(parsed);
  };
  const euValue = euFundedToOption(value.euFunded);
  const label = "text-[11px] font-medium text-muted-foreground";
  const input = "rounded-md border px-2 py-1 text-sm bg-background w-full";
  return (
    <details className="mt-3 border-t pt-3">
      <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
        {bg ? "Стесни (по избор)" : "Narrow (optional)"}
      </summary>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className={label}>
            {bg
              ? "ЦПВ раздел/код (напр. 45, 71) — разделени със запетая"
              : "CPV division/code (e.g. 45, 71) — comma-separated"}
          </span>
          <input
            className={input}
            value={cpvText}
            onChange={(e) => setCpvText(e.target.value)}
            onBlur={commitCpv}
            onKeyDown={(e) => e.key === "Enter" && commitCpv()}
            placeholder="45, 71"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={label}>{bg ? "От дата" : "From date"}</span>
          <input
            type="date"
            className={input}
            value={value.dateFrom ?? ""}
            onChange={(e) =>
              onDateRange(e.target.value || undefined, value.dateTo)
            }
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={label}>{bg ? "До дата" : "To date"}</span>
          <input
            type="date"
            className={input}
            value={value.dateTo ?? ""}
            onChange={(e) =>
              onDateRange(value.dateFrom, e.target.value || undefined)
            }
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={label}>
            {bg ? "Мин. стойност €" : "Min amount €"}
          </span>
          <input
            type="number"
            min={0}
            className={input}
            value={value.minAmountEur ?? ""}
            onChange={(e) =>
              onAmountRange(numOrUndef(e.target.value), value.maxAmountEur)
            }
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={label}>
            {bg ? "Макс. стойност €" : "Max amount €"}
          </span>
          <input
            type="number"
            min={0}
            className={input}
            value={value.maxAmountEur ?? ""}
            onChange={(e) =>
              onAmountRange(value.minAmountEur, numOrUndef(e.target.value))
            }
          />
        </label>
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className={label}>{bg ? "Финансиране" : "Funding"}</span>
          <select
            className={input}
            value={euValue}
            onChange={(e) => onEuFunded(optionToEuFunded(e.target.value))}
          >
            <option value="all">{bg ? "Всички" : "All"}</option>
            <option value="eu">
              {bg ? "Само с ЕС средства" : "EU-funded only"}
            </option>
            <option value="nat">
              {bg ? "Без ЕС средства" : "Non-EU-funded only"}
            </option>
          </select>
        </label>
      </div>
    </details>
  );
};

export interface ProcurementQueryFilterProps {
  /** Current query — its `search` drives the thread rows and its narrowing fields
   *  the controls. A full spec (extends ProcurementQuery) is fine; only these
   *  fields are read. */
  value: ProcurementQuery;
  bg: boolean;
  onThreadTerms: (i: number, terms: string) => void;
  onAddThread: (terms: string) => void;
  onRemoveThread: (i: number) => void;
  onThreadBuyer: (i: number, buyer: AwarderChoice | null) => void;
  onThreadContractor: (i: number, contractor: AwarderChoice | null) => void;
  onCpvIn: (cpvIn: string[]) => void;
  onDateRange: (from: string | undefined, to: string | undefined) => void;
  onAmountRange: (min: number | undefined, max: number | undefined) => void;
  onEuFunded: (v: boolean | undefined) => void;
}

/** The unioned recall-thread editor + the membership-narrowing section. The
 *  broader-match candidate list stays with the dossier screen (it is dossier
 *  state, not part of the reusable query editor). */
export const ProcurementQueryFilter: FC<ProcurementQueryFilterProps> = ({
  value,
  bg,
  onThreadTerms,
  onAddThread,
  onRemoveThread,
  onThreadBuyer,
  onThreadContractor,
  onCpvIn,
  onDateRange,
  onAmountRange,
  onEuFunded,
}) => (
  <div>
    <div className="text-xs font-medium text-muted-foreground mb-2">
      {bg ? "Думи за търсене (обединени)" : "Search terms (unioned)"}
    </div>
    <div className="flex flex-col gap-2">
      {value.search.map((th, i) => (
        <ThreadRow
          key={i}
          initial={th.terms ?? ""}
          index={i}
          removable={value.search.length > 1}
          buyer={
            th.buyerEik?.[0]
              ? { eik: th.buyerEik[0], name: th.buyerName ?? th.buyerEik[0] }
              : null
          }
          contractor={
            th.contractorEik?.[0]
              ? {
                  eik: th.contractorEik[0],
                  name: th.contractorName ?? th.contractorEik[0],
                }
              : null
          }
          onCommit={onThreadTerms}
          onBuyer={onThreadBuyer}
          onContractor={onThreadContractor}
          onRemove={onRemoveThread}
          bg={bg}
        />
      ))}
      <ThreadAdder onAdd={onAddThread} bg={bg} />
    </div>
    <div className="text-xs text-muted-foreground mt-2">
      {bg
        ? "Всеки ред е отделно търсене — резултатите се обединяват. Махни ред с ×."
        : "Each row is a separate search — results are unioned. Remove a row with ×."}
    </div>
    <NarrowingControls
      value={value}
      bg={bg}
      onCpvIn={onCpvIn}
      onDateRange={onDateRange}
      onAmountRange={onAmountRange}
      onEuFunded={onEuFunded}
    />
  </div>
);
