// Procurement section for the /officials/<slug> profile. The non-MP sibling of
// the MP procurement page: lists every contractor this official is tied to
// (HIGH-confidence Commerce-Registry / declared links only) that has won public
// procurement, with the relation(s), euro total, contract count, a by-year
// chart and the top awarders — the same per-company card the MP procurement
// page uses, so the two read identically. Renders nothing when the official has
// no procurement linkage. The same data powers the /procurement/people scanner
// row that links here.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Receipt } from "lucide-react";
import {
  usePepConnectedBySlug,
  type PepProcurementEntry,
} from "@/data/procurement/usePepConnectedBySlug";
import { formatEur } from "@/lib/currency";
import {
  ConnectedContractorCard,
  type ConnectedContractorEntry,
} from "./candidates/procurement/ConnectedContractorCard";
import type { ProcurementPepConnectedEntry } from "@/data/dataTypes";

// pep relations carry a `role` string (stake / director / procurator /
// representative …) rather than the MP-side `kind`. Resolve labels against the
// canonical procurement_rel_* keys (same set the MP relation labels use, which
// covers procurator / liquidator / actual_owner …), falling back to the
// official_role_* set and finally a de-underscored form. i18next returns the
// key itself for a miss, so we compare against the key to detect a real hit.
const summarizePepRelations = (
  relations: ProcurementPepConnectedEntry["relations"],
  t: (k: string) => string,
): string => {
  const resolve = (role: string): string => {
    const relKey = `procurement_rel_${role}`;
    const rel = t(relKey);
    if (rel !== relKey) return rel;
    const offKey = `official_role_${role}`;
    const off = t(offKey);
    if (off !== offKey) return off;
    return role.replace(/_/g, " ");
  };
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const r of relations) {
    let label = resolve(r.role);
    if (r.role === "stake" && r.shareSize) label = `${label} ${r.shareSize}`;
    if (seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  return labels.join(", ");
};

// pep entries carry byYear/topAwarders as optional; normalize to the card's
// required shape.
const toCardEntry = (e: PepProcurementEntry): ConnectedContractorEntry => ({
  contractorEik: e.contractorEik,
  contractorName: e.contractorName,
  totalEur: e.totalEur,
  totalOther: e.totalOther,
  contractCount: e.contractCount,
  awardCount: e.awardCount,
  byYear: e.byYear ?? [],
  topAwarders: e.topAwarders ?? [],
});

export const OfficialProcurementSection: FC<{ slug: string }> = ({ slug }) => {
  const { t } = useTranslation();
  const { entries, summary } = usePepConnectedBySlug(slug);
  if (entries.length === 0) return null;

  return (
    <section>
      <h2 className="text-base font-semibold flex items-center gap-2 mb-1">
        <Receipt className="h-4 w-4" />
        {t("official_procurement_title") ||
          "Connected companies with public procurement"}
        <span className="text-xs text-muted-foreground font-normal">
          · {entries.length}
        </span>
      </h2>
      <p className="text-xs text-muted-foreground mb-3">
        {t("official_procurement_intro") ||
          "Companies in which this official holds a declared / Commerce-Registry role that have won public procurement. A declared tie, not proof of wrongdoing."}{" "}
        <strong className="tabular-nums font-medium text-foreground">
          {formatEur(summary.totalEur)}
        </strong>{" "}
        {t("procurement_page_total_awarded") || "total awarded"}
      </p>

      <ul className="flex flex-col gap-3">
        {entries.map((e) => (
          <ConnectedContractorCard
            key={e.contractorEik}
            entry={toCardEntry(e)}
            relationSummary={summarizePepRelations(e.relations, t)}
          />
        ))}
      </ul>

      <p className="mt-3 text-[11px] text-muted-foreground/80">
        {t("official_procurement_source") ||
          "Source: data.egov.bg (АОП OCDS) joined to register.cacbg.bg declarations + Commerce Registry filings."}
      </p>
    </section>
  );
};
