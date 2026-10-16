// The dashed „could not be loaded" block every /sector/transport section renders
// when its source failed or came back empty — the section keeps its id and says
// so, rather than vanishing under a hub link that targets it (T9 F5).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { isBg } from "@/i18n";

export const TransportSourceNote: FC<{ what: { bg: string; en: string } }> = ({
  what,
}) => {
  const { i18n } = useTranslation();
  const bg = isBg(i18n.language);
  return (
    <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
      {bg
        ? `${what.bg} не можаха да се заредят.`
        : `${what.en} could not be loaded.`}
    </p>
  );
};
