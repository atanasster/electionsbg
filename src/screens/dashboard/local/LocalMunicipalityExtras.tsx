// Per-município tiles that live inside MunicipalityResults but are reusable
// independently:
//   MayorVsCouncilTile     — chip showing whether the mayor's party matches
//                            the council's leading party (the "is this an
//                            aligned town?" signal in one glance).
//   TopCouncillorsTile     — top councillors across all parties ranked by
//                            preference votes; mirror of TopCandidatesStrip
//                            from the parliamentary dashboards.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { GitFork, Users } from "lucide-react";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { titleCaseName } from "@/lib/utils";
import { formatThousands } from "@/data/utils";
import { StatCard } from "../StatCard";
import type { LocalMunicipalityBundle } from "@/data/local/types";

const Dot: FC<{ color: string }> = ({ color }) => (
  <span
    aria-hidden
    className="inline-block size-2 rounded-full ring-1 ring-border shrink-0"
    style={{ backgroundColor: color }}
  />
);

const partyId = (
  primary: string | null,
  isIndependent: boolean,
  localName: string,
): string => {
  if (primary) return primary;
  if (isIndependent) return "__independent__";
  return `local:${localName.toLocaleLowerCase("bg")}`;
};

export const MayorVsCouncilTile: FC<{ bundle: LocalMunicipalityBundle }> = ({
  bundle,
}) => {
  const { t } = useTranslation();
  const { colorFor } = useCanonicalParties();
  const mayor = bundle.mayor.elected;
  const leadingCouncil = useMemo(() => {
    const seated = bundle.council.filter((p) => p.mandatesWon > 0);
    const pool = seated.length > 0 ? seated : bundle.council;
    return [...pool].sort((a, b) => {
      if (b.mandatesWon !== a.mandatesWon) return b.mandatesWon - a.mandatesWon;
      return b.totalVotes - a.totalVotes;
    })[0];
  }, [bundle]);
  if (!mayor || !leadingCouncil) return null;
  const mayorPid = partyId(
    mayor.primaryCanonicalId,
    mayor.isIndependent,
    mayor.localPartyName,
  );
  const councilPid = partyId(
    leadingCouncil.primaryCanonicalId,
    leadingCouncil.isIndependent,
    leadingCouncil.localPartyName,
  );
  const aligned = mayorPid === councilPid;
  const mayorColor =
    (mayor.primaryCanonicalId
      ? colorFor(mayor.primaryCanonicalId)
      : "#9CA3AF") ?? "#9CA3AF";
  const councilColor =
    (leadingCouncil.primaryCanonicalId
      ? colorFor(leadingCouncil.primaryCanonicalId)
      : "#9CA3AF") ?? "#9CA3AF";
  return (
    <StatCard
      label={
        <div className="flex items-center gap-2">
          <GitFork className="h-4 w-4" />
          <span>
            {aligned
              ? t("local_muni_aligned_title")
              : t("local_muni_split_title")}
          </span>
        </div>
      }
      hint={aligned ? t("local_muni_aligned_hint") : t("local_muni_split_hint")}
    >
      <div className="flex flex-col gap-1 text-sm">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs uppercase tracking-wide text-muted-foreground w-16 shrink-0">
            {t("local_election_stat_mayor")}
          </span>
          <Dot color={mayorColor} />
          <span className="truncate">{mayor.localPartyName}</span>
        </div>
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs uppercase tracking-wide text-muted-foreground w-16 shrink-0">
            {t("local_election_sec_council")}
          </span>
          <Dot color={councilColor} />
          <span className="truncate">{leadingCouncil.localPartyName}</span>
        </div>
      </div>
    </StatCard>
  );
};

export const TopCouncillorsTile: FC<{ bundle: LocalMunicipalityBundle }> = ({
  bundle,
}) => {
  const { t } = useTranslation();
  const { colorFor } = useCanonicalParties();
  const rows = useMemo(() => {
    const all = bundle.council.flatMap((p) =>
      p.candidates
        .filter((c) => c.isElected)
        .map((c) => ({
          name: c.name,
          mpId: c.mpId,
          prefVotes: c.prefVotes,
          prefPct: c.prefPct,
          partyName: p.localPartyName,
          color:
            (p.primaryCanonicalId
              ? colorFor(p.primaryCanonicalId)
              : "#9CA3AF") ?? "#9CA3AF",
        })),
    );
    return all.sort((a, b) => b.prefVotes - a.prefVotes).slice(0, 8);
  }, [bundle, colorFor]);
  if (rows.length === 0) return null;
  return (
    <StatCard
      label={
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4" />
          <span>{t("local_top_councillors_title")}</span>
        </div>
      }
      hint={t("local_top_councillors_hint")}
    >
      {/* Avatar cards, mirroring the parliamentary TopCandidatesStrip. */}
      <div className="flex flex-wrap gap-3 mt-1">
        {rows.map((c, i) => (
          <div
            key={`${i}-${c.name}`}
            className="flex items-center gap-3 p-2 rounded-lg border border-border/60 min-w-0 flex-1 basis-[180px] max-w-[260px]"
          >
            <MpAvatar
              name={c.name}
              mpId={c.mpId}
              showPartyRing={false}
              className="h-10 w-10"
            />
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-semibold truncate">
                {titleCaseName(c.name)}
              </span>
              <span className="text-[11px] text-muted-foreground flex items-center gap-1.5 min-w-0">
                <Dot color={c.color} />
                <span className="truncate">{c.partyName}</span>
              </span>
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {formatThousands(c.prefVotes)} · {c.prefPct.toFixed(1)}%
              </span>
            </div>
          </div>
        ))}
      </div>
    </StatCard>
  );
};
