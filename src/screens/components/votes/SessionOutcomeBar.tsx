import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Tooltip } from "@/ux/Tooltip";
import type { TopicEntry, VoteOutcome } from "@/data/parliament/votes/types";

type Props = {
  // Entries from topic_index, scoped to one date. The bar collapses the
  // six-way outcome enum into four visual classes so the strip stays
  // readable even on narrow screens.
  entries: TopicEntry[];
};

type Bucket = "unanimous" | "passed" | "rejected" | "contested";

const BUCKET_COLOR: Record<Bucket, string> = {
  unanimous: "#94a3b8", // slate — boring/procedural
  passed: "#10b981", // emerald — adopted
  rejected: "#ef4444", // red — rejected
  contested: "#f59e0b", // amber — close call
};

const BUCKET_LABEL: Record<Bucket, string> = {
  unanimous: "votes_outcome_bar_unanimous",
  passed: "votes_outcome_bar_passed",
  rejected: "votes_outcome_bar_rejected",
  contested: "votes_outcome_bar_contested",
};

const bucketOf = (o: VoteOutcome): Bucket => {
  switch (o) {
    case "passed_unanimous":
    case "abstain_unanimous":
    case "rejected_unanimous":
      return "unanimous";
    case "passed":
      return "passed";
    case "rejected":
      return "rejected";
    case "contested":
      return "contested";
  }
};

// One thin horizontal strip with up to four colored segments, one per outcome
// bucket. The vote-count weight (length) gives a quick read on what kind of
// day it was: a wide grey stretch = procedural / unanimous; a long amber
// segment = contested decisions on the floor.
export const SessionOutcomeBar: FC<Props> = ({ entries }) => {
  const { t } = useTranslation();
  const counts = useMemo(() => {
    const c: Record<Bucket, number> = {
      unanimous: 0,
      passed: 0,
      rejected: 0,
      contested: 0,
    };
    for (const e of entries) c[bucketOf(e.outcome)]++;
    return c;
  }, [entries]);

  const total =
    counts.unanimous + counts.passed + counts.rejected + counts.contested;
  if (total === 0) return null;

  const segments: Array<{ bucket: Bucket; count: number; pct: number }> = [];
  for (const bucket of [
    "unanimous",
    "passed",
    "rejected",
    "contested",
  ] as Bucket[]) {
    if (counts[bucket] === 0) continue;
    segments.push({
      bucket,
      count: counts[bucket],
      pct: (counts[bucket] / total) * 100,
    });
  }

  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
      {segments.map((s) => {
        const label = t(BUCKET_LABEL[s.bucket]) || s.bucket;
        return (
          <Tooltip
            key={s.bucket}
            content={
              <span className="tabular-nums">
                {s.count} · {label}
              </span>
            }
          >
            <div
              className="h-full"
              style={{
                width: `${s.pct}%`,
                backgroundColor: BUCKET_COLOR[s.bucket],
              }}
            />
          </Tooltip>
        );
      })}
    </div>
  );
};
