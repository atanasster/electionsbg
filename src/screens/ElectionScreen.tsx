import { DashboardScreen } from "./DashboardScreen";

// Per-election landing page at /elections/:date. The election date in the URL
// path is read by ElectionContext (via useParams) and overrides the
// ?elections= query param, so this can render the dashboard as-is.
export const ElectionScreen = () => {
  return <DashboardScreen />;
};
