// ИСУН „clean delivery" on /company/:eik — what the register publishes about this
// company's EU-funded contracts that ended with no financial correction (175).
//
// ⚠️ THIS TILE ONLY EVER RENDERS A POSITIVE. It is mounted only when the company
// HAS a row in one of the two registers, and it never draws a zero. That is not a
// styling choice — it is what keeps the dataset honest:
//
//   • PRESENCE is a real claim ИСУН makes: no correction was imposed.
//   • ABSENCE is not the opposite. A company can be missing because it finished
//     late, was terminated, is still in final verification, or holds no EU grant
//     at all. Individual irregularities go to OLAF's IMS, which is confidential —
//     there is no public „was corrected" list anywhere.
//
// So a „0 clean contracts" state would read as an accusation the source cannot
// support, against a named company. It is unreachable by construction: no row,
// no tile. The caveat still renders in words, because a reader who sees the tile
// on one company will wonder what its absence means on the next.
//
// ⚠️⚠️ THE TWO NUMBERS COME FROM TWO DIFFERENT REPORTS AND MUST NEVER BE STACKED
// BARE. This tile showed „4 договора, приключени в срок" over „2 проекта без
// наложена финансова корекция" until 2026-09-02, and a reader does the only
// arithmetic available: 4 − 2 = 2 were corrected. The register says the exact
// opposite — for a listed beneficiary it asserts NO correction at all. The gap is
// that „в срок" is a stricter and orthogonal test (a contract can be
// on-time-but-corrected or late-but-clean), so the difference is not a population
// of anything. 2,921 of the 32,420 listed beneficiaries render that shape. Hence:
// every figure names the list it comes from, the difference is disclaimed in
// words, and the clean contracts are LISTED — the evidence, instead of an
// invitation to subtract.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { BadgeCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatDate } from "@/lib/formatDate";

export interface CleanContractRow {
  contract_number: string;
  title: string | null;
  programme: string | null;
  procedure: string | null;
  signed_on: string | null;
  original_end_on: string | null;
  closed_on: string | null;
  duration_months: number | null;
}

export interface CleanDeliveryInfo {
  eik: string;
  name: string;
  /** „Брой договори, успешно приключени В СРОК" — on time, a stricter test than
   *  merely uncorrected, which is why it can exceed `clean_contracts`.
   *
   *  ⚠️ NULL — never 0 — when this EIK is in the CONTRACT register but not the
   *  beneficiary one (956 EIKs, 17.5% of the register). „Not listed as a
   *  correction-free beneficiary" and „listed with zero on-time contracts" are
   *  different claims and only the second is a number, so this must never be
   *  coalesced: on a register whose whole premise is that a zero is an
   *  accusation, `?? 0` publishes the first as the second. */
  on_time_contracts: number | null;
  /** Rows in the „Проекти без наложени финансови корекции" list for this EIK. */
  clean_contracts: number | string;
  programmes: string[] | null;
  /** Whether ИСУН lists the COMPANY itself among beneficiaries with no financial
   *  correction — the strongest claim the register makes about it, and the one
   *  `on_time_contracts` is only a count within. */
  beneficiary_listed?: boolean;
  /** The named clean contracts (175). Present so a surface can show the evidence
   *  rather than leave a reader to subtract two counts that measure different
   *  things. Bounded: the busiest EIK in the corpus holds 12. */
  contracts?: CleanContractRow[] | null;
  /** Server-supplied. The BG copy is rendered VERBATIM so the page and the
   *  database cannot drift on what absence means.
   *
   *  ⚠️ THE EN COPY IS A FROZEN MIRROR (`ABSENCE_MEANING_EN` below), not the
   *  server's text — `isun_clean_delivery_coverage` carries only Bulgarian. A
   *  revision to `absence_meaning` reaches BG readers automatically and EN
   *  readers never. Keep the mirror in step by hand, or add an
   *  `absence_meaning_en` column to 175 and drop the literal. Both branches are
   *  gated on THIS field on purpose: a missing coverage row must leave the
   *  number unbounded in both languages, rather than in one. */
  absence_meaning: string | null;
}

/** The mirror named in `absence_meaning`'s comment. Semantically paired with the
 *  register's own sentence; it is not derived from it and cannot track a change.
 *
 *  ⚠️ EXPORTED SO THERE IS ONE COPY, NOT FOUR. `CompanyFundsTile` renders the same
 *  caveat beside its clean-delivery marks; a second literal there would drift from
 *  this one and from the server's, on the same page about the same register. The
 *  BG side needs no export — that tile takes `isun_clean_delivery_coverage`'s own
 *  sentence, passed down from the company payload. */
export const ABSENCE_MEANING_EN =
  "Being absent from this register does not mean a financial correction was " +
  "imposed — a project may have finished late, been terminated, or still be " +
  "under verification. Individual irregularities are reported to OLAF's IMS " +
  "and are not public.";

export const CompanyCleanDeliveryTile: FC<{ info: CleanDeliveryInfo }> = ({
  info,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  // `startsWith`, not `=== "bg"`: `formatDate` below already folds `bg-BG` to
  // Bulgarian, so strict equality would render English copy beside Bulgarian
  // dates — and `CompanyFundsTile` renders this same caveat on the same page
  // under `startsWith`. Two spellings is two languages on one card.
  const bg = lang.startsWith("bg");
  const T = (b: string, e: string) => (bg ? b : e);

  // NOT coalesced: null means „this company is not in the beneficiary register",
  // which is a different statement from „it is, with zero on-time contracts".
  const onTime =
    info.on_time_contracts == null ? null : Number(info.on_time_contracts);
  const clean = Number(info.clean_contracts) || 0;
  // The ONE test for „there is an on-time figure worth publishing", used at all
  // three sites below. They must never disagree: a zero here is an accusation,
  // and three separately-spelled predicates is the „someone missed one" shape
  // this repo names a rule against everywhere else.
  const hasOnTime = onTime !== null && onTime > 0;

  // Nothing to say. A zero here must never render as a finding.
  // `beneficiary_listed` keeps the tile alive on its own: presence in the
  // register IS „no correction was imposed on this company", and the sentence it
  // renders carries no number, so it cannot reintroduce a zero.
  if (!hasOnTime && clean <= 0 && !info.beneficiary_listed) return null;

  const rows = (info.contracts ?? []).filter(Boolean);
  // The chips duplicate the per-row programme once the contracts are listed, and
  // they sat under the on-time figure they do not describe — they are the clean
  // contracts' programmes. Kept only as the fallback for a payload with no rows.
  const programmes =
    rows.length > 0 ? [] : (info.programmes ?? []).filter(Boolean);
  // Only worth saying when a reader can actually see two different numbers.
  const showNoSubtraction = hasOnTime && clean > 0;

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <BadgeCheck className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <div className="min-w-0 flex-1">
          <div className="font-medium">
            {T(
              "Еврофондове: изпълнение без корекция",
              "EU funds: delivered without correction",
            )}
          </div>

          {/* The strongest claim the register makes about the COMPANY, and the one
              the old tile never stated — being in this list IS „no correction was
              imposed on it". `on_time_contracts` is only a count within it. */}
          {info.beneficiary_listed && (
            <p className="mt-1 text-sm">
              {T(
                "ИСУН изброява фирмата сред бенефициентите без наложена финансова корекция.",
                "ИСУН lists this company among beneficiaries with no financial correction imposed.",
              )}
            </p>
          )}

          {clean > 0 && (
            <div className="mt-3">
              <div className="text-sm">
                <span className="text-lg font-semibold tabular-nums">
                  {clean}
                </span>{" "}
                {T(
                  `${clean === 1 ? "приключен проект" : "приключени проекта"} в списъка „Проекти без наложени финансови корекции“`,
                  `completed ${clean === 1 ? "project" : "projects"} in the \u201Cprojects with no financial corrections imposed\u201D list`,
                )}
              </div>

              {rows.length > 0 && (
                <ul className="mt-2 divide-y divide-border rounded-md border">
                  {rows.map((c, i) => (
                    // `contract_number` is `reg_no` with the -C## contract-VERSION
                    // suffix stripped, so it is NOT unique in isun_clean_contract
                    // (the PK is reg_no). 9,940 of 9,940 are distinct today and a
                    // data gate holds that, but a re-ingest capturing two versions
                    // of one contract must not collide two React keys.
                    <li key={`${c.contract_number}-${i}`} className="px-3 py-2">
                      <Link
                        to={`/funds/contract/${encodeURIComponent(c.contract_number)}`}
                        className="text-sm font-medium text-foreground hover:underline"
                      >
                        {c.title || c.contract_number}
                      </Link>
                      {/* Joined from the parts that are present — every one of these
                          is nullable, and prefixing each with " · " renders a leading
                          separator on a row whose programme is missing. */}
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {[
                          c.programme,
                          c.closed_on &&
                            `${T("приключен", "closed")} ${formatDate(c.closed_on, lang)}`,
                          // The declared deadline, shown beside the closing date
                          // rather than compared to it. Whether a contract was „в
                          // срок" is the REGISTER's determination, published as the
                          // count above; a date comparison here would be ours, and
                          // could disagree with it on the same company. The `!==` is
                          // only to suppress a redundant repeat.
                          c.original_end_on &&
                            c.original_end_on !== c.closed_on &&
                            `${T("срок", "due")} ${formatDate(c.original_end_on, lang)}`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {/* The headline count and the list are two fields of one payload, so
                  server-side they cannot disagree. Rendered anyway: a truncation
                  added later must SHOW its residue rather than leave a number
                  standing over a shorter list. */}
              {rows.length > 0 && clean > rows.length && (
                <div className="mt-1 text-xs text-muted-foreground">
                  {T(
                    `+${clean - rows.length} още`,
                    `+${clean - rows.length} more`,
                  )}
                </div>
              )}
            </div>
          )}

          {hasOnTime && (
            <div className="mt-3 text-sm">
              <span className="font-semibold tabular-nums">{onTime}</span>{" "}
              {T(
                `${onTime === 1 ? "договор, успешно приключен" : "договора, успешно приключени"} в срок — отделно преброяване на ИСУН за бенефициента`,
                `${onTime === 1 ? "contract completed" : "contracts completed"} on time — ИСУН's separate count for the beneficiary`,
              )}
            </div>
          )}

          {/* ⚠️ THE SENTENCE THAT BLOCKS THE SUBTRACTION. Without it the two figures
              above read as „N − M were corrected", which inverts the register. */}
          {showNoSubtraction && (
            <p className="mt-2 text-xs leading-snug text-muted-foreground">
              {T(
                "Двете числа идват от два различни списъка и броят различни неща — „в срок“ е по-строг признак от „без корекция“ (един договор може да е приключил навреме, но с корекция, или със закъснение, но без). Разликата между тях НЕ са проекти с наложена корекция.",
                "The two figures come from two different lists and count different things — „on time“ is a stricter test than „no correction“ (a contract can finish on time yet be corrected, or late yet clean). The difference between them is NOT a set of corrected projects.",
              )}
            </p>
          )}

          {programmes.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {programmes.slice(0, 4).map((p) => (
                <span
                  key={p}
                  className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                >
                  {p}
                </span>
              ))}
              {programmes.length > 4 && (
                <span className="px-1 py-0.5 text-xs text-muted-foreground">
                  +{programmes.length - 4}
                </span>
              )}
            </div>
          )}

          {/* The bound, in words — verbatim from the register's own coverage row in
              BG, and a hand-kept mirror in EN (see ABSENCE_MEANING_EN). */}
          {info.absence_meaning && (
            <p className="mt-2 text-xs leading-snug text-muted-foreground">
              {bg ? info.absence_meaning : ABSENCE_MEANING_EN}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
};
