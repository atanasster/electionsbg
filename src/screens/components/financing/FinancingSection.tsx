import { FC, PropsWithChildren, ReactNode } from "react";
import { LucideIcon } from "lucide-react";
import { Hint } from "@/ux/Hint";

// A top-level section divider for the financing dashboard, styled like the
// home-page DashboardSection: an uppercase kicker with an icon and a trailing
// rule. Groups related tiles/tables under one heading (Приходи / Разходи).
export const FinancingSection: FC<
  PropsWithChildren<{ title: ReactNode; icon: LucideIcon; hint?: ReactNode }>
> = ({ title, icon: Icon, hint, children }) => {
  const kicker = (
    <div className="flex shrink-0 items-center gap-2 text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
      <Icon className="h-4 w-4" />
      <span>{title}</span>
    </div>
  );
  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        {hint ? (
          <Hint text={hint} underline={false}>
            {kicker}
          </Hint>
        ) : (
          kicker
        )}
        <span
          aria-hidden
          className="hidden h-px flex-1 bg-gradient-to-r from-foreground/20 via-foreground/10 to-transparent sm:block"
        />
      </div>
      {children}
    </section>
  );
};
