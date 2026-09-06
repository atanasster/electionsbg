// `fetchTickets`'s guard, and the reason a ticket may reach the map with no colour.
//
// ⚠ THE GUARD IS WHAT KEEPS A BAD BODY OFF A MAP. Nothing downstream re-checks: the choropleth
// reads `ticket.color` and `ticket.president` straight onto a fill and an accessible label, so
// a 404 body or an HTML error page reaching it would either throw in the render — which, with
// no error boundary in `src/`, unmounts the React root — or paint 31 regions in `undefined`.

import { describe, expect, it } from "vitest";
import { fetchTickets, ticketsPath } from "./useTickets";

const respond = (body: unknown, status = 200) => {
  globalThis.fetch = (async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
    })) as typeof fetch;
};

describe("fetchTickets", () => {
  it("returns the tickets from a good body", async () => {
    respond({
      cycle: "c",
      tickets: [{ number: 1, president: "П", vicePresident: "В" }],
    });
    expect((await fetchTickets(ticketsPath("c")))?.[0].number).toBe(1);
  });

  it("refuses a body whose leaves the map dereferences are missing", async () => {
    // ⚠ THE LEAVES, NOT THE CONTAINER. A `tickets` array of empty objects is still an array;
    // the map would then label a region „undefined води с 55%".
    for (const bad of [
      "<!doctype html>",
      {},
      { tickets: {} },
      { tickets: [{}] },
      { tickets: [{ number: 1 }] },
      { tickets: [{ president: "П" }] },
    ]) {
      respond(bad);
      expect(await fetchTickets("p"), JSON.stringify(bad)).toBeNull();
    }
  });

  it("returns null for a 404 and for a rejected fetch, not a throw", async () => {
    // A cycle whose tree is unpublished is the expected answer for most of this corpus.
    respond({}, 404);
    expect(await fetchTickets("p")).toBeNull();
    globalThis.fetch = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    expect(await fetchTickets("p")).toBeNull();
  });

  it("accepts a ticket with NO colour — the ingest could not always resolve one", async () => {
    // ⚠ The map draws it in its own neutral fill rather than borrowing another pair's colour.
    // Refusing the whole file over one uncoloured pair would lose 22 good ones with it.
    respond({
      cycle: "c",
      tickets: [{ number: 1, president: "П", vicePresident: "В" }],
    });
    const t = await fetchTickets("p");
    expect(t?.[0].color).toBeUndefined();
  });
});

describe("ticketsPath", () => {
  it("is the cycle's own file", () => {
    expect(ticketsPath("2021_11_14_pvr")).toBe("2021_11_14_pvr/tickets.json");
  });
});
