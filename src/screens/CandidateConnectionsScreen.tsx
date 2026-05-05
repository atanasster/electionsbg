import { FC, useMemo } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Network } from "lucide-react";
import { Title } from "@/ux/Title";
import { useMpConnections } from "@/data/parliament/useMpConnections";
import { useResolvedCandidateName } from "@/data/candidates/useResolvedCandidate";
import type { ConnectionsEdge, ConnectionsNode } from "@/data/dataTypes";
import { ConnectionPathRow } from "./components/candidates/ConnectionPathRow";
import { ErrorSection } from "./components/ErrorSection";

export const CandidateConnectionsScreen: FC = () => {
  const { id } = useParams();
  const { t } = useTranslation();
  const { name: resolved } = useResolvedCandidateName(id);
  const fallback =
    id && !id.startsWith("mp-") && !id.startsWith("c-")
      ? decodeURIComponent(id)
      : null;
  const name = resolved ?? fallback;
  const { subgraph, isLoading } = useMpConnections(name);

  const nodeById = useMemo(() => {
    const m = new Map<string, ConnectionsNode>();
    for (const n of subgraph?.nodes ?? []) m.set(n.id, n);
    return m;
  }, [subgraph]);

  const edgeBetween = useMemo(() => {
    const map = new Map<string, ConnectionsEdge>();
    if (!subgraph) return () => undefined;
    const score = (e: ConnectionsEdge) =>
      (e.isCurrent ? 2 : 0) + (e.confidence === "high" ? 1 : 0);
    for (const e of subgraph.edges) {
      const k =
        e.source < e.target
          ? `${e.source}|${e.target}`
          : `${e.target}|${e.source}`;
      const prior = map.get(k);
      if (!prior || score(e) > score(prior)) map.set(k, e);
    }
    return (a: string, b: string) => {
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      return map.get(k);
    };
  }, [subgraph]);

  if (!name) return null;

  if (!isLoading && (!subgraph || subgraph.paths.length === 0)) {
    return (
      <ErrorSection
        title={name}
        description={
          t("mp_connections_no_paths_long") ||
          "No business-connection paths to other MPs were found for this candidate. Either they have no declared companies, or none of those companies share an officer/owner with another MP."
        }
      />
    );
  }

  const paths = subgraph?.paths ?? [];

  // Group paths by length so the page reads top-down: direct shared
  // companies (length 2) first, then 3rd-party connections (length 4).
  const buckets = new Map<number, typeof paths>();
  for (const p of paths) {
    const arr = buckets.get(p.length) ?? [];
    arr.push(p);
    buckets.set(p.length, arr);
  }
  const orderedLengths = Array.from(buckets.keys()).sort((a, b) => a - b);

  return (
    <>
      <Title
        description={`Business connection paths from ${name} to other MPs`}
        title={`${name} — ${t("mp_connections_full_title") || "Connections to other MPs"}`}
        className="text-base md:text-xl lg:text-2xl py-4 md:py-6"
      >
        <span className="inline-flex items-center gap-2">
          <Network className="h-5 w-5" />
          {name}
        </span>
      </Title>
      <div className="w-full max-w-5xl mx-auto px-4 pb-12 space-y-6">
        <p className="text-sm text-muted-foreground">
          {t("mp_connections_full_intro") ||
            "Each row is a shortest path through the business connections graph from this MP to another. Direct shared companies (2 steps) usually indicate an explicit business overlap; longer paths show indirect links through co-officers or owners."}
        </p>

        {orderedLengths.map((len) => {
          const list = buckets.get(len)!;
          return (
            <section key={len} className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {len === 2
                  ? t("mp_connections_section_direct") ||
                    "Direct shared companies"
                  : len === 4
                    ? t("mp_connections_section_indirect") ||
                      "Indirect connections (via shared associate)"
                    : `${len} ${t("connections_path_steps") || "step(s)"}`}
                <span className="ml-2 text-xs font-normal normal-case opacity-70">
                  {list.length}
                </span>
              </h2>
              <div className="flex flex-col gap-1.5">
                {list.map((p, i) => (
                  <ConnectionPathRow
                    key={`${p.targetMpNodeId}-${i}`}
                    path={p}
                    nodeById={nodeById}
                    edgeBetween={edgeBetween}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
};
