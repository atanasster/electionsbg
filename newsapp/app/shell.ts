/**
 * The reading shell's content box, declared once for the app and for layout
 * fixtures so the two measure the same width.
 *
 * ⚠️ It deliberately does NOT restate a max-width: `news.css` sets
 * `.news-main { max-width: 84rem }`, and a second copy here would let the two
 * drift. A fixture that hard-coded `max-w-[84rem] px-3 sm:px-5` measured a
 * 1304px grid against this shell's 1312px — 2.67px per track, enough to wrap a
 * long Bulgarian headline one line earlier than the real page does.
 *
 * ⚠️ It lives in its own leaf module rather than in `App.tsx` on purpose. A
 * fixture importing it from `App` pulls the router, every screen and the
 * analytics tracker into a page that renders none of them; measured, that took
 * the fixture's first load past Playwright's 30 s navigation timeout.
 */
export const SHELL_MAIN = "news-main container flex-1 px-2 py-6 sm:px-4";
