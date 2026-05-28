// Plovdiv (Община Пловдив) naredba parser — DEFERRED.
//
// Plovdiv publishes the FEES naredba behind an Angular SPA at
// plovdiv.obshtini.bg/doc/388893 (same platform as Sofia — Cloudflare-
// fronted backend requires a session login to release the PDF) and
// references it on plovdiv.bg/obs/действащи-актове/... but the canonical
// document page returns 403 to non-browser User-Agents. None of the
// candidate URLs surface a direct PDF download.
//
// This parser is wired to demonstrate the catalog seat but throws a
// "deferred" error so the dispatcher records the skip cleanly in the
// per-município watermark. Replace once we add a Playwright bridge for
// the obshtini.bg platform (would unblock Pl, Sofia TAX naredba, ~150
// other small municípios that use the same platform).

import type { NaredbaParser } from "../types";

export const pdvParser: NaredbaParser = {
  obshtina: "PDV22",
  label:
    "Община Пловдив — Наредба за местните такси (deferred — obshtini.bg SPA)",
  url: "https://plovdiv.obshtini.bg/doc/388893",
  documentType: "fees",

  async parse() {
    throw new Error(
      "PDV22 parser deferred — plovdiv.obshtini.bg is an Angular SPA that requires a session login to release the PDF; needs a Playwright bridge",
    );
  },
};
