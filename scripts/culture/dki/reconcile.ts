// Register ↔ allowlist reconciliation (plan T3.1).
//
// `src/lib/kulturaReferenceData.ts` classifies every culture EIK by PRINCIPAL,
// by hand. Its own header says principal „is still a human judgement, and T3.1
// (МК's ДКИ register) is what will make it verifiable". This is the verification
// — and it deliberately does NOT reclassify anything.
//
// ⚠️ WHY THE GATE PINS DISAGREEMENTS INSTEAD OF RESOLVING THEM. Moving a body
// between the four lists changes what every € on /culture means, and neither
// source is authoritative on its own: МК's page is МК stating its own remit
// (strong evidence, occasionally out of date), while the allowlist carries
// bodies the register never lists at all and encodes judgements the register
// cannot express. So a disagreement is DECLARED here with what we know, the gate
// fails on any disagreement that is not declared, and a human moves the EIK.
//
// This is the `LISTING_LABEL_EXCEPTIONS` / `HOLDING_FILTER_EXCEPTIONS` shape: a
// new conflict breaks a test until somebody decides, and a stale entry breaks it
// too.

import type { DkiRegister } from "./types";
import {
  ADJACENT_EIKS,
  CULTURE_GROUP_EIKS,
  EXCLUDED_EIKS,
  VERIFY_PRINCIPAL_EIKS,
} from "../../../src/lib/kulturaReferenceData";

/** The artifact, as the WRITER declares it. Declaring a second reader-side
 *  shape is what let the two drift until the gate needed an `as unknown as` to
 *  read its own file. */
export type DkiRegisterFile = DkiRegister;

/** Which of the four lists an EIK sits in, or `none`. */
export type ListName = "group" | "verify" | "adjacent" | "excluded" | "none";

const eiksOf = (x: unknown): string[] =>
  Array.isArray(x)
    ? x.map((v) =>
        typeof v === "string" ? v : String((v as { eik: string }).eik),
      )
    : Object.keys(x as object);

/** The four lists, built once. `listOf` used to rebuild all four Sets on every
 *  call, so a 49-entry reconciliation did ~200 walks over four fixed constants —
 *  and the „exactly one list" invariant had no single place to live. */
const LISTS = [
  ["group", new Set(eiksOf(CULTURE_GROUP_EIKS))],
  ["verify", new Set(eiksOf(VERIFY_PRINCIPAL_EIKS))],
  ["adjacent", new Set(eiksOf(ADJACENT_EIKS))],
  ["excluded", new Set(eiksOf(EXCLUDED_EIKS))],
] as const satisfies readonly (readonly [ListName, ReadonlySet<string>])[];

export const listOf = (eik: string): ListName =>
  LISTS.find(([, set]) => set.has(eik))?.[0] ?? "none";

/** A body МК lists as its own ДКИ that our allowlist does NOT have in the
 *  roll-up. Every one is a live question about the sector's headline money. */
export type Disagreement = {
  eik: string;
  /** Where our allowlist puts it today. */
  list: Exclude<ListName, "group">;
  /** МК's own name for it, for a reader checking the register page. */
  name: string;
  /** Why it has not been moved yet. `open` means nobody has ruled. */
  status: "open" | "accepted";
  note: string;
};

/** Measured 2026-08-19 against the register as МК publishes it today.
 *
 *  Nineteen entries, and the three groups are NOT the same kind of problem:
 *
 *  - the nine `verify` rows are T0.2, and the register ANSWERS it — МК lists
 *    each of them as its own ДКИ, which is the primary-source ruling the
 *    allowlist was waiting for. They are `open` only because moving them moves
 *    the sector's headline € and that is the user's call, not the ingest's.
 *  - the two `excluded` rows are T0.3 and are a genuine CONTRADICTION: the
 *    allowlist's recorded reasoning for Сфумато says it „appears in no МК ДКИ
 *    listing", and it is the second entry on МК's театър page.
 *  - the seven `none` rows are bodies no list has ever carried. The corpus sweep
 *    could not find some of them (a body with no ЗОП procurement is invisible to
 *    it), which is exactly the blind spot this register exists to cover. */
export const DKI_DISAGREEMENTS: readonly Disagreement[] = [
  // ---- T0.2: МК lists it; we had it as „principal unsettled" --------------
  {
    eik: "000124037",
    list: "verify",
    name: "Музикално-драматичен театър „Константин Кисимов“ — Велико Търново",
    status: "open",
    note: "МК lists it as its own ДКИ — the T0.2 ruling. Move to the roll-up.",
  },
  {
    eik: "000282756",
    list: "verify",
    name: "Драматичен театър — Ловеч",
    status: "open",
    note: "МК lists it as its own ДКИ — the T0.2 ruling. Move to the roll-up.",
  },
  {
    eik: "000867998",
    list: "verify",
    name: "Драматичен театър — Търговище",
    status: "open",
    note: "МК lists it as its own ДКИ — the T0.2 ruling. Move to the roll-up.",
  },
  {
    eik: "000014352",
    list: "verify",
    name: "Драматичен театър „Н. Й. Вапцаров“ — Благоевград",
    status: "open",
    note: "МК lists it as its own ДКИ — the T0.2 ruling. Move to the roll-up.",
  },
  {
    eik: "000455489",
    list: "verify",
    name: "Драматичен театър „Н. О. Масалитинов“ — Пловдив",
    status: "open",
    note: "МК lists it as its own ДКИ — the T0.2 ruling. Move to the roll-up.",
  },
  {
    eik: "000522703",
    list: "verify",
    name: "Драматичен театър „Сава Огнянов“ — Русе",
    status: "open",
    note: "МК lists it as its own ДКИ — the T0.2 ruling. Move to the roll-up.",
  },
  {
    eik: "112582278",
    list: "verify",
    name: "Драматично-куклен театър „Константин Величков“ — Пазарджик",
    status: "open",
    note: "МК lists it as its own ДКИ — the T0.2 ruling. Move to the roll-up.",
  },
  {
    eik: "126004416",
    list: "verify",
    name: "Драматично-куклен театър „Иван Димов“ — Хасково",
    status: "open",
    note: "МК lists it as its own ДКИ — the T0.2 ruling. Move to the roll-up.",
  },
  {
    eik: "000403802",
    list: "verify",
    name: "Драматично-куклен театър „Иван Радоев“ — Плевен",
    status: "open",
    note: "МК lists it as its own ДКИ — the T0.2 ruling. Move to the roll-up.",
  },

  // ---- T0.3: МК lists it; we excluded it ----------------------------------
  {
    eik: "831381016",
    list: "excluded",
    name: "Театрална работилница „Сфумато“",
    status: "open",
    note:
      "CONTRADICTS the recorded reason for excluding it („appears in no МК ДКИ " +
      "listing“). It is the SECOND entry on МК's own театър page. T0.3 was " +
      "decided on the reading that put a municipal theatre out of a state " +
      "roll-up; that reading now has evidence against it.",
  },
  {
    eik: "000674508",
    list: "excluded",
    name: "Национална гимназия за древни езици и култури „Константин-Кирил Философ“",
    status: "open",
    note:
      "МК lists it among the училища по изкуствата. Widely understood to be a " +
      "МОН school, so this is the case where the register may be the stale side. " +
      "Needs a primary check before either list moves.",
  },

  // ---- МК lists it; we have it as another ministry's ----------------------
  {
    eik: "129009016",
    list: "adjacent",
    name: "Театър „Българска армия“",
    status: "open",
    note:
      "Classified `mo` (Министерство на отбраната) and listed by МК as a ДКИ. " +
      "One of the two is out of date. `adjacent` is the safe place to sit while " +
      "that is checked — it is shown, not denied.",
  },

  // ---- in NO list of ours ------------------------------------------------
  {
    eik: "000669802",
    list: "none",
    name: "Национална професионална гимназия по полиграфия и фотография",
    status: "open",
    note: "In no list. An art school the corpus sweep never surfaced.",
  },
  {
    eik: "000669774",
    list: "none",
    name: "Национално музикално училище „Любомир Пипков“ — София",
    status: "open",
    note: "In no list. NOT the same body as НУИ „Панайот Пипков“ — Плевен (000403460), which IS in ART_SCHOOLS — two schools, two Пипкови, one easy conflation.",
  },
  {
    eik: "000153836",
    list: "none",
    name: "Симфониета — Видин",
    status: "open",
    note: "In no list. МК-listed ДКИ with procurement in the corpus.",
  },
  {
    eik: "000185307",
    list: "none",
    name: "Симфониета — Враца",
    status: "open",
    note: "In no list. МК-listed ДКИ with procurement in the corpus.",
  },
  {
    eik: "000210326",
    list: "none",
    name: "Драматичен театър „Рачо Стоянов“ — Габрово",
    status: "open",
    note: "In no list. МК-listed ДКИ with procurement in the corpus.",
  },
  {
    eik: "127508351",
    list: "none",
    name: "Драматично-куклен театър „Васил Друмев“ — Шумен",
    status: "open",
    note: "In no list. МК-listed ДКИ with procurement in the corpus.",
  },
  {
    eik: "000608604",
    list: "none",
    name: "Родопски драматичен театър „Николай Хайтов“ — Смолян",
    status: "open",
    note: "In no list. МК-listed ДКИ with procurement in the corpus.",
  },
] as const;

/** Every resolved institute whose EIK is not in the roll-up. */
export const disagreementsIn = (
  reg: DkiRegisterFile,
): { eik: string; name: string; list: ListName }[] =>
  reg.institutes
    .filter((i) => i.eik)
    .map((i) => ({
      eik: i.eik as string,
      name: i.name,
      list: listOf(i.eik as string),
    }))
    .filter((d) => d.list !== "group");
