// Shared "Покажи още" incremental-pagination button, so every listing renders
// the same affordance (and resets live in one place at the call sites).

import { Button } from "@/components/ui/button";
import { useNewsLocale } from "../i18n";

export const LoadMore = ({
  remaining,
  onMore,
}: {
  remaining: number;
  onMore: () => void;
}) => {
  const { tr } = useNewsLocale();
  return (
    <div className="py-3">
      <Button variant="outline" size="sm" onClick={onMore}>
        {tr("Покажи още", "Show more")} ({remaining})
      </Button>
    </div>
  );
};
