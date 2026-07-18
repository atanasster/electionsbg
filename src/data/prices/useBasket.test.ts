// The localStorage-backed "Моята кошница" store. No backend — the module-level
// store IS the source of truth, mirrored to localStorage and shared across tiles
// via useSyncExternalStore. Tests exercise the mutation/query API and the
// reactive useInBasket hook, resetting the store + localStorage between cases
// (the store is module-level singleton state).

import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  inBasket,
  addToBasket,
  removeFromBasket,
  toggleBasket,
  clearBasket,
  useInBasket,
} from "./useBasket";

const STORAGE_KEY = "naiasno.consumption.basket.v1";

const storedSlugs = (): string[] => {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw).map((i: { slug: string }) => i.slug) : [];
};

beforeEach(() => {
  clearBasket();
  localStorage.clear();
});

describe("basket store", () => {
  it("starts empty", () => {
    expect(inBasket("mliako")).toBe(false);
  });

  it("adds a product and reflects it in membership + storage", () => {
    addToBasket("mliako", "Прясно мляко");
    expect(inBasket("mliako")).toBe(true);
    expect(storedSlugs()).toEqual(["mliako"]);
  });

  it("never adds the same slug twice", () => {
    addToBasket("mliako", "Прясно мляко");
    addToBasket("mliako", "Прясно мляко (пак)");
    expect(storedSlugs()).toEqual(["mliako"]);
  });

  it("removes a product", () => {
    addToBasket("mliako", "Прясно мляко");
    addToBasket("hlyab", "Хляб");
    removeFromBasket("mliako");
    expect(inBasket("mliako")).toBe(false);
    expect(storedSlugs()).toEqual(["hlyab"]);
  });

  it("removing an absent slug is a no-op", () => {
    addToBasket("hlyab", "Хляб");
    removeFromBasket("nope");
    expect(storedSlugs()).toEqual(["hlyab"]);
  });

  it("toggles a product in then out", () => {
    toggleBasket("sirene", "Сирене");
    expect(inBasket("sirene")).toBe(true);
    toggleBasket("sirene", "Сирене");
    expect(inBasket("sirene")).toBe(false);
  });

  it("clears the whole basket", () => {
    addToBasket("a", "A");
    addToBasket("b", "B");
    clearBasket();
    expect(storedSlugs()).toEqual([]);
    expect(inBasket("a")).toBe(false);
  });
});

describe("useInBasket", () => {
  it("reports membership and toggles reactively", () => {
    const { result } = renderHook(() => useInBasket("yaytsa", "Яйца"));
    expect(result.current.inBasket).toBe(false);

    act(() => result.current.toggle());
    expect(result.current.inBasket).toBe(true);
    expect(inBasket("yaytsa")).toBe(true);

    act(() => result.current.toggle());
    expect(result.current.inBasket).toBe(false);
  });

  it("is inert (never throws, never adds) for an undefined slug", () => {
    const { result } = renderHook(() => useInBasket(undefined, "нищо"));
    expect(result.current.inBasket).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.inBasket).toBe(false);
    expect(storedSlugs()).toEqual([]);
  });

  it("reacts to an external add of the same slug", () => {
    const { result } = renderHook(() => useInBasket("kashkaval", "Кашкавал"));
    expect(result.current.inBasket).toBe(false);
    act(() => addToBasket("kashkaval", "Кашкавал"));
    expect(result.current.inBasket).toBe(true);
  });
});
