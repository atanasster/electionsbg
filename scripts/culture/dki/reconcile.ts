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

/** WHAT RULING ON THESE COSTS, measured 2026-08-19 against `contracts`
 *  (`tag='contract'`). The roll-up was 881 contracts / €157,944,723 before the
 *  T0.2 ruling and €165,430,428 after it.
 *
 *  | bucket     | EIKs | €          | share of the roll-up |
 *  |------------|------|------------|----------------------|
 *  | ~~verify~~ |    9 | €7,485,705 | RULED IN 2026-08-19  |
 *  | `none`     |    7 |   €850,351 |                 0.5% |
 *  | `adjacent` |    1 |   €903,834 |                 0.5% |
 *  | `excluded` |    2 |   €386,770 |                 0.2% |
 *  | remaining  |   10 | €2,140,955 |                +1.3% |
 *
 *  So the expensive question is answered and the rest is a +1.3% tail. The two
 *  T0.3 contradictions are 0.2% of it, which means that one can be settled on
 *  the evidence rather than on its consequence — and of the seven unlisted,
 *  НМУ „Любомир Пипков" — София (000669774, €507k) is the single largest and
 *  looks most like an oversight, being an art school of the kind already in
 *  ART_SCHOOLS.
 *
 *  Measured 2026-08-19 against the register as МК publishes it today.
 *
 *  TEN entries. It was nineteen: the nine `verify` rows were T0.2, the register
 *  ANSWERED it, and on 2026-08-19 they were RULED into the roll-up — see
 *  `DKI_CONFIRMED_THEATRE_EIKS` in src/lib/kulturaReferenceData.ts. They had to
 *  LEAVE this table rather than be marked `accepted`, because the gate's „no
 *  stale entry" arm is what stops it describing decisions already taken.
 *
 *  What remains is the harder half, and the two groups are not the same problem:
 *
 *  - the two `excluded` rows are T0.3 and are a genuine CONTRADICTION: the
 *    allowlist's recorded reasoning for Сфумато says it „appears in no МК ДКИ
 *    listing", and it is the second entry on МК's театър page.
 *  - the seven `none` rows are bodies no list has ever carried. The corpus sweep
 *    could not find some of them (a body with no ЗОП procurement is invisible to
 *    it), which is exactly the blind spot this register exists to cover. */
export const DKI_DISAGREEMENTS: readonly Disagreement[] = [
  // ---- T0.2 — RULED 2026-08-19, and these nine are GONE from this table ----
  // МК lists all nine on its own ДКИ pages, so they moved into the roll-up as
  // `DKI_CONFIRMED_THEATRE_EIKS` (src/lib/kulturaReferenceData.ts). That is what
  // this register was built to settle, and it moved the sector headline +4.7%.
  // The „no stale entry" arm of the gate is why they had to leave this list
  // rather than being marked `accepted`: a table that keeps describing decisions
  // already taken stops describing the code.

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
