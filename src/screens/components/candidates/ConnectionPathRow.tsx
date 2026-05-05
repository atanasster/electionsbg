import { FC, ReactNode, useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, Building2, ExternalLink, UserSquare2 } from "lucide-react";
import type {
  ConnectionsCompanyNode,
  ConnectionsEdge,
  ConnectionsNode,
  ConnectionsPath,
} from "@/data/dataTypes";
import { candidateUrlForMp } from "@/data/candidates/candidateSlug";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { useMps } from "@/data/parliament/useMps";
import { useCandidateName } from "@/data/candidates/useCandidateName";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/ux/Tooltip";
import { MpAvatar } from "./MpAvatar";

type Props = {
  path: ConnectionsPath;
  /** Lookup map for nodes referenced by the path (built once by the parent
   * from the per-MP file's `nodes` array). */
  nodeById: Map<string, ConnectionsNode>;
  /** Lookup map for edges between consecutive nodes. Keyed by
   * `${a}|${b}` where a,b are node ids — order-insensitive lookup. */
  edgeBetween: (a: string, b: string) => ConnectionsEdge | undefined;
};

const NON_MP_ICON: Record<"company" | "person", FC<{ className?: string }>> = {
  company: Building2,
  person: UserSquare2,
};

const NON_MP_DOT: Record<"company" | "person", string> = {
  company: "bg-amber-500",
  person: "bg-neutral-400",
};

const linkForNode = (n: ConnectionsNode): { to: string } | null => {
  if (n.type === "mp") return { to: candidateUrlForMp(n.mpId) };
  if (n.type === "company" && n.slug) return { to: `/mp/company/${n.slug}` };
  return null;
};

const truncate = (s: string, max: number) =>
  s.length > max ? s.slice(0, max - 1) + "…" : s;

const isTrOnlyCompany = (
  n: ConnectionsNode,
): n is ConnectionsCompanyNode & { uic: string } =>
  n.type === "company" && !n.slug && !!n.uic;

const TrOnlyCompanyTooltip: FC<{
  node: ConnectionsCompanyNode & { uic: string };
  children: ReactNode;
}> = ({ node, children }) => {
  const { t } = useTranslation();
  const content = (
    <div className="space-y-1">
      <div className="font-medium">{node.label}</div>
      <div className="text-xs space-y-0.5 opacity-90">
        {node.legalForm ? <div>{node.legalForm}</div> : null}
        {node.status ? (
          <div>
            {(t(`tr_status_${node.status}`) as string) || node.status}
          </div>
        ) : null}
        {node.seat ? <div>{node.seat}</div> : null}
      </div>
      <a
        href={`https://portal.registryagency.bg/CR/en/Reports/VerifiedPersonShortInfo?uic=${node.uic}`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-xs underline"
      >
        {t("tr_eik") || "UIC"} {node.uic}
        <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
  return <Tooltip content={content}>{children}</Tooltip>;
};

/** Renders one shortest-path chain as a horizontal row of node chips
 * separated by arrows, with a confidence/currency footer. The hub MP is
 * the first chip, the target MP the last. */
export const ConnectionPathRow: FC<Props> = ({
  path,
  nodeById,
  edgeBetween,
}) => {
  const { t } = useTranslation();
  const { partyGroupShortLabel } = useCanonicalParties();
  const { findMpById } = useMps();
  const { mpName } = useCandidateName();
  const labelFor = (n: ConnectionsNode): string => {
    if (n.type !== "mp") return n.label;
    const mp = findMpById(n.mpId);
    return mp ? mpName(mp) : n.label;
  };

  // Pre-resolve nodes once per render so we don't pay map lookups twice.
  const segments = useMemo(() => {
    return path.nodeIds
      .map((id) => nodeById.get(id))
      .filter((n): n is ConnectionsNode => n !== undefined);
  }, [path.nodeIds, nodeById]);

  if (segments.length < 2) return null;

  const source = segments[0];
  const target = segments[segments.length - 1];
  const sourceParty =
    source.type === "mp" && source.partyGroupShort
      ? (partyGroupShortLabel(source.partyGroupShort) ?? source.partyGroupShort)
      : null;
  const targetParty =
    target.type === "mp" && target.partyGroupShort
      ? (partyGroupShortLabel(target.partyGroupShort) ?? target.partyGroupShort)
      : null;

  return (
    <div className="rounded border border-border/60 px-3 py-2 hover:bg-muted/40 transition-colors">
      <div className="flex items-center gap-1.5 flex-wrap text-sm">
        {sourceParty ? (
          <span className="mr-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            ({sourceParty})
          </span>
        ) : null}
        {segments.map((node, i) => {
          const link = linkForNode(node);
          const isMp = node.type === "mp";
          const display = labelFor(node);
          const chipBody = (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full text-xs",
                "border border-border/60 bg-background",
                isMp ? "py-0.5 pl-0.5 pr-2" : "px-2 py-0.5",
                link && "hover:bg-muted",
              )}
              title={display}
            >
              {isMp ? (
                <MpAvatar mpId={node.mpId} name={display} className="h-5 w-5" />
              ) : (
                <>
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full inline-block",
                      NON_MP_DOT[node.type],
                    )}
                    aria-hidden
                  />
                  {(() => {
                    const Icon = NON_MP_ICON[node.type];
                    return <Icon className="h-3 w-3 opacity-60" />;
                  })()}
                </>
              )}
              <span
                className={cn(
                  "max-w-[14rem] truncate",
                  i === segments.length - 1 && "font-medium",
                )}
              >
                {truncate(display, 32)}
              </span>
            </span>
          );
          return (
            <div
              key={`${node.id}-${i}`}
              className="inline-flex items-center gap-1.5"
            >
              {link ? (
                <Link to={link.to} className="no-underline">
                  {chipBody}
                </Link>
              ) : isTrOnlyCompany(node) ? (
                <TrOnlyCompanyTooltip node={node}>
                  {chipBody}
                </TrOnlyCompanyTooltip>
              ) : (
                chipBody
              )}
              {i < segments.length - 1 ? (
                <EdgeIndicator
                  edge={edgeBetween(segments[i].id, segments[i + 1].id)}
                />
              ) : null}
            </div>
          );
        })}
        {targetParty ? (
          <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            ({targetParty})
          </span>
        ) : null}
      </div>
      <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
        <span>
          {path.length} {t("connections_path_steps") || "step(s)"}
        </span>
        <span className="opacity-50">·</span>
        <span
          className={cn(
            path.isAllCurrent ? "text-emerald-700" : "text-amber-700",
          )}
        >
          {path.isAllCurrent
            ? t("connections_path_current") || "currently active"
            : t("connections_path_has_historical") || "includes historical"}
        </span>
        {!path.isAllHighConfidence ? (
          <>
            <span className="opacity-50">·</span>
            <span className="text-amber-700">
              {t("connections_path_lower_conf") || "name-match link"}
            </span>
          </>
        ) : null}
      </div>
    </div>
  );
};

const EdgeIndicator: FC<{ edge?: ConnectionsEdge }> = ({ edge }) => {
  if (!edge) {
    return <ArrowRight className="h-3 w-3 text-muted-foreground" />;
  }
  const color =
    edge.kind === "declared_stake" ? "text-blue-500" : "text-amber-600";
  const dashed = !edge.isCurrent;
  return (
    <span className="inline-flex items-center text-[10px] text-muted-foreground">
      <span
        aria-hidden
        className={cn(
          "inline-block w-3 border-t",
          color,
          dashed ? "border-dashed" : "border-solid",
        )}
      />
      <ArrowRight className={cn("h-3 w-3 -ml-0.5", color)} />
    </span>
  );
};
