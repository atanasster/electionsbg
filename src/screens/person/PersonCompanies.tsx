// The unified "Фирми" section on the person dashboard — the hybrid reconciliation of what used
// to be TWO overlapping lists (person-candidate-merge follow-up):
//   • "Фирми" — the EIK-exact Commerce-Registry footprint from person_by_slug (official role +
//     the public money each company won: procurement / EU funds / subsidies).
//   • "Бизнес интереси" — the MP's SELF-DECLARED ownership stakes filed with the Court of Audit
//     (declared value / share / years), name-keyed (no EIK), MP-only.
// The registry company is the spine; a declared stake folds onto its row when it matches by
// normalized name. Declarations that DON'T resolve to a registry company keep their own clearly
// labelled remainder so nothing is lost — and an uncertain match (a typo in the BASE name)
// stays in the remainder rather than assert a wrong company identity.
//
// THAT REMAINDER USED TO BE ONE UNDIFFERENTIATED LIST under „Декларирани дялове (не в
// Търговския регистър)", which is true and reads as a single failure when it is four different
// facts about the register — and the largest of them is not the one the heading names. Measured
// over the stake rows of active public figures (2026-08-12): 40.1% have NO company of that name
// in the register, 41.0% have exactly one that does not confirm the declared holder (31.6%
// because the register does not record them there, 9.5% because it records SOMEBODY of that
// name and the name is shared), 3.0% have several, and 15.9% resolve.
//
// So the remainder now splits three ways, with 096's reason on every row
// (person_declared_stake_status). The split is not cosmetic: „няма такова дружество" and
// „регистърът не свързва лицето с него" are different claims about a NAMED company, and
// printing the second as the first says something false about it.
//
// The `linked` group is the family arm. A spouse's holding resolves to a company that is by
// definition NOT in the subject's own registry footprint, so the name match above cannot find
// it and it lands here fully resolved — the one row on this list that is not a gap. It links,
// it keeps its italic holder attribution, and it is the reason the heading for that group says
// „по данни на декларатора", never „негови фирми".

import { FC, Fragment, useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Building2, ExternalLink } from "lucide-react";
import { useMpDeclarations } from "@/data/parliament/useMpDeclarations";
import {
  consolidate,
  type ConsolidatedStake,
} from "@/data/parliament/consolidateStakes";
import {
  RangeLabel,
  StakeRow,
} from "@/screens/components/candidates/MpFinancialDeclarations";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { Card, CardContent } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import { decodeEntities } from "@/lib/decodeEntities";
import { trRoleLabel } from "@/lib/trRole";
import type { ProfileCompany } from "./usePersonProfile";
import {
  useDeclaredStakeStatus,
  type DeclaredStakeReason,
  type DeclaredStakeStatus,
} from "./useDeclaredStakeStatus";

// Explicit and TOTAL, rather than `t(\`pp_declared_reason_${reason}\`)` with a cast. The
// template form typechecked and would have printed the literal key `pp_declared_reason_linked`
// on a person's profile the moment a `linked` row reached this group — the cast is exactly what
// stopped tsc from noticing there is no such key. Adding a reason to the union now fails the
// build instead of the page.
const REASON_KEY = {
  ambiguous: "pp_declared_reason_ambiguous",
  unconfirmed: "pp_declared_reason_unconfirmed",
  namesake: "pp_declared_reason_namesake",
  unverified: "pp_declared_reason_unverified",
  absent: "pp_declared_reason_absent",
} as const satisfies Record<Exclude<DeclaredStakeReason, "linked">, string>;

// Normalize a company name so a name-keyed declaration can match an EIK-keyed registry company:
// uppercase, strip punctuation, collapse spaces, drop the trailing legal-form token (incl. the
// common doubled-letter typos the declarations carry — "ООДД"). Matching is EXACT on the
// normalized base, so a typo in the BASE name ("ДАИКСС" vs "ДАИКС") never merges.
const LEGAL_FORM =
  /\s+(ЕООДД|ООДД|ЕООД|ООД|ЕАД|АД|ЕТ|КДА|КД|СД|ДЗЗД|АДСИЦ)\.?$/;
const norm = (s: string | null): string =>
  (s ?? "")
    .toUpperCase()
    // The class must cover what the CORPUS contains, not what looks symmetrical. It omitted
    // `”` (U+201D) while including `«»`, which occurs in 0 rows — so 28 declared names kept a
    // trailing `”`, which put the legal form out of reach of the $-anchored strip below, so
    // they could never fold onto their registry company either. „СТРОЙКОМПЛЕКТ АБ” ООД.
    .replace(/["'«»„“”`.,]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(LEGAL_FORM, "")
    .trim();

// The join key for a server verdict: the declared company AND the declared holder.
//
// NEVER the company alone. 096 resolves a stake per (name, holder), so one declared company can
// be refused for the filer and resolved through their spouse — 91 such groups, 23 of them
// refusing the filer's own claim. Keyed on the name only, the resolved row's verdict lands on
// the refused row and the profile links a company the register does not place this person in.
//
// Both sides go through THIS module's `norm`, on both halves. The server returns the raw
// strings precisely so the join can be local: the SQL and TypeScript normalisers are meant to
// agree, but nothing here is allowed to depend on it.
const statusKey = (company: string | null, holder: string | null): string =>
  `${norm(company)}|${norm(holder)}`;

// The public-money block on a company row (unchanged from the old inline render).
const CompanyMoney: FC<{ c: ProfileCompany }> = ({ c }) => {
  const { t } = useTranslation();
  const any =
    (c.procuredEur ?? 0) > 0 ||
    (c.fundsEur ?? 0) > 0 ||
    (c.subsidiesEur ?? 0) > 0;
  if (!any) return null;
  // Left-aligned under the company name on a phone, right-aligned beside it from sm up
  // (see the row below for why it stops sharing a line).
  return (
    <span className="shrink-0 space-y-0.5 text-xs font-medium text-foreground sm:text-right">
      {c.procuredEur != null && c.procuredEur > 0 && (
        <span className="block whitespace-nowrap">
          {formatEurCompact(c.procuredEur)}
          <span className="ml-1 font-normal text-muted-foreground">
            {t("pp_in_contracts", { count: c.contracts ?? 0 })}
          </span>
        </span>
      )}
      {c.fundsEur != null && c.fundsEur > 0 && (
        <span className="block whitespace-nowrap font-normal">
          {formatEurCompact(c.fundsEur)}
          <span className="ml-1 text-muted-foreground">
            {t("pp_funds_total")}
            {c.fundProjects
              ? ` · ${t("pp_fund_projects", { count: c.fundProjects })}`
              : ""}
            {c.fundsPaidEur != null && c.fundsPaidEur < c.fundsEur
              ? ` · ${formatEurCompact(c.fundsPaidEur)} ${t("pp_funds_paid")}`
              : ""}
          </span>
        </span>
      )}
      {c.subsidiesEur != null && c.subsidiesEur > 0 && (
        <span className="block whitespace-nowrap font-normal">
          {formatEurCompact(c.subsidiesEur)}
          <span className="ml-1 text-muted-foreground">
            {t("pp_subsidies_total")}
          </span>
        </span>
      )}
    </span>
  );
};

export const PersonCompanies: FC<{
  companies: ProfileCompany[];
  name: string;
  mpId: number | null;
  slug: string;
}> = ({ companies, name, mpId, slug }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;

  // Declared stakes are MP-only + name-keyed; undefined name → the hook skips the fetch.
  const { declarations } = useMpDeclarations(mpId != null ? name : undefined);
  // MP-gated for the same reason the declarations are: the remainder this explains comes from
  // useMpDeclarations, so on a non-MP profile the payload is fetched and discarded. 2,296 of
  // the 2,856 people with declared stakes are not MPs.
  const status = useDeclaredStakeStatus(mpId != null ? slug : undefined);
  const stakes = useMemo(
    () => consolidate(declarations.filter((d) => d.ownershipStakes.length > 0)),
    [declarations],
  );

  const { byEik, remainder } = useMemo(() => {
    const idx = new Map<string, string>(); // normalized name → eik
    for (const c of companies) if (c.name) idx.set(norm(c.name), c.eik);
    const matched = new Map<string, ConsolidatedStake[]>();
    const rest: ConsolidatedStake[] = [];
    for (const s of stakes) {
      const eik = idx.get(norm(s.companyName));
      if (eik) {
        const arr = matched.get(eik) ?? [];
        arr.push(s);
        matched.set(eik, arr);
      } else {
        rest.push(s);
      }
    }
    return { byEik: matched, remainder: rest };
  }, [companies, stakes]);

  // Group the remainder by 096's verdict — see statusKey above for the join.
  //
  // A row with no verdict (the status call has not landed, failed, or the person is outside
  // 096's public-figure gate) falls through to `unknown` and renders exactly as it did before,
  // under no caption at all. The split is additive: an unreached server must never turn a
  // stake into a claim, and must never borrow the sentence written for a different one.
  //
  // `linked` REQUIRES a non-null eik. The SQL cannot emit one without the other, but nothing
  // in TypeScript enforces that, and the consequence of the two disagreeing is a row in the
  // "matched to a company" group with nothing to match it to.
  const grouped = useMemo(() => {
    const byName = new Map<string, DeclaredStakeStatus>();
    for (const r of status ?? [])
      byName.set(statusKey(r.declaredName, r.holderName), r);
    const linked: { stake: ConsolidatedStake; st: DeclaredStakeStatus }[] = [];
    const unmatched: { stake: ConsolidatedStake; st: DeclaredStakeStatus }[] =
      [];
    const absent: { stake: ConsolidatedStake; st: DeclaredStakeStatus }[] = [];
    const unknown: ConsolidatedStake[] = [];
    // Until the verdicts land, every row is `unknown` and the whole remainder renders under
    // one caption, then redistributes into up to three headed groups when the call returns —
    // headings appear, the block grows, and everything below it moves. Rather than reserve a
    // height for a block whose shape is not known, the render below simply waits: the call is
    // a PK-ish lookup plus one indexed name join (13.8 ms locally, down from 1.99 s before
    // idx_tr_companies_declared_norm), so the hold is far shorter than the reshuffle it
    // replaces. `status === undefined` is "not answered yet"; `[]` is "answered, nothing".
    if (status === undefined)
      return { linked, unmatched, absent, unknown, pending: true };
    for (const stake of remainder) {
      const st = byName.get(statusKey(stake.companyName, stake.holderName));
      if (!st) unknown.push(stake);
      else if (st.reason === "linked") {
        // A `linked` row with no eik is a contract violation, not a reason: send it to the
        // uncaptioned group rather than to `unmatched`, whose REASON_KEY has no entry for it.
        if (st.eik) linked.push({ stake, st });
        else unknown.push(stake);
      } else if (st.reason === "absent") absent.push({ stake, st });
      else unmatched.push({ stake, st });
    }
    return { linked, unmatched, absent, unknown, pending: false };
  }, [remainder, status]);

  // Source declarations (cacbg) — shown once for the whole section when any stake is present.
  const sourceDecls = useMemo(
    () =>
      [...declarations]
        .filter((d) => d.ownershipStakes.length > 0)
        .sort((a, b) => b.declarationYear - a.declarationYear),
    [declarations],
  );

  if (companies.length === 0 && remainder.length === 0) return null;

  return (
    <DashboardSection
      id="person-business"
      title={t("pp_companies")}
      icon={Building2}
    >
      <Card>
        <CardContent className="space-y-2 pt-6">
          {companies.map((c) => {
            const declared = byEik.get(c.eik) ?? [];
            return (
              <div
                key={c.eik}
                className="border-b border-border/50 pb-2 last:border-0 last:pb-0"
              >
                {/* Stacked on a phone: the money block is whitespace-nowrap and shrink-0
                    ("€1 млн. от 2 договора" ≈ 150px of a 295px card), which left the name so
                    little room that its legal form dropped to a line of its own beside a
                    value still sitting on the first. */}
                <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
                  <span className="min-w-0 text-sm">
                    <Link
                      to={`/company/${c.eik}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {c.name ? decodeEntities(c.name) : c.eik}
                    </Link>
                    {c.legalForm && (
                      <span className="text-muted-foreground">
                        {" "}
                        {c.legalForm}
                      </span>
                    )}
                    <span className="block text-xs text-muted-foreground">
                      {c.roles.map((r) => trRoleLabel(r, t)).join(", ")}
                    </span>
                  </span>
                  <CompanyMoney c={c} />
                </div>
                {/* Declared ownership stake (Court of Audit) folded onto the registry row —
                    a self-reported value, distinct from the public money on the right. */}
                {declared.map((s) => (
                  <div
                    key={s.key}
                    className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground"
                  >
                    <span className="font-medium text-foreground/70">
                      {t("pp_declared_stake")}:
                    </span>
                    {s.ranges.map((r, i) => (
                      <Fragment key={i}>
                        {i > 0 && (
                          <span
                            aria-hidden
                            className="text-muted-foreground/60"
                          >
                            →
                          </span>
                        )}
                        <RangeLabel r={r} lang={lang} />
                      </Fragment>
                    ))}
                    {s.heldByOther && s.holderName && (
                      <span className="italic">· {s.holderName}</span>
                    )}
                  </div>
                ))}
              </div>
            );
          })}

          {/* Declared stakes that did not fold onto a registry row above, split by WHY.
              Every group states its own claim; none of them is "we could not be bothered". */}
          {!grouped.pending && grouped.linked.length > 0 && (
            <div className="mt-3 border-t pt-3">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("pp_declared_linked")}
              </div>
              {grouped.linked.map(({ stake, st }) => (
                <div key={stake.key}>
                  <StakeRow stake={stake} lang={lang} />
                  <div className="pb-2 text-xs">
                    <Link
                      to={`/company/${st.eik}`}
                      className="text-primary hover:underline"
                    >
                      {st.companyName ?? st.eik}
                    </Link>
                    <span className="ml-1 text-muted-foreground">
                      · {t("pp_declared_linked_hint")}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!grouped.pending && grouped.unmatched.length > 0 && (
            <div className="mt-3 border-t pt-3">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("pp_declared_unmatched")}
              </div>
              {grouped.unmatched.map(({ stake, st }) => (
                <div key={stake.key}>
                  <StakeRow stake={stake} lang={lang} />
                  <div className="pb-2 text-xs text-muted-foreground">
                    {st.reason !== "linked" && t(REASON_KEY[st.reason])}
                    {/* Named only for `ambiguous`, where listing them all is the honest move
                        and picking one is the defect. Deliberately NOT links: a candidate is
                        not this person's company, and a link would say it is. The NAME rides
                        along with the EIK — a bare pair of numbers gives a reader nothing to
                        tell the two same-named companies apart with. */}
                    {st.candidates.length > 0 && (
                      <span className="ml-1">
                        (
                        {st.candidates
                          .map((c) => (c.name ? `${c.name} — ${c.eik}` : c.eik))
                          .join("; ")}
                        )
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!grouped.pending &&
            (grouped.absent.length > 0 || grouped.unknown.length > 0) && (
              <div className="mt-3 border-t pt-3">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("pp_declared_only")}
                </div>
                {/* The caption is a CLAIM about the register — "no company of this name is in
                  it" — so it may only stand above rows the register was actually asked about.
                  The unknown rows below it are the ones nothing was determined for; printing
                  them under this sentence is the same false-precision the split exists to
                  remove, applied to the one group with no finding behind it. */}
                {grouped.absent.length > 0 && (
                  <div>
                    <div className="mb-1 text-xs text-muted-foreground">
                      {t("pp_declared_reason_absent")}
                    </div>
                    {grouped.absent.map(({ stake }) => (
                      <StakeRow key={stake.key} stake={stake} lang={lang} />
                    ))}
                  </div>
                )}
                {grouped.unknown.length > 0 && (
                  <div
                    className={
                      grouped.absent.length > 0
                        ? "mt-2 border-t pt-2"
                        : undefined
                    }
                  >
                    {grouped.unknown.map((stake) => (
                      <StakeRow key={stake.key} stake={stake} lang={lang} />
                    ))}
                  </div>
                )}
              </div>
            )}

          {/* One cacbg attribution for all declared stakes (matched + remainder). */}
          {sourceDecls.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
              <span>register.cacbg.bg:</span>
              {sourceDecls.map((d, i) => (
                <a
                  key={i}
                  href={d.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  {d.declarationYear}
                  <ExternalLink className="h-3 w-3" />
                </a>
              ))}
            </div>
          )}

          {/* Namesake caveat — lives HERE (was an orphaned page-bottom note): the registry
              footprint is name-matched (no ЕГН), so it belongs with the company records it
              qualifies, not after the EIK-exact money timeline. */}
          {companies.length > 0 && (
            <div className="mt-3 border-t pt-3 text-xs text-muted-foreground">
              {t("person_namesake_disclosure")}
            </div>
          )}
        </CardContent>
      </Card>
    </DashboardSection>
  );
};
