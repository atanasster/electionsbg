// Renders the election-hub breadcrumb for the current route (or nothing when the
// route isn't a hub page). Mounted once in LayoutScreen so every analyses/reports
// page shows "Избори › <hub> › …" without per-screen wiring; the lookup lives in
// hubBreadcrumbFor.

import { FC } from "react";
import { useLocation } from "react-router-dom";
import { ElectionsBreadcrumb } from "./ElectionsBreadcrumb";
import { hubBreadcrumbFor } from "./hubBreadcrumbFor";

export const HubBreadcrumb: FC = () => {
  const { pathname } = useLocation();
  const trail = hubBreadcrumbFor(pathname);
  if (!trail) return null;
  return (
    <ElectionsBreadcrumb
      hub={trail.hub}
      section={trail.section}
      currentKey={trail.currentKey}
      className="mt-4 mb-1"
    />
  );
};
