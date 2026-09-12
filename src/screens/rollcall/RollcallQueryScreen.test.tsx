import { procurementPageCsv } from "@/lib/procurementExport";
vi.mock("@/lib/procurementExport", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/procurementExport")>();
  return { ...actual, procurementPageCsv: vi.fn(actual.procurementPageCsv) };
});
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { expect, it, vi, beforeEach } from "vitest";
import {
  encodeRollcallQuery,
  validateRollcallQuery,
} from "@/lib/rollcallQuery";
const run = vi.hoisted(() => vi.fn());
const locale = vi.hoisted(() => ({ language: "en" }));
vi.mock("../../../ai/tools/rollcall", () => ({
  rollcallQuery: run,
  rollcallMessage: (_reason: string, lang: string) =>
    lang === "bg" ? "Няма индексирани данни" : "No indexed data",
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: locale.language } }),
}));
import { RollcallQueryScreen } from "./RollcallQueryScreen";
const query = validateRollcallQuery({
  corpus: "parliamentVotes",
  operation: "rank",
  groupBy: "body",
  limit: 2,
});
if (!query.ok) throw Error();
const q = query.query;
const envelope = (revision = "1", length = 2) => ({
  title: "Assemblies",
  subtitle: "scope",
  facts: { answer: "2" },
  columns: [{ key: "group_key", label: "Assembly" }],
  rows: Array.from({ length }, (_, i) => ({ group_key: "Assembly " + i })),
  rollcall: {
    query: q,
    result: {
      status: "success",
      revision,
      rows: [{ key: "raw1" }, { key: "raw2" }],
      totals: { records: 3, cohortRecords: 3 },
      groupCount: length === 2 ? 3 : length,
    },
  },
});
const mount = (requested = q) =>
  render(
    <MemoryRouter
      initialEntries={[
        "/rollcall/query?" +
          new URLSearchParams({ query: encodeRollcallQuery(requested) }),
      ]}
    >
      <RollcallQueryScreen />
    </MemoryRouter>,
  );
beforeEach(() => {
  run.mockReset();
  locale.language = "en";
});
it("does not page a short group collection using raw row count", async () => {
  run.mockResolvedValue(envelope("1", 1));
  mount();
  await screen.findByText("Assembly 0");
  expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  expect(run).toHaveBeenCalledTimes(1);
});
it("failed next page clears old rows and disables export until retry", async () => {
  run
    .mockResolvedValueOnce(envelope())
    .mockRejectedValueOnce(Error("offline"))
    .mockResolvedValueOnce(envelope());
  mount();
  await screen.findByText("Assembly 0");
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  await screen.findByRole("alert");
  expect(screen.queryByText("Assembly 0")).toBeNull();
  expect(
    screen.getByRole("button", { name: "Export this page (CSV)" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByText("Assembly 0");
  expect(run.mock.calls[2][0].offset).toBe(2);
});
it("revision-aware next page rejects mixed snapshots and restarts explicitly", async () => {
  run
    .mockResolvedValueOnce(envelope("1"))
    .mockResolvedValueOnce({
      facts: { answer: "revision changed" },
      rollcall: { query: q, result: { status: "unavailable" } },
    })
    .mockResolvedValueOnce(envelope("2"));
  mount();
  await screen.findByText("Assembly 0");
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
  await screen.findByText("Assembly 0");
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  await waitFor(() => expect(screen.queryByText("Assembly 0")).toBeNull());
  expect(screen.queryByText("raw1")).toBeNull();
  expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
});
it("resolved unavailable envelope offers retry", async () => {
  run
    .mockResolvedValueOnce({
      facts: { answer: "Unavailable" },
      rollcall: { query: q, result: { status: "unavailable" } },
    })
    .mockResolvedValueOnce(envelope());
  mount();
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByText("Assembly 0");
  expect(run).toHaveBeenCalledTimes(2);
});
it("explicit restart refreshes both child and embedded parent revision", async () => {
  const parent = validateRollcallQuery({
    corpus: "parliamentVotes",
    expectedRevision: "old-parent",
  });
  if (!parent.ok) throw Error();
  const child = validateRollcallQuery({
    corpus: "parliamentCasts",
    parentQuery: encodeRollcallQuery(parent.query),
    relationship: "voteCasts",
    expectedRevision: "old-child",
  });
  if (!child.ok) throw Error();
  run
    .mockResolvedValueOnce({
      facts: { answer: "stale parent" },
      rollcall: { query: child.query, result: { status: "unavailable" } },
    })
    .mockResolvedValueOnce(envelope("new"));
  mount(child.query);
  await screen.findByRole("alert");
  fireEvent.click(
    screen.getByRole("button", { name: "Restart from current revision" }),
  );
  await screen.findByText("Assembly 0");
  expect(run).toHaveBeenCalledTimes(2);
  const next = run.mock.calls[1][0];
  expect(next.expectedRevision).toBeUndefined();
  expect(
    JSON.parse(decodeURIComponent(next.parentQuery)).expectedRevision,
  ).toBeUndefined();
});
it.each(["bg", "en"])(
  "comparison evidence is localized per window (%s)",
  async (lang) => {
    locale.language = lang;
    const e = envelope();
    e.rollcall.result = {
      ...e.rollcall.result,
      comparisons: [
        {
          query: q,
          status: "partial",
          totals: { records: 2 },
          metrics: { numerator: 1, denominator: 2, percentage: 50 },
          coverage: { missingRolls: 1 },
        },
        {
          query: q,
          status: "unavailable",
          reason: "scope_not_indexed",
          totals: { records: 0 },
          coverage: { missingRolls: 0 },
        },
      ],
    } as typeof e.rollcall.result;
    run.mockResolvedValue(e);
    mount();
    await screen.findByText(
      lang === "bg" ? "Няма индексирани данни" : "No indexed data",
    );
    expect(screen.getByText(/1 \/ 2/)).toBeInTheDocument();
    expect(screen.queryByText(/—%/)).toBeNull();
    expect(screen.queryByText(/ · partial/)).toBeNull();
  },
);
it("an older response cannot overwrite a newer URL scope", async () => {
  let finish!: (x: unknown) => void;
  run
    .mockImplementationOnce(() => new Promise((r) => (finish = r)))
    .mockResolvedValueOnce({ ...envelope(), title: "New scope" });
  let navigate!: (s: string) => void;
  function Control() {
    navigate = useNavigate();
    return null;
  }
  render(
    <MemoryRouter
      initialEntries={[
        "/rollcall/query?" +
          new URLSearchParams({ query: encodeRollcallQuery(q) }),
      ]}
    >
      <Control />
      <RollcallQueryScreen />
    </MemoryRouter>,
  );
  await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
  await act(async () =>
    navigate(
      "/rollcall/query?" +
        new URLSearchParams({
          query: encodeRollcallQuery({
            ...q,
            from: "2025-01-01",
            toExclusive: "2026-01-01",
          }),
        }),
    ),
  );
  await screen.findByText("New scope");
  await act(async () => finish({ ...envelope(), title: "OLD RESPONSE" }));
  expect(screen.queryByText("OLD RESPONSE")).toBeNull();
  expect(screen.getByText("New scope")).toBeInTheDocument();
});
it("exports only visible localized columns while retaining group labels", async () => {
  const e = envelope("r", 1);
  e.rows = [
    {
      group_key: "2026-01",
      key: "opaque-2022-01-01",
      session_key: "private-key",
    } as (typeof e.rows)[number],
  ];
  run.mockResolvedValue(e);
  mount();
  await screen.findByText("2026-01");
  const create = URL.createObjectURL,
    revoke = URL.revokeObjectURL;
  URL.createObjectURL = vi.fn(() => "blob:test");
  URL.revokeObjectURL = vi.fn();
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  try {
    fireEvent.click(
      screen.getByRole("button", { name: "Export this page (CSV)" }),
    );
    expect(vi.mocked(procurementPageCsv).mock.calls.at(-1)?.[0]).toEqual([
      { Assembly: "2026-01" },
    ]);
  } finally {
    URL.createObjectURL = create;
    URL.revokeObjectURL = revoke;
    click.mockRestore();
  }
});
