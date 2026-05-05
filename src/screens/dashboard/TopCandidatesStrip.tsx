import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import { useQuery, QueryFunctionContext } from "@tanstack/react-query";
import { PreferencesInfo } from "@/data/dataTypes";
import { NationalPartyResult } from "@/data/dashboard/dashboardTypes";
import { useElectionContext } from "@/data/ElectionContext";
import { useCandidates } from "@/data/preferences/useCandidates";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { useMps } from "@/data/parliament/useMps";
import {
  useParliamentGroups,
  stripPgPrefix,
} from "@/data/parliament/useParliamentGroups";
import { electionToNsFolder } from "@/data/parliament/nsFolders";
import { useRegions } from "@/data/regions/useRegions";
import { formatThousands } from "@/data/utils";
import { Link } from "@/ux/Link";
import { candidateUrlFor } from "@/data/candidates/candidateSlug";
import { Tooltip } from "@/ux/Tooltip";
import { Hint } from "@/ux/Hint";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { initials } from "@/lib/utils";
import { StatCard } from "./StatCard";

type Props = {
  parties: NationalPartyResult[];
  regionCode?: string;
  regionCodes?: string[];
  municipalityCode?: string;
  ekatte?: string;
  basePath?: string;
};

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string | null | undefined]>): Promise<
  PreferencesInfo[] | undefined
> => {
  if (!queryKey[1]) return undefined;
  const response = await fetch(`/${queryKey[1]}/preferences/country.json`);
  if (!response.ok) return undefined;
  return response.json();
};

export const TopCandidatesStrip: FC<Props> = ({
  parties,
  regionCode,
  regionCodes,
  municipalityCode,
  ekatte,
  basePath,
}) => {
  const { t, i18n } = useTranslation();
  const { selected } = useElectionContext();
  const { findCandidate } = useCandidates();
  const { findMpByName, mps, currentNs } = useMps();
  const { childrenFor } = useParliamentGroups();
  const { findRegion } = useRegions();
  const { displayNameFor } = useCanonicalParties();

  // True when the selected election seated the currently-sitting NS — only
  // then can we trust per-MP `currentPartyGroupShort` to attribute candidates
  // to a specific child group.
  const isCurrentNs = useMemo(() => {
    if (!mps || !currentNs) return false;
    const selFolder = electionToNsFolder(selected);
    const currentFolder = currentNs.match(/^(\d+)/)?.[1] ?? null;
    return !!selFolder && selFolder === currentFolder;
  }, [mps, currentNs, selected]);
  const { data: preferences } = useQuery({
    queryKey: ["preferences_all_country", selected] as [
      string,
      string | null | undefined,
    ],
    queryFn,
  });

  const rows = useMemo(() => {
    if (!preferences || !parties.length) return [];
    // National view: only seated parties; region/sofia view: only top parties
    // (those that crossed the 4% national threshold or are in the scope's top
    // 6 — both flagged as passedThreshold by useRegionSummary/useSofiaSummary).
    // Avoids one card per fringe party in regions where 25+ parties received
    // votes.
    const isScoped =
      !!regionCode || !!regionCodes?.length || !!municipalityCode || !!ekatte;
    const eligibleParties = isScoped
      ? parties.filter((p) => p.passedThreshold)
      : parties.filter((p) => (p.seats ?? 0) > 0);
    const scopedPreferences = ekatte
      ? preferences.filter((r) => r.ekatte === ekatte)
      : municipalityCode
        ? preferences.filter((r) => r.obshtina === municipalityCode)
        : regionCodes?.length
          ? preferences.filter(
              (r) => r.oblast && regionCodes.includes(r.oblast),
            )
          : regionCode
            ? preferences.filter((r) => r.oblast === regionCode)
            : preferences;

    // Build a single top-candidate row from a (possibly filtered) preference
    // subset for one party. Returns null when no preference entries map to a
    // known candidate. The labelOverride/colorOverride/keyOverride args carry
    // a parliamentary-group identity (e.g. ПП vs ДБ) when the row represents
    // one component of a coalition that splits in parliament.
    const buildRow = (
      p: NationalPartyResult,
      prefs: PreferencesInfo[],
      override?: {
        partyNickName: string;
        color: string;
        keySuffix: string;
      },
    ) => {
      if (!prefs.length) return null;
      const top = prefs.reduce((a, b) => (b.totalVotes > a.totalVotes ? b : a));
      const candidate = top.oblast
        ? findCandidate(top.oblast, top.partyNum, top.pref)
        : undefined;
      if (!candidate) return null;

      const allEntries = prefs.filter(
        (r) =>
          r.oblast &&
          findCandidate(r.oblast, r.partyNum, r.pref)?.name === candidate.name,
      );
      const totalVotes = allEntries.reduce((s, r) => s + r.totalVotes, 0);
      const hasPaper = allEntries.some((r) => r.paperVotes != null);
      const paperVotes = hasPaper
        ? allEntries.reduce((s, r) => s + (r.paperVotes ?? 0), 0)
        : undefined;
      const hasMachine = allEntries.some((r) => r.machineVotes != null);
      const machineVotes = hasMachine
        ? allEntries.reduce((s, r) => s + (r.machineVotes ?? 0), 0)
        : undefined;
      const hasLy = allEntries.some((r) => r.lyTotalVotes != null);
      const lyTotalVotes = hasLy
        ? allEntries.reduce((s, r) => s + (r.lyTotalVotes ?? 0), 0)
        : undefined;
      const regionCount = new Set(allEntries.map((r) => r.oblast)).size;

      const region = regionCount === 1 ? findRegion(top.oblast) : undefined;
      const regionName = region
        ? i18n.language === "bg"
          ? region.long_name || region.name
          : region.long_name_en || region.name_en
        : undefined;

      const mp = findMpByName(candidate.name);

      return {
        rowKey: `${p.partyNum}${override ? `:${override.keySuffix}` : ""}`,
        partyNum: p.partyNum,
        partyNickName: override?.partyNickName ?? p.nickName,
        color: override?.color ?? p.color ?? "#888",
        candidateName: candidate.name,
        totalVotes,
        paperVotes,
        machineVotes,
        partyVotes: p.totalVotes,
        lyTotalVotes,
        pref: top.pref,
        regionName,
        regionCount,
        photoUrl: mp?.photoUrl,
        mpId: mp?.id ?? null,
      };
    };

    return eligibleParties
      .flatMap((p) => {
        const partyPrefs = scopedPreferences.filter(
          (r) => r.partyNum === p.partyNum,
        );
        if (!partyPrefs.length) return [];
        // Coalitions that splinter into parliamentary groups (e.g. ПП-ДБ →
        // ПГ ПП + ПГ ДБ) get one top candidate per child. The lookup only
        // works for the currently-sitting NS — for older elections we keep
        // the coalition view since per-MP group attribution would be wrong.
        const children = isCurrentNs ? childrenFor(p.nickName) : undefined;
        if (children && children.length) {
          const childRows = children
            .map((c) => {
              const childPrefs = partyPrefs.filter((r) => {
                const cand = r.oblast
                  ? findCandidate(r.oblast, r.partyNum, r.pref)
                  : undefined;
                if (!cand) return false;
                const mp = findMpByName(cand.name);
                if (!mp || !mp.isCurrent || !mp.currentPartyGroupShort)
                  return false;
                return stripPgPrefix(mp.currentPartyGroupShort) === c.shortName;
              });
              return buildRow(p, childPrefs, {
                partyNickName: c.displayName,
                color: c.color,
                keySuffix: c.shortName,
              });
            })
            .filter((r): r is NonNullable<typeof r> => !!r);
          // If splits produced nothing (e.g. no candidate→MP matches yet),
          // fall back to the coalition row so the user still sees a result.
          if (childRows.length) return childRows;
        }
        const row = buildRow(p, partyPrefs);
        return row ? [row] : [];
      })
      .filter((r) => !!r.candidateName)
      .sort((a, b) => b.totalVotes - a.totalVotes);
  }, [
    preferences,
    parties,
    findCandidate,
    findMpByName,
    findRegion,
    i18n.language,
    regionCode,
    regionCodes,
    municipalityCode,
    ekatte,
    childrenFor,
    isCurrentNs,
  ]);

  if (rows.length === 0) return null;

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between w-full">
          <Hint text={t("dashboard_top_candidates_hint")} underline={false}>
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              <span>{t("dashboard_top_candidates")}</span>
            </div>
          </Hint>
          <Link
            to={
              basePath
                ? `${basePath}/preferences`
                : regionCode
                  ? `/municipality/${regionCode}/preferences`
                  : "/preferences"
            }
            className="text-[10px] normal-case text-primary hover:underline"
            underline={false}
          >
            {t("dashboard_see_details")} →
          </Link>
        </div>
      }
    >
      <div className="flex flex-wrap gap-3 mt-1">
        {rows.map((r) => (
          <Tooltip
            key={r.rowKey}
            className="max-w-56 p-2"
            content={
              <div className="flex flex-col gap-1">
                <div className="font-semibold">{r.candidateName}</div>
                <div className="flex items-center gap-1.5 text-primary-foreground/70">
                  <span
                    className="inline-block w-2 h-2 rounded-sm shrink-0"
                    style={{ backgroundColor: r.color }}
                  />
                  <span>
                    {displayNameFor(r.partyNickName) ?? r.partyNickName}
                  </span>
                  {r.regionCount > 1 ? (
                    <span>
                      · {r.regionCount} {t("regions").toLowerCase()}
                    </span>
                  ) : (
                    r.regionName && <span>· {r.regionName}</span>
                  )}
                  {r.pref && (
                    <span className="ml-auto font-mono">#{r.pref}</span>
                  )}
                </div>
                <div className="border-t border-primary-foreground/20 pt-1 flex flex-col gap-0.5">
                  <div className="flex justify-between gap-4">
                    <span>{t("votes")}</span>
                    <span className="font-semibold tabular-nums">
                      {formatThousands(r.totalVotes)}
                    </span>
                  </div>
                  {r.paperVotes != null && (
                    <div className="flex justify-between gap-4 text-primary-foreground/70">
                      <span>{t("paper_votes")}</span>
                      <span className="tabular-nums">
                        {formatThousands(r.paperVotes)}
                      </span>
                    </div>
                  )}
                  {r.machineVotes != null && r.machineVotes > 0 && (
                    <div className="flex justify-between gap-4 text-primary-foreground/70">
                      <span>{t("machine_votes")}</span>
                      <span className="tabular-nums">
                        {formatThousands(r.machineVotes)}
                      </span>
                    </div>
                  )}
                  {r.partyVotes != null && r.partyVotes > 0 && (
                    <div className="flex justify-between gap-4 text-primary-foreground/70">
                      <span>% {t("of_party_votes")}</span>
                      <span className="tabular-nums">
                        {((r.totalVotes / r.partyVotes) * 100).toFixed(1)}%
                      </span>
                    </div>
                  )}
                  {r.lyTotalVotes != null && (
                    <div className="flex justify-between gap-4 text-primary-foreground/70">
                      <span>{t("prev_elections")}</span>
                      <span className="tabular-nums">
                        {formatThousands(r.lyTotalVotes)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            }
          >
            <Link
              to={candidateUrlFor({
                mpId: r.mpId,
                partyNum: r.partyNum,
                name: r.candidateName!,
              })}
              underline={false}
              className="flex items-center gap-3 p-2 rounded-lg border border-border/60 hover:bg-muted/40 transition-colors min-w-0 flex-1 basis-[180px] max-w-[260px]"
            >
              <Avatar
                className="h-10 w-10 shrink-0 ring-2"
                style={{ ["--tw-ring-color" as string]: r.color }}
              >
                {r.photoUrl && (
                  <AvatarImage
                    src={r.photoUrl}
                    alt={r.candidateName}
                    className="object-cover"
                  />
                )}
                <AvatarFallback
                  className="text-white text-sm font-bold"
                  style={{ backgroundColor: r.color }}
                >
                  {initials(r.candidateName)}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-semibold truncate">
                  {r.candidateName}
                </span>
                <span className="text-[11px] text-muted-foreground flex items-center gap-1.5 min-w-0">
                  <span
                    className="inline-block w-2 h-2 rounded-sm shrink-0"
                    style={{ backgroundColor: r.color }}
                  />
                  <span className="truncate">
                    {displayNameFor(r.partyNickName) ?? r.partyNickName}
                  </span>
                  {r.regionCount > 1 ? (
                    <span className="truncate">
                      · {r.regionCount} {t("regions").toLowerCase()}
                    </span>
                  ) : (
                    r.regionName && (
                      <span className="truncate">· {r.regionName}</span>
                    )
                  )}
                </span>
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {formatThousands(r.totalVotes)} {t("votes").toLowerCase()}
                </span>
              </div>
            </Link>
          </Tooltip>
        ))}
      </div>
    </StatCard>
  );
};
