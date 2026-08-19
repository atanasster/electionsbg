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

/** ONE entry. It was nineteen.
 *
 *  All nineteen were ruled on 2026-08-19, in two passes on the same evidence:
 *  МК publishing a body on its own ДКИ pages is МК asserting principal, which is
 *  what this register was built to obtain. Eighteen moved into the roll-up as
 *  `DKI_CONFIRMED_INSTITUTES`; the sector headline went
 *  **€157,944,723 → €166,667,550 (+5.5%)** across the two passes.
 *
 *  | pass | what                                   | n  | €          |
 *  |------|----------------------------------------|----|------------|
 *  | 1    | the T0.2 regional theatres             |  9 | €7,485,705 |
 *  | 2    | in no list + the two T0.3 exclusions    |  9 | €1,237,121 |
 *  | —    | refused: Театър „Българска армия“       |  1 |   €903,834 |
 *
 *  They had to LEAVE this table rather than be marked `accepted`, because the
 *  gate's „no stale entry" arm is what stops it describing decisions already
 *  taken. The single survivor is `accepted` precisely because it is a standing
 *  decision rather than an open question.
 *
 *  ⚠️ The asymmetry is the point: eighteen moved because МК's claim was the ONLY
 *  claim, and one did not because a second claim exists in our own data. „МК
 *  lists it" is decisive against silence and merely suggestive against evidence. */
export const DKI_DISAGREEMENTS: readonly Disagreement[] = [
  {
    eik: "129009016",
    list: "adjacent",
    name: "Театър „Българска армия“",
    status: "accepted",
    note:
      "THE ONE THAT STAYS OUT, and the only one of the original nineteen with " +
      "independent counter-evidence. МК lists it as a ДКИ — but it also sits in " +
      "`MO_ENTITIES` (src/lib/defenseReferenceData.ts) under EIK 129009016, in " +
      "the 1290… block every other Ministry of Defence body occupies, and МО's " +
      "own roster carries it. Two ministries claim it and this repo cannot " +
      "settle which is right. `adjacent` is exactly the list for that: a real " +
      "cultural body whose principal is another ministry — shown, never denied. " +
      "Do not read the ДКИ listing alone as settling it; the EIK block is the " +
      "structural evidence on the other side.",
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
