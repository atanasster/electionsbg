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

// Normalize a company name so a name-keyed declaration can match an EIK-keyed registry company:
// uppercase, strip punctuation, collapse spaces, drop the trailing legal-form token (incl. the
// common doubled-letter typos the declarations carry — "ООДД"). Matching is EXACT on the
// normalized base, so a typo in the BASE name ("ДАИКСС" vs "ДАИКС") never merges.
const LEGAL_FORM =
  /\s+(ЕООДД|ООДД|ЕООД|ООД|ЕАД|АД|ЕТ|КДА|КД|СД|ДЗЗД|АДСИЦ)\.?$/;
const norm = (s: string | null): string =>
  (s ?? "")
    .toUpperCase()
    .replace(/["'«»„“.,]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(LEGAL_FORM, "")
    .trim();

// The public-money block on a company row (unchanged from the old inline render).
const CompanyMoney: FC<{ c: ProfileCompany }> = ({ c }) => {
  const { t } = useTranslation();
  const any =
    (c.procuredEur ?? 0) > 0 ||
    (c.fundsEur ?? 0) > 0 ||
    (c.subsidiesEur ?? 0) > 0;
  if (!any) return null;
  return (
    <span className="shrink-0 space-y-0.5 text-right text-xs font-medium text-foreground">
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
}> = ({ companies, name, mpId }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;

  // Declared stakes are MP-only + name-keyed; undefined name → the hook skips the fetch.
  const { declarations } = useMpDeclarations(mpId != null ? name : undefined);
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
                <div className="flex items-baseline justify-between gap-3">
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

          {/* Declared stakes with no registry match — kept, clearly labelled, never merged. */}
          {remainder.length > 0 && (
            <div className="mt-3 border-t pt-3">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("pp_declared_only")}
              </div>
              {remainder.map((s) => (
                <StakeRow key={s.key} stake={s} lang={lang} />
              ))}
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
        </CardContent>
      </Card>
    </DashboardSection>
  );
};
