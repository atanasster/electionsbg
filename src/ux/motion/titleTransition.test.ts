import { afterEach, describe, expect, it, vi } from "vitest";
import {
  navigateWithTitleTransition,
  untilDetached,
  VT_TITLE,
} from "./titleTransition";

const click = (over: Partial<React.MouseEvent> = {}) => {
  const e = {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
    preventDefault: vi.fn(),
    ...over,
  };
  return e as unknown as React.MouseEvent & { preventDefault: typeof vi.fn };
};

type Doc = { startViewTransition?: unknown };

const setup = () => {
  document.body.innerHTML = `<h1 id="old">Hub</h1><a><span id="title">Tile</span></a>`;
  return {
    h1: document.getElementById("old")!,
    title: document.getElementById("title")!,
  };
};

/** A fake API that runs the update and keeps its promise, with `finished` resolved on demand. */
const installApi = () => {
  let finish!: () => void;
  const api = {
    calls: 0,
    namedDuringUpdate: [] as string[],
    update: undefined as Promise<void> | void,
    finish: () => finish(),
  };
  (document as Doc).startViewTransition = (
    update: () => Promise<void> | void,
  ) => {
    api.calls++;
    api.update = update();
    api.namedDuringUpdate = [
      ...document.querySelectorAll<HTMLElement>("[style]"),
    ]
      .filter(
        (el) => el.style.getPropertyValue("view-transition-name") === VT_TITLE,
      )
      .map((el) => el.id);
    return { finished: new Promise<void>((r) => (finish = r)) };
  };
  return api;
};

const setReducedMotion = (reduce: boolean) => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduce && query.includes("reduce"),
  })) as unknown as typeof window.matchMedia;
};

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("navigateWithTitleTransition", () => {
  afterEach(() => {
    delete (document as Doc).startViewTransition;
    delete document.documentElement.dataset.vtTitle;
    vi.useRealTimers();
  });

  it("takes the click over and navigates inside the transition, the title named", async () => {
    setReducedMotion(false);
    const api = installApi();
    const { h1, title } = setup();
    const navigate = vi.fn();
    const e = click();
    navigateWithTitleTransition(e, title, "/elsewhere", navigate);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledOnce();
    expect(api.namedDuringUpdate).toEqual(["title"]);
    expect(h1.style.getPropertyValue("view-transition-name")).toBe("none");
    expect(document.documentElement.dataset.vtTitle).toBe("");
    api.finish();
    await flush();
  });

  it("clears every name it handed out, and the marker, when the transition finishes", async () => {
    setReducedMotion(false);
    const api = installApi();
    const { h1, title } = setup();
    navigateWithTitleTransition(click(), title, "/elsewhere", vi.fn());
    api.finish();
    await flush();
    expect(document.documentElement.dataset.vtTitle).toBeUndefined();
    expect(title.style.getPropertyValue("view-transition-name")).toBe("");
    expect(h1.style.getPropertyValue("view-transition-name")).toBe("");
  });

  it("lets a second click through as a plain link while one is in flight", async () => {
    setReducedMotion(false);
    const api = installApi();
    const { title } = setup();
    navigateWithTitleTransition(click(), title, "/elsewhere", vi.fn());
    const second = click();
    const navigate = vi.fn();
    navigateWithTitleTransition(second, title, "/other", navigate);
    expect(second.preventDefault).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(api.calls).toBe(1);
    api.finish();
    await flush();
  });

  it("does not transition to the page it is already on", () => {
    setReducedMotion(false);
    const api = installApi();
    const { title } = setup();
    const e = click();
    navigateWithTitleTransition(
      e,
      title,
      `${window.location.pathname}?pscope=all`,
      vi.fn(),
    );
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(api.calls).toBe(0);
  });

  it("leaves the link alone without the API, on a modified click, and under reduced motion", () => {
    const { title } = setup();
    const navigate = vi.fn();

    setReducedMotion(false);
    const noApi = click();
    navigateWithTitleTransition(noApi, title, "/elsewhere", navigate);
    expect(noApi.preventDefault).not.toHaveBeenCalled();

    installApi();
    const modified = click({ metaKey: true });
    navigateWithTitleTransition(modified, title, "/elsewhere", navigate);
    expect(modified.preventDefault).not.toHaveBeenCalled();

    setReducedMotion(true);
    const reduced = click();
    navigateWithTitleTransition(reduced, title, "/elsewhere", navigate);
    expect(reduced.preventDefault).not.toHaveBeenCalled();

    expect(navigate).not.toHaveBeenCalled();
    expect(title.style.getPropertyValue("view-transition-name")).toBe("");
  });
});

describe("untilDetached", () => {
  afterEach(() => vi.useRealTimers());

  it("resolves when the watched element leaves the document — the new route committed", async () => {
    const { title } = setup();
    let resolved = false;
    void untilDetached(title, () => {}).then(() => (resolved = true));
    await flush();
    expect(resolved).toBe(false);
    title.remove();
    await new Promise((r) => setTimeout(r, 0)); // let the MutationObserver deliver
    await flush();
    expect(resolved).toBe(true);
  });

  it("resolves at the cap when the element never leaves", async () => {
    vi.useFakeTimers();
    const { title } = setup();
    let resolved = false;
    void untilDetached(title, () => {}).then(() => (resolved = true));
    await vi.advanceTimersByTimeAsync(1499);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(resolved).toBe(true);
  });

  it("navigates first, and resolves on the next tick with nothing to watch", async () => {
    vi.useFakeTimers();
    const navigate = vi.fn();
    let resolved = false;
    void untilDetached(null, navigate).then(() => (resolved = true));
    expect(navigate).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(true);
  });
});
