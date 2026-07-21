// The person-page header — identity + party + (for MPs) a compact one-line bio. Thin wrapper
// over the shared PersonProfileHeader, which the candidate sub-pages reuse so a drill-down
// shows the same profile as this dashboard.

import { FC } from "react";
import { PersonProfileHeader } from "@/screens/components/candidates/PersonProfileHeader";
import type { PersonProfile } from "./usePersonProfile";

export const PersonHeader: FC<{ p: PersonProfile; mpId: number | null }> = ({
  p,
  mpId,
}) => <PersonProfileHeader name={p.name} mpId={mpId} profile={p} />;
