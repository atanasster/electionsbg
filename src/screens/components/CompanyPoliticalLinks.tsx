// Single shared renderer for a company's political-economy linkages — the people in public
// office declared as owners, managers or board members of one EIK.
//
// ⚠️ WHAT THIS REPLACED, BECAUSE THE OLD SHAPE IS EASY TO REBUILD BY ACCIDENT. This tile used to
// union TWO arms IN THE BROWSER and print «Няма установени връзки с политици.» whenever the
// merged list came back empty. Both arms are money-gated — `company_politicians` (347 EIKs) and
// the ИСУН beneficiary shard (971) — against 1,020,707 companies of which 29,616 have ever
// signed a contract, so for any company that neither contracts nor draws EU funds the denial was
// unconditional. /company/175155542 asserted that an NGO chaired by a former Deputy PM and
// Minister of Defence has no political links, at a 200.
//
// The union now happens server-side in `/api/db/company-political` (its header carries the
// measurements and the reason it cannot be done here), and this file asks
// `companyPoliticalVerdict` rather than a list length.
//
// ⚠️ THE DENIAL LIVES IN THE *OTHER* BRANCHES, WHICH IS WHERE IT KEEPS COMING BACK. Four separate
// ways it re-appeared in one draft of this file, all of them invisible when links exist:
//   · rendering the `unknown` copy while the query is still PENDING — «the check could not be
//     performed», on every page load, before the answer arrives;
//   · keying the direct card on `verdict.state` instead of `direct.length`, so a company with
//     bridged-only links showed an empty list under a "(0)" heading and suppressed the copy that
//     explains it;
//   · hiding `bridgeFoldsSuppressed` inside the bridged card, which is gated on that card having
//     rows — so a bridge that was cut short entirely printed a flat denial;
//   · leaving two sibling surfaces on the same screen counting the PG arm alone.
// A tile that only tells the truth when it has something to show is the defect, not the fix.
//
// TWO BLOCKS, NEVER ONE LIST. `direct` is an office-holder on this company's own registry
// filings; `bridged` is one hop further out. Migration 158's header is explicit that merging
// them behind a confidence column is exactly how the retired shard family let a two-hop
// coincidence read as a finding.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Landmark, Share2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import { formatEur } from "@/lib/currency";
import { trRoleLabel } from "@/lib/trRole";
import { usePersonLabels } from "@/lib/personLabels";
import { summarizeFundsRelations } from "@/data/funds/relationLabel";
import type { FundsMpRelation } from "@/data/funds/types";
import { officialCategoryLabel } from "@/data/funds/officialLabels";
import {
  useCompanyPolitical,
  companyPoliticalVerdict,
  type CompanyPoliticalDirect,
  type CompanyPoliticalBridged,
} from "@/data/procurement/useCompanyPolitical";

const asArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/**
 * The MP id an arm happens to carry: the funds arm sets it outright, the PG arm encodes it in
 * `href` (`/candidate/mp-2829`) and 158 in the slug (`mp-2829`).
 *
 * ⚠️ DERIVING IT IS NOT COSMETIC. `MpAvatar` falls back to the full ~970 KB
 * `parliament/index.json` when it is given a name and no id — a fallback whose own doc names
 * /company as one of the pages it exists to keep off that download. Passing `undefined` here
 * therefore costs the roster on every company page carrying an MP row, not just a missing face.
 */
const mpIdOf = (row: {
  mpId?: number;
  slug?: string | null;
  href?: string | null;
}): number | undefined => {
  if (row.mpId != null) return row.mpId;
  const m = /mp-(\d+)/.exec(row.slug ?? row.href ?? "");
  return m ? Number(m[1]) : undefined;
};

/**
 * What this person is at THIS company — the registry roles, in the reader's language.
 *
 * ⚠️ ONE VOCABULARY FOR EVERY ARM, AND IT IS `tr_role_*`. The rows are the same
 * `person_role`/`tr_person_roles` codes whichever arm carried them, so labelling them from two
 * tables would describe one code two ways on one page. `procurement_rel_*` (via
 * `summarizeOfficialRoles`) covers 7 of the 13 codes and falls back to the RAW code for the
 * rest — `ngo_board`, `sole_owner`, `actual_owner`, `trustee`, `verifier` … — on /bg as well as
 * /en; and it disagrees with `tr_role_*` on `director` (a post vs the board it sits on).
 * `tr_role_*` has all 13 in both locales.
 */
const companyRoleText = (t: TFunction, row: CompanyPoliticalDirect): string => {
  // MP relations are kind-based (`{kind}`), not role-based, and have their own labeller.
  if (row.kind === "mp" && row.arm !== "person_layer")
    return summarizeFundsRelations(t, asArray<FundsMpRelation>(row.relations));

  const codes =
    row.arm === "person_layer"
      ? (row.trRoles ?? [])
      : row.arm === "funds"
        ? asArray<{ trRole?: string | null }>(row.officialRoles).map(
            (r) => r.trRole ?? "",
          )
        : asArray<{ role?: string }>(row.relations).map((r) => r.role ?? "");

  const seen = new Set<string>();
  const out: string[] = [];
  for (const code of codes) {
    if (!code) continue;
    const label = trRoleLabel(code, t);
    // trRoleLabel yields "—" for an empty code; never show it as a role.
    if (!label || label === "—" || seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out.join(", ");
};

const DirectRow: FC<{ row: CompanyPoliticalDirect }> = ({ row }) => {
  const { t } = useTranslation();
  const { roleLabel } = usePersonLabels();

  // ⚠️ NEVER `row.office`. The route drops it for direct rows precisely because it is
  // `person_source.label_bg` and that table has no `label_en`. `pp_role_*` is bilingual.
  const office =
    row.arm === "person_layer"
      ? roleLabel(row.officeRole)
      : row.kind === "mp"
        ? t("company_pol_office_mp")
        : officialCategoryLabel(t, row.category ?? row.role ?? "");

  const meta =
    row.arm === "funds"
      ? [row.institution, row.municipality].filter(Boolean).join(" · ")
      : "";
  const roles = companyRoleText(t, row);

  const name = row.href ? (
    <Link
      to={row.href}
      className="inline-flex items-center gap-2 font-medium text-accent hover:underline"
    >
      {row.kind === "mp" ? (
        <MpAvatar mpId={mpIdOf(row)} name={row.name} />
      ) : null}
      {row.name}
    </Link>
  ) : (
    <span className="inline-flex items-center gap-2 font-medium">
      {row.name}
    </span>
  );

  return (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      {name}
      <span className="text-xs text-muted-foreground">
        {office ? `· ${office}` : ""}
        {roles ? ` · ${roles}` : ""}
        {meta ? ` · ${meta}` : ""}
        {/* `!= null`, not truthiness: a genuine €0 is a fact about the row. */}
        {row.totalEur != null ? ` · ${formatEur(row.totalEur)}` : ""}
      </span>
      {/* ⚠️ BOTH BASES ARE LABELLED, and the weaker one especially. Chipping only `declared`
          leaves `name_match` bare — visually identical to a hard registry join — which reads as
          the unqualified default and inverts the disclosure. Neither is a verdict: `declared`
          means a curated register put this COMPANY on this person, which is stronger than a bare
          fold and still NOT a confirmed identity (148 §0.2). */}
      {row.linkBasis ? (
        <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
          {row.linkBasis === "declared"
            ? t("company_pol_basis_declared")
            : t("company_pol_basis_name_match")}
        </span>
      ) : null}
    </li>
  );
};

const BridgedRow: FC<{ row: CompanyPoliticalBridged }> = ({ row }) => {
  const { t } = useTranslation();
  const { roleLabel } = usePersonLabels();
  const office = roleLabel(row.officeRole);
  return (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      <Link
        to={`/person/${row.slug}`}
        className="inline-flex items-center gap-2 font-medium text-accent hover:underline"
      >
        {/^mp-\d+$/.test(row.slug) ? (
          <MpAvatar mpId={mpIdOf(row)} name={row.name} />
        ) : null}
        {row.name}
      </Link>
      <span className="text-xs text-muted-foreground">
        {office ? `· ${office}` : ""}
        {row.bridgeName
          ? ` · ${t("company_pol_via_person")} ${row.bridgeName}`
          : ""}
        {row.viaCompany ? (
          <>
            {" · "}
            {row.viaEik ? (
              <Link to={`/company/${row.viaEik}`} className="hover:underline">
                {row.viaCompany}
              </Link>
            ) : (
              row.viaCompany
            )}
          </>
        ) : null}
        {row.bridgeCompanies != null
          ? ` · ${t("company_pol_bridge_companies", { count: row.bridgeCompanies })}`
          : ""}
        {row.pathCount && row.pathCount > 1
          ? ` · ${t("company_pol_paths", { count: row.pathCount })}`
          : ""}
      </span>
    </li>
  );
};

export const CompanyPoliticalLinks: FC<{ eik: string }> = ({ eik }) => {
  const { t } = useTranslation();
  const { data, isPending, fetchStatus } = useCompanyPolitical(eik);
  const verdict = companyPoliticalVerdict(data);

  // `enabled: !!eik` leaves a disabled query pending with fetchStatus "idle" for ever, so
  // `isPending` alone would pin the spinner on a caller that passes "". An idle-pending query
  // has nothing to say and falls through to the unknown copy, never to a denial.
  const loading = isPending && fetchStatus !== "idle";

  const direct = verdict.state === "links" ? verdict.direct : [];
  const bridged = verdict.state === "links" ? verdict.bridged : [];
  // Read through the VERDICT, not the raw payload. Re-deriving it here left `bridgeComplete`
  // with no consumer, and a mutation hard-coding it to `true` passed the whole suite while
  // reporting a complete bridge for a payload with four suppressed folds.
  const bridgeCut = verdict.state !== "unknown" && !verdict.bridgeComplete;
  const suppressed = bridgeCut ? (data?.bridgeFoldsSuppressed ?? 0) : 0;

  // ⚠️ A COUNT IS A CLAIM. `direct` is [] in three of the four states, so rendering its length
  // unguarded publishes «(0) direct political links» while the body says the check could not be
  // run — the shipped denial, in numeral form — and on every page load while pending. Only
  // `links` (a real number) and `none` (a supported zero) may show a numeral.
  // `CompanyDbScreen` applies the identical rule to its KPI and risk chip.
  const directCount =
    loading || verdict.state === "unknown" ? null : direct.length;

  // The direct card has its own, narrower version of "could we look?": no direct rows AND a
  // direct-feeding arm was down. Keying only on `verdict.state === "unknown"` made ONE bridged
  // row flip this card from «could not check» to a denial — a weaker disclosure on the page
  // carrying MORE evidence.
  const directUnsupported =
    verdict.state === "unknown" ||
    (verdict.state === "links" && verdict.unavailable.length > 0);

  // A found link is published even when another source was unreachable — but never SILENTLY, or
  // a partial answer reads as a complete one. Naming WHICH source matters: `person_layer` is the
  // registry arm the denial copy is about, while `pg` and `funds` are money-gated and empty for
  // most companies by construction, so "one source was unavailable" does not tell a reader
  // whether the register was checked.
  const partial =
    verdict.state === "links" && verdict.unavailable.length > 0 ? (
      <div className="mt-2 text-xs text-muted-foreground">
        {t("company_pol_partial", {
          count: verdict.unavailable.length,
          arms: verdict.unavailable
            .map((a) => t(`company_pol_arm_${a}`))
            .join(", "),
        })}
      </div>
    ) : null;

  // A cut-short bridge is a fact about the SEARCH, not about the rows, so it must render even
  // when there are no bridged rows to attach it to — that is precisely the case where a flat
  // denial would be a refusal published as an absence.
  const suppressionNote =
    suppressed > 0 ? (
      <div className="mt-2 text-xs text-muted-foreground">
        {data?.bridgeMaxCompanies
          ? t("company_pol_bridge_suppressed_with_cap", {
              count: suppressed,
              cap: data.bridgeMaxCompanies,
            })
          : t("company_pol_bridge_suppressed", { count: suppressed })}
      </div>
    ) : null;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Landmark className="h-4 w-4" /> {t("company_pol_direct_title")}
            {directCount != null ? ` (${directCount})` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-sm text-muted-foreground">
              {t("company_pol_loading")}
            </div>
          ) : direct.length > 0 ? (
            // Keyed on the tuple the ROUTE dedups by. It deliberately keeps two unidentifiable
            // rows as two rows, so discarding the arm prefix collides them back together — which
            // is the ordinary state of a database missing migration 106, where every slug is null.
            <ul className="space-y-2">
              {direct.map((row) => (
                <DirectRow
                  key={row.slug ?? `${row.arm}:${row.href ?? row.name}`}
                  row={row}
                />
              ))}
            </ul>
          ) : directUnsupported ? (
            <div className="text-sm text-muted-foreground">
              {t("company_pol_unknown")}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">
              {t("company_pol_none_direct")}
            </div>
          )}
          {/* ⚠️ NO FRACTION. `direct.length` is the deduped union of three arms while
              `directCount` is 158's total for one of them, so the ratio compares different bases
              and can print «59 от 52». Gated on the flag alone: truncation is the fact that has
              to survive, the count is the garnish. */}
          {data?.directTruncated ? (
            <div className="mt-2 text-xs text-muted-foreground">
              {t("company_pol_direct_truncated", { count: direct.length })}
            </div>
          ) : null}
          {partial}
          {bridged.length === 0 ? suppressionNote : null}
        </CardContent>
      </Card>

      {bridged.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Share2 className="h-4 w-4" /> {t("company_pol_bridged_title")} (
              {bridged.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* The arm is meaningless without this sentence — it licenses exactly one claim. */}
            <p className="mb-3 text-xs text-muted-foreground">
              {t("company_pol_bridged_explainer")}
            </p>
            <ul className="space-y-2">
              {bridged.map((row) => (
                <BridgedRow key={row.slug} row={row} />
              ))}
            </ul>
            {/* Same mixed-basis trap as above, one step worse: `bridged.length` is counted AFTER
                the route removes people already in `direct`, and `bridgedCount` before it. */}
            {data?.bridgedTruncated ? (
              <div className="mt-2 text-xs text-muted-foreground">
                {t("company_pol_bridged_truncated", { count: bridged.length })}
              </div>
            ) : null}
            {data?.bridgedSuppressedAsDirect ? (
              <div className="mt-2 text-xs text-muted-foreground">
                {t("company_pol_bridged_already_direct", {
                  count: data.bridgedSuppressedAsDirect,
                })}
              </div>
            ) : null}
            {partial}
            {suppressionNote}
          </CardContent>
        </Card>
      ) : null}
    </>
  );
};
