// A caller with no settlement passes "" (the presidential municipality map does), and the
// hook used to fetch `<election>/settlements/.json` on every such render — a 404 on each
// presidential municipality page view.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/data/ElectionContext", () => ({
  useElectionContext: () => ({ selected: "2026_04_19" }),
}));

import { useSettlementVotes } from "./useSettlementVotes";

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
  >
    {children}
  </QueryClientProvider>
);

describe("useSettlementVotes", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("does not fetch when no settlement is given", async () => {
    const { result } = renderHook(() => useSettlementVotes(""), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.settlement).toBeUndefined();
  });

  it("fetches the settlement file for a real ekatte", async () => {
    fetchMock.mockResolvedValue({ json: async () => ({ ekatte: "12499" }) });
    const { result } = renderHook(() => useSettlementVotes("12499"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.settlement).toBeDefined());
    expect(String(fetchMock.mock.calls[0][0])).toMatch(
      /\/2026_04_19\/settlements\/12499\.json$/,
    );
  });
});
