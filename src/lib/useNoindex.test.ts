// useNoindex must flip the document's robots meta to noindex while mounted and RESTORE the
// prior value on unmount — a personal route must not leave the whole SPA marked noindex after
// the reader navigates away.

import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useNoindex } from "./useNoindex";

beforeEach(() => {
  document.head.innerHTML = '<meta name="robots" content="index, follow" />';
});

const robots = () =>
  document.querySelector<HTMLMetaElement>('meta[name="robots"]')?.content;

describe("useNoindex", () => {
  it("sets noindex while mounted and restores on unmount", () => {
    const { unmount } = renderHook(() => useNoindex());
    expect(robots()).toBe("noindex, follow");
    unmount();
    expect(robots()).toBe("index, follow");
  });

  it("does nothing when inactive", () => {
    renderHook(() => useNoindex(false));
    expect(robots()).toBe("index, follow");
  });
});
