import { useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { useElectionContext } from "@/data/ElectionContext";
import { useNationalSummaryFor } from "@/data/dashboard/useNationalSummary";
import { useSearchParam } from "@/screens/utils/useSearchParam";
import { prefetchElection } from "@/data/prefetch";
import { useRegionVotes } from "@/data/regions/useRegionVotes";
import { useRegions } from "@/data/regions/useRegions";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { localDate } from "@/data/utils";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ElectionPicker } from "./compare/ElectionPicker";
import { RegionPicker } from "./compare/RegionPicker";
import { CompareTable } from "./compare/CompareTable";
import { CompareRegionsTable } from "./compare/CompareRegionsTable";
import { computeRegionSummary } from "./compare/regionSummary";
import { RegionInfo } from "@/data/dataTypes";

type Mode = "elections" | "regions";

const CompareElections = () => {
  const { t } = useTranslation();
  const { elections } = useElectionContext();
  const [leftRaw, setLeft] = useSearchParam("left", { replace: true });
  const [rightRaw, setRight] = useSearchParam("right", { replace: true });

  const left = leftRaw && elections.includes(leftRaw) ? leftRaw : elections[0];
  const right =
    rightRaw && elections.includes(rightRaw) ? rightRaw : elections[1];

  useEffect(() => {
    prefetchElection(left);
    prefetchElection(right);
  }, [left, right]);

  const leftQuery = useNationalSummaryFor(left);
  const rightQuery = useNationalSummaryFor(right);
  const leftData = leftQuery.data;
  const rightData = rightQuery.data;
  const sameElection = left === right;

  return (
    <>
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <ElectionPicker
          label={t("compare_left")}
          value={left}
          options={elections}
          placeholder={t("compare_pick_election")}
          onChange={setLeft}
        />
        <ElectionPicker
          label={t("compare_right")}
          value={right}
          options={elections}
          placeholder={t("compare_pick_election")}
          onChange={setRight}
        />
      </div>

      {sameElection && (
        <p className="text-sm text-amber-600 mb-4">
          {t("compare_same_election_warning")}
        </p>
      )}

      {leftData && rightData ? (
        <CompareTable left={leftData} right={rightData} />
      ) : (
        <div className="text-sm text-muted-foreground py-12 text-center">
          {leftQuery.isLoading || rightQuery.isLoading
            ? t("loading")
            : t("compare_no_data")}
        </div>
      )}
    </>
  );
};

const CompareRegions = () => {
  const { t, i18n } = useTranslation();
  const { selected } = useElectionContext();
  const { regions, findRegion } = useRegions();
  const { votes } = useRegionVotes();
  const { parties } = usePartyInfo();
  const [leftRaw, setLeft] = useSearchParam("regionLeft", { replace: true });
  const [rightRaw, setRight] = useSearchParam("regionRight", { replace: true });

  const oblastOptions = useMemo(() => {
    return (regions as RegionInfo[]).filter(
      (r) => r.oblast && !r.hidden && r.oblast !== "32",
    );
  }, [regions]);

  const validCodes = useMemo(
    () => new Set(oblastOptions.map((r) => r.oblast)),
    [oblastOptions],
  );

  const left =
    leftRaw && validCodes.has(leftRaw) ? leftRaw : oblastOptions[0]?.oblast;
  const right =
    rightRaw && validCodes.has(rightRaw)
      ? rightRaw
      : oblastOptions[1]?.oblast || oblastOptions[0]?.oblast;

  const leftRegion = votes?.find((v) => v.key === left);
  const rightRegion = votes?.find((v) => v.key === right);
  const leftInfo = findRegion(left || "");
  const rightInfo = findRegion(right || "");

  const isBg = i18n.language === "bg";
  const nameOf = useCallback(
    (info?: RegionInfo) =>
      info
        ? isBg
          ? info.long_name || info.name
          : info.long_name_en || info.name_en || info.name
        : "",
    [isBg],
  );

  const leftSummary = useMemo(
    () =>
      leftRegion
        ? computeRegionSummary(leftRegion, nameOf(leftInfo), selected, parties)
        : undefined,
    [leftRegion, leftInfo, selected, parties, nameOf],
  );
  const rightSummary = useMemo(
    () =>
      rightRegion
        ? computeRegionSummary(
            rightRegion,
            nameOf(rightInfo),
            selected,
            parties,
          )
        : undefined,
    [rightRegion, rightInfo, selected, parties, nameOf],
  );

  const sameRegion = !!left && left === right;

  return (
    <>
      <p className="text-xs text-muted-foreground mb-3">
        {t("compare_election_label")}: {localDate(selected)}
      </p>
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <RegionPicker
          label={t("compare_region_left")}
          value={left}
          regions={oblastOptions}
          placeholder={t("compare_pick_region")}
          onChange={setLeft}
        />
        <RegionPicker
          label={t("compare_region_right")}
          value={right}
          regions={oblastOptions}
          placeholder={t("compare_pick_region")}
          onChange={setRight}
        />
      </div>

      {sameRegion && (
        <p className="text-sm text-amber-600 mb-4">
          {t("compare_same_region_warning")}
        </p>
      )}

      {leftSummary && rightSummary ? (
        <CompareRegionsTable left={leftSummary} right={rightSummary} />
      ) : (
        <div className="text-sm text-muted-foreground py-12 text-center">
          {votes ? t("compare_no_data") : t("loading")}
        </div>
      )}
    </>
  );
};

export const CompareScreen = () => {
  const { t } = useTranslation();
  const [modeRaw, setMode] = useSearchParam("mode", { replace: true });
  const mode: Mode = modeRaw === "regions" ? "regions" : "elections";

  return (
    <div className="w-full max-w-5xl mx-auto px-4 pb-12">
      <Title description={t("compare_description")}>{t("compare_title")}</Title>

      <div className="inline-flex items-center gap-1 rounded-lg bg-muted p-1 mb-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setMode("elections")}
          className={cn(
            "px-4 py-1.5 text-sm",
            mode === "elections"
              ? "bg-background shadow"
              : "text-muted-foreground",
          )}
        >
          {t("compare_mode_elections")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setMode("regions")}
          className={cn(
            "px-4 py-1.5 text-sm",
            mode === "regions"
              ? "bg-background shadow"
              : "text-muted-foreground",
          )}
        >
          {t("compare_mode_regions")}
        </Button>
      </div>

      {mode === "elections" ? <CompareElections /> : <CompareRegions />}
    </div>
  );
};
