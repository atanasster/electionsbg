import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi, beforeEach } from "vitest";
import { encodeFundingQuery, validateFundingQuery } from "@/lib/fundingQuery";
const run = vi.hoisted(() => vi.fn());
vi.mock("../../../ai/tools/funding", () => ({
  fundingQuery: run,
  fundingScope: () => "scope",
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" } }),
}));
import { FundingQueryScreen } from "./FundingQueryScreen";
const query = validateFundingQuery({
  corpus: "isunProjects",
  operation: "rank",
  groupBy: "entity",
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
  funding: {
    query: q,
    result: {
      status: "success",
      revision,
      rows: [{ key: "raw1" }, { key: "raw2" }],
    },
  },
});
const mount = (requested = q) =>
  render(
    <MemoryRouter
      initialEntries={[
        "/funding/query?" +
          new URLSearchParams({ query: encodeFundingQuery(requested) }),
      ]}
    >
      <FundingQueryScreen />
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
it("revision-aware next page rejects mixed snapshots and restarts explicitly", async () => {
  run
    .mockResolvedValueOnce(envelope("1"))
    .mockResolvedValueOnce({
      facts: { answer: "revision changed" },
      funding: { query: q, result: { status: "unavailable" } },
    })
    .mockResolvedValueOnce(envelope("2"));
  mount();
  await screen.findByText("Buyer 0");
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  await screen.findByRole("alert");
  expect(run.mock.calls[1][0].expectedRevision).toBe("1");
  fireEvent.click(
    screen.getByRole("button", { name: "Restart from current revision" }),
  );
  await waitFor(() => expect(run).toHaveBeenCalledTimes(3));
  expect(run.mock.calls[2][0].offset).toBe(0);
  expect(run.mock.calls[2][0].expectedRevision).toBeUndefined();
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
      funding: { query: q, result: { status: "unavailable" } },
    })
    .mockResolvedValueOnce(envelope());
  mount();
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByText("Buyer 0");
  expect(run).toHaveBeenCalledTimes(2);
});
it("explicit restart refreshes both child and embedded parent revision", async () => {
  const parent = validateFundingQuery({
    corpus: "interregOperations",
    expectedRevision: "old-parent",
  });
  if (!parent.ok) throw Error();
  const child = validateFundingQuery({
    corpus: "interregPartners",
    parentQuery: encodeFundingQuery(parent.query),
    relationship: "operationsToPartners",
    expectedRevision: "old-child",
  });
  if (!child.ok) throw Error();
  run
    .mockResolvedValueOnce({
      facts: { answer: "stale parent" },
      funding: { query: child.query, result: { status: "unavailable" } },
    })
    .mockResolvedValueOnce(envelope("new"));
  mount(child.query);
  await screen.findByRole("alert");
  fireEvent.click(
    screen.getByRole("button", { name: "Restart from current revision" }),
  );
  await screen.findByText("Buyer 0");
  expect(run).toHaveBeenCalledTimes(2);
  const next = run.mock.calls[1][0];
  expect(next.expectedRevision).toBeUndefined();
  expect(
    JSON.parse(decodeURIComponent(next.parentQuery)).expectedRevision,
  ).toBeUndefined();
});
