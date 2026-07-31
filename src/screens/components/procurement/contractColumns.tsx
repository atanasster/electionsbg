// The one definition of a contracts-table column set, shared by every DbDataTable
// over the `contracts` resource: the global browser (/procurement/contracts), the
// per-entity drill-downs (/company/:eik/contracts, /company/:eik/annexes,
// /awarder/:eik/contracts) and the per-settlement browser
// (/procurement/settlement/:ekatte).
//
// WHY IT IS SHARED: the three screens had grown near-identical copies of a ~200-line
// column array — and, exactly as with AwarderListSection's four awarder lists, they had
// already drifted in ways nothing could see:
//
//   • the global browser linked an AWARDER to /company/:eik, dropping the ?pscope carry
//     AwarderLink exists to hold — the bug class its header documents at ~25 call sites
//     (a buyer with no awards in the default window then renders an empty page);
//   • decodeEntities ran on the global browser's name cells and not the company page's,
//     so an entity-encoded buyer name ("ЕАД &quot;…&quot;") rendered raw on one and
//     clean on the other;
//   • the appeal chip appeared on one screen only.
//
// Three smaller normalizations ride along, all cosmetic and applied in the same
// direction on every screen: the contractor cell is `font-medium` everywhere (was the
// global browser only), the subject cell carries a `title=` tooltip everywhere (was the
// company screen only), and the risk cell is wrapped in the flex row that lets a chip
// sit beside the appeal chip (was the global browser only).
//
// Callers pick the columns they want by id and pass the few things that GENUINELY
// differ. Everything else is defined once here.
//
// See docs/plans/procurement-settlement-browser-v1.md §2.3.

import { useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";
import type { DataTableColumnDef } from "@/ux/data_table/utils";
import type { ProcurementContract } from "@/data/dataTypes";
import { procedureBucket, procedureLabel } from "@/lib/cpvSectors";
import {
  contractRiskFromMasks,
  withNgoDisclosure,
} from "@/lib/contractRiskMask";
import type { NgoForeignFundedEntry } from "@/data/procurement/computeProcurementRisk";
import { decodeEntities } from "@/lib/decodeEntities";
import { resolveContractSource } from "@/screens/components/candidates/procurement/sourceUrl";
import { ContractAmount } from "./ContractAmount";
import { RiskBadges } from "./RiskBadges";
import { AppealChip } from "./AppealChip";
import { AwarderLink } from "./AwarderLink";

export type ContractColumnId =
  | "date"
  | "awarder_name"
  | "contractor_name"
  | "title"
  | "amount_eur"
  | "procedure"
  | "number_of_tenderers"
  | "consortium_full_eur"
  | "risk_cri"
  | "source";

export interface ContractColumnOptions {
  /** Columns to render, in order. */
  show: ContractColumnId[];
  /** Which date the "date" column shows.
   *  "signed"    — dateSigned ?? date, NOT sortable: sorting stays on the indexed
   *                `date` column via defaultSort (date_signed is unindexed), so a
   *                resortable header would silently order by a different column.
   *  "published" — the raw `date`, sortable. */
  dateMode?: "signed" | "published";
  /** Foreign-funding disclosures by contractor EIK (`useNgoForeignFundedByEik`) — the one
   *  risk input the row masks do not carry (a lawful disclosure, deliberately not a flag).
   *
   *  REQUIRED, not optional: an omitted map compiles and renders, and silently drops the
   *  disclosure from every row — the "green locally, blank in production" shape this
   *  codebase keeps getting caught by. Pass `null` to mean it deliberately. */
  ngoByEik: Map<string, NgoForeignFundedEntry> | null;
  /** Show the КЗК appeal chip beside the risk badges. */
  showAppealChip?: boolean;
  /** Let the header sort the awarder/contractor name columns. Off by default: over the
   *  whole corpus a name sort cannot use an index (MEASURED 254ms even scoped to one
   *  settlement, far worse unscoped), so the global browser leaves it off and offers
   *  search instead. Entity-scoped screens, whose row set is small, turn it on. */
  sortableNames?: boolean;
  /** Subject-cell clamp width. */
  titleClamp?: "sm" | "md";
}

type Col = DataTableColumnDef<ProcurementContract, unknown>;

// Written out in full, never interpolated: Tailwind extracts class names statically, so
// a `max-w-${clamp}` template compiles to no CSS at all and the cell loses its clamp.
const TITLE_CLAMP = {
  sm: "text-sm line-clamp-2 max-w-sm inline-block hover:text-primary hover:underline",
  md: "text-sm line-clamp-2 max-w-md inline-block hover:text-primary hover:underline",
} as const;

/** Column definitions for a contracts DbDataTable. Returns them in `show` order. */
export const useContractColumns = ({
  show,
  dateMode = "published",
  ngoByEik,
  showAppealChip = false,
  sortableNames = false,
  titleClamp = "md",
}: ContractColumnOptions): Col[] => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;

  // Memoized because DbDataTable feeds `columns` straight into useReactTable, so a fresh
  // array identity rebuilds the table's column model on every keystroke in the search box.
  //
  // Two things would defeat that memo, and BOTH did in the hand-written arrays this
  // replaces (their `[t, i18n.language, …]` dependency list never hit — measured):
  //
  //   • `t` — useTranslation returns a NEW function identity on every render, so listing
  //     it as a dependency invalidates the memo unconditionally. It is read through a ref
  //     instead; `lang` is the dependency that actually decides when labels change, and a
  //     ref read inside the memo cannot go stale across a language switch because `lang`
  //     rebuilds it.
  //   • `show` — callers pass an inline array literal, so it is depended on by VALUE
  //     (joined) rather than identity.
  const tRef = useRef(t);
  tRef.current = t;
  const showKey = show.join(",");

  return useMemo<Col[]>(() => {
    // Decoding the masks is cheap but not free, and two cells want it per row (the bid
    // count reads weakCompetition, the risk cell reads everything). cellRender calls cell
    // functions directly — there is no per-cell memo boundary — so without this the whole
    // page decodes twice on every parent render. Keyed on the row object and scoped to
    // this memo, so it is discarded whenever the columns rebuild.
    const maskCache = new WeakMap<
      ProcurementContract,
      ReturnType<typeof contractRiskFromMasks>
    >();
    const masksOf = (row: ProcurementContract) => {
      if (!maskCache.has(row)) maskCache.set(row, contractRiskFromMasks(row));
      return maskCache.get(row) ?? null;
    };
    const riskOf = (row: ProcurementContract) =>
      withNgoDisclosure(masksOf(row), ngoByEik?.get(row.contractorEik));

    const byId: Record<ContractColumnId, Col> = {
      date:
        dateMode === "signed"
          ? {
              id: "date",
              accessorFn: (r) => r.dateSigned ?? r.date,
              header: tRef.current("company_contract_signed") || "Signed",
              enableSorting: false,
              cell: ({ row }) => (
                <div className="tabular-nums whitespace-nowrap">
                  {row.original.dateSigned ?? row.original.date}
                </div>
              ),
            }
          : {
              id: "date",
              accessorFn: (r) => r.date,
              header: tRef.current("company_contract_date") || "Date",
              cell: ({ row }) => (
                <div className="tabular-nums whitespace-nowrap">
                  {row.original.date}
                </div>
              ),
            },

      // Always AwarderLink, for the scope carry: a bare pathname drops ?pscope, and a
      // buyer with no awards in the default window then renders an empty page.
      // (Its other service — substituting the curated name — does NOT apply here: this
      // column sorts on `awarder_name`, so the cell has to render that same string, and
      // passing children opts out of canonicalAwarderName by design.)
      awarder_name: {
        id: "awarder_name",
        accessorFn: (r) => r.awarderName,
        header: tRef.current("company_contract_awarder") || "Awarder",
        enableSorting: sortableNames,
        cell: ({ row }) => (
          <AwarderLink
            eik={row.original.awarderEik}
            className="text-sm hover:underline"
          >
            {decodeEntities(row.original.awarderName)}
          </AwarderLink>
        ),
      },

      contractor_name: {
        id: "contractor_name",
        accessorFn: (r) => r.contractorName,
        header: tRef.current("company_contract_contractor") || "Contractor",
        enableSorting: sortableNames,
        cell: ({ row }) => (
          <Link
            to={`/company/${row.original.contractorEik}`}
            className="text-sm font-medium hover:underline"
          >
            {decodeEntities(row.original.contractorName)}
          </Link>
        ),
      },

      title: {
        id: "title",
        accessorFn: (r) => r.title,
        header: tRef.current("company_contract_subject") || "Subject",
        enableSorting: false,
        cell: ({ row }) => (
          <Link
            to={`/procurement/contract/${row.original.key}`}
            className={TITLE_CLAMP[titleClamp]}
            title={row.original.title || undefined}
          >
            {row.original.title || "—"}
          </Link>
        ),
      },

      // A €0 consortium MEMBER row (migration 087) keeps its real €0 here so a sort on
      // the amount stays honest; the full joint value has its own column below.
      amount_eur: {
        id: "amount_eur",
        accessorFn: (r) => r.amountEur,
        header: tRef.current("company_contract_amount") || "Amount",
        meta: { align: "right" },
        cell: ({ row }) => (
          <ContractAmount
            amountEur={row.original.amountEur}
            amount={row.original.amount}
            currency={row.original.currency}
          />
        ),
      },

      // Bucketed + translated (the same vocabulary as the mix bar and the filter). Not
      // sortable: the bucket order ≠ the raw-string order the DB would sort by, so the
      // header would silently order by something else. Discovery is via the chart/filter.
      procedure: {
        id: "procedure",
        header: tRef.current("company_contract_procedure") || "Procedure",
        enableSorting: false,
        className: "hidden md:table-cell",
        cell: ({ row }) => (
          <span className="inline-block whitespace-nowrap rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {procedureLabel(
              procedureBucket(row.original.procurementMethod),
              lang,
            )}
          </span>
        ),
      },

      number_of_tenderers: {
        id: "number_of_tenderers",
        accessorFn: (r) => r.numberOfTenderers ?? null,
        header: tRef.current("company_contracts_bids") || "Bids",
        className: "hidden sm:table-cell",
        cell: ({ row }) => {
          const n = row.original.numberOfTenderers;
          if (n == null)
            return <span className="text-xs text-muted-foreground">—</span>;
          // Unscored (null masks) must not read as "competition was fine" — leave the
          // count unhighlighted rather than asserting the negative.
          const weak = masksOf(row.original)?.flags.weakCompetition ?? false;
          return (
            <span
              className={`block text-right text-sm tabular-nums ${
                weak ? "font-medium text-rose-600 dark:text-rose-400" : ""
              }`}
            >
              {n}
            </span>
          );
        },
      },

      // Reference-only (migration 087): a consortium MEMBER row's amount is €0 (its real
      // share is not public), so the full joint-contract value is shown HERE rather than
      // distorting a sort on the real amount. Empty for ordinary rows.
      consortium_full_eur: {
        id: "consortium_full_eur",
        accessorFn: (r) => r.consortiumFullEur ?? null,
        header: tRef.current("company_contract_consortium_full", {
          defaultValue: "Обединение",
        }),
        meta: { align: "right" },
        className: "hidden lg:table-cell",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.consortiumRole === "member" ? (
            <span
              className="whitespace-nowrap text-xs text-muted-foreground"
              title={tRef.current("company_contract_consortium_full_tip", {
                defaultValue:
                  "Пълна стойност на договора на обединението — тази фирма е участник; реалният ѝ дял не е публичен.",
              })}
            >
              {row.original.consortiumEik ? (
                <Link
                  to={`/company/${row.original.consortiumEik}`}
                  className="text-primary hover:underline"
                >
                  <ContractAmount amountEur={row.original.consortiumFullEur} />
                </Link>
              ) : (
                <ContractAmount amountEur={row.original.consortiumFullEur} />
              )}
            </span>
          ) : null,
      },

      // id MUST match the registry column, not a display name: buildOrder silently drops
      // an ORDER BY for an id it does not recognise, so a column called "risk" would look
      // sortable and quietly do nothing.
      risk_cri: {
        id: "risk_cri",
        header: tRef.current("company_contract_risk") || "Flags",
        // The bid count has its own column, so the weak-competition chip is hidden here
        // rather than showing the same signal twice.
        cell: ({ row }) => (
          <div className="flex flex-wrap items-center gap-1">
            <RiskBadges
              result={riskOf(row.original)}
              contractKey={row.original.key}
              hideWeakCompetition
            />
            {showAppealChip &&
            row.original.hasAppeal &&
            !row.original.appealUpheld ? (
              <AppealChip />
            ) : null}
          </div>
        ),
      },

      source: {
        id: "source",
        header: tRef.current("company_contract_source") || "Source",
        enableSorting: false,
        cell: ({ row }) => {
          const src = resolveContractSource(row.original);
          return (
            <a
              href={src.url}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-0.5"
            >
              {src.label === "egov" ? "egov" : "ЕОП"}
              <ExternalLink className="h-3 w-3" />
            </a>
          );
        },
      },
    };

    // Rebuilt from showKey, not closed over `show` — that keeps the dependency list
    // exhaustive (no lint suppression to hide the NEXT option someone forgets to add).
    return (showKey.split(",") as ContractColumnId[]).map((id) => byId[id]);
  }, [
    lang,
    showKey,
    dateMode,
    ngoByEik,
    showAppealChip,
    sortableNames,
    titleClamp,
  ]);
};
