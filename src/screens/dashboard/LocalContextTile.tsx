// Compact "who governs here" tile for section + settlement (ekatte)
// pages. Surfaces the elected município mayor and — when the settlement
// is also a kmetstvo center — the kmetstvo mayor, so a user landing on a
// section or settlement page can see the local-election anchor without
// drilling into /local.
//
// Designed to be cheap to mount: reads useLocalMunicipality(obshtinaCode)
// which shares the ["local_municipality", cycle, code] queryKey with the
// município dashboard tile and the oblast rollup. Clicking through to
// /settlement/<obshtinaCode> or /local/<cycle>/<obshtinaCode> reads from
// the React-Query cache.
//
// Auto-hides when there's no município bundle (Sofia districts pre-2019,
// abroad sections — which have obshtina "32"/"NMB" — etc.).

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ArrowRight, Landmark } from "lucide-react";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import { useLocalMunicipality } from "@/data/local/useLocalMunicipality";
import { useChmiHistory } from "@/data/local/useChmiHistory";
import { friendlyCycleDate } from "@/data/local/cycleDate";
import { StatCard } from "./StatCard";

type Props = {
  /** Parent município code (BLG03 / SOF / S2401 / …). When undefined the
   *  tile renders nothing — section/settlement page guards on this. */
  obshtinaCode?: string | null;
  /** Optional EKATTE — when provided and the settlement is a kmetstvo
   *  center, the kmetstvo mayor row is appended. */
  ekatte?: string | null;
  /** Optional settlement name — used as a fallback to match a kmetstvo
   *  in bundles where the kmetstva[].ekatte field is empty (mi2023 still
   *  carries the unbackfilled shape). Lowercased + whitespace-normalised
   *  before compare, same as MyAreaKmetstvoTile. */
  settlementName?: string | null;
  className?: string;
};

const normalize = (s: string): string =>
  s.trim().toLocaleLowerCase("bg").replace(/\s+/g, " ");

export const LocalContextTile: FC<Props> = ({
  obshtinaCode,
  ekatte,
  settlementName,
  className,
}) => {
  const { t } = useTranslation();
  const { municipality, cycle } = useLocalMunicipality(obshtinaCode);
  const chmiEvents = useChmiHistory(obshtinaCode);

  // Kmetstvo mayor for this settlement. Prefer EKATTE match (clean when
  // the backfill ran); fall back to normalised-name compare for the
  // current mi2023 shape where ekatte is often empty — mirrors
  // MyAreaKmetstvoTile.
  const kmetstvoMayor = useMemo(() => {
    if (!municipality?.kmetstva) return null;
    let found = ekatte
      ? municipality.kmetstva.find((k) => k.ekatte && k.ekatte === ekatte)
      : undefined;
    if (!found && settlementName) {
      const target = normalize(settlementName);
      found = municipality.kmetstva.find(
        (k) => normalize(k.kmetstvoName) === target,
      );
    }
    if (!found) return null;
    return found.candidates.find((c) => c.isElected) ?? null;
  }, [ekatte, settlementName, municipality]);

  if (!obshtinaCode || !municipality) return null;
  const mayor = municipality.mayor.elected;
  if (!mayor && !kmetstvoMayor) return null;
  const cycleDate = friendlyCycleDate(cycle);

  return (
    <StatCard
      className={className}
      label={
        <div className="flex items-center justify-between w-full gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Landmark className="h-4 w-4 shrink-0" />
            <span className="truncate">
              {t("local_context_tile_title")} · {cycleDate}
            </span>
          </div>
          <Link
            to={`/local/${cycle}/${obshtinaCode}`}
            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline normal-case shrink-0"
          >
            {t("local_election_view_details")}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      }
    >
      {mayor ? (
        <div className="mt-1 flex items-start gap-2">
          <MpAvatar
            name={mayor.candidateName}
            mpId={mayor.mpId}
            showPartyRing={false}
          />
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {t("local_context_muni_mayor_label", {
                muni: municipality.obshtinaName,
              })}
            </div>
            <div className="text-sm font-semibold leading-tight">
              {mayor.candidateName}
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground truncate">
              {mayor.isIndependent
                ? t("local_election_independent")
                : mayor.localPartyName}
              <span className="mx-1.5">·</span>
              <span className="tabular-nums">
                {t("local_election_elected_round", {
                  round:
                    mayor.round === 2
                      ? t("local_election_round_2")
                      : t("local_election_round_1"),
                })}
              </span>
            </div>
          </div>
        </div>
      ) : null}

      {kmetstvoMayor ? (
        <div className="mt-3 pt-2 border-t flex items-start gap-2">
          <MpAvatar
            name={kmetstvoMayor.candidateName}
            mpId={kmetstvoMayor.mpId}
            showPartyRing={false}
          />
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {t("local_context_kmetstvo_mayor_label")}
            </div>
            <div className="text-sm font-semibold leading-tight">
              {kmetstvoMayor.candidateName}
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground truncate">
              {kmetstvoMayor.isIndependent
                ? t("local_election_independent")
                : kmetstvoMayor.localPartyName}
            </div>
          </div>
        </div>
      ) : null}

      {chmiEvents.length > 0 ? (
        <div className="mt-2 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center rounded-md border border-blue-500/40 bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-blue-700 mr-1.5">
            {t("local_election_chmi_section")}
          </span>
          <span>
            {t("local_election_chmi_count", { count: chmiEvents.length })}
          </span>
        </div>
      ) : null}
    </StatCard>
  );
};
