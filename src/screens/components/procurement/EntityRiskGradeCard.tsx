// Multi-component A–F procurement risk grade for one entity, acting as a BUYER
// or a SUPPLIER. Backed by awarder_risk_grade() / supplier_risk_grade() (PG,
// schema 041). The grade is share-of-value-weighted EXPOSURE — a documentation /
// pattern signal, not proof of wrongdoing (footnoted). Hlídač-státu K-index
// lineage; components computed only from data already in PG.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { GRADE_TONE, formatShare, type RiskGradeLetter } from "@/lib/riskGrade";

export type RiskGradeComponent = {
  key: string;
  share: number | null;
  available: boolean;
};

// Only what the card renders — the DB payload carries more (supplierCount,
// buyerCount, linkedEur, …) but this presentational component reads none of it.
export interface EntityRiskGrade {
  role: "buyer" | "supplier";
  totalEur: number;
  contractCount: number;
  score: number;
  grade: RiskGradeLetter;
  components: RiskGradeComponent[];
}

const COMPONENT_LABEL: Record<string, { key: string; fallback: string }> = {
  connection: {
    key: "risk_grade_c_connection",
    fallback: "Politically-linked suppliers",
  },
  singleBid: { key: "risk_grade_c_single_bid", fallback: "Single-bid awards" },
  direct: { key: "risk_grade_c_direct", fallback: "Direct awards" },
  concentration: {
    key: "risk_grade_c_concentration",
    fallback: "Supplier concentration",
  },
  connectedSelf: {
    key: "risk_grade_c_connected_self",
    fallback: "Politically linked",
  },
  buyerConcentration: {
    key: "risk_grade_c_buyer_conc",
    fallback: "Reliance on one buyer",
  },
  upheldAppeal: {
    key: "risk_grade_c_upheld_appeal",
    fallback: "КЗК-upheld appeals",
  },
};

export const EntityRiskGradeCard: FC<{ grade: EntityRiskGrade | null }> = ({
  grade,
}) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  // Nothing to show for entities with no contracts in this role.
  if (!grade || grade.score == null || grade.contractCount === 0) return null;
  const tone = GRADE_TONE[grade.grade] ?? GRADE_TONE.C;
  const roleLabel =
    grade.role === "buyer"
      ? t("risk_grade_as_buyer") || "as a buyer"
      : t("risk_grade_as_supplier") || "as a supplier";

  return (
    <Card className={tone.ring}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="h-4 w-4" />
          {t("risk_grade_title") || "Procurement risk grade"}
          <span className="text-xs font-normal text-muted-foreground">
            {roleLabel}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-center gap-3">
          <span
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border-2 text-2xl font-bold ${tone.ring} ${tone.bg} ${tone.text}`}
          >
            {grade.grade}
          </span>
          <div>
            <div className="tabular-nums">
              <span className={`text-lg font-bold ${tone.text}`}>
                {grade.score}
              </span>
              <span className="text-muted-foreground"> / 100</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("risk_grade_over_contracts", {
                count: grade.contractCount,
                defaultValue: "over {{count}} contracts",
              })}
            </p>
          </div>
        </div>

        <ul className="space-y-1.5">
          {grade.components.map((c) => {
            const label = COMPONENT_LABEL[c.key];
            const share = c.share ?? 0;
            // Clamp to 0–100 so a share slightly >1 (rounding, or a component
            // share defined >100%) can't overflow the track or push aria-valuenow
            // past aria-valuemax.
            const pct = Math.min(100, Math.max(0, Math.round(share * 100)));
            return (
              <li key={c.key} className="flex items-center gap-2">
                <span className="w-40 shrink-0 text-xs text-muted-foreground">
                  {t(label?.key ?? "") || label?.fallback || c.key}
                </span>
                {c.available ? (
                  <>
                    <span
                      role="progressbar"
                      aria-valuenow={pct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={
                        t(label?.key ?? "") || label?.fallback || c.key
                      }
                      className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
                    >
                      <span
                        className={`block h-full rounded-full bg-current opacity-70 ${tone.text}`}
                        style={{ width: `${pct}%` }}
                      />
                    </span>
                    <span className="w-10 shrink-0 text-right text-xs tabular-nums">
                      {formatShare(share, lang)}
                    </span>
                  </>
                ) : (
                  <span className="flex-1 text-xs text-muted-foreground/60">
                    {t("risk_grade_na") || "not published"}
                  </span>
                )}
              </li>
            );
          })}
        </ul>

        <p className="text-[11px] text-muted-foreground/80">
          {t("risk_grade_hint") ||
            "A share-of-value-weighted exposure signal (Hlídač-státu style) — a pattern indicator, not proof of wrongdoing."}
        </p>
      </CardContent>
    </Card>
  );
};
