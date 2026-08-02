// DataTable — the global filter box is script-forgiving.
//
// WHAT THIS PINS. Every client-side table on the site holds Bulgarian text, and
// the filter box ran TanStack's `includesString` — a literal substring test — so
// a reader typing Latin ("iv", "da": shljokavica, the way Bulgarian is commonly
// typed on a Latin keyboard) got "Няма резултати" on a roster that plainly
// contains those people. The fix lives in the shared component, not per screen,
// so it gets a test here: a swap back to `includesString` still type-checks and
// still passes every other test in the repo.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect } from "vitest";
import { DataTable } from "./DataTable";

type Row = { name: string; company: string };

const rows: Row[] = [
  { name: "Иван Георгиев Иванов", company: "ИНФОРМАЦИОННО ОБСЛУЖВАНЕ" },
  { name: "Дарин Величков Матов", company: "БЪЛГАРСКИ ПОЩИ" },
  { name: "Alpha Research", company: "АЛФА РИСЪРЧ" },
];

const columns = [
  { accessorKey: "name", header: "name" },
  { accessorKey: "company", header: "company" },
];

const renderTable = () => render(<DataTable columns={columns} data={rows} />);

// The box debounces at 200ms before the filter is applied.
const typeFilter = async (text: string) => {
  const user = userEvent.setup();
  await user.type(screen.getByRole("searchbox"), text);
};

describe("DataTable global filter", () => {
  it("matches Cyrillic rows from a Latin query", async () => {
    renderTable();
    await typeFilter("iv");
    await waitFor(() =>
      expect(screen.queryByText("Дарин Величков Матов")).toBeNull(),
    );
    expect(screen.getByText("Иван Георгиев Иванов")).toBeInTheDocument();
  });

  it("matches a Latin query against a Cyrillic company name", async () => {
    renderTable();
    await typeFilter("poshti");
    await waitFor(() =>
      expect(screen.queryByText("Иван Георгиев Иванов")).toBeNull(),
    );
    expect(screen.getByText("Дарин Величков Матов")).toBeInTheDocument();
  });

  it("keeps working for plain Cyrillic and plain Latin queries", async () => {
    const { unmount } = renderTable();
    await typeFilter("Величков");
    await waitFor(() =>
      expect(screen.queryByText("Иван Георгиев Иванов")).toBeNull(),
    );
    expect(screen.getByText("Дарин Величков Матов")).toBeInTheDocument();
    unmount();

    renderTable();
    await typeFilter("research");
    await waitFor(() =>
      expect(screen.queryByText("Дарин Величков Матов")).toBeNull(),
    );
    expect(screen.getByText("Alpha Research")).toBeInTheDocument();
  });

  it("shows the empty state for a genuine non-match", async () => {
    renderTable();
    await typeFilter("zzzz");
    await waitFor(() =>
      expect(screen.queryByText("Иван Георгиев Иванов")).toBeNull(),
    );
    expect(screen.queryByText("Alpha Research")).toBeNull();
  });
});
