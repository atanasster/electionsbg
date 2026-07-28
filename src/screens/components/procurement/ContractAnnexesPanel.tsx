// "Анекси към договора" — the per-annex breakdown on the contract detail page.
// The value ladder above it shows the NET signing→current move; this itemises
// what produced it: each published modification, when, its Δ, and the ЗОП
// ground the buyer stated. It exists to answer the question the net figure
// cannot (docs/plans/procurement-risk-v2.md §0b) — was a +50% move ONE annex at
// the чл.116 ал.2 cap, or SEVERAL smaller ones summing to it?
//
// DESCRIPTIVE, not a verdict: it reports the register's own stated grounds
// verbatim and never asserts a breach — the companion to the CRI badges and the
// normalcy panel, same non-verdict framing.
//
// ⚠️ Values are contract-total (full), matching the source. Within one annex the
// last→current progression is self-consistent; see useContractAnnexes.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Layers, ArrowRight } from "lucide-react";
import { formatEurCompact } from "@/lib/currency";
import { decodeEntities } from "@/lib/decodeEntities";
import {
  useContractAnnexes,
  type ContractAnnexRow,
} from "@/data/procurement/useContractAnnexes";

const pct = (row: ContractAnnexRow): number | null => {
  if (row.lastValueEur == null || row.currentValueEur == null) return null;
  if (row.lastValueEur <= 0) return null;
  return ((row.currentValueEur - row.lastValueEur) / row.lastValueEur) * 100;
};

export const ContractAnnexesPanel: FC<{ contractKey?: string | null }> = ({
  contractKey,
}) => {
  const { t, i18n } = useTranslation();
  const { data } = useContractAnnexes(contractKey);
  if (!data || data.annexCount === 0) return null;

  const rows = data.rows;
  const lang = i18n.language;

  // Net move across the chain — but ONLY when every row is the same lot (or all
  // lot-less). A single annex publication touching N lots emits N rows ordered
  // by publication date, so rows[0]→rows[last] would cross independent per-lot
  // value series and print a meaningless percentage. Across lots the net is
  // suppressed; the per-row deltas below stay correct either way.
  const singleChain = new Set(rows.map((r) => r.lot ?? "")).size === 1;
  const netFrom = singleChain ? (rows[0]?.lastValueEur ?? null) : null;
  const netTo = singleChain
    ? (rows[rows.length - 1]?.currentValueEur ?? null)
    : null;
  const netPct =
    netFrom != null && netTo != null && netFrom > 0
      ? ((netTo - netFrom) / netFrom) * 100
      : null;

  // The §0b distinction, in plain words.
  const summary =
    data.annexCount === 1
      ? t("contract_annexes_one", {
          defaultValue: "A single annex moved this contract's value.",
        })
      : t("contract_annexes_several", {
          count: data.annexCount,
          defaultValue: "{{count}} annexes moved this contract's value.",
        });

  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Layers className="h-4 w-4 text-amber-600" />
        {t("contract_annexes_title") || "Анекси към договора"}
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
          {data.annexCount}
        </span>
      </h2>

      <p className="text-sm text-muted-foreground">
        {summary}
        {netPct != null && Math.abs(netPct) >= 0.05 ? (
          <>
            {" "}
            <span className="tabular-nums text-foreground">
              {netFrom != null ? formatEurCompact(netFrom, lang) : ""}
            </span>{" "}
            <ArrowRight className="inline h-3 w-3 align-middle" />{" "}
            <span className="tabular-nums font-medium text-foreground">
              {netTo != null ? formatEurCompact(netTo, lang) : ""}
            </span>{" "}
            <span
              className={`tabular-nums font-medium ${netPct >= 0 ? "text-rose-600" : "text-emerald-600"}`}
            >
              ({netPct >= 0 ? "+" : "−"}
              {Math.abs(netPct).toFixed(0)}%)
            </span>
          </>
        ) : null}
      </p>

      <ol className="space-y-2.5">
        {rows.map((row, i) => {
          const p = pct(row);
          const reason =
            row.changeReasonDescription ||
            row.changeReason ||
            row.changeDescription;
          return (
            <li
              key={`${row.noticeId ?? "n"}-${row.lot ?? ""}-${i}`}
              className="border-l-2 border-muted pl-3"
            >
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-xs tabular-nums text-muted-foreground">
                  {row.publicationDate?.slice(0, 10) ?? ""}
                </span>
                {row.lot ? (
                  <span className="text-[11px] text-muted-foreground">
                    {t("tender_lots") || "Позиция"} {row.lot}
                  </span>
                ) : null}
                <span className="text-sm tabular-nums">
                  {row.lastValueEur != null
                    ? formatEurCompact(row.lastValueEur, lang)
                    : "—"}{" "}
                  <ArrowRight className="inline h-3 w-3 align-middle text-muted-foreground" />{" "}
                  <span className="font-medium">
                    {row.currentValueEur != null
                      ? formatEurCompact(row.currentValueEur, lang)
                      : "—"}
                  </span>
                </span>
                {p != null && Math.abs(p) >= 0.05 ? (
                  <span
                    className={`text-xs tabular-nums font-medium ${p >= 0 ? "text-rose-600" : "text-emerald-600"}`}
                  >
                    {p >= 0 ? "+" : "−"}
                    {Math.abs(p).toFixed(0)}%
                  </span>
                ) : null}
              </div>
              {reason ? (
                <p className="text-xs text-muted-foreground">
                  {decodeEntities(reason)}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>

      <p className="text-[11px] text-muted-foreground">
        {t("contract_annexes_note") ||
          "Основанията са цитирани както са обявени от възложителя — за преглед, не доказателство за нарушение."}
      </p>
    </section>
  );
};
