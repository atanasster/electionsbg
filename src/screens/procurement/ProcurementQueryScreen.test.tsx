import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi, beforeEach } from "vitest";
import {
  encodeProcurementQuery,
  validateProcurementQuery,
} from "@/lib/procurementQuery";
const run = vi.hoisted(() => vi.fn());
vi.mock("../../../ai/tools/procurement", () => ({ procurementQuery: run }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" } }),
}));
import { ProcurementQueryScreen } from "./ProcurementQueryScreen";
const query = validateProcurementQuery({
  corpus: "contracts",
  operation: "rank",
  groupBy: "buyer",
  limit: 2,
});
if (!query.ok) throw Error();
const q = query.query;
const envelope = (revision = "1", length = 2) => ({
  title: "Buyers",
  subtitle: "scope",
  facts: { answer: "2" },
  columns: [{ key: "group_key", label: "Buyer" }],
  rows: Array.from({ length }, (_, i) => ({ group_key: "Buyer " + i })),
  procurement: {
    query: q,
    result: {
      status: "success",
      revision: { contracts: revision },
      rows: [{ key: "raw1" }, { key: "raw2" }],
    },
  },
});
const mount = () =>
  render(
    <MemoryRouter
      initialEntries={[
        "/procurement/query?" +
          new URLSearchParams({ query: encodeProcurementQuery(q) }),
      ]}
    >
      <ProcurementQueryScreen />
    </MemoryRouter>,
  );
beforeEach(() => run.mockReset());
it("does not page a short group collection using raw row count", async () => {
  run.mockResolvedValue(envelope("1", 1));
  mount();
  await screen.findByText("Buyer 0");
  expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  expect(run).toHaveBeenCalledTimes(1);
});
it("failed next page clears old rows and disables export until retry", async () => {
  run
    .mockResolvedValueOnce(envelope())
    .mockRejectedValueOnce(Error("offline"))
    .mockResolvedValueOnce(envelope());
  mount();
  await screen.findByText("Buyer 0");
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  await screen.findByRole("alert");
  expect(screen.queryByText("Buyer 0")).toBeNull();
  expect(
    screen.getByRole("button", { name: "Export this page (CSV)" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByText("Buyer 0");
  expect(run.mock.calls[2][0].offset).toBe(2);
});
it("revision change restarts at page zero without an extra initial request", async () => {
  run
    .mockResolvedValueOnce(envelope("1"))
    .mockResolvedValueOnce(envelope("2"))
    .mockResolvedValueOnce(envelope("2"));
  mount();
  await screen.findByText("Buyer 0");
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  await waitFor(() => expect(run).toHaveBeenCalledTimes(3));
  expect(run.mock.calls.map((c) => c[0].offset)).toEqual([0, 2, 0]);
});
it("empty group page does not fall back to raw rows", async () => {
  run.mockResolvedValueOnce(envelope()).mockResolvedValueOnce(envelope("1", 0));
  mount();
  await screen.findByText("Buyer 0");
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  await waitFor(() => expect(screen.queryByText("Buyer 0")).toBeNull());
  expect(screen.queryByText("raw1")).toBeNull();
  expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
});
it("resolved unavailable envelope offers retry", async () => {
  run
    .mockResolvedValueOnce({
      facts: { answer: "Unavailable" },
      procurement: { query: q, result: { status: "unavailable" } },
    })
    .mockResolvedValueOnce(envelope());
  mount();
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByText("Buyer 0");
  expect(run).toHaveBeenCalledTimes(2);
});
