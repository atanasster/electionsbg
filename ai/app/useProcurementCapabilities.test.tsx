import { renderHook, waitFor } from "@testing-library/react";
import { it, expect, vi } from "vitest";
const fetchDb = vi.hoisted(() => vi.fn());
vi.mock("../tools/dataClient", () => ({ fetchDb }));
import { useProcurementCapabilities } from "./useProcurementCapabilities";
import { QUESTION_CATALOG } from "../../src/lib/questions/catalog";
import { PROCUREMENT_QUERY_VERSION } from "../../src/lib/procurementQuery";
it("gates loading, missing and stale risk capabilities while preserving legacy questions", async () => {
  let resolve!: (value: unknown) => void;
  fetchDb.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const { result } = renderHook(() =>
    useProcurementCapabilities(QUESTION_CATALOG),
  );
  expect(
    result.current.questions.some((q) => q.id.startsWith("procurement-query-")),
  ).toBe(false);
  expect(
    result.current.questions.some((q) => q.id === "procurementTotals"),
  ).toBe(true);
  resolve({
    version: PROCUREMENT_QUERY_VERSION,
    corpora: {
      contracts: { ready: true, risks: [] },
      tenders: { ready: false, risks: [] },
    },
  });
  await waitFor(() =>
    expect(
      result.current.questions.some(
        (q) => q.id === "procurement-query-one-bid",
      ),
    ).toBe(true),
  );
  expect(
    result.current.questions.some(
      (q) => q.id === "procurement-query-risk-directAward",
    ),
  ).toBe(false);
  expect(
    result.current.questions.some((q) => q.id === "procurement-query-tenders"),
  ).toBe(false);
});
