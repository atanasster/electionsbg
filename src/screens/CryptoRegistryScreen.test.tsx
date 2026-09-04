// Component guard for /declarations/crypto — the "Притежател" (holder) column.
//
// docs/plans/declaration-holder-self-fold-v1.md T0: the column must print the register's
// own holder text where there is one, not the bare neutral label that makes a false
// is_spouse flag an unqualified claim about a named public figure. HolderChip itself is
// covered in isolation (src/screens/person/HolderChip.test.tsx); this proves the screen
// actually wires it into the column DbDataTable renders.
//
// Hermetic: DbDataTable mocked to its props, columns captured and exercised directly.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { CryptoHoldingRow } from "@/data/persons/useCryptoRegistry";
import type { DataTableColumnDef } from "@/ux/data_table/utils";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: "bg" },
  }),
}));
vi.mock("react-router-dom", () => ({
  Link: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/ux/Title", () => ({
  Title: ({ children }: { children?: ReactNode }) => <h1>{children}</h1>,
}));
vi.mock("@/screens/components/DeclarationsBreadcrumb", () => ({
  DeclarationsBreadcrumb: () => null,
}));

let capturedColumns: DataTableColumnDef<CryptoHoldingRow, unknown>[] = [];
vi.mock("@/ux/data_table/DbDataTable", () => ({
  DbDataTable: (p: Record<string, unknown>) => {
    capturedColumns = p.columns as typeof capturedColumns;
    return <div data-testid="table" />;
  },
}));

import { CryptoRegistryScreen } from "./CryptoRegistryScreen";

const holderCell = (row: Partial<CryptoHoldingRow>) => {
  const col = capturedColumns.find((c) => c.id === "is_spouse");
  if (typeof col?.cell !== "function")
    throw new Error("is_spouse column has no cell renderer");
  return col.cell({ row: { original: row } } as never) as ReactNode;
};

describe("CryptoRegistryScreen — holder column", () => {
  it("renders the register's own holder text when is_spouse is true and holderName is set", () => {
    render(<CryptoRegistryScreen />);
    expect(screen.getByTestId("table")).toBeInTheDocument();
    render(
      <>
        {holderCell({ isSpouse: true, holderName: "Христо Пламенов Панаотов" })}
      </>,
    );
    expect(screen.getByText("Христо Пламенов Панаотов")).toBeInTheDocument();
    expect(screen.queryByText("pp_decl_holder_other")).not.toBeInTheDocument();
  });

  it("falls back to the neutral label when is_spouse is true but no holder name is given", () => {
    render(<CryptoRegistryScreen />);
    render(<>{holderCell({ isSpouse: true, holderName: null })}</>);
    expect(screen.getByText("pp_decl_holder_other")).toBeInTheDocument();
  });

  it("labels the declarant's own row, not 'other holder', when is_spouse is false", () => {
    render(<CryptoRegistryScreen />);
    render(<>{holderCell({ isSpouse: false, holderName: null })}</>);
    expect(screen.getByText("crypto_holder_self")).toBeInTheDocument();
  });
});
