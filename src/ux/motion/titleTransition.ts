// The shared-element title morph: a hub tile's title becomes the destination page's <h1>.
//
// ⚠️ THE APP USES THE DECLARATIVE <BrowserRouter>, WHICH IGNORES <Link viewTransition> — that
// prop only works under a data router. So this drives the transition itself: a plain click is
// taken over and the navigation runs inside `document.startViewTransition`.
//
// ⚠️ AND `flushSync` CANNOT COMMIT IT. React Router v7 dispatches navigations inside React's
// `startTransition`, so the update stays pending and the browser would snapshot the OLD page as
// the "new" one — measured: the only element named after the update was still the tile. The
// update callback therefore returns a promise that resolves once the clicked tile has LEFT the
// DOM, i.e. the new route has committed (capped, so a slow route cannot hold the page frozen).
//
// A view transition pairs elements by `view-transition-name`, and a name must be UNIQUE in
// each snapshot or the browser skips the whole transition. Every page has an <h1>, so naming
// <h1>s permanently would put two `page-title`s in the OLD snapshot (the hub's own heading and
// the clicked tile). So the name is handed out for one navigation:
//   · the clicked tile's title gets it inline;
//   · every <h1> on the OLD page is opted out inline (inline beats the stylesheet);
//   · `:root[data-vt-title] h1` in index.css names the NEW page's <h1>, which is a fresh element
//     with no inline opt-out.
// The marker is cleared when the transition finishes so a later navigation is unaffected.
//
// A LAZY ROUTE IS COVERED BY THE SAME WAIT: React keeps the old page mounted while the chunk
// loads (that is what `startTransition` means), so the tile stays connected and the snapshot
// waits for the real page. Past the cap the browser snapshots whatever is on screen — at worst
// the title fades out with the root cross-fade and the page arrives without a morph.

export const VT_TITLE = "page-title";
const MARKER = "vtTitle";

/** How long the old page may stay frozen waiting for the new route to commit. */
const COMMIT_TIMEOUT_MS = 1500;

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => Promise<void> | void) => {
    finished: Promise<void>;
  };
};

/** Navigate, then resolve once `el` is gone from the document (the old page unmounted), or
 *  after the cap. With no element to watch, resolve on the next commit opportunity. */
export const untilDetached = (el: HTMLElement | null, navigate: () => void) =>
  new Promise<void>((resolve) => {
    navigate();
    if (!el) {
      setTimeout(resolve, 0);
      return;
    }
    const done = () => {
      observer.disconnect();
      clearTimeout(timer);
      resolve();
    };
    const observer = new MutationObserver(() => {
      if (!el.isConnected) done();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = setTimeout(done, COMMIT_TIMEOUT_MS);
    if (!el.isConnected) done();
  });

/** Whether this click would be a same-tab navigation — the only kind that transitions. */
const isPlainClick = (e: React.MouseEvent) =>
  !e.defaultPrevented &&
  e.button === 0 &&
  !e.metaKey &&
  !e.ctrlKey &&
  !e.shiftKey &&
  !e.altKey;

const reducedMotion = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** True while a transition is waiting on its route, so a second click cannot start another
 *  one whose cleanup races this one's marker. */
let inFlight = false;

/** Same pathname as the current page: the tile would stay mounted, and the wait would sit out
 *  its whole cap with the page frozen. */
const isSamePage = (href: string) =>
  new URL(href, window.location.href).pathname === window.location.pathname;

/** Call from the tile link's onClick. Takes the click over ONLY when it can run a view
 *  transition; otherwise it returns without touching the event and the link navigates as a
 *  plain link. Under reduced motion it never takes over — the instant navigation is the state
 *  change, with no travel. */
export const navigateWithTitleTransition = (
  e: React.MouseEvent,
  titleEl: HTMLElement | null,
  href: string,
  navigate: () => void,
): void => {
  if (typeof document === "undefined") return;
  const doc = document as ViewTransitionDocument;
  if (!doc.startViewTransition || !isPlainClick(e) || reducedMotion()) return;
  if (inFlight || isSamePage(href)) return;
  e.preventDefault();
  inFlight = true;

  const oldHeadings = [...document.querySelectorAll<HTMLElement>("h1")];
  for (const h of oldHeadings)
    h.style.setProperty("view-transition-name", "none");
  titleEl?.style.setProperty("view-transition-name", VT_TITLE);
  const root = document.documentElement;
  root.dataset[MARKER] = "";

  const transition = doc.startViewTransition(() =>
    untilDetached(titleEl, navigate),
  );
  const clear = () => {
    inFlight = false;
    delete root.dataset[MARKER];
    titleEl?.style.removeProperty("view-transition-name");
    for (const h of oldHeadings) h.style.removeProperty("view-transition-name");
  };
  transition.finished.then(clear, clear);
};
