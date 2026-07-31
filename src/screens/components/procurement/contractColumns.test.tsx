// Fetch-free unit test for the shared contracts column factory. The whole point of
// contractColumns.tsx is "three browsers must not drift", and nothing enforced that but
// review — so this pins the properties a future edit would silently break:
//
//   - `show` decides which columns exist AND their order (a screen's layout);
//   - per-column sortability, which is a CONTRACT with the server: buildOrder drops an
//     ORDER BY for an id the registry does not know, so a column that looks sortable and
//     silently does nothing is the exact trap the risk column's comment documents;
//   - the signed-vs-published date semantics, the one genuine behavioural difference
//     between the entity screens and the global browser;
//   - the memo, since DbDataTable feeds `columns` straight into useReactTable.

import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import type { ProcurementContract } from "@/data/dataTypes";
import { useContractColumns, type ContractColumnId } from "./contractColumns";

const wrapper = ({ children }: { children: ReactNode }) => (
  <MemoryRouter>{children}</MemoryRouter>
);

const setup = (opts: Parameters<typeof useContractColumns>[0]) =>
  renderHook(() => useContractColumns(opts), { wrapper });

const idsOf = (cols: { id?: string }[]) => cols.map((c) => c.id);

const ALL: ContractColumnId[] = [
  "date",
  "awarder_name",
  "contractor_name",
  "title",
  "amount_eur",
  "procedure",
  "number_of_tenderers",
  "consortium_full_eur",
  "risk_cri",
  "source",
];

describe("useContractColumns", () => {
  it("returns exactly the requested columns, in the requested order", () => {
    const { result } = setup({
      show: ["risk_cri", "date", "amount_eur"],
      ngoByEik: null,
    });
    expect(idsOf(result.current)).toEqual(["risk_cri", "date", "amount_eur"]);
  });

  it("can produce every declared column id", () => {
    // Guards the Record<ContractColumnId, Col> from losing an entry: a missing key would
    // hand DbDataTable an `undefined` column and blank the table.
    const { result } = setup({ show: ALL, ngoByEik: null });
    expect(idsOf(result.current)).toEqual(ALL);
    expect(result.current.every(Boolean)).toBe(true);
  });

  it("locks which columns the header may sort", () => {
    // These four must never become sortable: `title` and `procedure` have no usable
    // server ordering, `consortium_full_eur` would distort against the real amount, and
    // `source` is a computed link. amount_eur/date carry no flag → sortable by default.
    const { result } = setup({
      show: [
        "title",
        "procedure",
        "consortium_full_eur",
        "source",
        "amount_eur",
        "date",
      ],
      ngoByEik: null,
    });
    expect(result.current.map((c) => c.enableSorting)).toEqual([
      false,
      false,
      false,
      false,
      undefined,
      undefined,
    ]);
  });

  it("sortableNames gates the two name columns and nothing else", () => {
    const off = setup({
      show: ["awarder_name", "contractor_name", "amount_eur"],
      ngoByEik: null,
    });
    expect(off.result.current.map((c) => c.enableSorting)).toEqual([
      false,
      false,
      undefined,
    ]);

    const on = setup({
      show: ["awarder_name", "contractor_name", "amount_eur"],
      ngoByEik: null,
      sortableNames: true,
    });
    expect(on.result.current.map((c) => c.enableSorting)).toEqual([
      true,
      true,
      undefined,
    ]);
  });

  it("dateMode 'signed' reads dateSigned ?? date and is not sortable", () => {
    // date_signed is unindexed, so ordering stays on `date` via defaultSort — a
    // resortable header here would order by a column the user cannot see.
    const { result } = setup({
      show: ["date"],
      ngoByEik: null,
      dateMode: "signed",
    });
    const col = result.current[0];
    expect(col.enableSorting).toBe(false);
    const accessor = (
      col as { accessorFn?: (r: ProcurementContract) => unknown }
    ).accessorFn as (r: ProcurementContract) => unknown;
    expect(
      accessor({ dateSigned: "2024-03-04", date: "2024-01-02" } as never),
    ).toBe("2024-03-04");
    expect(accessor({ date: "2024-01-02" } as never)).toBe("2024-01-02");
  });

  it("dateMode 'published' reads `date` and stays sortable", () => {
    const { result } = setup({ show: ["date"], ngoByEik: null });
    const col = result.current[0];
    expect(col.enableSorting).toBeUndefined();
    const accessor = (
      col as { accessorFn?: (r: ProcurementContract) => unknown }
    ).accessorFn as (r: ProcurementContract) => unknown;
    expect(
      accessor({ dateSigned: "2024-03-04", date: "2024-01-02" } as never),
    ).toBe("2024-01-02");
  });

  it("keeps the risk column's id on the registry column, not a display name", () => {
    // buildOrder silently drops an ORDER BY for an id it does not recognise, so renaming
    // this to "risk" would leave a header that looks sortable and does nothing.
    const { result } = setup({ show: ["risk_cri"], ngoByEik: null });
    expect(result.current[0].id).toBe("risk_cri");
  });

  it("does not rebuild the array when re-rendered with an equal `show` literal", () => {
    // Callers pass an inline array, so a memo keyed on identity would rebuild the whole
    // column model on every keystroke in the search box.
    const { result, rerender } = renderHook(
      () => useContractColumns({ show: ["date", "title"], ngoByEik: null }),
      { wrapper },
    );
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
