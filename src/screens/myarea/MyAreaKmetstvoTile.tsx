// Settlement-grain kметство tile. ~3,000 Bulgarian villages large enough
// to elect their own кмет (separate from the município mayor) — when the
// resolved area is a settlement that has its own кметство, this tile
// surfaces the elected village mayor for the latest local cycle.
//
// Implementation: fetch the município's local-election bundle (already
// keyed by obshtina, ~5-20 KB each) and find the kmetstva[] entry whose
// kmetstvoName matches the settlement name. Source data is from the 2023
// CIK results — when mi2027 lands the same hook auto-picks it via
// useLatestLocalCycle.
//
// Why name-match instead of EKATTE-join: the CIK source carries
// kmetstvoName but an empty ekatte field. A future ingest pass can
// backfill ekatte; until then a normalized name compare works for the
// ~95% of cases where the village and the kметство share a name.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Crown } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useLocalMunicipality } from "@/data/local/useLocalMunicipality";
import type { LocalKmetstvoResult } from "@/data/local/types";
import { titleCaseName } from "@/lib/utils";

type Props = {
  /** EKATTE of the resolved settlement. */
  ekatte: string;
  /** Settlement Bulgarian name (used for kметство name matching). */
  settlementName: string;
  /** Obshtina code; needed to fetch the right município bundle. */
  obshtina: string;
};

/** Normalize for kметство name comparison: lowercase + strip whitespace +
 *  fold spacing. Cyrillic case folding handled by toLowerCase(). */
const normalize = (s: string): string =>
  s.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();

const formatVotes = (n: number): string =>
  new Intl.NumberFormat("bg-BG").format(n);

export const MyAreaKmetstvoTile: FC<Props> = ({ settlementName, obshtina }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const { municipality, isLoading } = useLocalMunicipality(obshtina);

  // Name-match the kметство. We compare normalized names: lower-cased,
  // whitespace-collapsed. ~3,000 villages countrywide so the inner search
  // is bounded — no need for a precomputed index.
  const match = useMemo<LocalKmetstvoResult | null>(() => {
    if (!municipality?.kmetstva) return null;
    const target = normalize(settlementName);
    for (const k of municipality.kmetstva) {
      if (normalize(k.kmetstvoName) === target) return k;
    }
    return null;
  }, [municipality, settlementName]);

  // Pre-data render path: skip the tile entirely until we know one way or
  // another. The skeleton would otherwise flicker on ~95% of settlements
  // that don't have their own кметство (towns are administered by the
  // município mayor; only sub-municipal villages have кметства).
  if (isLoading) return null;
  if (!match) return null;

  // Find the elected кмет inside this kметство's candidate list.
  const elected = match.candidates.find((c) => c.isElected);
  if (!elected) return null;

  const partyLabel =
    elected.localPartyName ||
    (elected.isIndependent
      ? lang === "bg"
        ? "Независим"
        : "Independent"
      : "—");

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <Crown className="size-4 text-primary" />
        <h2 className="text-sm font-semibold">{t("my_area_kmetstvo_mayor")}</h2>
      </div>
      <div className="flex items-baseline gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-base truncate">
            {/* CIK source carries candidate names in ALL CAPS. Title-case
                them to match the MP-row convention so we don't read like
                a ransom note. */}
            {titleCaseName(elected.candidateName)}
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {partyLabel}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-bold tabular-nums text-base">
            {formatVotes(elected.votes)}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {elected.pctOfValid.toFixed(1)}%
          </div>
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground mt-3">
        {lang === "bg"
          ? `Кмет на кметство ${match.kmetstvoName} · избран ${municipality?.cycle?.replace(/_/g, " ") ?? ""}`
          : `Mayor of kметство ${match.kmetstvoName} · elected ${municipality?.cycle?.replace(/_/g, " ") ?? ""}`}
      </p>
    </Card>
  );
};
