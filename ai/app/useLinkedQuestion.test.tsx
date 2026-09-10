import { StrictMode } from "react";
import { renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useLinkedQuestion } from "./useLinkedQuestion";

it("runs an entry question once under StrictMode and responds to SPA changes", () => {
  const send = vi.fn(async () => {});
  const { rerender } = renderHook(
    ({ search, busy }) => useLinkedQuestion(search, busy, send),
    {
      initialProps: { search: "?q=First", busy: false },
      wrapper: StrictMode,
    },
  );
  expect(send.mock.calls).toEqual([["First"]]);
  rerender({ search: "?q=First&area=68134", busy: false });
  expect(send).toHaveBeenCalledTimes(1);
  rerender({ search: "?q=Second", busy: true });
  expect(send).toHaveBeenCalledTimes(1);
  rerender({ search: "?q=Third", busy: false });
  expect(send.mock.calls).toEqual([["First"], ["Third"]]);
  rerender({ search: "", busy: false });
  rerender({ search: "?q=First", busy: false });
  expect(send.mock.calls.at(-1)).toEqual(["First"]);
});
