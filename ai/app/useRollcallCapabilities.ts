import { useEffect, useState } from "react";
import { fetchDb } from "../tools/dataClient";
import { ROLLCALL_VERSION } from "../../src/lib/rollcallQuery";
import {
  ROLLCALL_TEMPLATES,
  matchRollcallTemplate,
  rollcallTemplate,
} from "../../src/lib/questions/contracts/rollcall";
import type { QuestionCatalog } from "../../src/lib/questions/types";
export type RollcallCapabilities = {
  version: string;
  corpora: Record<
    string,
    { ready: boolean; metrics: string[]; operations: string[] }
  >;
  councils?: {
    id: string;
    name: string;
    named: number;
    resolutions: number;
    year_only: boolean;
  }[];
};
export function rollcallTemplateReady(
  id: string,
  cap: RollcallCapabilities | null,
) {
  const t = ROLLCALL_TEMPLATES.find((t) => "rollcall-query-" + t.id === id);
  if (!t) return true;
  const c = cap?.corpora[t.corpus];
  if (cap?.version !== ROLLCALL_VERSION || !c?.ready) return false;
  const draft = matchRollcallTemplate(rollcallTemplate(id, "en").text)?.draft;
  const operation =
    draft?.operation ||
    (
      {
        S09: "list",
        S10: "list",
        S11: "detail",
        S12: "rank",
        S13: "share",
        S14: "list",
        S16: "methodology",
        S22: "list",
        S26: "detail",
        S27: "compare",
        S28: "methodology",
      } as Record<string, string>
    )[t.id] ||
    "list";
  const parentCorpus =
    t.id === "S09" || t.id === "S10"
      ? "parliamentVotes"
      : t.id === "S22"
        ? "councilResolutions"
        : null;
  if (
    !c.operations.includes(operation) ||
    (parentCorpus && !cap?.corpora[parentCorpus]?.operations.includes("detail"))
  )
    return false;
  const metric =
    t.id === "S12"
      ? "contested"
      : t.id === "S13"
        ? "choiceShare"
        : t.id === "S14"
          ? "agreement"
          : "records";
  return (
    c.metrics.includes(metric) &&
    (!t.corpus.startsWith("council") ||
      !!cap.councils?.some((b) =>
        t.corpus === "councilCasts"
          ? b.named > 0
          : t.corpus === "councilSessions"
            ? b.resolutions > 0 && !b.year_only
            : b.resolutions > 0,
      ))
  );
}
export function useRollcallCapabilities(
  catalog: QuestionCatalog,
): QuestionCatalog {
  const [cap, setCap] = useState<RollcallCapabilities | null>(null);
  useEffect(() => {
    let active = true;
    void fetchDb<RollcallCapabilities>("rollcall-capabilities")
      .then((c) => {
        if (active) setCap(c);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  return {
    ...catalog,
    questions: catalog.questions.filter((q) =>
      rollcallTemplateReady(q.id, cap),
    ),
  };
}
