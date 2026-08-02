// DataTable — the global filter box is script-forgiving, and narrows to EXACTLY
// the matching rows.
//
// WHAT THIS PINS. Every client-side table on the site holds Bulgarian text, and
// the filter box ran TanStack's `includesString` — a literal substring test — so
// a reader typing Latin ("iv", "da": shljokavica, the way Bulgarian is commonly
// typed on a Latin keyboard) got "Няма резултати" on a roster that plainly
// contains those people. The fix lives in the shared component, not per screen,
// so it gets a test here: a swap back to `includesString` still type-checks and
// still passes every other test in the repo.
//
// Assertions count VISIBLE ROWS rather than asserting one row is present. The
// likelier future regression is the filter becoming too PERMISSIVE — a fold that
// collapses more letters, or a dropped empty-needle guard — and presence-only
// assertions cannot fail on that: the row you looked for is still there.

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

/** Names currently rendered — the row count, not "is my row there". */
const visibleNames = () =>
  rows.filter((r) => screen.queryByText(r.name) !== null).map((r) => r.name);

// The box debounces at 200ms before the filter is applied.
const typeFilter = async (text: string) => {
  const user = userEvent.setup();
  await user.type(screen.getByRole("searchbox"), text);
};

describe("DataTable global filter", () => {
  it("narrows to exactly the Cyrillic rows a Latin query matches", async () => {
    renderTable();
    await typeFilter("iv");
    await waitFor(() =>
      expect(visibleNames()).toEqual(["Иван Георгиев Иванов"]),
    );
  });

  it("matches a Latin query against a Cyrillic company name", async () => {
    renderTable();
    await typeFilter("poshti");
    await waitFor(() =>
      expect(visibleNames()).toEqual(["Дарин Величков Матов"]),
    );
  });

  it("keeps working for plain Cyrillic and plain Latin queries", async () => {
    const { unmount } = renderTable();
    await typeFilter("Величков");
    await waitFor(() =>
      expect(visibleNames()).toEqual(["Дарин Величков Матов"]),
    );
    unmount();

    renderTable();
    await typeFilter("research");
    await waitFor(() => expect(visibleNames()).toEqual(["Alpha Research"]));
  });

  it("shows the empty state for a genuine non-match", async () => {
    renderTable();
    await typeFilter("zzzz");
    await waitFor(() => expect(visibleNames()).toEqual([]));
  });

  it("restores every row when the box is cleared", async () => {
    renderTable();
    await typeFilter("zzzz");
    await waitFor(() => expect(visibleNames()).toEqual([]));
    await userEvent.setup().clear(screen.getByRole("searchbox"));
    await waitFor(() => expect(visibleNames()).toHaveLength(rows.length));
  });

  it("filters on a numeric column and tolerates a null cell", async () => {
    // Both paths are in the filter fn and neither is exercised above: the
    // `String(value)` coercion, and the `value == null` bail (a null cell must
    // be a non-match, not a crash).
    render(
      <DataTable
        columns={[...columns, { accessorKey: "total", header: "total" }]}
        data={[
          { ...rows[0], total: 1234 },
          { ...rows[1], total: null },
        ]}
      />,
    );
    await typeFilter("1234");
    await waitFor(() =>
      expect(screen.queryByText("Дарин Величков Матов")).toBeNull(),
    );
    expect(screen.getByText("Иван Георгиев Иванов")).toBeInTheDocument();
  });
});
