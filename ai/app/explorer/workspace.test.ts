import { expect, it } from "vitest";
import {
  draftKey,
  toolIntent,
  emptyEnvelope,
  navigationPath,
  resultIsStale,
} from "./workspace";
import type { Envelope } from "../../tools/types";
it("binds visible chat settings to normalized arguments without stale examples", () => {
  expect(toolIntent("contractSearch", {}, "en")).toBeNull();
  const intent = toolIntent(
    "contractSearch",
    { company: "  Test Ltd  ", count: "12" },
    "en",
  )!;
  expect(intent.args).toEqual({ company: "Test Ltd", count: 12 });
  expect(intent.text).toContain("Test Ltd");
  expect(intent.text).toContain("12");
});
it("ignores field ordering and blank optional fields when comparing drafts", () => {
  expect(draftKey({ a: "one", b: "" })).toBe(
    draftKey({ b: undefined, a: "one" }),
  );
  expect(draftKey({ a: "one" })).not.toBe(draftKey({ a: "two" }));
});
it("distinguishes empty payloads from a scalar zero or clarification", () => {
  const env: Envelope = {
    tool: "test",
    kind: "scalar",
    title: "Test",
    facts: {},
    provenance: [],
    viz: "none",
  };
  expect(emptyEnvelope(env)).toBe(true);
  expect(emptyEnvelope({ ...env, value: 0 })).toBe(false);
  expect(
    emptyEnvelope({ ...env, clarify: { prompt: "Choose", options: [] } }),
  ).toBe(false);
});

it("preserves area when navigating to chat without carrying unrelated query text", () => {
  expect(navigationPath("chat", "?area=68134&tool=localDeals")).toBe(
    "/?area=68134",
  );
});
it("keeps a clarified old request stale against edited inputs", () => {
  const result = {
    tool: "municipalityResults",
    args: { place: "12345" },
    context: { lang: "en" as const, election: "2024_10_27" },
    requestedAt: "now",
    envelope: {} as Envelope,
    draftKey: draftKey({ place: "Banya" }),
  };
  expect(resultIsStale(result, { place: "Sofia" }, "en")).toBe(true);
  expect(resultIsStale(result, { place: "Banya" }, "en")).toBe(false);
});

it("marks an area-anchored result stale when the navigation anchor changes", () => {
  const result = {
    tool: "localDeals",
    args: {},
    context: { lang: "en" as const, election: "2024_10_27", area: "68134" },
    requestedAt: "now",
    envelope: {} as Envelope,
    draftKey: draftKey({}),
  };
  expect(resultIsStale(result, {}, "en", "68134")).toBe(false);
  expect(resultIsStale(result, {}, "en", "56784")).toBe(true);
  expect(resultIsStale(result, {}, "en")).toBe(true);
});
