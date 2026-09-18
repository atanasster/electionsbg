// The shared seam both EvalsScreen suites mount the page through.
//
// ⚠️ THE NON-OBVIOUS CONSTRAINT, which is why this is worth sharing rather than
// writing twice: the page fetches SEVERAL artifacts and leaves its whole body
// unmounted if any of them rejects. So a test that stubs only the file it cares
// about renders an empty `<div />` and every assertion fails with a message
// about the element it was looking for, naming nothing about the real cause.
// Everything therefore comes off disk — the same committed files the deploy
// ships — and only the manifest is substituted.
//
// Reading the real artifacts is also the point of these suites: a hand-written
// fixture keeps passing after an artifact is renamed or a run is republished,
// which is exactly the drift the manifest exists to catch.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { render } from "@testing-library/react";
import { ChatNavigationContext } from "./navigation";
import { EvalsScreen } from "./EvalsScreen";

export const EVALS_INDEX_PATH = "data/ai/evals/index.json";

/** Serve the page's fetches from `data/`.
 *  - `manifest` (when the key is present) replaces `index.json`; omit the key
 *    entirely to serve the committed manifest.
 *  - `failPath` makes one path reject, for the degradation assertions. */
export const serveEvals =
  (opts: { manifest?: unknown; failPath?: string | null } = {}) =>
  async (path: string) => {
    if (opts.failPath && path.endsWith(opts.failPath))
      throw new Error(`no ${path}`);
    if ("manifest" in opts && path.endsWith("index.json")) return opts.manifest;
    const rel = path.startsWith("/") ? path.slice(1) : path;
    return JSON.parse(await readFile(join(process.cwd(), "data", rel), "utf8"));
  };

export const readEvalsIndex = async <T,>(): Promise<T> =>
  JSON.parse(await readFile(join(process.cwd(), EVALS_INDEX_PATH), "utf8"));

export const renderEvals = (lang: "bg" | "en" = "bg") =>
  render(
    <ChatNavigationContext.Provider
      value={{
        pathname: `${lang === "en" ? "/en" : ""}/chat/evals`,
        search: "",
        lang,
        navigate: () => {},
      }}
    >
      <EvalsScreen integrated />
    </ChatNavigationContext.Provider>,
  );
