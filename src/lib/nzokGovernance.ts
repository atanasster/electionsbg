// Who appoints a hospital's director — the governance-attribution layer for the
// НЗОК pack (Диагноза България surfaces this; we match it, more carefully). The
// appointing AUTHORITY is deterministic from ownership, so it needs no scrape and
// carries no accuracy risk: a state ЛЗ's director is appointed by the health
// minister (or the sponsoring minister for the few hospitals under another
// ministry — ВМА → отбрана, МИ → вътрешни работи), a municipal one's by the
// mayor / общински съвет.
//
// THE CAVEAT IS THE POINT. This attributes the APPOINTMENT (which office fills the
// post), NOT the party affiliation of the director and NOT a claim about who
// personally holds it now. Director NAMES + appointment dates are intentionally
// NOT shown here: there is no clean machine-readable source (the Commercial
// Register carries several undated "active" directors per hospital), and a wrong
// name on a public-money page is worse than none. That scrape is a separate task.

import type { NzokOwnership } from "@/data/budget/types";

// Hospitals whose sponsoring ministry is NOT Здравеопазване — the appointing
// authority is that ministry's head. Keyed by EIK.
const MINISTRY_OVERRIDE: Record<string, { bg: string; en: string }> = {
  "129000273": { bg: "Министър на отбраната", en: "Minister of Defence" }, // ВМА
  "129007218": {
    bg: "Министър на вътрешните работи",
    en: "Minister of the Interior",
  }, // Медицински институт – МВР
};

export interface AppointingAuthority {
  /** Short authority label. */
  authority: { bg: string; en: string };
  /** The one-line attribution caveat (appointment, not party). */
  caveat: { bg: string; en: string };
}

/** The office that appoints this hospital's director, from its ownership (+ the
 *  sponsoring-ministry override). Returns null when ownership is unknown, so the
 *  UI shows nothing rather than a guess. */
export const appointingAuthority = (
  ownership: NzokOwnership | null | undefined,
  eik?: string | null,
): AppointingAuthority | null => {
  if (eik && MINISTRY_OVERRIDE[eik])
    return {
      authority: MINISTRY_OVERRIDE[eik],
      caveat: APPOINTMENT_CAVEAT,
    };
  if (ownership === "state")
    return {
      authority: {
        bg: "Министър на здравеопазването",
        en: "Minister of Health",
      },
      caveat: APPOINTMENT_CAVEAT,
    };
  if (ownership === "municipal")
    return {
      authority: {
        bg: "Кмет / Общински съвет",
        en: "Mayor / municipal council",
      },
      caveat: APPOINTMENT_CAVEAT,
    };
  // Private hospitals answer to their owners/board — no public appointing office.
  if (ownership === "private")
    return {
      authority: {
        bg: "Собственик / съвет на директорите",
        en: "Owner / board of directors",
      },
      caveat: APPOINTMENT_CAVEAT,
    };
  return null;
};

const APPOINTMENT_CAVEAT = {
  bg: "Показва органа, който назначава директора по устройство — не партийната принадлежност на директора, нито кой заема поста в момента.",
  en: "Shows the office that appoints the director by statute — not the director's party affiliation, nor who personally holds the post now.",
};
