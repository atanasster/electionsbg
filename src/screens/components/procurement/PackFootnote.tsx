// The reconciliation footnote every sector pack closes with.
//
// WHY IT IS SHARED: the boilerplate half is identical across the packs and is the bit
// most likely to need a central edit — the register's name ("АОП/ЦАИС ЕОП") and the
// bid-coverage caveat ("the procedure and bid count are known for some contracts only",
// which is why every "single-bid" share is expressed among bid-known contracts). Before
// this, those sentences were re-typed in 8 packs, so a wording change meant 8 edits and
// they had already drifted apart.
//
// The domain half stays with the pack — each group is different (what it contains, what
// is deliberately EXCLUDED and lives in its own sector, what the register cannot see).
// Those come in as slots, so this component never has to know about roads/ВиК/FMS/etc.
//
// Renders:
//   Консолидиран изглед по {n} структури на {groupOf} ({€total}){afterLead} — {detail}.
//   Поръчките са от регистъра (АОП/ЦАИС ЕОП){registerNote}. {excludes} {bidCaveat}

import { FC, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { formatEurCompact } from "@/lib/currency";

export interface PackFootnoteText {
  bg: ReactNode;
  en: ReactNode;
}

const pick = (t: PackFootnoteText | undefined, bg: boolean): ReactNode =>
  t ? (bg ? t.bg : t.en) : null;

export const PackFootnote: FC<{
  /** How many units of the group actually have contracts in scope. */
  unitCount: number;
  /** Genitive group label — "групата на МРРБ" / "the МРРБ group". */
  groupOf: PackFootnoteText;
  /** Whole-group € (filter-invariant). */
  totalEur: number;
  /** Clause after the em-dash: what the group contains. */
  detail?: PackFootnoteText;
  /** Clause appended right after the total, before the em-dash (e.g. "; заглавната
   *  карта горе показва само централното МТС"). */
  afterLead?: PackFootnoteText;
  /** Appended inside the register sentence (e.g. МВР's classified-supply carve-out). */
  registerNote?: PackFootnoteText;
  /** What is deliberately NOT in this pack (its own sector, another ministry, …). */
  excludes?: PackFootnoteText;
  /** Override the default bid-coverage caveat — МО/МВР quantify their coverage. */
  bidCaveat?: PackFootnoteText;
}> = ({
  unitCount,
  groupOf,
  totalEur,
  detail,
  afterLead,
  registerNote,
  excludes,
  bidCaveat,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";

  const detailNode = pick(detail, bg);
  const afterLeadNode = pick(afterLead, bg);
  const registerNoteNode = pick(registerNote, bg);
  const excludesNode = pick(excludes, bg);
  const bidNode = pick(bidCaveat, bg) ?? (
    // The default: why every single-bid share is a share OF BID-KNOWN contracts.
    <>
      {bg
        ? "Начинът на възлагане и броят оферти са известни за част от договорите."
        : "The procedure and bid count are known for some contracts only."}
    </>
  );

  return (
    <p className="text-[11px] text-muted-foreground/80">
      {bg ? "Консолидиран изглед по " : "Consolidated across "}
      {unitCount} {bg ? "структури на " : "units of "}
      {pick(groupOf, bg)} ({formatEurCompact(totalEur, lang)}){afterLeadNode}
      {detailNode ? <> — {detailNode}</> : null}.{" "}
      {bg
        ? "Поръчките са от регистъра (АОП/ЦАИС ЕОП)"
        : "Procurement is from the register (АОП/ЦАИС ЕОП)"}
      {registerNoteNode}. {excludesNode ? <>{excludesNode} </> : null}
      {bidNode}
    </p>
  );
};
