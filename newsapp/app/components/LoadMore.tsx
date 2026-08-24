// Shared "Покажи още" incremental-pagination button, so every listing renders
// the same affordance (and resets live in one place at the call sites).

import { Button } from "@/components/ui/button";

export const LoadMore = ({
  remaining,
  onMore,
}: {
  remaining: number;
  onMore: () => void;
}) => (
  <div className="py-3">
    <Button variant="outline" size="sm" onClick={onMore}>
      Покажи още ({remaining})
    </Button>
  </div>
);
