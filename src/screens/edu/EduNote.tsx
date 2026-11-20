import type { FC } from "react";

/** A block whose source failed or is empty says so, rather than vanishing. */
export const EduNote: FC<{ children: string }> = ({ children }) => (
  <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
    {children}
  </p>
);
