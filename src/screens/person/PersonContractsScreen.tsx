// Standalone "all contracts" browser for a person — /person/:name/contracts, reached from the
// portfolio's _Топ договори_ "see all". A thin wrapper over the shared ContractsBrowserSection
// (docs/plans/person-procurement-browser-v1.md, Tier 3): it resolves the person, chooses the
// right semi-join scope, and supplies the window + the always-on member-exclusion predicate.
//
// NAME vs SLUG (the one non-obvious bit). `:name` is a resolved SLUG for a public figure and a
// raw TR name for the fallback persons. We must scope through the column whose EIK derivation
// matches the KPI source the reader would see on /person/:name:
//   • profile hit  → contractor_of_person_slug  (person_role — matches person_by_slug, 082);
//   • profile miss → contractor_of_person_name  (tr_officers.name_fold — matches 024).
// Choosing name-scope for a public figure would fold the SLUG through translit_bg_latin and
// match nothing, so we wait for the profile to resolve before mounting the browser.
//
// COUNT BASIS. `not_consortium_member` rides the scope so the browser counts on the same basis
// as person_procurement (excludes €0 consortium-member rows, 024:47-48) — otherwise the footer
// count would exceed the portfolio headline.
//
// SCOPE. A person's portfolio is lifetime, so this page defaults to ALL years (not the
// parliament window) and offers a year picker — no `ns`, unlike the section pages.

import { FC, useMemo } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ChevronLeft, Info, Receipt } from "lucide-react";
import { SEO } from "@/ux/SEO";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DbColumnFilter } from "@/ux/data_table/DbDataTable";
import {
  ContractsBrowserSection,
  type ContractsBrowserSectionProps,
} from "@/screens/components/procurement/ContractsBrowserSection";
import { usePersonProfile } from "./usePersonProfile";
import { scopeRange } from "@/data/scope/scopeRange";
import { defaultScopeYears, useScope, type Scope } from "@/data/scope/useScope";
import { useElectionContext } from "@/data/ElectionContext";

// Both parties shown — a person spans many buyers and firms, so neither side is implied by the
// page (same column set as the settlement browser).
const PERSON_COLUMNS: ContractsBrowserSectionProps["columns"] = [
  "date",
  "awarder_name",
  "contractor_name",
  "title",
  "amount_eur",
  "procedure",
  "number_of_tenderers",
  "consortium_full_eur",
  "risk_cri",
];

const YEARS = defaultScopeYears();
const SCOPE_ALL = "all";

export const PersonContractsScreen: FC = () => {
  const { name = "" } = useParams();
  const { t } = useTranslation();
  const decoded = decodeURIComponent(name);
  const profile = usePersonProfile(name);
  const [params] = useSearchParams();
  const { selected } = useElectionContext();

  // Reuse the shared parse+resolve+CLAMP stack: useScope validates ?pscope against the years
  // this page actually offers (resolveScope), so an off-range or absent value resolves to `ns`
  // — which this lifetime-portfolio page treats as ALL years (it has no parliament window). The
  // clamp is what keeps the picker value and the numbers ONE value: a `?pscope=y:2005` can never
  // blank the Select. `setScope` (the shared setter) writes/clears the param canonically.
  const { scope: urlScope, setScope } = useScope({
    years: YEARS,
    allowAll: true,
  });
  const scope: Scope = urlScope === "ns" ? SCOPE_ALL : urlScope;
  const dateWindow = useMemo(
    () => scopeRange(scope, selected),
    [scope, selected],
  );

  // The identity scope — only knowable once the profile resolves (slug vs name). Includes the
  // member-exclusion predicate so the count basis matches person_procurement.
  const personScope = useMemo<DbColumnFilter[] | null>(() => {
    if (profile === undefined) return null; // still resolving
    const base: DbColumnFilter =
      profile && profile.slug
        ? { id: "contractor_of_person_slug", value: profile.slug }
        : { id: "contractor_of_person_name", value: decoded };
    return [base, { id: "not_consortium_member", value: "member" }];
  }, [profile, decoded]);

  const displayName = profile?.name ?? decoded;
  // A resolved public figure is identity-scoped (no namesakes); only the name-fold path
  // (profile miss) can collapse namesakes, so the disclosure rides that path.
  const showNamesake = profile === null;

  return (
    <div className="w-full px-4 py-6 md:px-6">
      <SEO
        title={`${t("pp_proc_all_contracts") || "Обществени поръчки"} — ${displayName}`}
        description={
          t("pp_proc_all_contracts_desc") ||
          "Всички договори за обществени поръчки на фирмите, свързани с лицето."
        }
        // Canonicalise to the profile page — this filtered browser is not its own indexable
        // destination (it is also absent from the sitemap / prerender set).
        canonical={`https://electionsbg.com/person/${encodeURIComponent(name)}`}
      />

      <div className="mb-4">
        <Link
          to={`/person/${encodeURIComponent(name)}`}
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          <ChevronLeft className="h-4 w-4" /> {displayName}
        </Link>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold">
          <Receipt className="h-6 w-6 text-muted-foreground" />
          {t("pp_proc_all_contracts") || "Обществени поръчки"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("pp_proc_all_contracts_hint") ||
            "Всички договори на фирмите, в които лицето е (или е било) вписано."}
        </p>

        <div className="mt-3 flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {t("procurement_period") || "Период"}
          </span>
          <Select value={scope} onValueChange={setScope}>
            <SelectTrigger
              className="h-9 w-auto"
              aria-label={t("procurement_period") || "Период"}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SCOPE_ALL}>
                {t("procurement_scope_all_years") || "Всички години"}
              </SelectItem>
              {YEARS.map((y) => (
                <SelectItem key={y} value={`y:${y}`}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {showNamesake && (
          <p className="mt-3 flex items-start gap-1.5 rounded-md border border-border/60 bg-muted/40 p-2.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {t("person_namesake_disclosure") ||
                "Лицата в Търговския регистър се идентифицират само по име."}
            </span>
          </p>
        )}
      </div>

      {personScope === null ? (
        <div className="py-8 text-sm text-muted-foreground">
          {t("loading") || "Зареждане…"}
        </div>
      ) : (
        <ContractsBrowserSection
          scope={personScope}
          dateWindow={dateWindow}
          resetKey={profile?.slug ?? decoded}
          columns={PERSON_COLUMNS}
          initialSearch={params.get("q") ?? ""}
        />
      )}
    </div>
  );
};
