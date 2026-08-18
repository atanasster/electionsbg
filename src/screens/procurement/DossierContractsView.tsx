// The contracts browser in DOSSIER MODE (ask 3). Entered from /procurement/contracts
// with ?dossier=<slug> (curated) or ?dspec=<ProcurementQuery> (DIY). It resolves the
// dossier with the SAME client resolver the dossier page uses (useProjectFile), then
// branches on the resolved model:
//   • BOUNDED (!contractsTruncated) — the exact member set exists, so render the
//     CLIENT DataTable over model.contracts with the same shared contract columns as
//     the corpus browser. This is the DIY-exact path: it works for a curated OR an
//     ad-hoc DIY dossier with zero server round-trips. View filters (single-bid, risk
//     grade) filter the in-memory array; the headline keeps the FULL member total,
//     with a "филтриран изглед" marker when a view filter is active.
//   • TRUNCATED / program — no exact full member set exists (the dossier itself is
//     capped), so "see all the ~N" is a server seed reproduction: the DbDataTable
//     with the dossier's own seed filter (title-only FTS, buyer/contractor scope +
//     membership narrowing), pscope=all. Reuses the seedContractFilter definition so
//     it can never drift from what the dossier resolved.

import { FC, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { DataTable } from "@/ux/data_table/DataTable";
import { DbDataTable, type DbColumnFilter } from "@/ux/data_table/DbDataTable";
import { useContractColumns } from "@/screens/components/procurement/contractColumns";
import { RiskGradeFilter } from "@/screens/components/procurement/RiskGradeFilter";
import { SingleBidderToggle } from "@/screens/components/procurement/SingleBidderToggle";
import {
  useProjectFile,
  useCuratedProjectSpec,
  parseProjectSpec,
  type ProjectFileSpec,
} from "@/data/procurement/useProjectFile";
import { seedContractFilter } from "@/data/procurement/projectFile";
import { formatEur } from "@/lib/currency";
import type { RiskGradeLetter } from "@/lib/riskGrade";
import type { ProcurementContract } from "@/data/dataTypes";
import type { ContractColumnId } from "@/screens/components/procurement/contractColumns";

const SHOW: ContractColumnId[] = [
  "date",
  "awarder_name",
  "contractor_name",
  "title",
  "amount_eur",
  "procedure",
  "number_of_tenderers",
  "risk_cri",
  "source",
];

export const DossierContractsView: FC<{
  spec: ProjectFileSpec;
  title?: string;
  /** Link back to the dossier page. */
  backHref?: string;
}> = ({ spec, title, backHref }) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const { data, isLoading, isError } = useProjectFile(spec);
  const columns = useContractColumns({
    show: SHOW,
    ngoByEik: null,
    showAppealChip: true,
    titleClamp: "sm",
  });
  // View filters (bounded branch): they filter the in-memory member array and NEVER
  // change the headline total — a dossier's membership is what it is.
  const [singleBidder, setSingleBidder] = useState(false);
  const [grades, setGrades] = useState<RiskGradeLetter[]>([]);

  const chip = (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
        {bg ? "Досие" : "Dossier"}
        {title ? `: ${title}` : ""}
      </span>
      {backHref && (
        <Link to={backHref} className="text-xs text-primary underline">
          {bg ? "към досието →" : "to the dossier →"}
        </Link>
      )}
    </div>
  );

  if (isLoading)
    return (
      <div className="my-4">
        {chip}
        <div className="text-sm text-muted-foreground">
          {bg ? "Зарежда договорите…" : "Loading contracts…"}
        </div>
      </div>
    );
  if (isError || !data)
    return (
      <div className="my-4">
        {chip}
        <div className="text-sm text-muted-foreground">
          {bg ? "Грешка при зареждане." : "Failed to load."}
        </div>
      </div>
    );

  // TRUNCATED / program → server seed reproduction (all title matches, the ~N).
  // Accepted limitation: a single DbDataTable has one free-text box, so a
  // MULTI-thread truncated dossier reproduces only its FIRST thread here. In
  // practice a contract-truncated dossier is the single-token program shape (e.g.
  // „саниране"); a bounded multi-thread dossier takes the exact client-table branch
  // above instead.
  if (data.contractsTruncated) {
    const seed = seedContractFilter(spec.search[0], spec);
    return (
      <div className="my-4">
        {chip}
        <div className="mb-2 text-xs text-muted-foreground">
          {bg
            ? "Досието включва само най-големите по стойност; тук са всички съвпадения по заглавие."
            : "The dossier lists only the largest by value; here are all title matches."}
        </div>
        <DbDataTable<ProcurementContract>
          resource="contracts"
          fixedFilters={seed.columns as DbColumnFilter[]}
          globalCols={seed.globalCols}
          globalFtsOnly={seed.globalFtsOnly}
          initialSearch={seed.global}
          columns={columns}
          defaultSort={[{ id: "amount_eur", desc: true }]}
          pageSize={25}
          renderAggregates={(agg, total, exact) => (
            <span className="text-sm text-muted-foreground">
              <span className="font-semibold tabular-nums text-foreground">
                {formatEur(agg.sumAmountEur ?? 0)}
              </span>{" "}
              {bg ? "по" : "over"}{" "}
              <span className="tabular-nums">
                {exact ? "" : "≈"}
                {(agg.count ?? total).toLocaleString("bg-BG")}
              </span>{" "}
              {bg ? "договора" : "contracts"}
            </span>
          )}
        />
      </div>
    );
  }

  // BOUNDED → the exact resolved member set in the client table.
  // Single-bidder uses `=== 1`, matching the corpus browser's toggle
  // (number_of_tenderers min:1,max:1) so the SAME control means the same thing on
  // both halves of the page (not the fold's ≤1 `isSingleBid`, which also counts
  // 0-tenderer rows).
  const rows = data.contracts.filter(
    (c) =>
      (!singleBidder || c.numberOfTenderers === 1) &&
      (grades.length === 0 ||
        (c.riskGrade != null &&
          grades.includes(c.riskGrade as RiskGradeLetter))),
  );
  const filtered = singleBidder || grades.length > 0;
  return (
    <div className="my-4">
      {chip}
      <div className="mb-3 text-sm text-muted-foreground">
        <span className="font-semibold tabular-nums text-foreground">
          {formatEur(data.fold.totalContractedEur)}
        </span>{" "}
        {bg ? "по" : "over"}{" "}
        <span className="tabular-nums">
          {data.fold.contractCount.toLocaleString("bg-BG")}
        </span>{" "}
        {bg ? "договора" : "contracts"}
        {filtered && (
          <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs">
            {bg ? "филтриран изглед" : "filtered view"}
          </span>
        )}
      </div>
      <DataTable<ProcurementContract, unknown>
        columns={columns}
        data={rows}
        pageSize={25}
        initialSort={[{ id: "amount_eur", desc: true }]}
        toolbarItems={
          <>
            <RiskGradeFilter value={grades} onChange={setGrades} />
            <SingleBidderToggle
              checked={singleBidder}
              onChange={setSingleBidder}
            />
          </>
        }
      />
    </div>
  );
};

/** Resolve the dossier reference (?dossier=<slug> curated, or ?dspec=<spec> DIY) to
 *  a spec, then render the view. Curated loads the committed spec; DIY parses (and
 *  clamps) the URL spec. Both hooks run unconditionally (rules-of-hooks). */
export const ContractsDossierRoute: FC<{
  slug: string | null;
  dspec: string | null;
}> = ({ slug, dspec }) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const curated = useCuratedProjectSpec(slug ?? undefined);
  const diySpec = useMemo(() => parseProjectSpec(dspec), [dspec]);
  const spec = slug ? curated.data : diySpec;
  const title = bg ? spec?.title?.bg : spec?.title?.en;
  const backHref = slug ? `/procurement/project/${slug}` : undefined;

  if (slug && curated.isLoading)
    return (
      <div className="my-4 text-sm text-muted-foreground">
        {bg ? "Зарежда досието…" : "Loading dossier…"}
      </div>
    );
  if (!spec)
    return (
      <div className="my-4 text-sm text-muted-foreground">
        {slug
          ? bg
            ? "Досието не е намерено."
            : "Dossier not found."
          : bg
            ? "Невалидно досие във връзката."
            : "Invalid dossier in the link."}
      </div>
    );
  // key on the dossier identity so switching dossiers REMOUNTS the view — the
  // in-memory view filters + table page/sort reset instead of bleeding across.
  return (
    <DossierContractsView
      key={slug ?? dspec ?? ""}
      spec={spec}
      title={title}
      backHref={backHref}
    />
  );
};
