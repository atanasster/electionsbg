// The `/polls` hub's section-divider row — icon, uppercase label, optional
// hint, trailing rule. Extracted from `PollsScreen.tsx` so a sibling section
// component (`PresidentialPollsSection`) can render its OWN header as part
// of the same self-hiding unit, rather than the hub mounting a header
// unconditionally above a section that might have nothing to show — the
// orphaned-header shape `DashboardSection.tsx`'s own doc comment warns
// about, for the same reason it warns about it there.

import { FC, ReactNode } from "react";
import { Hint } from "@/ux/Hint";

export const PollsSectionHeader: FC<{
  icon: ReactNode;
  label: ReactNode;
  hint?: string;
}> = ({ icon, label, hint }) => {
  const content = (
    <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {icon}
      <span>{label}</span>
    </div>
  );
  return (
    <div className="flex items-center gap-3 mt-6 mb-2 first:mt-0">
      {hint ? (
        <Hint text={hint} underline={false}>
          {content}
        </Hint>
      ) : (
        content
      )}
      <div className="flex-1 h-px bg-border" />
    </div>
  );
};
