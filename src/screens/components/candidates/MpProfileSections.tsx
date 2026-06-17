import { FC } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  Briefcase,
  Euro,
  Landmark,
  Vote,
  Wallet,
} from "lucide-react";
import { Link } from "@/ux/Link";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { useMpManagement } from "@/data/parliament/useMpManagement";
import { useMpConnections } from "@/data/parliament/useMpConnections";
import { useMpConnectedContracts } from "@/data/parliament/useMpConnectedContracts";
import { useMpConnectedFunds } from "@/data/funds/useMpConnectedFunds";
import { useMpAssets } from "@/data/parliament/useMpAssets";
import { useMpDeclarations } from "@/data/parliament/useMpDeclarations";
import { MpFinancialDeclarations } from "./MpFinancialDeclarations";
import { MpAssetsSummary } from "./MpAssetsSummary";
import { MpManagementRoles } from "./MpManagementRoles";
import { MpConnectionsMini } from "./MpConnectionsMini";
import { MpConnectedContractsTile } from "./MpConnectedContractsTile";
import { MpConnectedFundsTile } from "./MpConnectedFundsTile";
import { MpVotingTile } from "./MpVotingTile";
import { MpTwinsTile } from "./MpTwinsTile";

/** The parliament-member sections of a candidate page (voting, assets,
 * business, procurement, EU funds). Split out of `Candidate` so its MP-only
 * data hooks — every one of which reads the parliament index — mount *only*
 * for candidates that actually matched an MP. A non-MP candidate page never
 * renders this, so it never downloads parliament/index.json. */
export const MpProfileSections: FC<{ name: string; linkSlug: string }> = ({
  name,
  linkSlug,
}) => {
  const { t } = useTranslation();

  const { management, isLoading: mgmtLoading } = useMpManagement(name);
  const { subgraph, isLoading: connectionsLoading } = useMpConnections(name);
  const { entries: connectedContracts, isLoading: contractsLoading } =
    useMpConnectedContracts(name);
  const { entries: connectedFunds, isLoading: fundsLoading } =
    useMpConnectedFunds(name);
  const { rollup: assetsRollup, isLoading: assetsLoading } = useMpAssets(name);
  const { declarations, isLoading: declsLoading } = useMpDeclarations(name);

  const hasManagementRoles = (management?.roles?.length ?? 0) > 0;
  const hasConnections = subgraph != null && subgraph.nodes.length > 1;
  const hasContracts = connectedContracts.length > 0;
  const hasFunds = connectedFunds.length > 0;
  const hasAssets = assetsRollup != null;
  const hasFinancialDecls = declarations.some(
    (d) => d.ownershipStakes.length > 0,
  );
  // Keep the section visible while data is in flight so the tile's loading
  // skeleton can reserve space; hide it once we know there's nothing to show.
  const showBusiness =
    mgmtLoading || connectionsLoading || hasManagementRoles || hasConnections;
  const showProcurement = contractsLoading || hasContracts;
  const showFunds = fundsLoading || hasFunds;
  const showDeclarations =
    assetsLoading || declsLoading || hasAssets || hasFinancialDecls;

  return (
    <>
      <DashboardSection
        id="parliament"
        title={t("mp_section_voting") || "Voting & similarity"}
        icon={Vote}
      >
        <MpVotingTile name={name} linkSlug={linkSlug} />
        <MpTwinsTile name={name} />
      </DashboardSection>

      {showDeclarations && (
        <DashboardSection
          id="declarations"
          title={t("mp_section_assets") || "Assets & declarations"}
          icon={Wallet}
        >
          <MpAssetsSummary name={name} linkSlug={linkSlug} />
          <MpFinancialDeclarations name={name} />
        </DashboardSection>
      )}

      {showBusiness && (
        <DashboardSection
          id="declarations"
          title={t("mp_section_business") || "Business & management"}
          icon={Briefcase}
        >
          <MpManagementRoles name={name} />
          <MpConnectionsMini name={name} linkSlug={linkSlug} />
        </DashboardSection>
      )}

      {showProcurement && (
        <DashboardSection
          id="procurement"
          title={t("mp_section_procurement") || "Public procurement"}
          icon={Landmark}
        >
          <MpConnectedContractsTile name={name} linkSlug={linkSlug} />
        </DashboardSection>
      )}

      {showFunds && (
        <DashboardSection
          id="funds"
          title={t("mp_section_funds") || "EU funds"}
          icon={Euro}
        >
          <MpConnectedFundsTile name={name} linkSlug={linkSlug} />
        </DashboardSection>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>{t("mp_section_explore_more") || "Explore further"}:</span>
        <Link
          to="/governance"
          underline={false}
          className="inline-flex items-center gap-1 rounded-full border bg-card px-3 py-1 text-primary hover:underline"
        >
          {t("nav_governance") || "Governance"}
          <ArrowRight className="h-3 w-3" />
        </Link>
        <Link
          to="/parliament"
          underline={false}
          className="inline-flex items-center gap-1 rounded-full border bg-card px-3 py-1 text-primary hover:underline"
        >
          {t("dashboard_section_parliament")}
          <ArrowRight className="h-3 w-3" />
        </Link>
        <Link
          to="/connections"
          underline={false}
          className="inline-flex items-center gap-1 rounded-full border bg-card px-3 py-1 text-primary hover:underline"
        >
          {t("connections_link_label")}
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </>
  );
};
