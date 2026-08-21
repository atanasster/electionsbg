// Compact "name match only" / "corroborated" badge for MP↔company links.
//
// Used wherever the SPA surfaces a TR-derived role or a procurement row that rests on one.
//
// ⚠️ WHERE THE GRADE COMES FROM, as of 2026-08-20. It is emitted by `MP_ARM_SQL` /
// `MP_ARM_ALL_SQL` (`scripts/db/load_tr_pg.ts`, read through `scripts/lib/mp_linkage.ts`) into
// `company_politicians.relations` and the two `mp_connected.json` payloads, and reaches this
// component through those and the procurement by_ns aggregates.
//
// It used to come from `scripts/declarations/tr/integrate.ts` — "high if the TR seat covers
// the MP region or a same-party MP also declared the company; medium if it is a name match
// only" — propagated through `companies-index.json`. That computation was deleted with its
// phase, and the file, the module and `augment_mp_roles.ts` (named below) are all gone with
// the name-keyed company page: docs/plans/company-page-consolidation-v1.md (Tier 5.2). The
// paragraph on the tooltip strings below is still the correct account of what the two words
// mean; only its attribution was stale.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { ShieldCheck } from "lucide-react";

export const ConfidenceBadge: FC<{
  confidence: "high" | "medium";
  reason?: string;
  showHigh?: boolean;
}> = ({ confidence, reason, showHigh = true }) => {
  const { t } = useTranslation();
  if (confidence === "high" && !showHigh) return null;
  const isHigh = confidence === "high";
  const label = isHigh
    ? t("tr_confidence_high") || "high"
    : t("tr_confidence_medium") || "medium";
  const tooltip =
    reason ??
    (isHigh
      ? // ⚠️ THESE TWO STRINGS DESCRIBE THE LINK BASIS, not a confidence grade. The high/medium
        // scale this component was built for is gone: the arm queries map a DECLARED stake to
        // "high" and a registry role to "medium", so `high` means a curated register put this
        // COMPANY on this person and `medium` means it was found by name. The old copy named
        // the three corroboration rules (declaration, region, same-party witness) that were
        // deleted with integrate.ts's phase 2 — it described a computation that no longer runs,
        // and integrate.ts itself is now deleted too.
        //
        // `high` is still NOT a confirmed identity: Bridge A keeps the officers on an
        // independently-linked EIK whose name matches, so the company link is register-sourced
        // and the officer row inside it is a name match. See 148's header and LinkBasisMark.
        t("tr_confidence_high_tooltip") ||
        "A curated register (declared interests / ИВСС чл. 175а) links this company to this person. The officer row inside it is still matched by name."
      : t("tr_confidence_medium_tooltip") ||
        "Found by name in the Commerce Registry, not from a declared interest. Names the registry records for more than one person are refused outright.");
  return (
    <span
      title={tooltip}
      className={
        isHigh
          ? "inline-flex items-center gap-1 rounded px-1 py-px text-[10px] font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200"
          : "inline-flex items-center gap-1 rounded px-1 py-px text-[10px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200"
      }
    >
      <ShieldCheck className="h-2.5 w-2.5" />
      {label}
    </span>
  );
};
