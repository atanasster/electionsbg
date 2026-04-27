import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Landmark } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { NationalPartyResult } from "@/data/dashboard/dashboardTypes";
import { SOFIA_REGIONS } from "@/data/dataTypes";
import { useElectionContext } from "@/data/ElectionContext";
import { useCandidates } from "@/data/preferences/useCandidates";
import { useMps, MpIndexEntry } from "@/data/parliament/useMps";
import { electionToNsFolder, oblastToMir } from "@/data/parliament/nsFolders";
import { Link } from "@/ux/Link";
import { useTooltip } from "@/ux/useTooltip";
import { Hint } from "@/ux/Hint";
import { StatCard } from "./StatCard";

type Props = {
  parties: NationalPartyResult[];
};

const normalize = (s: string) => s.toUpperCase().replace(/\s+/g, " ").trim();

const initials = (name: string) => {
  const parts = name.trim().split(/\s+/);
  return (
    (parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "")
  ).toUpperCase();
};

type MpRow = {
  mp: MpIndexEntry;
  partyNum: number | null;
  partyNickName: string | null;
  color: string;
};

type PartyGroup = {
  partyNickName: string;
  color: string;
  mps: MpRow[];
};

export const SofiaMpsTile: FC<Props> = ({ parties }) => {
  const { t } = useTranslation();
  const { selected } = useElectionContext();
  const { findMpsByRegion } = useMps();
  const { candidates } = useCandidates();
  const { tooltip, onMouseEnter, onMouseLeave } = useTooltip({
    maxHeight: 240,
    maxWidth: 240,
  });

  const nsFolder = electionToNsFolder(selected);

  const partyByNum = useMemo(
    () => new Map(parties.map((p) => [p.partyNum, p])),
    [parties],
  );
  const cikByName = useMemo(() => {
    const m = new Map<string, { partyNum: number }>();
    if (!candidates) return m;
    for (const c of candidates) {
      if (!SOFIA_REGIONS.includes(c.oblast)) continue;
      const k = normalize(c.name);
      if (!m.has(k)) m.set(k, { partyNum: c.partyNum });
    }
    return m;
  }, [candidates]);

  const groups = useMemo<PartyGroup[]>(() => {
    if (!nsFolder) return [];
    const mps: MpIndexEntry[] = [];
    const seen = new Set<number>();
    for (const region of SOFIA_REGIONS) {
      const mir = oblastToMir(region);
      if (!mir) continue;
      for (const mp of findMpsByRegion(mir, nsFolder)) {
        if (seen.has(mp.id)) continue;
        seen.add(mp.id);
        mps.push(mp);
      }
    }

    const rows: MpRow[] = mps.map((mp) => {
      const cik = cikByName.get(mp.normalizedName);
      const party = cik ? partyByNum.get(cik.partyNum) : undefined;
      const partyNum = cik?.partyNum ?? null;
      const partyNickName =
        party?.nickName ??
        mp.currentPartyGroupShort?.replace(/^ПГ /, "").trim() ??
        "—";
      const color = party?.color || "#888";
      return { mp, partyNum, partyNickName, color };
    });

    const map = new Map<string, PartyGroup>();
    for (const r of rows) {
      const key = r.partyNickName ?? "—";
      const cur = map.get(key) ?? {
        partyNickName: key,
        color: r.color,
        mps: [],
      };
      cur.mps.push(r);
      map.set(key, cur);
    }
    for (const g of map.values()) {
      g.mps.sort((a, b) => a.mp.name.localeCompare(b.mp.name, "bg"));
    }
    return [...map.values()].sort(
      (a, b) =>
        b.mps.length - a.mps.length ||
        a.partyNickName.localeCompare(b.partyNickName, "bg"),
    );
  }, [findMpsByRegion, nsFolder, cikByName, partyByNum]);

  if (!nsFolder) return null;
  const total = groups.reduce((s, g) => s + g.mps.length, 0);
  if (total === 0) return null;

  const maxStack = Math.max(...groups.map((g) => g.mps.length));

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between w-full">
          <Hint text={t("dashboard_sofia_mps_hint")} underline={false}>
            <div className="flex items-center gap-2">
              <Landmark className="h-4 w-4" />
              <span>{t("dashboard_sofia_mps")}</span>
            </div>
          </Hint>
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {total} {t("seats").toLowerCase()}
          </span>
        </div>
      }
    >
      <div className="mt-2 overflow-x-auto">
        <div
          className="flex items-end justify-center gap-3 min-h-[160px] px-1"
          style={{ minWidth: `${groups.length * 64}px` }}
        >
          {groups.map((g) => (
            <div
              key={g.partyNickName}
              className="flex flex-col items-center gap-1.5 shrink-0"
            >
              <div className="flex flex-col items-center gap-1">
                {Array.from({ length: maxStack - g.mps.length }).map((_, i) => (
                  <div key={`s${i}`} className="h-9 w-9" aria-hidden />
                ))}
                {g.mps.map((r) => {
                  const tooltipContent = (
                    <div className="flex items-center gap-2">
                      {r.mp.photoUrl && (
                        <img
                          src={r.mp.photoUrl}
                          alt={r.mp.name}
                          loading="lazy"
                          className="h-12 w-12 rounded-full object-cover shrink-0"
                        />
                      )}
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <div className="font-semibold text-sm leading-tight">
                          {r.mp.name}
                        </div>
                        <div className="text-[11px] text-primary-foreground/70 leading-tight">
                          {r.partyNickName}
                        </div>
                      </div>
                    </div>
                  );
                  return (
                    <Link
                      key={r.mp.id}
                      to={`/candidate/${encodeURIComponent(r.mp.name)}`}
                      underline={false}
                      className="block"
                      onMouseEnter={(e) =>
                        onMouseEnter(
                          { pageX: e.pageX, pageY: e.pageY },
                          tooltipContent,
                        )
                      }
                      onMouseLeave={onMouseLeave}
                    >
                      <Avatar
                        className="h-9 w-9 ring-2 transition-transform hover:scale-110"
                        style={{ ["--tw-ring-color" as string]: r.color }}
                      >
                        {r.mp.photoUrl && (
                          <AvatarImage
                            src={r.mp.photoUrl}
                            alt={r.mp.name}
                            className="object-cover"
                          />
                        )}
                        <AvatarFallback
                          className="text-[10px] font-bold text-white"
                          style={{ backgroundColor: r.color }}
                        >
                          {initials(r.mp.name)}
                        </AvatarFallback>
                      </Avatar>
                    </Link>
                  );
                })}
              </div>
              <div
                className="h-1 w-full rounded-full"
                style={{ backgroundColor: g.color }}
                aria-hidden
              />
              <div className="flex flex-col items-center text-[10px] leading-tight w-16 text-center">
                <span className="font-semibold tabular-nums text-sm leading-none">
                  {g.mps.length}
                </span>
                <span
                  className="text-muted-foreground truncate w-full"
                  title={g.partyNickName}
                >
                  {g.partyNickName}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
      {tooltip}
    </StatCard>
  );
};
