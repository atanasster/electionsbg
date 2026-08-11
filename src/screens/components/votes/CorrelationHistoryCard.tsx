// „Как се променя съвпадението" — the historical half of /parliament/correlation.
//
// The heatmap above is one parliament's whole-term matrix. This card is the same measure
// through time: the movement board (which pairs moved most into the selected parliament)
// doubles as the picker for the arc (that pair across all nine parliaments we hold).
//
// It adds NO fetch. usePartyCorrelationHistory reads the same 17 KB artifact under the same
// React Query key the heatmap already uses; every number here is arithmetic over bytes the
// page had downloaded and thrown away.

import { FC, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { History } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { usePartyCorrelationHistory } from "@/data/parliament/votes/usePartyCorrelation";
import { useParliamentGroups } from "@/data/parliament/useParliamentGroups";
import { PairCorrelationArcChart } from "@/screens/components/charts/PairCorrelationArcChart";
import { PairMovementStrip } from "./PairMovementStrip";

export const CorrelationHistoryCard: FC = () => {
  const { t } = useTranslation();
  const { series, movement, parliaments, ns, isLoading } =
    usePartyCorrelationHistory();
  const { colorForPartyShort, labelForPartyShort } = useParliamentGroups();

  // The biggest mover is the default subject — the row a reader would click first anyway.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const topId = movement[0]?.id ?? null;
  useEffect(() => {
    // Re-seeds when the election selector moves, and drops a selection that the newly
    // selected parliament does not seat.
    setSelectedId((cur) =>
      cur && movement.some((m) => m.id === cur) ? cur : topId,
    );
  }, [movement, topId]);

  const pair = selectedId ? series.get(selectedId) : undefined;

  // A parliament with fewer than two groups above the floor has no pair to show, and a
  // corpus of one parliament has no history. Both are legitimate states of the artifact
  // (the 45th sat 17 days), so they render nothing rather than an empty frame.
  if (isLoading || movement.length === 0 || parliaments.length < 2) return null;

  const labelOf = (short: string) => labelForPartyShort(short) || short;
  const colorOf = (short: string) => colorForPartyShort(short) ?? "#94a3b8";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <History className="h-4 w-4" />
          {t("corr_history_title")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-4">
          {t("corr_history_desc")}
        </p>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div>
            {pair && (
              <>
                <div className="flex items-baseline gap-1.5 text-sm mb-1">
                  <span
                    className="font-semibold"
                    style={{ color: colorOf(pair.a) }}
                  >
                    {labelOf(pair.aRaw)}
                  </span>
                  <span className="text-muted-foreground">↔</span>
                  <span
                    className="font-semibold"
                    style={{ color: colorOf(pair.b) }}
                  >
                    {labelOf(pair.bRaw)}
                  </span>
                </div>
                <PairCorrelationArcChart
                  pair={pair}
                  parliaments={parliaments}
                  currentNs={ns}
                />
              </>
            )}
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
              {t("corr_history_movement_title")}
            </h3>
            <PairMovementStrip
              rows={movement}
              selectedId={selectedId}
              onSelect={setSelectedId}
              labelFor={labelOf}
              colorFor={colorOf}
            />
          </div>
        </div>

        {/* The identity caveat belongs on the page, not only in the code: a reader looking
            at a broken line is owed the reason. */}
        <p className="text-[10px] text-muted-foreground mt-3">
          {t("corr_history_identity_note")}
        </p>
      </CardContent>
    </Card>
  );
};
