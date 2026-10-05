// One round's section risk score — `<cycle>/tur<round>/risk_score.json`, written by
// `scripts/parsers_presidential/build_risk_score.ts`. The input to the presidential Election
// Risk Index and to the section-risk tile.
//
// ⚠ „A SCREENING, NOT A VERDICT" TRAVELS IN THE FILE, and this hook refuses a file without it in
// both languages — the payload names polling stations. The four-state machine is `./guardedFetch`.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { guardedFetch, makeWarnOnce, num, str } from "./guardedFetch";

export type RiskBandId = "low" | "elevated" | "high" | "critical";

export type RiskSignal =
  | "invalidBallots"
  | "additionalVoters"
  | "concentrated"
  | "peerOutlier"
  | "swing";

export interface RiskScoreComponent {
  id: RiskSignal;
  /** A percentage for the two ratios and `concentrated`, a z for `peerOutlier` and `swing`. */
  raw: number;
  normalized: number;
}

export interface RiskScoreSection {
  code: string;
  oblast: string;
  ekatte?: string;
  placeName?: string;
  winner?: { number: number; pct: number };
  totalActualVoters: number;
  score: number;
  /** ⚠ The ONLY figure to use for a question about a candidate — it never reads who won. */
  proceduralScore: number | null;
  distributionScore: number | null;
  band: RiskBandId;
  signalsAvailable: number;
  components: RiskScoreComponent[];
}

export interface PresidentialRiskScore {
  cycle: string;
  round: 1 | 2;
  basis: string;
  basisEn: string;
  signals: {
    used: RiskSignal[];
    unavailable: { id: string; reason: string; reasonEn: string }[];
    swingAgainst: string | null;
    /** Winner share (0–100) above which `concentrated` fires — raised above 80 in a landslide. */
    concentratedFloor: number;
  };
  coverage: {
    sections: number;
    scored: number;
    totalActualVoters: number;
    allSectionsActualVoters: number;
  };
  cuts: { elevated: number; high: number; critical: number };
  counts: Record<RiskBandId, number>;
  votesByBand: Record<RiskBandId, number>;
  elevatedShare: number;
  top: RiskScoreSection[];
}

export type PresidentialRiskScoreState =
  | { status: "loading" }
  | { status: "ready"; risk: PresidentialRiskScore }
  | { status: "absent" }
  | { status: "unusable" };

const BANDS: readonly RiskBandId[] = ["low", "elevated", "high", "critical"];

export const isPresidentialRiskScore = (
  v: unknown,
): v is PresidentialRiskScore => {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  if (!str(o.basis) || !str(o.basisEn)) return false;
  const c = o.coverage as Record<string, unknown> | undefined;
  if (
    !num(c?.sections) ||
    !num(c?.scored) ||
    !num(c?.totalActualVoters) ||
    !num(c?.allSectionsActualVoters)
  )
    return false;
  const counts = o.counts as Record<string, unknown> | undefined;
  const votes = o.votesByBand as Record<string, unknown> | undefined;
  // ⚠ THE WHOLE LADDER: a missing band would render „0" — a claim that nothing was flagged.
  if (!BANDS.every((b) => num(counts?.[b]) && num(votes?.[b]))) return false;
  if (!num(o.elevatedShare) || !Array.isArray(o.top)) return false;
  const s = o.signals as Record<string, unknown> | undefined;
  if (!Array.isArray(s?.used) || !Array.isArray(s?.unavailable)) return false;
  return (o.top as unknown[]).every((t) => {
    const r = t as Record<string, unknown>;
    return (
      typeof t === "object" &&
      t !== null &&
      str(r.code) &&
      num(r.score) &&
      BANDS.includes(r.band as RiskBandId) &&
      Array.isArray(r.components)
    );
  });
};

const { warnOnce, reset } = makeWarnOnce();
export const __resetRiskScoreWarnings = reset;

export const riskScorePath = (cycle: string, round: 1 | 2): string =>
  `${cycle}/tur${round}/risk_score.json`;

export const fetchPresidentialRiskScore = async (
  cycle: string,
  round: 1 | 2,
): Promise<PresidentialRiskScoreState> => {
  const got = await guardedFetch({
    path: riskScorePath(cycle, round),
    id: `${cycle}/tur${round}`,
    prefix: "rs",
    subject: "section risk score",
    guard: isPresidentialRiskScore,
    shapeMessage:
      "missing the screening caveat, a band or a coverage figure — refusing to render it",
    warnOnce,
    toUrl: (path) => dataUrl(`/${path}`),
  });
  return got.status === "ready" ? { status: "ready", risk: got.value } : got;
};

export const usePresidentialRiskScore = (
  cycle: string | undefined,
  round: 1 | 2,
): PresidentialRiskScoreState => {
  const q = useQuery({
    queryKey: ["presidential_risk_score", cycle ?? "", round],
    queryFn: () => fetchPresidentialRiskScore(cycle as string, round),
    enabled: !!cycle,
    // A settled election's published protocols; they never change under a reader.
    staleTime: Infinity,
  });
  return q.data ?? { status: "loading" };
};
